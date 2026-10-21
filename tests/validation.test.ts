import { describe, expect, it } from 'vitest';
import { MESSAGES, cleanText, isValidEmail, normalizeEmail, validateWaitlist } from '../shared/waitlist.js';

describe('normalizeEmail', () => {
  it('remove espaços e converte para minúsculas', () => {
    expect(normalizeEmail('  Fulano.Silva@Gmail.COM ')).toBe('fulano.silva@gmail.com');
    expect(normalizeEmail('fulano @ gmail.com')).toBe('fulano@gmail.com');
  });

  it('remove caracteres invisíveis', () => {
    expect(normalizeEmail('a​b@c.com')).toBe('ab@c.com');
  });

  it('ignora tipos que não são texto', () => {
    expect(normalizeEmail(42)).toBe('');
    expect(normalizeEmail({ email: 'a@b.com' })).toBe('');
  });
});

describe('isValidEmail', () => {
  it.each(['a@b.co', 'nome.sobrenome+pit@email.com.br', 'x_y@sub.dominio.io'])('aceita %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(['', 'sem-arroba', 'a@b', 'a@b.c', '@b.com', 'a..b@c.com', '.a@b.com', 'a@-b.com', `${'a'.repeat(65)}@b.com`, "a@b.com'--"])(
    'recusa %s',
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );
});

describe('cleanText', () => {
  it('colapsa espaços e remove controles', () => {
    expect(cleanText('  Peugeot\t208 \n 2024\u0000 ')).toBe('Peugeot 208 2024');
  });
});

describe('validateWaitlist', () => {
  const valid = { name: 'Ana', email: 'ANA@Email.com ', car: ' Peugeot 208 2024 1.0 ', consent: true };

  it('normaliza um cadastro válido', () => {
    const { data, errors } = validateWaitlist(valid);
    expect(errors).toEqual({});
    expect(data).toEqual({ name: 'Ana', email: 'ana@email.com', car: 'Peugeot 208 2024 1.0', consent: true });
  });

  it('carro vazio vira null', () => {
    expect(validateWaitlist({ ...valid, car: '   ' }).data.car).toBeNull();
  });

  it('exige nome, e-mail válido e consentimento', () => {
    const { errors } = validateWaitlist({ name: ' ', email: 'x', consent: false });
    expect(errors).toEqual({
      name: MESSAGES.nameRequired,
      email: MESSAGES.emailInvalid,
      consent: MESSAGES.consentRequired,
    });
  });

  it('consentimento precisa ser true literal', () => {
    expect(validateWaitlist({ ...valid, consent: 'true' }).errors.consent).toBe(MESSAGES.consentRequired);
  });

  it('limita tamanhos', () => {
    const { errors } = validateWaitlist({ ...valid, name: 'a'.repeat(81), car: 'c'.repeat(81) });
    expect(errors.name).toBe(MESSAGES.nameLong);
    expect(errors.car).toBe(MESSAGES.carLong);
  });

  it('nome precisa ter letras', () => {
    expect(validateWaitlist({ ...valid, name: '12345' }).errors.name).toBe(MESSAGES.nameShort);
  });
});
