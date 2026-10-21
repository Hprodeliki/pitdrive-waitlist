import { validateWaitlist, type FieldErrors } from '../shared/waitlist.js';
import { captureAttribution, createTracker } from './tracking.js';

const attribution = captureAttribution();
const { track } = createTracker(attribution);
const renderedAt = performance.now();

track('waitlist_page_view');

const form = document.getElementById('waitlist-form') as HTMLFormElement;
const status = document.getElementById('form-status') as HTMLElement;
const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
const signup = document.getElementById('lista') as HTMLElement;
const nameInput = form.elements.namedItem('name') as HTMLInputElement;

const FIELDS = ['name', 'email', 'car', 'consent'] as const;
type Field = (typeof FIELDS)[number];

// CTAs: rolam até o formulário e põem o foco no primeiro campo.
document.querySelectorAll<HTMLAnchorElement>('[data-cta]').forEach((link) => {
  link.addEventListener('click', (event) => {
    track('waitlist_cta_click', { cta: link.dataset.cta });
    if (!form.isConnected || form.hidden) return;
    event.preventDefault();
    signup.scrollIntoView({ block: 'start' });
    nameInput.focus({ preventScroll: true });
    history.replaceState(null, '', `${location.pathname}${location.search}#lista`);
  });
});

// CTA visto + CTA fixo no celular (aparece quando o botão do topo sai da tela e o formulário ainda não está visível).
const heroCta = document.getElementById('hero-cta');
const sticky = document.getElementById('sticky-cta') as HTMLElement;
if ('IntersectionObserver' in window && heroCta) {
  let heroVisible = true;
  let signupVisible = false;
  const update = () => {
    sticky.hidden = heroVisible || signupVisible || form.hidden;
  };
  new IntersectionObserver(([entry]) => {
    heroVisible = entry!.isIntersecting;
    if (heroVisible) track('waitlist_cta_view', { cta: 'hero' }, true);
    update();
  }).observe(heroCta);
  new IntersectionObserver(([entry]) => {
    signupVisible = entry!.isIntersecting;
    update();
  }).observe(signup);
}

// Formulário iniciado: primeira interação com qualquer campo.
form.addEventListener('focusin', () => track('waitlist_form_start', {}, true), { once: true });

function setError(field: Field, message: string | undefined): void {
  const input = form.elements.namedItem(field) as HTMLInputElement;
  const error = document.getElementById(`f-${field}-error`) as HTMLElement;
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    error.textContent = message;
    error.hidden = false;
  } else {
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    error.hidden = true;
  }
}

function showErrors(errors: FieldErrors): void {
  for (const field of FIELDS) setError(field, errors[field]);
  const first = FIELDS.find((field) => errors[field]);
  if (first) (form.elements.namedItem(first) as HTMLInputElement).focus();
}

function readForm() {
  const value = (field: string) => (form.elements.namedItem(field) as HTMLInputElement).value;
  return {
    name: value('name'),
    email: value('email'),
    car: value('car'),
    consent: (form.elements.namedItem('consent') as HTMLInputElement).checked,
    website: value('website'),
  };
}

// Revalida um campo ao sair dele, só se já estava marcado como inválido.
form.addEventListener('focusout', (event) => {
  const input = event.target as HTMLInputElement;
  const field = input.name as Field;
  if (!FIELDS.includes(field) || input.getAttribute('aria-invalid') !== 'true') return;
  setError(field, validateWaitlist(readForm()).errors[field]);
});
form.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.name === 'consent' && input.checked) setError('consent', undefined);
});

function showSuccess(car: string | null): void {
  form.hidden = true;
  sticky.hidden = true;
  (document.getElementById('signup-intro') as HTMLElement).hidden = true;
  const success = document.getElementById('waitlist-success') as HTMLElement;
  if (car) {
    (document.getElementById('success-car-name') as HTMLElement).textContent = car;
    (document.getElementById('success-car') as HTMLElement).hidden = false;
  }
  success.hidden = false;
  const title = document.getElementById('success-title') as HTMLElement;
  title.focus({ preventScroll: true });
  signup.scrollIntoView({ block: 'start' });
}

let sending = false;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending) return;
  status.textContent = '';

  const raw = readForm();
  const { data, errors } = validateWaitlist(raw);
  if (Object.keys(errors).length > 0) {
    showErrors(errors);
    track('waitlist_error', { errorCode: 'client_validation' });
    return;
  }
  showErrors({});

  sending = true;
  submit.disabled = true;
  submit.textContent = 'Enviando…';
  track('waitlist_submit');

  try {
    const response = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...data,
        website: raw.website,
        elapsedMs: Math.round(performance.now() - renderedAt),
        utm: attribution.utm,
        landingPath: attribution.landingPath,
        referrerHost: attribution.referrerHost,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: FieldErrors };

    if (response.ok && body.ok) {
      track('waitlist_success');
      showSuccess(data.car);
      return;
    }
    if (response.status === 400 && body.fields) {
      showErrors(body.fields);
      track('waitlist_error', { errorCode: 'server_validation' });
    } else if (response.status === 429) {
      status.textContent = 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
      track('waitlist_error', { errorCode: 'rate_limited' });
    } else {
      status.textContent = 'Não foi possível enviar agora. Tente de novo em instantes.';
      track('waitlist_error', { errorCode: 'server' });
    }
  } catch {
    status.textContent = 'Sem conexão. Confira sua internet e tente de novo.';
    track('waitlist_error', { errorCode: 'network' });
  } finally {
    sending = false;
    submit.disabled = false;
    submit.textContent = 'Quero entrar na lista';
  }
});
