// Edge Function: create-user
//
// Cria usuário via service_role (admin.createUser). Motivo: o signUp público rejeita o
// domínio interno `.local` ("Email address is invalid"); a admin API não aplica essa
// validação de formato. Bônus: NÃO troca a sessão do chamador (o signUp logaria o novo
// usuário, derrubando a sessão do admin). O trigger handle_new_user popula user_profiles.
//
// Segurança:
//   - Exige JWT válido do chamador + `app_metadata.control === 'administrador'`.
//     A flag vai para app_metadata, gravável apenas por service_role — ver _shared/auth.ts.
//   - email_confirm: true → o usuário já pode logar (sem etapa de confirmação por email).

import {
  corsHeaders, json, preflight, readBody, requireAdmin, lower, str,
} from '../_shared/auth.ts';

const AUTH_EMAIL_DOMAIN = 'softtech-fiscal.local';

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('Origin'));

  const early = preflight(req, cors);
  if (early) return early;

  const gate = await requireAdmin(req, cors, 'cadastrar usuários');
  if (!gate.ok) return gate.response;

  const body = await readBody(req);
  const username = lower(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = str(body.fullName);
  const control = str(body.control);

  if (!username) return json({ ok: false, error: 'username é obrigatório' }, 400, cors);
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return json({ ok: false, error: 'username inválido (use minúsculas, números, . _ -)' }, 400, cors);
  }
  if (password.length < 6) {
    return json({ ok: false, error: 'A senha deve ter pelo menos 6 caracteres' }, 400, cors);
  }
  if (!control) return json({ ok: false, error: 'control é obrigatório' }, 400, cors);

  // `control` em app_metadata (autorização, só service_role escreve).
  // `username`/`full_name` em user_metadata (exibição, o usuário pode editar sem risco).
  const { data, error } = await gate.admin.auth.admin.createUser({
    email: `${username}@${AUTH_EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName || username },
    app_metadata: { control },
  });
  if (error) return json({ ok: false, error: error.message }, 400, cors);

  return json({ ok: true, status: 'created', userId: data.user?.id }, 200, cors);
});
