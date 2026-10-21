import { createHash } from 'node:crypto';

export const MAX_BODY_BYTES = 4096;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export function methodNotAllowed(): Response {
  return json(405, { ok: false, error: 'method_not_allowed' }, { allow: 'POST' });
}

/** IP do cliente atrás do proxy da Vercel (x-real-ip / primeiro x-forwarded-for). */
export function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return 'unknown';
}

/** Nunca guardamos o IP: só um hash com sal, usado para rate limit. */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

/**
 * Aceita apenas POSTs vindos da própria página (mesmo host) ou de origens
 * listadas em ALLOWED_ORIGINS. Requisições sem Origin (curl, scripts) são recusadas.
 */
export function isAllowedOrigin(request: Request, allowedOrigins: string[]): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  if (originHost === host) return true;
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).host === originHost;
    } catch {
      return false;
    }
  });
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export type BodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

/**
 * Lê JSON com limite de tamanho e content-type obrigatório.
 * `allowTextPlain` existe para o sendBeacon, que envia text/plain sem preflight.
 */
export async function readJson(request: Request, { allowTextPlain = false } = {}): Promise<BodyResult> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  const accepted = type.startsWith('application/json') || (allowTextPlain && type.startsWith('text/plain'));
  if (!accepted) {
    return { ok: false, response: json(415, { ok: false, error: 'unsupported_media_type' }) };
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, response: json(413, { ok: false, error: 'payload_too_large' }) };
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return { ok: false, response: json(413, { ok: false, error: 'payload_too_large' }) };
  }
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: json(400, { ok: false, error: 'invalid_json' }) };
  }
}

export function deviceFrom(request: Request): 'mobile' | 'desktop' {
  const ua = request.headers.get('user-agent') ?? '';
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? 'mobile' : 'desktop';
}

/** Lê a config de ambiente necessária às rotas. */
export function serverConfig() {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error('IP_HASH_SALT não configurado');
  return { salt, allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS) };
}
