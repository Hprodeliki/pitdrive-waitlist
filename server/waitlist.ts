import { CONSENT_VERSION, LIMITS, UTM_KEYS, cleanShort, validateWaitlist } from '../shared/waitlist.js';
import type { Queryable } from './db.js';
import { clientIp, hashIp, isAllowedOrigin, json, readJson } from './http.js';
import { hit } from './rate-limit.js';

export interface WaitlistDeps {
  db: Queryable;
  salt: string;
  allowedOrigins: string[];
}

/** Envios por IP a cada 15 minutos (folga para IPs compartilhados de operadora móvel). */
export const SIGNUP_LIMIT = 10;
export const SIGNUP_WINDOW_SECONDS = 15 * 60;
/** Humanos levam mais que isso para preencher nome + e-mail + consentimento. */
export const MIN_FILL_MS = 2500;

const OK = () => json(200, { ok: true });

export async function handleWaitlist(request: Request, deps: WaitlistDeps): Promise<Response> {
  if (!isAllowedOrigin(request, deps.allowedOrigins)) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const ipKey = `signup:${hashIp(clientIp(request), deps.salt)}`;
  if (!(await hit(deps.db, ipKey, SIGNUP_LIMIT, SIGNUP_WINDOW_SECONDS))) {
    return json(429, { ok: false, error: 'rate_limited' }, { 'retry-after': String(SIGNUP_WINDOW_SECONDS) });
  }

  // Armadilhas para robôs: campo invisível preenchido ou envio rápido demais.
  // Respondemos "ok" para não ensinar o robô a contornar, mas nada é gravado.
  const honeypot = typeof body.website === 'string' && body.website.trim() !== '';
  const elapsed = typeof body.elapsedMs === 'number' ? body.elapsedMs : 0;
  if (honeypot || elapsed < MIN_FILL_MS) return OK();

  const { data, errors } = validateWaitlist(body);
  if (Object.keys(errors).length > 0) {
    return json(400, { ok: false, error: 'invalid', fields: errors });
  }

  const utmRaw = (body.utm && typeof body.utm === 'object' ? body.utm : {}) as Record<string, unknown>;
  const utm = UTM_KEYS.map((key) => cleanShort(utmRaw[key], LIMITS.utmMax));
  const landingPath = cleanPath(body.landingPath);
  const referrerHost = cleanHost(body.referrerHost);

  try {
    // E-mail já na lista: nada muda (primeira origem fica preservada).
    // E-mail descadastrado que volta a se inscrever: novo consentimento, volta para WAITLISTED.
    await deps.db.query(
      `INSERT INTO waitlist_leads
         (name, email, car, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          landing_path, referrer_host, consent_given, consent_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
       ON CONFLICT (email) DO UPDATE SET
         status = 'WAITLISTED',
         unsubscribed_at = NULL,
         name = EXCLUDED.name,
         car = COALESCE(EXCLUDED.car, waitlist_leads.car),
         consent_given = true,
         consent_version = EXCLUDED.consent_version,
         consent_at = now(),
         updated_at = now()
       WHERE waitlist_leads.status = 'UNSUBSCRIBED'`,
      [data.name, data.email, data.car, ...utm, landingPath, referrerHost, CONSENT_VERSION],
    );
  } catch (err) {
    // Só o código do erro: nunca logar e-mail/nome.
    const code = (err as { code?: string }).code ?? 'unknown';
    console.error(`[waitlist] erro ao gravar lead (pg ${code})`);
    return json(500, { ok: false, error: 'server' });
  }

  // Mesma resposta para novo e duplicado: a API não revela quem já está na lista.
  return OK();
}

export function cleanPath(value: unknown): string | null {
  const v = cleanShort(value, LIMITS.pathMax);
  return v && v.startsWith('/') ? v : null;
}

export function cleanHost(value: unknown): string | null {
  const v = cleanShort(value, LIMITS.hostMax)?.toLowerCase() ?? null;
  return v && /^[a-z0-9.-]+$/.test(v) ? v : null;
}
