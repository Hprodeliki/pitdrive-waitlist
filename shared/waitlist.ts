// Regras compartilhadas entre o navegador e o servidor.
// O servidor é sempre a fonte de verdade; o navegador usa só para feedback rápido.

/** Muda sempre que o texto do consentimento ou da política mudar. */
export const CONSENT_VERSION = '2026-10-21-provisoria';

export const LIMITS = {
  nameMin: 2,
  nameMax: 80,
  emailMax: 254,
  carMax: 80,
  utmMax: 100,
  pathMax: 200,
  hostMax: 253,
} as const;

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;

export const EVENT_NAMES = [
  'waitlist_page_view',
  'waitlist_cta_view',
  'waitlist_cta_click',
  'waitlist_form_start',
  'waitlist_submit',
  'waitlist_success',
  'waitlist_error',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const CTA_LOCATIONS = ['hero', 'sticky', 'como-funciona'] as const;

// Caracteres de controle e invisíveis (zero-width, bidi) que não têm lugar em nome/carro.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Remove caracteres invisíveis, colapsa espaços e apara. */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/\s+/g, ' ').replace(INVISIBLE, '').trim();
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLE, '').replace(/\s+/g, '').toLowerCase();
}

// Formato prático (não RFC completo): local@dominio.tld, sem espaços, TLD com 2+ letras.
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;

export function isValidEmail(email: string): boolean {
  if (email.length < 6 || email.length > LIMITS.emailMax) return false;
  const [local] = email.split('@');
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return EMAIL_RE.test(email);
}

export type FieldErrors = Partial<Record<'name' | 'email' | 'car' | 'consent', string>>;

export interface WaitlistInput {
  name: string;
  email: string;
  car: string | null;
  consent: boolean;
}

export const MESSAGES = {
  nameRequired: 'Informe seu nome.',
  nameShort: 'O nome precisa ter pelo menos 2 letras.',
  nameLong: `Use no máximo ${LIMITS.nameMax} caracteres.`,
  emailRequired: 'Informe seu e-mail.',
  emailInvalid: 'Confira o e-mail. Exemplo: nome@email.com',
  carLong: `Use no máximo ${LIMITS.carMax} caracteres.`,
  consentRequired: 'Marque a caixa para receber o aviso.',
} as const;

/** Normaliza e valida os campos do formulário. */
export function validateWaitlist(raw: { name?: unknown; email?: unknown; car?: unknown; consent?: unknown }): {
  data: WaitlistInput;
  errors: FieldErrors;
} {
  const name = cleanText(raw.name);
  const email = normalizeEmail(raw.email);
  const car = cleanText(raw.car);
  const consent = raw.consent === true;
  const errors: FieldErrors = {};

  if (!name) errors.name = MESSAGES.nameRequired;
  else if (name.length < LIMITS.nameMin || !/\p{L}/u.test(name)) errors.name = MESSAGES.nameShort;
  else if (name.length > LIMITS.nameMax) errors.name = MESSAGES.nameLong;

  if (!email) errors.email = MESSAGES.emailRequired;
  else if (!isValidEmail(email)) errors.email = MESSAGES.emailInvalid;

  if (car.length > LIMITS.carMax) errors.car = MESSAGES.carLong;

  if (!consent) errors.consent = MESSAGES.consentRequired;

  return { data: { name, email, car: car || null, consent }, errors };
}

/** Valor de UTM/rota: texto curto, sem caracteres invisíveis; vazio vira null. */
export function cleanShort(value: unknown, max: number): string | null {
  const v = cleanText(value);
  return v ? v.slice(0, max) : null;
}
