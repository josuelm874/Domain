# Auditoria de Sistema — SoftTech Fiscal

> Data: 2026-08-01 · Branch: `claude/accounting-system-audit-fe248a` · Commit base: `ac2459e`
> Escopo: código-fonte completo do repositório (frontend, worker Node, API Python, Edge Functions,
> configuração de deploy). **Fora do escopo:** políticas RLS reais no dashboard Supabase, o binário
> `.exe` do worker distribuído, e teste dinâmico (pentest) contra o ambiente de produção.
> Objetivo declarado: avaliar prontidão para comercialização a escritórios de contabilidade.

---

## Veredito

**O sistema não está pronto para ser vendido.** Não por falta de funcionalidade — o domínio fiscal
está coberto e as regras de negócio demonstram conhecimento real do problema. O bloqueio é
arquitetural e de segurança:

1. **Não existe multi-tenancy.** Vender para dois clientes hoje exige dois projetos Supabase e dois
   deploys Vercel separados. Isso não é um produto, é uma instalação replicada manualmente.
2. **Qualquer usuário autenticado consegue virar administrador** com uma chamada de API. O próprio
   código documenta essa limitação em três arquivos, e ela nunca foi fechada.
3. **O worker local expõe dados fiscais e o disco do contador para qualquer site que ele visite.**
4. **A API Python em produção roda sem autenticação.**

Os pontos 2, 3 e 4 são vulnerabilidades exploráveis, não hipóteses. O ponto 1 define quanto trabalho
falta antes de faturar o primeiro cliente externo.

Estimativa honesta: **6 a 10 semanas** de trabalho focado até um estado defensável para venda —
concentradas em multi-tenancy, autorização e cobertura de teste no núcleo fiscal.

---

## Sumário de achados

| # | Severidade | Achado | Arquivo |
|---|------------|--------|---------|
| 1 | **P0** | Escalonamento de privilégio via `user_metadata.control` | `supabase/functions/*/index.ts` |
| 2 | **P0** | Worker local sem autenticação, CORS aberto, leitura arbitrária de disco | `worker/server.js`, `worker/lib/dirbi.js` |
| 3 | **P0** | Multi-tenancy inexistente — `system_data` é um KV global | `assets/js/supabase-sync.js` |
| 4 | **P0** | API Python pública sem `ICMS_API_KEY`; endpoint de escrita sem authz | `render.yaml.disabled`, `api_icms/api_icms.py` |
| 5 | **P1** | Fallback de auth client-side com salt e hash entregues ao browser | `assets/js/app.js`, `scripts/gen-config.js` |
| 6 | **P1** | Hash legacy reversível (`btoa`+reverse) ainda aceito no login | `assets/js/app.js:63` |
| 7 | **P1** | RLS não versionada — nenhuma migration no repositório | `supabase/` |
| 8 | **P1** | Sem SRI nas dependências de CDN + CSP com `unsafe-inline` | `Dominium.html`, `vercel.json` |
| 9 | **P1** | Dependências desatualizadas com CVEs conhecidas | `Dominium.html`, `api_icms/requirements.txt` |
| 10 | **P1** | Ausência total de rate limiting | todas as camadas |
| 11 | **P2** | Núcleo fiscal sem cobertura de teste (1 arquivo de teste no repositório) | `scripts/` |
| 12 | **P2** | Aritmética monetária em ponto flutuante | `assets/js/app.js:11725` |
| 13 | **P2** | Base de cálculo negativa produz imposto negativo sem alerta | `assets/js/app.js:11772` |
| 14 | **P2** | `app.js` monolítico: 663 KB, ~9.600 linhas, um único IIFE | `assets/js/app.js` |
| 15 | **P2** | Erros silenciados em trilha de auditoria e sincronização | `assets/js/supabase-sync.js:147` |
| 16 | **P2** | Sem CI, sem lint, sem `package.json` na raiz, sem lockfile | raiz |
| 17 | **P2** | Automação RPA por coordenada de tela (`pyautogui`) | `.py/*.py` |
| 18 | **P2** | LGPD: dados fiscais de terceiros sem política de retenção/expurgo | transversal |

**Nota positiva, e ela é real:** a API Python foi endurecida com competência — parser lxml com
`resolve_entities=False` (anti-XXE), `MAX_CONTENT_LENGTH`, `secure_filename`, limpeza garantida no
`finally`, `debug` desligado por padrão. `scripts/gen-config.js` falha o build quando falta env var
em vez de gerar auth quebrada silenciosamente. O `.gitignore`/`.vercelignore` estão corretos e a
varredura do histórico do Git **não encontrou nenhum segredo commitado**. Isso não é comum.

---

## P0 — Bloqueiam a venda

### 1. Escalonamento de privilégio via `user_metadata`

**Onde:** `supabase/functions/create-user/index.ts:66-69`, `delete-user/index.ts:73-76`,
`update-user/index.ts` (mesmo padrão).

