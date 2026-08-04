# Migrations — SoftTech Fiscal

Schema, policies RLS, triggers e funções do Postgres vivem **aqui**, versionados.

## Estado atual: incompleto — falta o baseline

Até 2026-08-03 nada disso estava no repositório (auditoria, achado 7). Policies, o
trigger `handle_new_user`, `current_user_is_admin()` e a RPC `registrar_acao` existem
apenas no dashboard do Supabase. Consequência: não é auditável, não é reproduzível para
um segundo cliente e nenhuma mudança passa por code review.

**O baseline ainda precisa ser extraído.** Este diretório tem só a migration de
correção do achado 1, que assume um schema que ninguém conferiu contra o banco real.

### Passo 1 — extrair o baseline (fazer isto primeiro)

```bash
supabase link --project-ref utqsrzfuyfxkyjvedcwq
supabase db pull
```

Isso gera uma migration com o estado atual do banco. Commite **antes** de aplicar
qualquer outra coisa — é o retrato do que existe hoje, e o ponto de comparação para
revisar tudo que vier depois.

### Passo 2 — conferir a migration do achado 1

Com o baseline em mãos, abra `20260803120000_admin_flag_app_metadata.sql` e confira:

- `current_user_is_admin()` existe com essa assinatura? O `create or replace` assume
  `() returns boolean`. Assinatura diferente cria uma sobrecarga em vez de substituir,
  e a RLS continuaria chamando a versão antiga.
- `user_profiles` tem mesmo as colunas `control`, `role` e `updated_at`?
- `handle_new_user` lê `control` de `raw_user_meta_data`? Se sim, usuários criados
  depois do deploy dependem do trigger `z_sync_profile_control` desta migration para
  ter `user_profiles.control` correto. Confirme que ele roda depois (ordem alfabética
  de nome de trigger).

### Passo 3 — aplicar, e só então publicar as funções

```bash
supabase db push
supabase functions deploy create-user delete-user update-user
```

**A ordem importa.** As Edge Functions passaram a exigir `app_metadata.control`.
Publicá-las antes do backfill nega 403 para todo mundo — inclusive para o dono do
sistema, que perde o caminho de volta pela UI.

A migration tem uma trava contra isso: se o backfill não encontrar nenhum administrador,
ela aborta a transação em vez de deixar o banco num estado sem admin.

### Passo 4 — validar

```sql
-- Deve listar os administradores esperados.
select email, raw_app_meta_data ->> 'control' as control
from auth.users
where raw_app_meta_data ->> 'control' = 'administrador';

-- user_profiles deve estar espelhando o mesmo valor.
select p.username, p.control, p.role
from public.user_profiles p
join auth.users u on u.id = p.id
where u.raw_app_meta_data ->> 'control' is distinct from p.control;
-- (esperado: nenhuma linha)
```

Depois de aplicar, faça login com uma conta **não-admin** e confirme que
`create-user` responde 403.

## Daqui em diante

Toda mudança de schema, policy, função ou trigger vira migration commitada. Nada de
alteração direta pelo dashboard — mudança que não está aqui não existe para o próximo
cliente nem para o próximo desenvolvedor.
