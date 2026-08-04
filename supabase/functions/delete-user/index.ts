// Edge Function: delete-user
//
// Exclui um usuário DEFINITIVAMENTE de auth.users via service_role. O front com
// publishable key não pode tocar auth.users; o cascade remove user_profiles.
// Idempotente: alvo inexistente na nuvem (órfão só-local) devolve ok + 'not-found'.
//
// Segurança:
//   - Exige JWT válido do chamador + `app_metadata.control === 'administrador'`.
//     A flag vive em app_metadata, gravável apenas por service_role — ver _shared/auth.ts.
//   - Bloqueia auto-exclusão e a exclusão do último administrador.

import {
  corsHeaders, json, preflight, readBody, requireAdmin, lower,
} from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('Origin'));

  const early = preflight(req, cors);
  if (early) return early;

  const gate = await requireAdmin(req, cors, 'excluir usuários');
  if (!gate.ok) return gate.response;

  const username = lower((await readBody(req)).username);
  if (!username) return json({ ok: false, error: 'username é obrigatório' }, 400, cors);

  const { data: profile, error: profErr } = await gate.admin
    .from('user_profiles')
    .select('id, username, control')
    .eq('username', username)
    .maybeSingle();
  if (profErr) return json({ ok: false, error: profErr.message }, 500, cors);
  if (!profile) return json({ ok: true, status: 'not-found' }, 200, cors);

  if (profile.id === gate.caller.id) {
    return json({ ok: false, error: 'Você não pode excluir a própria conta' }, 400, cors);
  }

  // Apagar o último admin deixaria o sistema sem ninguém capaz de administrar.
  if (profile.control === 'administrador') {
    const { count, error: cntErr } = await gate.admin
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('control', 'administrador');
    if (cntErr) return json({ ok: false, error: cntErr.message }, 500, cors);
    if ((count ?? 0) <= 1) {
      return json({ ok: false, error: 'Não é possível excluir o último administrador' }, 400, cors);
    }
  }

  const { error: delErr } = await gate.admin.auth.admin.deleteUser(profile.id as string);
  if (delErr) return json({ ok: false, error: delErr.message }, 500, cors);

  return json({ ok: true, status: 'deleted' }, 200, cors);
});
