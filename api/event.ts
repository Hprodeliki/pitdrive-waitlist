// POST /api/event — eventos anônimos do funil (sem cookies, sem IP gravado).
import { getPool } from '../server/db.js';
import { methodNotAllowed, noContent, serverConfig } from '../server/http.js';
import { handleEvent } from '../server/events.js';

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleEvent(request, { db: getPool(), ...serverConfig() });
  } catch (err) {
    console.error('[event] falha:', (err as Error).message);
    return noContent();
  }
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
