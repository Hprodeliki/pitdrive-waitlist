import pg from 'pg';

let pool: pg.Pool | undefined;

/**
 * Pool reaproveitado entre invocações da mesma instância serverless.
 * Use a connection string "pooled" do provedor (ex.: Neon -pooler) em produção.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não configurada');
  pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

export type Queryable = Pick<pg.Pool, 'query'>;
