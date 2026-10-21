# PitDrive — landing de lista de espera

Página de pré-lançamento separada da landing principal. Objetivo único: **visitante → interesse → cadastro na lista**,
medindo de onde cada pessoa veio e qual carro ela tem.

- Página: `/lista-de-espera` (também responde em `/` e `/espera` neste deploy)
- Política de privacidade provisória: `/privacidade`
- API: `POST /api/waitlist` (cadastro) e `POST /api/event` (eventos de funil). Não existe nenhuma rota que leia a lista.

## Decisões de arquitetura

| Tema | Decisão | Por quê |
| --- | --- | --- |
| Projeto | Vite + TypeScript sem framework, funções em `/api` da Vercel | O código do PitDrive ainda não está no GitHub e o backend NestJS (Render) não está no ar. Isso põe a lista no ar hoje sem depender dele. Vite é o mesmo do frontend. Só ~3 KB de JS (gzip). |
| Banco | Qualquer PostgreSQL via `DATABASE_URL` (recomendado: Neon pela Vercel Marketplace, plano grátis) | Mesmo banco do stack (Postgres). Tabelas com os mesmos nomes que o modelo Prisma em `db/prisma-model.prisma`, para migrar depois para o NestJS sem conversão. |
| Rate limit | Tabela `rate_limits` no próprio Postgres, chave = hash do IP | Evita Redis/Upstash só para isso. IP nunca é gravado em texto. |
| Analytics | Primeira parte: eventos anônimos na tabela `waitlist_events` | Não havia analytics na landing atual. Vercel Analytics só tem eventos customizados no plano Pro; PostHog é bom mas pesa ~50 KB e usa cookies/armazenamento persistente (exige banner). Assim: zero cookies, zero terceiros, sem banner, funil por UTM em SQL (`db/queries.sql`). |
| Fontes | Kanit + Instrument Sans auto-hospedadas (as mesmas da landing principal) | Sem Google Fonts: mais rápido e não envia IP do visitante ao Google. |
| E-mail de confirmação | **Não implementado** (ver "Próximos passos") | Prioridade é capturar o lead. Resend está no stack, mas não há chave/domínio verificado para este projeto. |

## Estrutura

```
lista-de-espera.html   página principal (HTML estático, carrega rápido)
privacidade.html       política provisória
src/                   CSS e JS do navegador (formulário, UTM, eventos)
shared/waitlist.ts     validação/normalização usada no navegador e no servidor
api/                   funções da Vercel (rotas públicas)
server/                lógica das rotas: validação, anti-spam, rate limit, banco
db/schema.sql          tabelas (idempotente)  ·  db/queries.sql  consultas de funil/exportação
db/prisma-model.prisma referência para migrar ao backend NestJS
tests/                 unitários, integração com Postgres e e2e (Playwright)
public/                logo, favicons e og-image.png (1200x630)
```

## Rodar localmente

Requisitos: Node 20+ e um PostgreSQL (local, Docker ou um banco grátis no Neon).

```bash
npm install
cp .env.example .env.local          # edite DATABASE_URL e IP_HASH_SALT
npm run db:migrate                  # cria as tabelas
npm run dev                         # http://localhost:5173/lista-de-espera
```

Postgres rápido com Docker:

```bash
docker run -d --name pitdrive-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 5432:5432 postgres:16
docker exec pitdrive-pg createdb -U postgres pitdrive_waitlist
docker exec pitdrive-pg createdb -U postgres pitdrive_test
```

`npm run dev` já executa `/api/*` localmente (não precisa do `vercel dev`).
Para testar no celular na mesma rede: `npm run dev -- --host` e abra o IP da máquina.

## Testes e verificação

```bash
npm run typecheck
npm run lint
npm test                                                     # só unitários
TEST_DATABASE_URL=postgres://postgres@localhost:5432/pitdrive_test npm test         # + integração (banco é limpo!)
npx playwright install chromium                              # uma vez
TEST_DATABASE_URL=postgres://postgres@localhost:5432/pitdrive_test npm run test:e2e # e2e iPhone/Android/desktop
npm run build
```

Use um banco **só para testes** em `TEST_DATABASE_URL`: os testes apagam as tabelas.

## Variáveis de ambiente (Vercel → Project → Settings → Environment Variables)

| Variável | Obrigatória | Valor |
| --- | --- | --- |
| `DATABASE_URL` | Sim | Connection string do Postgres. No Neon, use a **pooled** (host com `-pooler`) e `sslmode=require`. Se conectar o Neon pela Marketplace da Vercel, ela é criada automaticamente. |
| `IP_HASH_SALT` | Sim | Texto aleatório secreto: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SITE_URL` | Não | Só quando tiver domínio: `https://pitdrive.com.br`. Sem ela, canonical/Open Graph usam o domínio `*.vercel.app` de produção automaticamente. |
| `ALLOWED_ORIGINS` | Não | Outras origens que podem enviar o formulário, separadas por vírgula. O domínio da própria página já é aceito. |

Marque `DATABASE_URL` e `IP_HASH_SALT` para **Production** e **Preview** (o preview pode usar um banco/branch separado).

## Deploy na Vercel (manual)

1. Crie o repositório no GitHub e envie esta pasta (`git init && git add . && git commit -m "Landing lista de espera" && git push`).
   `.env.local` e `node_modules` já estão no `.gitignore`.
