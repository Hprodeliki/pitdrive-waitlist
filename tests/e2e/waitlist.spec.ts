import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/pitdrive_test' });

test.beforeEach(async () => {
  await pool.query('TRUNCATE waitlist_leads, waitlist_events, rate_limits');
});
test.afterAll(async () => {
  await pool.end();
});

async function fill(page: Page, { name = 'Bruno Lima', email = 'Bruno.Lima@Email.com ', car = 'Peugeot 208 2024 1.0' } = {}) {
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('E-mail').fill(email);
  if (car) await page.getByLabel(/Qual é o seu carro/).fill(car);
  await page.getByLabel(/Quero receber novidades/).check();
  await page.waitForTimeout(2600); // tempo mínimo anti-robô
}

test('CTA aparece na primeira tela, sem rolar', async ({ page }) => {
  await page.goto('/lista-de-espera');
  const cta = page.locator('#hero-cta');
  await expect(cta).toBeInViewport();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Coloque seu carro.');
});

test('cadastro completo com UTM, sucesso e persistência', async ({ page }) => {
  await page.goto('/lista-de-espera?utm_source=tiktok&utm_medium=bio&utm_campaign=waitlist&utm_content=v2');
  await page.locator('#hero-cta').click();
  await expect(page.getByLabel('Nome')).toBeFocused();

  await fill(page);
  await page.getByRole('button', { name: 'Quero entrar na lista' }).click();

  await expect(page.getByRole('heading', { name: /Você está na lista/ })).toBeVisible();
  await expect(page.locator('#success-car-name')).toHaveText('Peugeot 208 2024 1.0');
  await expect(page.locator('#waitlist-form')).toBeHidden();

  const { rows } = await pool.query('SELECT * FROM waitlist_leads');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    name: 'Bruno Lima',
    email: 'bruno.lima@email.com',
    utm_source: 'tiktok',
    utm_medium: 'bio',
    utm_campaign: 'waitlist',
    utm_content: 'v2',
    landing_path: '/lista-de-espera',
    consent_given: true,
    status: 'WAITLISTED',
  });

  await expect
    .poll(async () => (await pool.query('SELECT DISTINCT name FROM waitlist_events ORDER BY name')).rows.map((r) => r.name))
    .toEqual(
      expect.arrayContaining([
        'waitlist_page_view',
        'waitlist_cta_view',
        'waitlist_cta_click',
        'waitlist_form_start',
        'waitlist_submit',
        'waitlist_success',
      ]),
    );
  const { rows: events } = await pool.query(`SELECT DISTINCT utm_source, utm_campaign FROM waitlist_events`);
  expect(events).toEqual([{ utm_source: 'tiktok', utm_campaign: 'waitlist' }]);
});

test('UTM sobrevive a recarregar a página sem parâmetros', async ({ page }) => {
  await page.goto('/lista-de-espera?utm_source=instagram&utm_medium=bio&utm_campaign=waitlist');
  await page.goto('/lista-de-espera');
  await fill(page, { car: '' });
  await page.getByRole('button', { name: 'Quero entrar na lista' }).click();
  await expect(page.getByRole('heading', { name: /Você está na lista/ })).toBeVisible();
  await expect(page.locator('#success-car')).toBeHidden();
  const { rows } = await pool.query('SELECT utm_source, car FROM waitlist_leads');
  expect(rows).toEqual([{ utm_source: 'instagram', car: null }]);
});

test('erros claros: e-mail inválido e consentimento', async ({ page }) => {
  await page.goto('/lista-de-espera');
  await page.getByLabel('Nome').fill('Bruno');
  await page.getByLabel('E-mail').fill('bruno@');
  await page.getByRole('button', { name: 'Quero entrar na lista' }).click();

  await expect(page.locator('#f-email-error')).toHaveText(/Confira o e-mail/);
  await expect(page.locator('#f-consent-error')).toHaveText(/Marque a caixa/);
  await expect(page.getByLabel('E-mail')).toBeFocused();
  await expect(page.getByLabel('E-mail')).toHaveAttribute('aria-invalid', 'true');
  expect((await pool.query('SELECT count(*)::int AS n FROM waitlist_leads')).rows[0].n).toBe(0);
});

test('e-mail duplicado: mesma tela de sucesso, um único registro', async ({ page }) => {
  for (let i = 0; i < 2; i++) {
    await page.goto('/lista-de-espera');
    await fill(page, { email: 'repetido@email.com' });
    await page.getByRole('button', { name: 'Quero entrar na lista' }).click();
    await expect(page.getByRole('heading', { name: /Você está na lista/ })).toBeVisible();
  }
  expect((await pool.query('SELECT count(*)::int AS n FROM waitlist_leads')).rows[0].n).toBe(1);
});

test('formulário utilizável só com teclado', async ({ page, isMobile }) => {
  test.skip(isMobile, 'teclado físico só no desktop');
  await page.goto('/lista-de-espera');
  await page.keyboard.press('Tab'); // link "Pular para o formulário"
  await expect(page.getByRole('link', { name: 'Pular para o formulário' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Nome')).toBeFocused();
  await page.keyboard.type('Carla Dias');
  await page.keyboard.press('Tab');
  await page.keyboard.type('carla@email.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Onix 2020 1.0 turbo');
  await page.keyboard.press('Tab'); // pula o honeypot (tabindex=-1) e vai ao checkbox
  await expect(page.getByLabel(/Quero receber novidades/)).toBeFocused();
  await page.keyboard.press('Space');
  await page.waitForTimeout(2600);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Você está na lista/ })).toBeFocused();
});

test('CTA fixo aparece no celular depois de rolar e some no formulário', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'só no celular');
  await page.goto('/lista-de-espera');
  const sticky = page.locator('#sticky-cta');
  await expect(sticky).toBeHidden();
  await page.getByRole('heading', { name: 'Como funciona' }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  await expect(sticky).toBeVisible();
  await page.locator('#lista').scrollIntoViewIfNeeded();
  await expect(sticky).toBeHidden();
});

test('política de privacidade e rotas', async ({ page, request }) => {
  await page.goto('/lista-de-espera');
  await page.getByRole('link', { name: 'Política de Privacidade' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Política de Privacidade');
  await expect(page.getByText('Versão provisória.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'contatopitdrive@gmail.com' }).first()).toBeVisible();

  expect((await request.get('/espera')).status()).toBe(200);
  expect((await request.get('/api/waitlist')).status()).toBe(405);
});

test('sem rolagem horizontal', async ({ page }) => {
  await page.goto('/lista-de-espera');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
