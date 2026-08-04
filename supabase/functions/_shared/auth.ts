// Bloco compartilhado das Edge Functions: CORS, resposta JSON e o gate de admin.
//
// Pasta `_shared` (com underscore) não é publicada como função pelo Supabase CLI.
//
// ---------------------------------------------------------------------------
// POR QUE app_metadata, E NÃO user_metadata
// ---------------------------------------------------------------------------
// `user_metadata` é gravável pelo PRÓPRIO usuário via `supabase.auth.updateUser()`.
// Checar `user_metadata.control === 'administrador'` significa perguntar ao atacante
// se ele é administrador. Qualquer conta autenticada virava admin com uma chamada e
// passava a criar/apagar usuários e ler todo o `system_data`.
//
// `app_metadata` só é gravável por `service_role` — ou seja, por este código, nunca
// pelo cliente. É onde a flag de autorização tem que morar.
//
// ⚠️ ORDEM DE IMPLANTAÇÃO — inverter isto DERRUBA TODOS OS ADMINS:
//      1. Aplicar a migration 004 (backfill user_metadata → app_metadata).
//      2. SÓ ENTÃO publicar estas funções.
//    Antes do backfill nenhum usuário tem `app_metadata.control`, então o gate abaixo
//    nega 403 para todo mundo, inclusive o dono do sistema.

import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

export const ALLOWED_ORIGINS = [
  'https://softtech-fiscal.vercel.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

export function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(obj: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

interface Env {
  SUPABASE_URL: string;
  ANON_KEY: string;
  SERVICE_KEY: string;
}

function readEnv(): Env | null {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return null;
  return { SUPABASE_URL, ANON_KEY, SERVICE_KEY };
}

/** Lê a flag de autorização — SEMPRE de app_metadata. Ver cabeçalho do arquivo. */
export function isAdmin(user: User): boolean {
  const control = (user.app_metadata as Record<string, unknown> | null)?.control;
  return control === 'administrador';
}

export type AdminGate =
  | { ok: true; caller: User; admin: SupabaseClient }
  | { ok: false; response: Response };

/**
 * Valida o JWT do chamador, exige admin e devolve um client service_role pronto.
 * `acao` entra na mensagem de 403 ("Apenas administradores podem {acao}").
 */
export async function requireAdmin(
  req: Request,
  cors: Record<string, string>,
  acao: string,
): Promise<AdminGate> {
  const env = readEnv();
  if (!env) {
    return { ok: false, response: json({ ok: false, error: 'Função mal configurada (env ausente)' }, 500, cors) };
  }

  const callerClient = createClient(env.SUPABASE_URL, env.ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });

  const { data, error } = await callerClient.auth.getUser();
  if (error || !data?.user) {
    return { ok: false, response: json({ ok: false, error: 'Não autenticado' }, 401, cors) };
  }
  if (!isAdmin(data.user)) {
    return { ok: false, response: json({ ok: false, error: `Apenas administradores podem ${acao}` }, 403, cors) };
  }

  return {
    ok: true,
    caller: data.user,
    admin: createClient(env.SUPABASE_URL, env.SERVICE_KEY, { auth: { persistSession: false } }),
  };
}

/** Boilerplate de OPTIONS/método. Retorna null quando a requisição deve prosseguir. */
export function preflight(req: Request, cors: Record<string, string>): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405, cors);
  return null;
}

/** Corpo JSON tolerante a payload inválido. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const lower = (v: unknown): string => str(v).toLowerCase();