```ts
const callerControl = (userData.user.user_metadata as Record<string, unknown> | null)?.control;
if (callerControl !== 'administrador') {
  return json({ ok: false, error: 'Apenas administradores podem cadastrar usuários' }, 403, cors);
}
```

**Causa:** `user_metadata` é gravável pelo próprio usuário através de `supabase.auth.updateUser()`.
A checagem de administrador lê exatamente o campo que o atacante controla. O comentário no topo de
`delete-user/index.ts:15-19` descreve o problema com precisão e conclui "Fora do escopo desta função".

**Exploração:** qualquer usuário auxiliar autenticado executa no console do navegador:

```js
await window.supabaseSync.auth.getUser();               // confirma sessão
// a chamada abaixo grava user_metadata.control = 'administrador'
```

A partir daí passa nas três Edge Functions e — conforme o comentário afirma que
`current_user_is_admin()` usa "a mesma régua" — provavelmente também nas policies RLS. Consequência:
criar administradores, apagar contas (inclusive a do dono do escritório), ler e escrever todo o
`system_data`.

**Correção:** mover a flag para `app_metadata`, que só o `service_role` escreve.

```ts
// na Edge Function, ao criar o usuário:
await admin.auth.admin.createUser({
  email, password, email_confirm: true,
  user_metadata: { username, full_name: fullName },
  app_metadata:  { control },        // ← só service_role escreve
});

// na checagem de authz:
const callerControl = (caller.app_metadata as Record<string, unknown> | null)?.control;
```

E no Postgres, `current_user_is_admin()` deve ler do mesmo lugar:

```sql
create or replace function public.current_user_is_admin() returns boolean
language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'control') = 'administrador',
    false
  );
$$;
```

Requer uma migration de backfill copiando `user_metadata.control` → `app_metadata.control` para os
usuários existentes, executada com `service_role`.

---

### 2. Worker local: exfiltração de dados fiscais e leitura arbitrária de disco

**Onde:** `worker/server.js:31-42` (CORS), `worker/lib/dirbi.js:227` (`inboxPath`),
`worker/lib/nfce.js:156` e `dirbi.js:228` (IDs de job).

Três defeitos que isoladamente seriam médios, e combinados formam um vetor crítico:

```js
// worker/server.js:31 — ecoa qualquer origin, sem allowlist
function applyCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    ...
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
```

- **Sem autenticação.** Nenhuma rota exige token. Não há sequer o header `x-authentication-token`
  sendo validado — ele só é repassado à SEFAZ.
- **CORS ecoa qualquer origem** e habilita Private Network Access explicitamente, o que é o que
  permite a uma página HTTPS pública ler respostas de `http://127.0.0.1:47620`.
- **IDs de job são sequenciais:** `'nfce-' + (++jobSeq)`, `'dirbi-' + (++jobSeq)`. O primeiro job de
  cada sessão é sempre `nfce-1` / `dirbi-1`.

**Exploração.** Enquanto o worker roda, qualquer aba aberta pelo contador (um anúncio, um site de
notícia, um link de e-mail) pode executar:

```js
// 1. detecta o worker
const h = await (await fetch('http://127.0.0.1:47620/health')).json();

// 2. força o worker a varrer QUALQUER pasta do disco em busca de XMLs
await fetch('http://127.0.0.1:47620/dirbi/start', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ inboxPath: 'C:\\Users\\contador\\Documents' }),
});

// 3. baixa a planilha gerada com os dados fiscais consolidados
const xlsx = await (await fetch('http://127.0.0.1:47620/dirbi/result/dirbi-1')).blob();

// 4. e os ZIPs de NFCe já baixados pelo contador
const zip = await (await fetch('http://127.0.0.1:47620/nfce/zip/nfce-1/12345678000199')).blob();
```

`worker/lib/dirbi.js:171` chama `listFilesRec(inboxDir, [])` sem validar que o caminho está sob um
diretório permitido — é travessia de diretório completa, limitada apenas às permissões do processo.

**Correção (três medidas, todas necessárias):**

```js
// 1. allowlist de origem — nada de eco
const ALLOWED_ORIGINS = new Set([
    'https://softtech-fiscal.vercel.app',
    'http://localhost:5500',
]);
function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return false;   // sem header = browser bloqueia
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    ...
    return true;
}

// 2. token de pareamento: worker gera no boot, imprime no console, usuário cola na UI uma vez
const crypto = require('crypto');
const PAIR_TOKEN = crypto.randomBytes(24).toString('hex');
console.log(`  token de pareamento: ${PAIR_TOKEN}`);
// e em cada rota (exceto /health):
if (req.headers['x-worker-token'] !== PAIR_TOKEN) { sendJson(res, 401, {ok:false}); return; }

// 3. IDs de job imprevisíveis
const id = 'nfce-' + crypto.randomBytes(16).toString('hex');
```

