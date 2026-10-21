// Integração com um Postgres real. Rode com:
//   TEST_DATABASE_URL=postgres://... npm test
// Sem TEST_DATABASE_URL estes testes são pulados. O banco é limpo a cada teste: use um banco só para testes.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from '../shared/waitlist.js';
import { handleEvent } from '../server/events.js';
import { handleWaitlist, SIGNUP_LIMIT } from '../server/waitlist.js';
import * as route from '../api/waitlist.js';

const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'https://pitdrive-waitlist.vercel.app';

function post(path: string, body: unknown, init: { origin?: string | null; ip?: string; type?: string; raw?: string } = {}) {
  const headers = new Headers({ 'content-type': init.type ?? 'application/json', 'x-real-ip': init.ip ?? '203.0.113.7' });
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: init.raw ?? JSON.stringify(body) });
}

const lead = (over: Record<string, unknown> = {}) => ({
  name: 'Ana Souza',
  email: 'Ana.Souza@Email.com',
  car: 'Peugeot 208 2024 1.0',
  consent: true,
  website: '',
  elapsedMs: 9000,
  utm: { utm_source: 'tiktok', utm_medium: 'bio', utm_campaign: 'waitlist' },
  landingPath: '/lista-de-espera',
  referrerHost: 'www.tiktok.com',
  ...over,
});

