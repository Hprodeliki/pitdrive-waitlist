// Aplica db/schema.sql no banco de DATABASE_URL (idempotente).
// Uso: npm run db:migrate   (lê .env.local / .env se existirem)
// Na Vercel roda antes de cada build (vercel.json → buildCommand).
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url = process.env.DATABASE_URL;
if (!url) {
  if (process.env.VERCEL) {
    // Primeiro deploy antes de conectar o banco: não bloqueia o build, mas avisa.
    console.warn('[migrate] DATABASE_URL ausente: migration pulada. Conecte o banco e faça redeploy.');
    process.exit(0);
  }
  console.error('DATABASE_URL não configurada (.env.local ou variável de ambiente).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  console.log('Schema aplicado: waitlist_leads, waitlist_events, rate_limits.');
} finally {
  await client.end();
}