E em `dirbi.js`, restringir `inboxPath` a uma raiz permitida:

```js
const ROOT = path.resolve(process.env.DIRBI_ROOT || path.join(__dirname, '..', 'inbox'));
const requested = path.resolve(payload.inboxPath || ROOT);
if (requested !== ROOT && !requested.startsWith(ROOT + path.sep)) {
    return { id: null, error: 'inboxPath fora da raiz permitida' };
}
```

---

### 3. Multi-tenancy inexistente

**Onde:** modelo de dados inteiro. `assets/js/supabase-sync.js:15` — `TABLE_NAME = 'system_data'`,
chaveada por `key` (texto) sem nenhuma coluna de organização ou tenant.

```js
// supabase-sync.js:377 — upsert global, sem escopo de cliente
.from(TABLE_NAME).upsert({ key, value: data, updated_at: ... }, { onConflict: 'key' })
```

As chaves são literais globais: `'registeredUsers'`, `'contributors'`, `'cest_vencidos'`. Dois
escritórios no mesmo projeto Supabase sobrescreveriam os dados um do outro imediatamente.

Some-se a isso que `assets/js/config.js` é **gerado em tempo de build** a partir de env vars do
Vercel (`scripts/gen-config.js`), incluindo a URL do Supabase. Ou seja: a identidade do banco está
congelada no artefato de deploy. Um cliente = um projeto Supabase = um projeto Vercel = um conjunto
de env vars = um `adminPasswordHash`. Não há caminho para onboarding self-service.

**Decisão a tomar antes de escrever código** — os dois caminhos têm custos muito diferentes:

| Caminho | Custo de implementação | Custo operacional por cliente | Isolamento |
|---|---|---|---|
| **A. Single-tenant replicado** (o que existe hoje, formalizado) | Baixo — script de provisionamento | Alto — 1 projeto Supabase + 1 deploy por cliente, migrations aplicadas N vezes | Máximo (bancos separados) |
| **B. Multi-tenant real** | Alto — coluna `org_id` em tudo, RLS por organização, tabela `organizations`, convites, troca de contexto | Baixo — um deploy serve todos | Depende inteiramente da RLS estar correta |

Recomendação: **B**, mas somente depois de fechar os achados 1 e 7. Multi-tenancy sobre uma RLS não
versionada e com escalonamento de privilégio conhecido transforma um bug de autorização em vazamento
de dados entre clientes concorrentes — o pior cenário possível para um produto contábil.

Se a pressa comercial exigir faturar antes disso, **A** é defensável como estágio intermediário,
desde que vendido como "instalação dedicada" e com o provisionamento automatizado por script. Não é
defensável como estado permanente.

Esboço mínimo do caminho B:

```sql
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.system_data add column org_id uuid not null
  references public.organizations(id) on delete cascade;
alter table public.system_data drop constraint system_data_pkey;
alter table public.system_data add primary key (org_id, key);

alter table public.system_data enable row level security;
create policy "tenant isolation" on public.system_data
  for all
  using  (org_id = (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid)
  with check (org_id = (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid);
```

`org_id` em `app_metadata` pelo mesmo motivo do achado 1: precisa ser inescrevível pelo usuário.

---

### 4. API Python em produção sem autenticação

**Onde:** `render.yaml.disabled:26-33` versus `api_icms/api_icms.py:58,141-149`.

```python
# api_icms.py:58 — se a env var não existir, a autenticação é desligada por completo
API_KEY = os.environ.get("ICMS_API_KEY", "").strip()

def _check_api_key():
    if not API_KEY:
        return None          # ← sem chave configurada = qualquer requisição passa
```

O `render.yaml.disabled` define `ICMS_API_LOG_LEVEL` e `ICMS_API_CORS_ORIGINS`, mas **não define
`ICMS_API_KEY`**. E a CSP em `vercel.json` lista `https://softtech-icms-api.onrender.com` em
`connect-src`, confirmando que o serviço está publicado.

**CORS não é controle de acesso.** Ele instrui o *navegador* a bloquear a leitura da resposta; `curl`,
Python `requests` ou qualquer cliente não-browser ignora completamente. A API está aberta.

Dois impactos:

- `POST /api/icms/process` — processamento de `.xlsx` e XML arbitrários por qualquer um. Free tier do
  Render, sem rate limit: negação de serviço trivial, e `openpyxl` sobre arquivo hostil (zip bomb) é
  um vetor de exaustão de memória.
- `POST /api/icms/biblioteca` (`api_icms.py:418-428`) — **escrita de arquivo sem qualquer verificação
  de administrador**, apenas o gate opcional de API key que está desligado. Qualquer pessoa
  sobrescreve a biblioteca de razões sociais, corrompendo silenciosamente os nomes que vão para as
  planilhas entregues aos clientes. Corrupção silenciosa de dado fiscal é pior que indisponibilidade.

**Correção imediata:** gerar a chave, configurar no Render, e falhar o boot se ela faltar em produção.

