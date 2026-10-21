import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, defineConfig, loadEnv, type Connect, type Plugin, type ViteDevServer } from 'vite';

/**
 * URL pública usada em canonical/Open Graph. Ordem:
 * SITE_URL (ex.: https://pitdrive.com.br) → domínio de produção da Vercel → URL do deploy → localhost.
 */
function resolveSiteUrl(env: Record<string, string>): string {
  const url =
    env.SITE_URL ||
    (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : env.VERCEL_URL
        ? `https://${env.VERCEL_URL}`
        : 'http://localhost:5173');
  return url.replace(/\/+$/, '');
}

function siteUrlPlugin(siteUrl: string): Plugin {
  return {
    name: 'pitdrive-site-url',
    transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteUrl),
  };
}

/** Mesmas URLs limpas da Vercel no `vite dev` / `vite preview`. */
const PAGES: Record<string, string> = {
  '/': '/lista-de-espera.html',
  '/espera': '/lista-de-espera.html',
  '/lista-de-espera': '/lista-de-espera.html',
  '/privacidade': '/privacidade.html',
};

/**
 * Roda as funções de /api localmente (dev e preview), sem precisar do `vercel dev`.
 * Em produção quem executa /api/*.ts é a própria Vercel.
 */
function localApiPlugin(): Plugin {
  let dev: ViteDevServer | undefined;

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const [path, query = ''] = (req.url ?? '/').split('?');
    const page = PAGES[path!.replace(/\/+$/, '') || '/'];
    if (page && req.method === 'GET') {
      req.url = page + (query ? `?${query}` : '');
      return next();
    }
    const match = /^\/api\/(waitlist|event)$/.exec(path!);
    if (!match) return next();
    // Beacons cancelados quando a aba fecha geram "aborted": ignorar no servidor local.
    void handleApi(match[1]!, req, res).catch((err: Error) => (err.message === 'aborted' ? undefined : next(err)));
  };

  async function handleApi(route: string, req: IncomingMessage, res: ServerResponse) {
    // No preview não há servidor de dev: cria um carregador SSR só para /api.
    dev ??= await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
    const mod = (await dev.ssrLoadModule(`/api/${route}.ts`)) as Record<string, (r: Request) => Promise<Response>>;
    const handler = mod[req.method ?? 'GET'];
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const response = handler ? await handler(request) : new Response(null, { status: 405 });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  return {
    name: 'pitdrive-local-api',
    configureServer(server) {
      dev = server;
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') } as Record<string, string>;
  // As funções /api leem process.env (DATABASE_URL, IP_HASH_SALT...) também no dev local.
  for (const [key, value] of Object.entries(env)) process.env[key] ??= value;

  return {
    plugins: [siteUrlPlugin(resolveSiteUrl(env)), localApiPlugin()],
    build: {
      target: 'es2020',
      rollupOptions: {
        input: {
          waitlist: resolve('lista-de-espera.html'),
          privacy: resolve('privacidade.html'),
        },
      },
    },
  };
});
