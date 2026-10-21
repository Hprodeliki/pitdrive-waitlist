// POST /api/waitlist — cadastro na lista de espera.
// Não existe rota de leitura: a lista só é acessível pelo banco.
import { getPool } from '../server/db.js';
import { json, methodNotAllowed, serverConfig } from '../server/http.js';
import { handleWaitlist } from '../server/waitlist.js';

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleWaitlist(request, { db: getPool(), ...serverConfig() });
  } catch (err) {
    console.error('[waitlist] falha:', (err as Error).message);
    return json(500, { ok: false, error: 'server' });
  }
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