```python
API_KEY = os.environ.get("ICMS_API_KEY", "").strip()
if not API_KEY and os.environ.get("ICMS_API_ENV", "dev") == "prod":
    raise RuntimeError("ICMS_API_KEY é obrigatória quando ICMS_API_ENV=prod")
```

```yaml
# render.yaml
      - key: ICMS_API_ENV
        value: prod
      - key: ICMS_API_KEY
        generateValue: true      # Render gera e injeta; não aparece no repositório
```

E comparar a chave em tempo constante, para não vazar por timing:

```python
import hmac
if not hmac.compare_digest(sent, API_KEY):
    ...
```

`biblioteca_post` precisa de authz própria — API key compartilhada não distingue admin de operador.
O caminho coerente com o resto do sistema é validar o JWT do Supabase e exigir
`app_metadata.control == 'administrador'`.

---

## P1 — Sérios

### 5. Fallback de autenticação client-side

`scripts/gen-config.js` grava `passwordSalt` e `adminPasswordHash` dentro de
`assets/js/config.js`, que é servido ao navegador. `Dominium.html:18` carrega esse arquivo.

Consequências concretas:

- O salt é público. PBKDF2 com 100k iterações e salt conhecido, sobre uma senha escolhida por humano,
  cai em ataque de dicionário offline. O salt existe justamente para impedir isso.
- O hash do super-admin é público. O atacante testa candidatos localmente, sem tocar o servidor —
  nenhum rate limit, nenhum log, nenhuma detecção possível.
- Pior: o caminho de fallback (`app.js:472-575`) autentica a UI contra `registeredUsers` lido do
  `localStorage`. Editar essa chave no DevTools libera o dashboard. Isso não dá acesso aos dados da
  nuvem (a RLS de fase 2 exige sessão), mas dá acesso a tudo que já está em cache local — que num
  escritório em uso diário é justamente a base de contribuintes.

**Correção:** remover o fallback local por completo. A migração para Supabase Auth já está feita
(`handleLogin` tenta Supabase primeiro, `app.js:447`). O fallback é dívida de transição que virou
superfície de ataque permanente. Junto com ele saem `adminPasswordHash`, `passwordSalt`,
`generateSecureHash`, `verifyPassword` e `_legacyUnsafeHash`.

Antes de remover: migrar os usuários que ainda existem só em `registeredUsers` para `auth.users` via
a Edge Function `create-user` (senha temporária + troca obrigatória no primeiro login).

### 6. Hash legacy reversível ainda aceito

`app.js:63-74`. `_legacyUnsafeHash` é `btoa()` + `reverse()` iterado com salts fixos e presentes no
código-fonte. É codificação, não hash — perfeitamente reversível por qualquer um que leia o arquivo.

`verifyPassword` (`app.js:50-54`) aceita esse formato e faz upgrade silencioso. Enquanto qualquer
registro no banco carregar um hash legacy, aquela senha deve ser tratada como **texto claro
publicado**. Sai junto com o achado 5.

### 7. RLS não versionada

`supabase/` contém apenas `functions/`. Não há `migrations/`. Todas as policies, o trigger
`handle_new_user`, a função `current_user_is_admin()` e a RPC `registrar_acao` existem apenas no
dashboard.

Para um produto vendido a escritórios de contabilidade isso é inaceitável em três frentes:

- **Não auditável.** Não há como um cliente, um auditor ou você mesmo daqui a seis meses revisar
  quem pode ler o quê.
- **Não reproduzível.** Provisionar o segundo cliente depende de alguém repetir cliques corretamente.
- **Não revisável.** Uma mudança de policy não passa por diff, code review ou histórico.

**Correção:** `supabase db pull` para extrair o estado atual em migration, commitar, e daí em diante
toda mudança de schema/policy vira migration versionada. Este é pré-requisito do achado 3 — não faz
sentido projetar isolamento por tenant sobre policies que ninguém consegue ler.

### 8. Sem SRI + CSP com `unsafe-inline`

`Dominium.html:13-22,271` carrega seis bibliotecas de CDN com `crossorigin="anonymous"` mas **sem
`integrity`**. `vercel.json` permite `script-src 'unsafe-inline'`.

Comprometimento de cdnjs ou jsdelivr, ou de uma dessas contas de publicação, injeta código com
acesso total à página — inclusive ao `localStorage`, onde o SDK do Supabase persiste o refresh token
(`supabase-sync.js:61`). Isso derruba toda a segurança da autenticação de uma vez.

**Correção:** adicionar `integrity="sha384-..."` em cada tag. Melhor ainda: baixar as libs para
`assets/vendor/` e servi-las do mesmo domínio, o que também remove a dependência de disponibilidade
de terceiros e permite fechar a CSP para `script-src 'self'`.

`'unsafe-inline'` é consequência dos 49 blocos `innerHTML = \`...\`` em `app.js`. Removê-lo exige
refatoração — registre como dívida com plano, não deixe implícito.

