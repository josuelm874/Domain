// Edge Function: create-user
//
// Cria usuário via service_role (admin.createUser). Motivo: o signUp público rejeita o
// domínio interno `.local` ("Email address is invalid"); a admin API não aplica essa
// validação de formato. Bônus: NÃO troca a sessão do chamador (o signUp logaria o novo
// usuário, derrubando a sessão do admin). O trigger handle_new_user popula user_profiles.
//
// Segurança:
//   - Exige JWT válido do chamador (getUser) + admin (user_metadata.control).
//   - email_confirm: true → o usuário já pode logar (sem etapa de confirmação por email).
//
// ⚠️ Mesma limitação herdada de delete-user: a checagem de admin via user_metadata é
//   passível de escalonamento (user_metadata é gravável pelo próprio usuário). Correção
//   definitiva: migrar a flag de admin para app_metadata. Fora do escopo.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://softtech-fiscal.vercel.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];
const AUTH_EMAIL_DOMAIN = 'softtech-fiscal.local';

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

  // 1) Identifica o chamador pelo JWT.
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
    return json({ ok: false, error: 'Apenas administradores podem cadastrar usuários' }, 403, cors);
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
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return json({ ok: false, error: 'username inválido (use minúsculas, números, . _ -)' }, 400, cors);
  }
  if (password.length < 6) return json({ ok: false, error: 'A senha deve ter pelo menos 6 caracteres' }, 400, cors);
  if (!control) return json({ ok: false, error: 'control é obrigatório' }, 400, cors);

  // 3) Cria o usuário com service_role (aceita o domínio .local; sem etapa de confirmação).
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const email = `${username}@${AUTH_EMAIL_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName || username, control },
  });
  if (error) return json({ ok: false, error: error.message }, 400, cors);

  return json({ ok: true, status: 'created', userId: data.user?.id }, 200, cors);
});
