import type { Queryable } from './db.js';

/**
 * Rate limit por janela fixa guardado no próprio Postgres (sem Redis).
 * Retorna true se a requisição ainda está dentro do limite.
 */
export async function hit(db: Queryable, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowSeconds],
  );
  // Limpeza ocasional das janelas antigas.
  if (Math.random() < 0.02) {
    await db.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`).catch(() => undefined);
  }
  return rows[0]!.count <= limit;
}
