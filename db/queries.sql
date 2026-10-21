-- Consultas úteis (rode no console SQL do provedor do banco, ex.: Neon → SQL Editor).
-- A lista de leads só é acessível por aqui: não existe endpoint público de leitura.

-- 1) Funil por origem: visitas → CTA → formulário → envio → sucesso → leads ----------
WITH ev AS (
  SELECT COALESCE(utm_source, 'direto') AS origem,
         COALESCE(utm_campaign, '-')    AS campanha,
         name, page_id
  FROM waitlist_events
  WHERE created_at >= now() - interval '30 days'
),
funil AS (
  SELECT origem, campanha,
         count(DISTINCT page_id) FILTER (WHERE name = 'waitlist_page_view')  AS visitas,
         count(DISTINCT page_id) FILTER (WHERE name = 'waitlist_cta_click')  AS cliques_cta,
         count(DISTINCT page_id) FILTER (WHERE name = 'waitlist_form_start') AS form_iniciado,
         count(DISTINCT page_id) FILTER (WHERE name = 'waitlist_submit')     AS envios,
         count(DISTINCT page_id) FILTER (WHERE name = 'waitlist_success')    AS sucesso
  FROM ev GROUP BY 1, 2
),
leads AS (
  SELECT COALESCE(utm_source, 'direto') AS origem, COALESCE(utm_campaign, '-') AS campanha, count(*) AS leads
  FROM waitlist_leads
  WHERE created_at >= now() - interval '30 days'
  GROUP BY 1, 2
)
SELECT COALESCE(f.origem, l.origem) AS origem, COALESCE(f.campanha, l.campanha) AS campanha,
       COALESCE(visitas, 0) AS visitas, COALESCE(cliques_cta, 0) AS cliques_cta,
       COALESCE(form_iniciado, 0) AS form_iniciado, COALESCE(envios, 0) AS envios,
       COALESCE(sucesso, 0) AS sucesso, COALESCE(leads, 0) AS leads,
       round(100.0 * COALESCE(leads, 0) / NULLIF(visitas, 0), 1) AS conversao_pct
FROM funil f FULL JOIN leads l USING (origem, campanha)
ORDER BY visitas DESC NULLS LAST;
-- "sucesso" (evento do navegador) pode ficar um pouco abaixo de "leads" se algum bloqueador
-- impedir o evento; "leads" é a fonte de verdade.

-- 2) Leads por dia e origem --------------------------------------------------------
SELECT date_trunc('day', created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
       COALESCE(utm_source, 'direto') AS origem, count(*) AS leads
FROM waitlist_leads GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;

-- 3) Carros mais informados (texto livre, agrupado de forma simples) ----------------
SELECT lower(car) AS carro, count(*) AS pessoas
FROM waitlist_leads WHERE car IS NOT NULL AND status = 'WAITLISTED'
GROUP BY 1 ORDER BY 2 DESC LIMIT 50;

-- 4) Exportar lista ativa para o aviso de lançamento ------------------------------
SELECT name, email, car, created_at
FROM waitlist_leads WHERE status = 'WAITLISTED' ORDER BY created_at;

-- 5) Descadastrar alguém que pediu por e-mail --------------------------------------
-- UPDATE waitlist_leads SET status = 'UNSUBSCRIBED', unsubscribed_at = now(), updated_at = now()
-- WHERE email = lower(trim('pessoa@email.com'));

-- 6) Excluir os dados de alguém (pedido de exclusão LGPD) --------------------------
-- DELETE FROM waitlist_leads WHERE email = lower(trim('pessoa@email.com'));

-- 7) Erros no formulário (para achar atrito) ---------------------------------------
SELECT error_code, device, count(*) FROM waitlist_events
WHERE name = 'waitlist_error' GROUP BY 1, 2 ORDER BY 3 DESC;