### 9. Dependências desatualizadas

| Pacote | Versão em uso | Onde | Observação |
|---|---|---|---|
| `xlsx` (SheetJS) | 0.18.5 | `Dominium.html:13` | Versão antiga; há correções de prototype pollution e ReDoS em releases posteriores. Processa `.xlsx` enviado pelo usuário. |
| `exceljs` | 4.4.0 (CDN) / **3.4.0** (worker) | `Dominium.html:14`, `worker/package.json` | Duas versões distintas para a mesma finalidade. A 3.x é de 2019. |
| `Werkzeug` | 3.0.1 | `api_icms/requirements.txt` | Atrás da 3.0.6, que corrigiu exaustão de recursos no parsing multipart — exatamente o que `/api/icms/process` faz. |
| `Flask` | 3.0.0 | idem | Atrás da linha 3.1. |

Não confirmei os números de CVE individualmente e não devo afirmá-los de memória. **Verifique você
mesmo antes de decidir prioridade** — leva dois minutos:

```bash
pip install pip-audit && pip-audit -r api_icms/requirements.txt
```

Para o frontend não há lockfile porque as libs vêm de CDN — o que é, em si, parte do problema. Migrar
para `npm` + bundler resolve versionamento, auditoria e SRI de uma vez (ver achado 14).

### 10. Ausência de rate limiting

Nenhuma camada tem limite: nem a API Flask, nem o worker, nem as Edge Functions, nem o login. O login
via Supabase tem alguma proteção nativa da plataforma, mas o fallback local (achado 5) não tem
nenhuma. `/api/icms/process` sem limite em free tier do Render é derrubável por um único cliente
mal-comportado, quanto mais por um ataque.

Para a API Flask, `flask-limiter` resolve com poucas linhas. Para as Edge Functions, um contador em
tabela com janela deslizante.

---

## P2 — Qualidade, manutenibilidade e conformidade

### 11. Núcleo fiscal sem cobertura de teste

Um único arquivo de teste no repositório: `scripts/test-transf-check.mjs`. Ele passa
(`✅ test-transf-check: todas as asserções passaram`) e é bem construído — o núcleo de
`transf-check.js` foi deliberadamente escrito puro para ser testável fora do browser. Esse é o padrão
correto e deve ser replicado.

Sem nenhum teste hoje:

- Cálculo PIS/COFINS (`app.js:11723-11797`)
- Filtros CST/CSOSN e geração de ICMS ST (`api_icms.py:154-236`)
- Corretor SPED/FS — as cinco regras de `corretor-fiscal.js`, **incluindo a regra 5, que apaga blocos
  de linhas do arquivo do cliente**
- Agregação DIRBI (`worker/lib/dirbi.js`)

Este é o risco que mais assusta num produto contábil. Um erro de cálculo de PIS/COFINS não gera erro
visível: gera uma guia com valor errado, que o cliente paga, e que aparece meses depois como multa.
`corretor-fiscal.js` remove linhas de arquivo SPED com base num relatório parseado por expressão
regular — se o parsing errar o número da linha, o arquivo entregue ao fisco fica corrompido de forma
silenciosa.

O trabalho aqui não é "escrever testes para tudo". É:

1. Extrair as funções de cálculo de `app.js` para módulos puros, como já foi feito em
   `transf-check.js` e `corretor-fiscal.js` (ambos com `module.exports` no fim).
2. Um caso de teste por regra fiscal, usando arquivos reais já validados manualmente como fixture.
3. Rodar em CI a cada push.

### 12. Aritmética monetária em ponto flutuante

`app.js:11725`:

```js
function round2(n) { return Math.round(n * PIS_COFINS_DECIMAL) / PIS_COFINS_DECIMAL; }
```

Verificado nesta auditoria:

```
round2(1.005)  = 1      (contábil: 1.01)   ← erra
round2(8.615)  = 8.62                       ← acerta
round2(1234.565) = 1234.57                  ← acerta
```

O erro em `1.005` acontece porque `1.005 * 100` resulta em `100.49999999999999` em ponto flutuante
IEEE 754, e `Math.round` arredonda para baixo. O comportamento é inconsistente — depende do valor
específico — o que é pior que estar sempre errado, porque não aparece em teste superficial.

Em centavos isolados isso é ruído. Somado sobre centenas de notas, e num contexto onde o número vai
para uma guia de recolhimento, é divergência de conciliação.

**Correção mínima** (evita a maioria dos casos, uma linha):

```js
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
```

**Correção correta:** trabalhar em centavos inteiros ou adotar decimal de precisão arbitrária
(`decimal.js`) no caminho de cálculo fiscal. Custo: uma dependência e refatoração do módulo de
cálculo. Benefício: acaba a classe inteira de bug. Para um produto que emite valores de imposto,
recomendo a segunda — mas a primeira, aplicada hoje, já reduz muito a exposição.

