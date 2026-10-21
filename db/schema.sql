-- PitDrive — lista de espera (pré-lançamento)
-- Idempotente: pode rodar mais de uma vez (npm run db:migrate).
-- Compatível com qualquer PostgreSQL 13+ (Neon, Supabase, Render, local).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid() em Postgres < 13 / alguns provedores

-- Leads da lista de espera -------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist_leads (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  email             text        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  car               text        NULL     CHECK (car IS NULL OR char_length(car) <= 80),

  utm_source        text        NULL CHECK (utm_source   IS NULL OR char_length(utm_source)   <= 100),
  utm_medium        text        NULL CHECK (utm_medium   IS NULL OR char_length(utm_medium)   <= 100),
  utm_campaign      text        NULL CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 100),
  utm_content       text        NULL CHECK (utm_content  IS NULL OR char_length(utm_content)  <= 100),
  utm_term          text        NULL CHECK (utm_term     IS NULL OR char_length(utm_term)     <= 100),
  landing_path      text        NULL CHECK (landing_path IS NULL OR char_length(landing_path) <= 200),
  referrer_host     text        NULL CHECK (referrer_host IS NULL OR char_length(referrer_host) <= 253),

  consent_given     boolean     NOT NULL,
  consent_version   text        NOT NULL,
  consent_at        timestamptz NOT NULL DEFAULT now(),

  status            text        NOT NULL DEFAULT 'WAITLISTED' CHECK (status IN ('WAITLISTED', 'UNSUBSCRIBED')),
  unsubscribed_at   timestamptz NULL,
  -- Token para um futuro link de descadastro nos e-mails (não exposto hoje).
  unsubscribe_token uuid        NOT NULL DEFAULT gen_random_uuid(),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_leads_email_key ON waitlist_leads (email);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_leads_unsubscribe_token_key ON waitlist_leads (unsubscribe_token);
CREATE INDEX IF NOT EXISTS waitlist_leads_created_at_idx ON waitlist_leads (created_at);
CREATE INDEX IF NOT EXISTS waitlist_leads_utm_source_idx ON waitlist_leads (utm_source);

-- Eventos de analytics (primeira parte, anônimos, sem cookies) --------------
-- Não guarda IP, e-mail, nome nem user agent. page_id é aleatório por
-- carregamento de página e nunca é ligado ao lead.
CREATE TABLE IF NOT EXISTS waitlist_events (
  id            bigserial   PRIMARY KEY,
  name          text        NOT NULL,
  page_id       text        NOT NULL,
  path          text        NULL,
  cta           text        NULL,
  error_code    text        NULL,
  device        text        NULL CHECK (device IS NULL OR device IN ('mobile', 'desktop')),
  utm_source    text        NULL,
  utm_medium    text        NULL,
  utm_campaign  text        NULL,
  utm_content   text        NULL,
  utm_term      text        NULL,
  referrer_host text        NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_events_created_at_idx ON waitlist_events (created_at);
CREATE INDEX IF NOT EXISTS waitlist_events_name_idx ON waitlist_events (name, created_at);

-- Rate limit por janela fixa (chave = bucket + hash do IP) ------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