describe.skipIf(!url)('API com Postgres', () => {
  let pool: pg.Pool;
  const deps = () => ({ db: pool, salt: 'test-salt', allowedOrigins: [] as string[] });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query(readFileSync('db/schema.sql', 'utf8'));
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE waitlist_leads, waitlist_events, rate_limits');
  });
  afterAll(async () => {
    await pool.end();
  });

  const leads = async () => (await pool.query('SELECT * FROM waitlist_leads ORDER BY created_at')).rows;

  it('grava o lead normalizado com UTM, consentimento e status', async () => {
    const res = await handleWaitlist(post('/api/waitlist', lead({ name: '  Ana   Souza ' })), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [row] = await leads();
    expect(row).toMatchObject({
      name: 'Ana Souza',
      email: 'ana.souza@email.com',
      car: 'Peugeot 208 2024 1.0',
      utm_source: 'tiktok',
      utm_medium: 'bio',
      utm_campaign: 'waitlist',
      utm_content: null,
      landing_path: '/lista-de-espera',
      referrer_host: 'www.tiktok.com',
      consent_given: true,
      consent_version: CONSENT_VERSION,
      status: 'WAITLISTED',
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('e-mail duplicado (outra caixa/espaços) não cria segundo lead e responde igual', async () => {
    await handleWaitlist(post('/api/waitlist', lead()), deps());
    const res = await handleWaitlist(
      post('/api/waitlist', lead({ email: '  ANA.SOUZA@email.com ', utm: { utm_source: 'instagram' } })),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await leads();
    expect(rows).toHaveLength(1);
    expect(rows[0].utm_source).toBe('tiktok'); // primeira origem preservada
  });

  it('descadastrado que se inscreve de novo volta para WAITLISTED', async () => {
    await handleWaitlist(post('/api/waitlist', lead()), deps());
    await pool.query(`UPDATE waitlist_leads SET status = 'UNSUBSCRIBED', unsubscribed_at = now()`);
    await handleWaitlist(post('/api/waitlist', lead({ car: '' })), deps());
    const [row] = await leads();
    expect(row.status).toBe('WAITLISTED');
    expect(row.unsubscribed_at).toBeNull();
    expect(row.car).toBe('Peugeot 208 2024 1.0');
  });

  it('e-mail inválido e falta de consentimento retornam 400 sem gravar', async () => {
    const res = await handleWaitlist(post('/api/waitlist', lead({ email: 'ana@', consent: false })), deps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.fields).sort()).toEqual(['consent', 'email']);
    expect(await leads()).toHaveLength(0);
  });

  it('carro é opcional', async () => {
    await handleWaitlist(post('/api/waitlist', lead({ car: undefined })), deps());
    expect((await leads())[0].car).toBeNull();
  });

  it('texto com SQL/HTML é guardado como texto, sem efeito', async () => {
    const car = `'); DROP TABLE waitlist_leads; -- <script>alert(1)</script>`;
    const res = await handleWaitlist(post('/api/waitlist', lead({ car })), deps());
    expect(res.status).toBe(200);
    expect((await leads())[0].car).toBe(car);
  });

  it('honeypot preenchido: responde ok e não grava', async () => {
    const res = await handleWaitlist(post('/api/waitlist', lead({ website: 'http://spam.example' })), deps());
    expect(res.status).toBe(200);
    expect(await leads()).toHaveLength(0);
  });

  it('envio rápido demais (robô): responde ok e não grava', async () => {
    const res = await handleWaitlist(post('/api/waitlist', lead({ elapsedMs: 300 })), deps());
    expect(res.status).toBe(200);
    expect(await leads()).toHaveLength(0);
  });

  it('rate limit por IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < SIGNUP_LIMIT + 2; i++) {
      const res = await handleWaitlist(post('/api/waitlist', lead({ email: `user${i}@email.com` })), deps());
      statuses.push(res.status);
    }
    expect(statuses.slice(0, SIGNUP_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(SIGNUP_LIMIT)).toEqual([429, 429]);
    expect(await leads()).toHaveLength(SIGNUP_LIMIT);

    // Outro IP continua podendo se cadastrar.
    const other = await handleWaitlist(post('/api/waitlist', lead({ email: 'outro@email.com' }), { ip: '198.51.100.1' }), deps());
    expect(other.status).toBe(200);
  });

  it('IP nunca é gravado em texto puro', async () => {
    await handleWaitlist(post('/api/waitlist', lead()), deps());
    const { rows } = await pool.query('SELECT key FROM rate_limits');
    expect(rows[0].key).not.toContain('203.0.113.7');
  });

  it('recusa origem de outro site e requisição sem Origin', async () => {
    expect((await handleWaitlist(post('/api/waitlist', lead(), { origin: 'https://evil.example' }), deps())).status).toBe(403);
    expect((await handleWaitlist(post('/api/waitlist', lead(), { origin: null }), deps())).status).toBe(403);
    const allowed = { ...deps(), allowedOrigins: ['https://pitdrive.com.br'] };
    expect((await handleWaitlist(post('/api/waitlist', lead(), { origin: 'https://pitdrive.com.br' }), allowed)).status).toBe(200);
  });

  it('payload inválido: content-type, JSON quebrado, array, corpo grande', async () => {
    expect((await handleWaitlist(post('/api/waitlist', null, { type: 'text/plain', raw: 'a' }), deps())).status).toBe(415);
    expect((await handleWaitlist(post('/api/waitlist', null, { raw: '{"name":' }), deps())).status).toBe(400);
    expect((await handleWaitlist(post('/api/waitlist', null, { raw: '[1,2]' }), deps())).status).toBe(400);
    expect((await handleWaitlist(post('/api/waitlist', lead({ car: 'x'.repeat(5000) })), deps())).status).toBe(413);
    expect((await handleWaitlist(post('/api/waitlist', lead({ email: ['a@b.com'], name: { $ne: 1 } })), deps())).status).toBe(400);
    expect(await leads()).toHaveLength(0);
  });

  it('não existe leitura da lista pela API', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await route[method]();
      expect(res.status).toBe(405);
      expect(await res.text()).not.toContain('@');
    }
    expect('POST' in route).toBe(true);
  });

  it('eventos: grava evento válido sem dados pessoais, recusa nome desconhecido', async () => {
    const ok = await handleEvent(
      post('/api/event', { name: 'waitlist_cta_click', pageId: 'abc123def456', cta: 'hero', path: '/lista-de-espera', utm: { utm_source: 'youtube' } }, { type: 'text/plain' }),
      deps(),
    );
    expect(ok.status).toBe(204);
    const bad = await handleEvent(post('/api/event', { name: 'drop_table', pageId: 'abc123def456' }), deps());
    expect(bad.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM waitlist_events');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'waitlist_cta_click', cta: 'hero', utm_source: 'youtube', device: 'desktop' });
  });
});