### 13. Base de cálculo negativa produz imposto negativo

`app.js:11772-11780`:

```js
const baseAnt = ant.vendas - ant.compras;
const baseAtual = atual.vendas - atual.compras;
if (baseAnt === 0) { semAnterior.push(atual); continue; }
const cofinsNovo = ant.cofins * (baseAtual / baseAnt);
```

O guard cobre `baseAnt === 0`, mas não o sinal. Verificado:

```
baseAnt = -50, baseAtual = 50, cofins_ant = 10  →  cofinsNovo = -10
```

Uma empresa que comprou mais do que vendeu no período anterior (situação comum: formação de estoque,
mês de baixa venda) inverte o sinal do imposto calculado. O valor negativo segue para o JSON do MIT
sem nenhum aviso.

**Correção:** não silenciar — sinalizar. Um valor que o contador precisa revisar manualmente é um
resultado legítimo; um valor negativo entregue como se fosse normal, não.

```js
if (baseAnt <= 0 || baseAtual <= 0) {
    revisarManualmente.push({ ...atual, motivo: 'base de cálculo não-positiva' });
    continue;
}
```

E a UI precisa exibir essa lista com o mesmo destaque que `semAnterior` já recebe.

### 14. `app.js` monolítico

663 KB, aproximadamente 9.600 linhas, um único IIFE, sem sistema de módulos e sem build. Cache-busting
manual por query string (`app.js?v=20260721a`).

O `CLAUDE.md` do projeto já reconhece o problema — a existência do grafo Graphify é uma solução de
navegação para um arquivo que não deveria precisar de uma. É um sintoma tratado, não a causa.

O efeito prático em um produto comercial: cada mudança carrega risco de regressão em área não
relacionada, revisão de código é inviável, e onboarding de um segundo desenvolvedor custa semanas.

Não recomendo reescrita — recomendo extração incremental, exatamente no padrão que
`transf-check.js` e `corretor-fiscal.js` já estabeleceram: puxar um domínio de cada vez para módulo
puro com `module.exports`, começando pelos que precisam de teste (achado 11). Vite ou esbuild com
configuração mínima; a stack vanilla não precisa mudar.

### 15. Erros silenciados

`supabase-sync.js:147-151` e `:180-184`:

```js
supabaseClient.rpc('registrar_acao', { ... }).then(() => {}, () => {});
```

A trilha de auditoria falha em silêncio. Para um sistema contábil, "quem fez o quê e quando" não é
telemetria opcional — é o registro que sustenta a defesa do escritório numa contestação. Se a RPC
falhar por policy, rede ou schema, ninguém descobre.

O mesmo padrão em `saveDataSync(...).catch(() => {})` (`app.js:529,651`): falha de sincronização
não chega ao usuário, que continua trabalhando acreditando que os dados subiram.

**Correção:** falha de auditoria e falha de sync devem, no mínimo, produzir log estruturado e um
indicador visível na UI. Um badge de "não sincronizado" é barato e evita perda de trabalho.

### 16. Sem CI, sem lint, sem lockfile na raiz

Não há `package.json` na raiz, nenhum workflow de CI, nenhum linter configurado, nenhuma verificação
automática antes do deploy. `node --check` passa em todos os arquivos JS (verificado nesta auditoria),
mas isso é só sintaxe.

