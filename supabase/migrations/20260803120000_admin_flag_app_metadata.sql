-- ============================================================================
-- Move a flag de administrador de user_metadata para app_metadata.
--
-- PROBLEMA (auditoria 2026-08-01, achado 1):
--   `user_metadata` é gravável pelo próprio usuário via supabase.auth.updateUser().
--   Checar `user_metadata.control === 'administrador'` é perguntar ao atacante se ele
--   é administrador. Qualquer conta autenticada virava admin com uma chamada.
--
--   `app_metadata` só é gravável por service_role. É onde a autorização tem que morar.
--
-- ORDEM DE IMPLANTAÇÃO — inverter DERRUBA TODOS OS ADMINS:
--   1. Esta migration (backfill + funções).
--   2. SÓ ENTÃO `supabase functions deploy create-user delete-user update-user`.
--   Antes do backfill ninguém tem app_metadata.control e o gate nega 403 para todos.
--
-- ⚠️ CONFERIR ANTES DE APLICAR EM PRODUÇÃO:
--   Este repositório ainda não tem o schema versionado (achado 7). Rode
--   `supabase db pull` primeiro e confira se `current_user_is_admin()` e o trigger
--   `handle_new_user` batem com o que está assumido aqui. Ver migrations/README.md.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- 1. backfill
-- Copia control de user_metadata para app_metadata em quem já existe.
-- Idempotente: reexecutar não muda nada além de reafirmar o mesmo valor.
update auth.users
set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('control', raw_user_meta_data ->> 'control')
where raw_user_meta_data ? 'control'
  and coalesce(raw_user_meta_data ->> 'control', '') <> '';

-- Rede de segurança: se o backfill não produziu NENHUM admin, aborta a transação.
-- Sem isso, um user_metadata inesperadamente vazio deixaria o sistema sem admin e
-- sem caminho de volta pela UI.
do $$
declare
  n int;
begin
  select count(*) into n
  from auth.users
  where raw_app_meta_data ->> 'control' = 'administrador';

  if n = 0 then
    raise exception
      'Backfill não encontrou nenhum administrador em app_metadata. '
      'Abortado para não trancar todo mundo fora. Confira auth.users.raw_user_meta_data.';
  end if;

  raise notice 'Backfill concluído: % administrador(es) em app_metadata.', n;
end $$;

-- ------------------------------------------------- 2. gate de admin no Postgres
-- Lê do MESMO lugar que as Edge Functions. Sem isto, a RLS continuaria confiando
-- no campo que o usuário controla.
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'control') = 'administrador',
    false
  );
$$;

comment on function public.current_user_is_admin() is
  'Autorização de admin. Lê app_metadata (só service_role escreve) — nunca user_metadata.';

-- ------------------------------------- 3. sincroniza user_profiles.control
-- `user_profiles.control` alimenta a UI e as checagens de "último administrador"
-- nas Edge Functions. Ele NÃO é fonte de autorização (isso é o JWT), mas precisa
-- refletir app_metadata.
--
-- Trigger ADITIVO de propósito: o `handle_new_user` existente não está versionado
-- neste repositório, então não é reescrito às cegas. O prefixo `z_` garante ordem
-- alfabética posterior, ou seja, este roda depois dele e tem a palavra final.
create or replace function public.sync_profile_control()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control text := new.raw_app_meta_data ->> 'control';
begin
  if v_control is null or v_control = '' then
    return new;
  end if;

  update public.user_profiles
  set control = v_control,
      role = case when v_control = 'administrador' then 'admin' else 'operator' end,
      updated_at = now()
  where id = new.id
    and (control is distinct from v_control);

  return new;
end $$;

comment on function public.sync_profile_control() is
  'Espelha auth.users.raw_app_meta_data->>control em user_profiles.control.';

drop trigger if exists z_sync_profile_control on auth.users;
create trigger z_sync_profile_control
  after insert or update of raw_app_meta_data on auth.users
  for each row
  execute function public.sync_profile_control();

-- Alinha o que já existe (o trigger só pega eventos futuros).
update public.user_profiles p
set control = u.raw_app_meta_data ->> 'control',
    role = case when u.raw_app_meta_data ->> 'control' = 'administrador'
                then 'admin' else 'operator' end,
    updated_at = now()
from auth.users u
where u.id = p.id
  and coalesce(u.raw_app_meta_data ->> 'control', '') <> ''
  and p.control is distinct from (u.raw_app_meta_data ->> 'control');

commit;
