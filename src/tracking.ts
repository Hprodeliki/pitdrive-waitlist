// Origem (UTM) e eventos de funil. Sem cookies, sem identificador persistente:
// - as UTMs ficam no sessionStorage da aba para não se perderem até o envio;
// - pageId é aleatório por carregamento de página e nunca é ligado ao lead.
import { LIMITS, UTM_KEYS, type EventName, type Utm } from '../shared/waitlist.js';

export interface Attribution {
  utm: Utm;
  landingPath: string;
  referrerHost: string | null;
}

const STORAGE_KEY = 'pd_waitlist_attr';

function safeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Lê UTMs da URL; se não houver, reaproveita as da sessão (ex.: recarregou a página). */
export function captureAttribution(location: Location = window.location, referrer = document.referrer): Attribution {
  const params = new URLSearchParams(location.search);
  const utm: Utm = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) utm[key] = value.slice(0, LIMITS.utmMax);
  }

  const storage = safeStorage();
  if (Object.keys(utm).length === 0 && storage) {
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as Attribution | null;
      if (saved && typeof saved === 'object' && saved.utm) return saved;
    } catch {
      /* sessão vazia ou inválida */
    }
  }

  let referrerHost: string | null = null;
  try {
    const host = referrer ? new URL(referrer).host : '';
    if (host && host !== location.host) referrerHost = host.slice(0, LIMITS.hostMax);
  } catch {
    /* referrer inválido */
  }

  const attribution: Attribution = { utm, landingPath: location.pathname.slice(0, LIMITS.pathMax), referrerHost };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    /* modo privado / armazenamento bloqueado: segue só em memória */
  }
  return attribution;
}

export function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export function createTracker(attribution: Attribution, pageId = randomId()) {
  const sent = new Set<string>();

  function track(name: EventName, extra: { cta?: string; errorCode?: string } = {}, once = false): void {
    const key = `${name}:${extra.cta ?? ''}`;
    if (once && sent.has(key)) return;
    sent.add(key);

    const payload = JSON.stringify({
      name,
      pageId,
      path: window.location.pathname,
      utm: attribution.utm,
      referrerHost: attribution.referrerHost,
      ...extra,
    });
    try {
      // text/plain não dispara preflight e sobrevive à navegação/fechamento da aba.
      if (navigator.sendBeacon?.('/api/event', new Blob([payload], { type: 'text/plain' }))) return;
    } catch {
      /* cai no fetch abaixo */
    }
    void fetch('/api/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  }

  return { track, pageId };
}