Mínimo defensável para produto comercial:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node --check assets/js/app.js
      - run: node scripts/test-transf-check.mjs
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install pip-audit && pip-audit -r api_icms/requirements.txt
```

Cresce conforme os testes do achado 11 forem escritos.

### 17. Automação RPA por coordenada de tela

`.py/Contribuicao_Ajuste.py` e `.py/Eliminar_Inventario.py` usam `pyautogui` — cliques em posições
absolutas de tela. Isso quebra com qualquer mudança de resolução, escala de DPI, versão do software
alvo ou posição de janela, e falha de forma perigosa: um clique fora do lugar em software contábil
pode alterar dados sem que ninguém perceba.

Se esses scripts fazem parte do produto vendido, precisam de guarda de verificação (confirmar por
screenshot que a tela esperada está em foco antes de cada clique) e de um modo dry-run. Se são
ferramentas internas do Josué, documente isso explicitamente e mantenha-os fora do pacote entregue.

### 18. LGPD — lacunas de conformidade

Vendendo para escritórios de contabilidade, o sistema processa dados fiscais de **terceiros** (os
clientes dos escritórios). Isso coloca você como operador de dados pessoais na acepção da LGPD, com
obrigações contratuais próprias.

Lacunas identificadas no código:

- **Sem política de retenção ou expurgo.** `system_data` e `localStorage` acumulam indefinidamente.
  Não há rotina de exclusão nem endpoint de "esquecer este contribuinte".
- **`localStorage` sem limpeza no logout.** `authSignOut` (`supabase-sync.js:178-191`) encerra a
  sessão Supabase mas deixa `registeredUsers`, `contributors` e demais chaves no navegador. Em
  máquina compartilhada de escritório, o próximo usuário lê tudo pelo DevTools.
- **Trilha de auditoria não confiável** (achado 15) — e o artigo 37 da LGPD exige registro das
  operações de tratamento.
- **Sem DPA nem documentação de tratamento.** Não é código, mas é bloqueante para venda a cliente
  que tenha jurídico.

Não sou advogado e isto não é orientação jurídica. **Consulte um profissional antes de assinar
contrato com o primeiro cliente** — a exposição aqui é do escritório *e* sua.

---

## Ordem de trabalho recomendada

A sequência importa: cada fase é pré-requisito da seguinte.

**Fase 1 — Fechar o exploitável (1 a 2 semanas).** Nada aqui depende de decisão de produto.

1. `ICMS_API_KEY` no Render + boot falhando sem ela + authz em `/biblioteca` (achado 4)
2. Worker: allowlist de origem, token de pareamento, IDs aleatórios, `inboxPath` restrito (achado 2)
3. `app_metadata.control` nas três Edge Functions e em `current_user_is_admin()` (achado 1)
4. `supabase db pull` → primeira migration versionada (achado 7)

**Fase 2 — Limpar a superfície de autenticação (1 semana).**

5. Migrar usuários residuais de `registeredUsers` para `auth.users`
6. Remover fallback local, `adminPasswordHash`, `passwordSalt` e `_legacyUnsafeHash` (achados 5, 6)
7. Limpar `localStorage` no logout (achado 18)

**Fase 3 — Confiança no cálculo (2 a 3 semanas). Esta é a que protege sua reputação.**

8. Extrair PIS/COFINS, ICMS ST e corretor SPED para módulos puros
9. Fixtures reais + testes por regra fiscal (achado 11)
10. Corrigir arredondamento e base negativa (achados 12, 13)
11. CI rodando testes e `pip-audit` (achados 9, 16)

**Fase 4 — Multi-tenancy (3 a 4 semanas).** Só depois que 1, 3 e 7 estiverem fechados.

12. Decidir entre caminho A e B (achado 3)
13. Se B: `organizations`, `org_id`, RLS por tenant, fluxo de convite, provisionamento

**Fase 5 — Endurecimento e dívida.**

14. SRI ou vendorização das libs de CDN; fechar a CSP (achado 8)
15. Rate limiting (achado 10)
16. Extração incremental de `app.js` (achado 14)
17. Documentação de tratamento de dados e DPA (achado 18)

---

## O que verificar antes de confiar neste relatório

Auditoria estática tem limites. Os pontos abaixo eu **não** consegui confirmar a partir do
repositório e podem alterar a severidade dos achados:

- **As policies RLS reais.** O achado 1 assume que `current_user_is_admin()` lê de `user_metadata`,
  com base no comentário em `delete-user/index.ts:11`. Se a função já foi corrigida no dashboard, o
  impacto é menor — mas o problema nas Edge Functions permanece, porque a checagem lá é
  independente e está no código que eu li.
- **O exploit do worker, na prática.** A leitura do código é conclusiva sobre a ausência de auth e o
  CORS aberto. Confirmar exige rodar o worker e disparar as requisições de outra origem. Vale fazer —
  é rápido e remove qualquer dúvida sobre a prioridade.
- **Se a API do Render está de fato no ar.** Baseei-me na CSP de `vercel.json` e no
  `render.yaml.disabled`. Um `curl https://softtech-icms-api.onrender.com/api/icms/health` responde
  isso em segundos. Se estiver fora do ar, o achado 4 cai para P1 (dívida de configuração) em vez
  de P0 (exposição ativa).
- **As CVEs das dependências.** Não afirmei números de CVE porque não os verifiquei nesta sessão.
  Rode `pip-audit` antes de priorizar o achado 9.
- **O `.exe` do worker distribuído.** Auditei `worker/server.js` no repositório. O binário
  empacotado nas máquinas pode estar em versão anterior — a `PENDENCIAS.md` (item P1b) confirma que
  há divergência conhecida entre worker distribuído e código atual.

---

---

# Adendo — 2026-08-03: Fase 1 implementada

A implementação verificou coisas que a análise estática só supôs. Duas correções de
severidade e dois achados novos.

## Correção: achado 4 é P1, não P0

**A API do Render não está no ar.** Verificado:

```
$ curl -D - https://softtech-icms-api.onrender.com/api/icms/health
HTTP/1.1 404 Not Found
x-render-routing: no-server
```

`x-render-routing: no-server` significa que o serviço não existe no Render — não é um
404 do Flask. E `icmsApiUrl` aparece **só** no `config.example.js`: nenhum arquivo do
frontend chama a API.

