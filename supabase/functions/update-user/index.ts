// Edge Function: update-user
//
// Atualiza a SENHA (e, opcionalmente, full_name/control) de um usuário existente via
// service_role (admin.updateUserById). Motivo: o front com publishable key não pode tocar
// auth.users. A edição de senha pelo painel só altera o hash LOCAL (registeredUsers); sem
// esta função, a nova senha não vale para login via Supabase Auth. Foto e nome continuam
// sendo propagados a user_profiles pelo wrapper updateProfile.
//
// Segurança:
//   - Exige JWT válido do chamador + `app_metadata.control === 'administrador'`.
//   - `control` é gravado em app_metadata (autorização), nunca em user_metadata — ver
//     _shared/auth.ts. Gravar em user_metadata devolveria ao usuário o poder de se
//     promover a admin.
//   - Resolve o id do alvo em user_profiles.username (service_role).

import {
  corsHeaders, json, preflight, readBody, requireAdmin, lower, str,
} from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('Origin'));

  const early = preflight(req, cors);
  if (early) return early;

  const gate = await requireAdmin(req, cors, 'editar usuários');
  if (!gate.ok) return gate.response;

  const body = await readBody(req);
  const username = lower(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = str(body.fullName);
  const control = str(body.control);

  if (!username) return json({ ok: false, error: 'username é obrigatório' }, 400, cors);
  if (password && password.length < 6) {
    return json({ ok: false, error: 'A senha deve ter pelo menos 6 caracteres' }, 400, cors);
  }
  if (!password && !fullName && !control) {
    return json({ ok: false, error: 'Nada para atualizar' }, 400, cors);
  }

  const { data: profile, error: profErr } = await gate.admin
    .from('user_profiles')
    .select('id')
    .eq('username', username)
    .single();
  if (profErr || !profile?.id) {
    return json({ ok: false, error: 'Usuário não encontrado na nuvem' }, 404, cors);
  }

  // Rebaixar o último admin deixaria o sistema sem ninguém capaz de administrar —
  // e como só admin chama esta função, seria irreversível pela UI.
  if (control && control !== 'administrador') {
    const { count, error: cntErr } = await gate.admin
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('control', 'administrador');
    if (cntErr) return json({ ok: false, error: cntErr.message }, 500, cors);
    if ((count ?? 0) <= 1) {
      return json({ ok: false, error: 'Não é possível rebaixar o último administrador' }, 400, cors);
    }
  }

  const patch: Record<string, unknown> = {};
  if (password) patch.password = password;
  if (fullName) patch.user_metadata = { full_name: fullName };
  if (control) patch.app_metadata = { control };

  const { error: updErr } = await gate.admin.auth.admin.updateUserById(profile.id as string, patch);
  if (updErr) return json({ ok: false, error: updErr.message }, 400, cors);

  return json({ ok: true, status: 'updated' }, 200, cors);
});
