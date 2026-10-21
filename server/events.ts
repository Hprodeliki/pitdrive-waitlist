import { CTA_LOCATIONS, EVENT_NAMES, LIMITS, UTM_KEYS, cleanShort } from '../shared/waitlist.js';
import type { Queryable } from './db.js';
import { clientIp, deviceFrom, hashIp, isAllowedOrigin, json, noContent, readJson } from './http.js';
import { hit } from './rate-limit.js';
import { cleanHost, cleanPath } from './waitlist.js';

export interface EventDeps {
  db: Queryable;
  salt: string;
  allowedOrigins: string[];
}

export const EVENT_LIMIT = 300;
export const EVENT_WINDOW_SECONDS = 15 * 60;

/** Recebe eventos anônimos de funil. Nunca falha de forma visível para a página. */
export async function handleEvent(request: Request, deps: EventDeps): Promise<Response> {
  if (!isAllowedOrigin(request, deps.allowedOrigins)) return json(403, { ok: false, error: 'forbidden' });

  const parsed = await readJson(request, { allowTextPlain: true });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const name = body.name;
  const pageId = body.pageId;
  if (typeof name !== 'string' || !(EVENT_NAMES as readonly string[]).includes(name)) {
    return json(400, { ok: false, error: 'invalid' });
  }
  if (typeof pageId !== 'string' || !/^[a-z0-9]{8,32}$/i.test(pageId)) {
    return json(400, { ok: false, error: 'invalid' });
  }

  const ipKey = `event:${hashIp(clientIp(request), deps.salt)}`;
  if (!(await hit(deps.db, ipKey, EVENT_LIMIT, EVENT_WINDOW_SECONDS))) return noContent();

  const cta = typeof body.cta === 'string' && (CTA_LOCATIONS as readonly string[]).includes(body.cta) ? body.cta : null;
  const errorCode = typeof body.errorCode === 'string' && /^[a-z_]{1,32}$/.test(body.errorCode) ? body.errorCode : null;
  const utmRaw = (body.utm && typeof body.utm === 'object' ? body.utm : {}) as Record<string, unknown>;
  const utm = UTM_KEYS.map((key) => cleanShort(utmRaw[key], LIMITS.utmMax));

  try {
    await deps.db.query(
      `INSERT INTO waitlist_events
         (name, page_id, path, cta, error_code, device,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer_host)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [name, pageId, cleanPath(body.path), cta, errorCode, deviceFrom(request), ...utm, cleanHost(body.referrerHost)],
    );
  } catch (err) {
    console.error(`[event] erro ao gravar evento (pg ${(err as { code?: string }).code ?? 'unknown'})`);
  }
  return noContent();
}