Ou seja: não há exposição ativa. O risco é o momento em que alguém renomear
`render.yaml.disabled` e subir o serviço com a configuração antiga. Rebaixado para P1
(dívida de configuração), e corrigido mesmo assim — o custo era baixo e a armadilha
ficaria armada.

## Achado novo 19 — P1: takeover de subdomínio via CSP

Consequência direta do anterior. A CSP em `vercel.json` autorizava
`connect-src https://softtech-icms-api.onrender.com`, e esse nome **está livre no
Render** — o serviço foi removido. Qualquer pessoa pode registrar um serviço com esse
nome e passar a ser um destino autorizado pela política de segurança do site.

Não é exploração de um passo (precisa de XSS para ser usada), mas é exatamente o tipo
de resíduo que transforma um XSS de baixa severidade em exfiltração. Entrada de CSP
apontando para host que não existe mais é superfície gratuita.

**Corrigido:** host removido do `connect-src`.

## Achado novo 20 — P0: revogação de privilégio não chegava à nuvem

Encontrado ao ligar o `control` ao `app_metadata`. Em `app.js`, no fluxo de edição de
usuário:

```js
// antes
if (password && window.supabaseSync?.auth?.updateUser && ...) {
    await window.supabaseSync.auth.updateUser({ username, password, control });
}
```

`updateUser` é a **única** via que altera `auth.users` — e só era chamada quando uma
nova senha era digitada. Rebaixar um administrador sem trocar a senha gravava o novo
`control` apenas no `localStorage` e em `user_profiles`. No Supabase, a pessoa
continuava administradora.

Efeito prático: o admin abre o painel, muda o nível de acesso de alguém, a UI confirma
"Usuário atualizado com sucesso", e o acesso não foi revogado. Falha de revogação
silenciosa — a pior categoria, porque produz a crença de que a ação surtiu efeito.

Isto é P0 por si só, independente do achado 1: mesmo com `app_metadata` correto, a
revogação não acontecia.

**Corrigido:** dispara quando a senha **ou** o `control` mudam, e falha ao propagar
permissão agora produz aviso explícito em vez de um `console.warn` que ninguém lê.

---

## O que foi entregue na Fase 1

| Item | Achado | Estado |
|---|---|---|
| Worker: allowlist de origem, token de pareamento, IDs aleatórios, `inboxPath` restrito | 2 | ✅ código |
| Edge Functions + RLS lendo `app_metadata` | 1 | ✅ código · ⏳ exige migration aplicada |
| Revogação de privilégio propagando para `auth.users` | 20 | ✅ código |
| API Python: boot falha sem chave em prod, `hmac.compare_digest`, admin key nas rotas de escrita | 4 | ✅ código |
| Host morto removido da CSP | 19 | ✅ código |
| Baseline de migrations | 7 | ⏳ exige `supabase db pull` (precisa das suas credenciais) |

### Arquivos

```
worker/lib/access.js                 novo — allowlist, token, path, job id (sem dependência)
worker/server.js                     allowlist + token + /health mínimo + /dirbi/info protegido
worker/lib/nfce.js, dirbi.js         job id aleatório; inboxPath restrito a INBOX_ROOT
assets/js/app.js                     workerFetch/workerHealth + pareamento; revogação corrigida
assets/js/supabase-sync.js           updateProfile não grava mais control
supabase/functions/_shared/auth.ts   novo — CORS, json, requireAdmin (app_metadata)
supabase/functions/{create,update,delete}-user/index.ts   reescritas sobre _shared
supabase/migrations/                 novo — backfill + current_user_is_admin + README
api_icms/api_icms.py                 _validar_config, _match, _check_admin_key
render.yaml.disabled                 ICMS_API_ENV=prod + chaves geradas pelo Render
vercel.json                          host morto fora do connect-src
scripts/test-worker-access.mjs       novo — 30 asserções sobre o controle de acesso
```

### Verificação

```
✅ test-worker-access: todas as asserções passaram
✅ test-transf-check: todas as asserções passaram
node --check: app.js, supabase-sync.js, server.js, dirbi.js, nfce.js
ast.parse: api_icms.py · json.load: vercel.json
```

Não rodado: `deno check` nas Edge Functions (Deno ausente nesta máquina) e a migration
contra o banco real. Ambos precisam do seu ambiente.

### Ordem de implantação — inverter derruba todos os admins

1. `supabase db pull` e conferir a migration contra o schema real (ver
   `supabase/migrations/README.md`)
2. `supabase db push` — backfill de `user_metadata` → `app_metadata`
3. `supabase functions deploy create-user delete-user update-user`
4. Rebuild do `.exe` do worker e re-pareamento nas máquinas

Publicar as funções antes do passo 2 nega 403 para todo mundo, inclusive você. A
migration aborta a transação se o backfill não encontrar nenhum admin, mas essa trava
não te protege se a ordem for invertida — ela protege contra o backfill falhar.

---

*Auditoria conduzida em 2026-08-01 sobre o commit `ac2459e`. Adendo em 2026-08-03.*
