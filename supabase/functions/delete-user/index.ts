// Edge Function: delete-user
//
// Hard-delete de um usuário (auth.users) usando service_role no servidor — o front,
// com publishable key, não tem privilégio para tocar auth.users. A FK
// user_profiles.id -> auth.users(id) é ON DELETE CASCADE, então apagar auth.users
// remove o perfil automaticamente.
//
// Segurança:
//   - Exige JWT válido do chamador (validado via getUser no client "como o caller").
//   - Exige que o chamador seja admin (user_metadata.control === 'administrador'),
//     mesma régua usada por current_user_is_admin() nas RLS policies do projeto.
//   - Bloqueia auto-exclusão (admin não pode se trancar para fora).
//   - Idempotente: alvo inexistente na nuvem retorna 200 { status: 'not-found' }.
//
// ⚠️ LIMITAÇÃO HERDADA DO MODELO DE AUTH (ver follow-up de segurança):
//   user_metadata é gravável pelo próprio usuário (auth.updateUser), então a checagem
//   de admin baseada em user_metadata.control é tão forte quanto a RLS atual — ou seja,
//   passível de escalonamento de privilégio. A correção definitiva é migrar a flag de
//   admin para app_metadata (somente service_role). Fora do escopo desta função.

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

  // 1) Identifica o chamador a partir do JWT do Authorization header.
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ ok: false, error: 'Não autenticado' }, 401, cors);
  }
  const caller = userData.user;

  // 2) Exige que o chamador seja admin.
  const callerControl = (caller.user_metadata as Record<string, unknown> | null)?.control;
  if (callerControl !== 'administrador') {
    return json({ ok: false, error: 'Apenas administradores podem excluir usuários' }, 403, cors);
  }

  // 3) Lê o alvo do corpo.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (!username) return json({ ok: false, error: 'username é obrigatório' }, 400, cors);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 4) Resolve o uuid pelo username.
  const { data: profile, error: profErr } = await admin
    .from('user_profiles')
    .select('id, username')
    .eq('username', username)
    .maybeSingle();
  if (profErr) return json({ ok: false, error: profErr.message }, 500, cors);
  if (!profile) {
    // Órfão só-local: nada a apagar na nuvem. Idempotente.
    return json({ ok: true, status: 'not-found' }, 200, cors);
  }

  // 5) Bloqueia auto-exclusão.
  if (profile.id === caller.id) {
    return json({ ok: false, error: 'Você não pode excluir a própria conta' }, 400, cors);
  }

  // 6) Hard-delete de auth.users → cascade remove user_profiles.
  const { error: delErr } = await admin.auth.admin.deleteUser(profile.id as string);
  if (delErr) return json({ ok: false, error: delErr.message }, 500, cors);

  return json({ ok: true, status: 'deleted' }, 200, cors);
});