2. Na Vercel: **Add New → Project → Import** o repositório. O framework é detectado como Vite; build `npm run build`, saída `dist` (já em `vercel.json`).
3. Banco: no projeto da Vercel, **Storage → Create Database → Neon (Postgres)**. Escolha a região **São Paulo (sa-east-1)** se estiver disponível. Isso cria `DATABASE_URL`.
4. Adicione `IP_HASH_SALT` em Settings → Environment Variables.
5. Tabelas: a migration (`npm run db:migrate`, idempotente) roda sozinha antes de cada build na Vercel
   (`buildCommand` em `vercel.json`). Se o primeiro deploy acontecer antes de conectar o banco, ela é pulada com aviso:
   depois de conectar o Neon, faça **Redeploy**. Também dá para rodar do seu computador:
   `DATABASE_URL="<url do Neon>" npm run db:migrate`.
6. **Deploy**. Abra `https://<projeto>.vercel.app/lista-de-espera`, faça um cadastro de teste e confira no SQL Editor:
   `SELECT name, email, utm_source, created_at FROM waitlist_leads;`
7. Teste o compartilhamento: cole o link no WhatsApp ou em <https://www.opengraph.xyz> para ver a imagem.

As funções rodam em `gru1` (São Paulo), configurado em `vercel.json`.

### Links para a bio

```
https://<projeto>.vercel.app/lista-de-espera?utm_source=tiktok&utm_medium=bio&utm_campaign=waitlist
https://<projeto>.vercel.app/lista-de-espera?utm_source=instagram&utm_medium=bio&utm_campaign=waitlist
https://<projeto>.vercel.app/lista-de-espera?utm_source=youtube&utm_medium=bio&utm_campaign=waitlist
```

Para vídeos específicos, use `utm_content` (ex.: `utm_content=v2-fluido-freio`).

### Quando o domínio próprio chegar

1. Adicione `pitdrive.com.br` em Settings → Domains.
2. Configure `SITE_URL=https://pitdrive.com.br` e faça redeploy.
3. Se a landing principal passar a ocupar `/` no mesmo domínio, remova a regra `"source": "/"` de `vercel.json`.

## Como medir

Tudo em `db/queries.sql` (rode no SQL Editor do Neon):

1. **Funil por origem/campanha**: visitas → clique no CTA → formulário iniciado → envio → sucesso → leads, com % de conversão.
2. Leads por dia e origem.
3. Carros mais informados.
4. Exportar a lista para o aviso de lançamento.
5. Descadastrar ou excluir alguém que pediu por e-mail.
6. Erros do formulário por dispositivo.

Eventos registrados: `waitlist_page_view`, `waitlist_cta_view`, `waitlist_cta_click` (com local: `hero`, `sticky`,
`como-funciona`), `waitlist_form_start`, `waitlist_submit`, `waitlist_success`, `waitlist_error` (com código).
Cada evento leva as UTMs da visita, o site de origem e o tipo de dispositivo. Nenhum leva nome, e-mail ou IP.

## Segurança

- Validação e normalização no servidor (nome 2–80, e-mail em minúsculas e sem espaços, carro até 80, consentimento obrigatório).
- Queries parametrizadas (sem SQL concatenado); o carro aparece na tela de sucesso via `textContent` (sem HTML).
- E-mail único (`UNIQUE`). Duplicado recebe a **mesma resposta** que um novo cadastro: a API não revela quem está na lista.
- Anti-robô: campo armadilha invisível, tempo mínimo de preenchimento (2,5 s); robôs recebem "ok" e nada é gravado.
- Rate limit: 10 cadastros e 300 eventos por IP a cada 15 min.
- Só aceita POST com `Origin` do próprio domínio, JSON de até 4 KB.
- Sem rota de leitura; GET/PUT/PATCH/DELETE retornam 405.
- Logs nunca incluem e-mail ou nome (só o código do erro do banco).
- Cabeçalhos: CSP restrita, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`.

## LGPD (mínimo implementado)

- Coleta só nome, e-mail, carro (opcional) e origem. Sem CPF, RG, placa, RENAVAM ou chassi.
- Checkbox específico, desmarcado por padrão: "Quero receber novidades e ser avisado quando o PitDrive estiver disponível."
- Registro de consentimento: `consent_given`, `consent_at`, `consent_version` (`2026-10-21-provisoria`, em `shared/waitlist.ts`).
  Ao mudar o texto do consentimento ou da política, troque a versão.
- Status `WAITLISTED` / `UNSUBSCRIBED` e `unsubscribe_token` pronto para um link de descadastro nos e-mails futuros.
- **Política de privacidade provisória, pendente de revisão jurídica**, com os pontos em aberto marcados em amarelo na página:
  identificação do controlador (nome/CNPJ ou CPF), lista de provedores e transferência internacional, prazo de retenção, base legal.

## Próximos passos (fora deste escopo)

- **E-mail de confirmação via Resend**: depois de verificar um domínio no Resend, chamar a API dentro de
  `server/waitlist.ts` só quando o lead for novo, com link de descadastro usando `unsubscribe_token`.
  Sem domínio próprio, o Resend só envia para o seu próprio e-mail, por isso ficou para depois.
- Rota de descadastro por link (`/api/unsubscribe?token=...`) quando os e-mails começarem.
- Migrar a lista para o backend NestJS: usar `db/prisma-model.prisma` e importar a tabela.
