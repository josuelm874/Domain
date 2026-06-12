// Edge Function: update-user
//
// Atualiza a SENHA (e, opcionalmente, full_name/control no user_metadata) de um usuário
// existente via service_role (admin.updateUserById). Motivo: o front com publishable key
// não pode tocar auth.users. A edição de senha pelo painel só altera o hash LOCAL
// (registeredUsers); sem esta função, a nova senha não vale para login via Supabase Auth.
// Foto e nome continuam sendo propagados a user_profiles pelo wrapper updateProfile.
//
// Segurança:
//   - Exige JWT válido do chamador (getUser) + admin (user_metadata.control).
//   - Resolve o id do alvo em user_profiles.username (service_role).
//
// ⚠️ Mesma limitação herdada de create-user/delete-user: a checagem de admin via
//   user_metadata é passível de escalonamento. Correção definitiva: app_metadata. Fora
//   do escopo.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://softtech-fiscal.vercel.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(obj: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405, cors);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return json({ ok: false, error: 'Função mal configurada (env ausente)' }, 500, cors);
  }

  // 1) Identifica o chamador pelo JWT e exige admin.
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ ok: false, error: 'Não autenticado' }, 401, cors);
  }
  const callerControl = (userData.user.user_metadata as Record<string, unknown> | null)?.control;
  if (callerControl !== 'administrador') {
    return json({ ok: false, error: 'Apenas administradores podem editar usuários' }, 403, cors);
  }

  // 2) Lê e valida o corpo.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const control = typeof body.control === 'string' ? body.control.trim() : '';

  if (!username) return json({ ok: false, error: 'username é obrigatório' }, 400, cors);
  if (password && password.length < 6) {
    return json({ ok: false, error: 'A senha deve ter pelo menos 6 caracteres' }, 400, cors);
  }
  if (!password && !fullName && !control) {
    return json({ ok: false, error: 'Nada para atualizar' }, 400, cors);
  }

  // 3) Resolve o id do alvo pelo username (user_profiles, service_role).
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: profile, error: profErr } = await admin
    .from('user_profiles')
    .select('id')
    .eq('username', username)
    .single();
  if (profErr || !profile?.id) {
    return json({ ok: false, error: 'Usuário não encontrado na nuvem' }, 404, cors);
  }

  // 4) Monta o patch e atualiza auth.users.
  const patch: Record<string, unknown> = {};
  if (password) patch.password = password;
  const metaPatch: Record<string, unknown> = {};
  if (fullName) metaPatch.full_name = fullName;
  if (control) metaPatch.control = control;
  if (Object.keys(metaPatch).length > 0) patch.user_metadata = metaPatch;

  const { error: updErr } = await admin.auth.admin.updateUserById(profile.id as string, patch);
  if (updErr) return json({ ok: false, error: updErr.message }, 400, cors);

  return json({ ok: true, status: 'updated' }, 200, cors);
});
