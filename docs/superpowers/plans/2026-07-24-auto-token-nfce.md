# Auto-token NFCe — login automático no Ambiente Seguro + colheita de token

**Goal:** eliminar o passo manual de baixar uma NFCe no Ambiente Seguro SEFAZ-CE
só pra extrair o token. Ao clicar "Iniciar Download NFCe", o SoftTech pede CPF+senha,
loga sozinho (headless, invisível), colhe 1 token e alimenta o download NFCe existente.

## Contexto (o que já existe e funciona)

- **Harvester validado:** `harvester/harvest-tokens.js` (Node + Playwright). Login manual
  na página real da SEFAZ → seleciona 1ª empresa → captura `x-authentication-token` pelo
  header (imune ao modal central) → grava `token.txt`. **Já testado contra o site real, colhe token.**
- **Fato-chave confirmado pelo usuário:** UM token baixa NFCe de QUALQUER empresa (o
  download em node baixa milhares e filtra por chave). Então basta 1 token da 1ª empresa.
  Não precisa iterar empresas.
- **Token:** JWT, `sub` = CNPJ da 1ª empresa, `exp` = `iat` + 86400 (**24h**). Payload tem
  `{sub, iat, exp, "<cnpj>":"CONTRIBUINTE"}`.
- **Download NFCe:** `createBaixarNfcePage` em `assets/js/app.js` (~9079). Já tem **modo
  global** (`#bn-global-mode` checkbox + `#bn-token` textarea): 1 token pra todas as empresas.
  Pipeline: report → chaves → `buildCompanies` → `/nfce/start` no worker → ZIP.
- **Worker:** `worker/server.js` porta `47620`, **zero-dep** (regra do repo). NÃO adicionar
  Playwright aqui.
- **Login SEFAZ:** `https://servicos.sefaz.ce.gov.br/internet/acessoseguro/servicosenha/logarusuario/login.asp`
  — sem CAPTCHA, sem gov.br. Cert usa CA que o Chromium do Playwright não traz → `ignoreHTTPSErrors: true`.
- **Fluxo pós-login:** clicar menu "MFE - Modulo Fiscal Eletronico" → "Acessar MFe" →
  lista de empresas (`a[href^="JavaScript:submete"]`) → selecionar 1ª → portal-mfe cunha o token.
  Há um **modal central** ao entrar no MFe (não bloqueia a captura por header).

## Arquitetura — sidecar (browser não roda Playwright)

```
[SoftTech browser file://]                    [sidecar Node+Playwright, loopback :47621]
  botão "Iniciar Download NFCe"
    -> GET  /nfce/token           --------->  token em cache válido? devolve. senão 401.
    -> (401) modal CPF+senha
    -> POST /nfce/token {cpf,senha} -------->  headless: login.asp preenche cpf/senha/vínculo
                                               -> MFE -> Acessar MFe -> 1ª empresa
                                               -> captura x-authentication-token
                                               -> cacheia {token, exp} em memória
    <---------- {token} --------------------
  preenche modo global -> /nfce/start (worker 47620, pipeline atual)
```

Sidecar separado do worker zero-dep. Porta sugerida **47621**.

---

### Task 0: Capturar o DOM do form de login.asp (BLOQUEADOR — fazer antes de codar)

Sem os seletores do form, o preenchimento headless é chute. Pedir ao usuário (DevTools na
`login.asp`, Inspecionar) o HTML dos campos:
- input do **CPF/usuário** (id/name)
- input da **senha** (id/name)
- select/radio do **vínculo** (onde escolhe "Contador") — ou se é escolhido depois do login
- **botão** de submeter (id/name/texto)

Anotar os seletores confirmados no topo do sidecar.

---

### Task 1: Sidecar `harvester/harvest-server.js`

**Files:** Create `harvester/harvest-server.js`. Reusa a lógica de `harvester/harvest-tokens.js`.

**Rotas (loopback 127.0.0.1:47621, CORS + Private Network como o worker):**
- `GET /health` → `{ok:true}`.
- `GET /nfce/token` → se cache válido (`exp` no futuro c/ margem 5min), `{ok:true, token}`;
  senão `{ok:false, needsLogin:true}` (status 200, flag).
- `POST /nfce/token {cpf, senha}` → executa login headless + colheita → `{ok:true, token}`
  ou `{ok:false, error}`. Cacheia `{token, exp}` (decodifica `exp` do JWT).

**Login headless (Playwright):**
- `chromium.launch({ headless: true, channel: 'chrome' })` + `newContext({ ignoreHTTPSErrors: true })`.
- `page.goto(login.asp)` → preenche CPF/senha/vínculo (seletores da Task 0) → submete.
- Espera `SEL.menuMFE` (login OK) — se timeout/erro de credencial, retorna `{error:'login falhou'}`.
- `click(menuMFE)` → `click(acessarMFe)` → `waitForSelector(companyRow)`.
- `ctx.on('request')` captura o 1º `x-authentication-token` → decodifica `sub`/`exp`.
- `page.locator(companyRow).first().click()` → espera token → fecha browser.

**Segurança (obrigatório):**
- `cpf`/`senha` só em memória; nunca `console.log`, nunca em disco.
- Não persistir credenciais entre requests. Não logar o token.
- Cache do token só em memória (some ao reiniciar o sidecar).

**Testabilidade:** a colheita real precisa do site SEFAZ (sem mock viável). Teste unitário
possível: `decodeExp(jwt)` (parse do `exp`), validação de cache-expiry. Login E2E = manual.

---

### Task 2: UI — modal CPF+senha + integração no `createBaixarNfcePage`

**Files:** Modify `assets/js/app.js` (`createBaixarNfcePage`).

- Ao clicar "Iniciar Download NFCe": se modo global sem token válido, `GET :47621/nfce/token`.
  - Cache válido → usa o token, segue.
  - `needsLogin` → abre **modal** no SoftTech pedindo CPF + senha (vínculo fixo Contador).
- Confirma modal → `POST :47621/nfce/token {cpf, senha}` → recebe token → preenche `#bn-token`
  (ou variável interna) → segue o fluxo global existente (`buildCompanies` → `/nfce/start`).
- **Segurança UI:** campo senha `type=password`, `value=''` após submit; nunca logar.
- Detectar sidecar ausente (fetch falha) → instruir subir o sidecar (igual ao banner do worker).

---

### Task 3: Erros + cache + polimento

- Login falhou / senha errada → mensagem clara na tela (reusar padrão `showLaunchError`).
- Token expira no meio → 401 do worker/SEFAZ → repedir login (invalidar cache).
- Cache 24h: reusa token entre downloads do mesmo dia sem repedir senha. Só pede senha quando
  `GET /nfce/token` diz `needsLogin`.

---

### Task 4: Distribuição / infra

- `harvester/` tem `.gitignore` protegendo `token.txt`, `tokens.json`, `node_modules/`,
  perfil PW. Confirmar que `token.txt` está coberto (adicionar se faltar).
- `harvester/package.json` com dep `playwright` + script `start` (`node harvest-server.js`).
- README curto: `npm i` → `node harvest-server.js` (sobe o sidecar). Sidecar + worker rodam juntos.
- Decidir empacotamento: worker vira `.exe` via `bundle-worker.js`; o sidecar Playwright é
  pesado (bundle grande). Avaliar distribuir sidecar à parte ou como script Node.

## Constraints globais

- Worker `47620` permanece **zero-dep**. Playwright vive só no sidecar `harvester/` (47621).
- Sem CAPTCHA/gov.br no login (confirmado) → login headless viável.
- Credenciais: nunca em disco, nunca em log, limpar após uso. Token = segredo (24h).
- 1 token serve todas as empresas (confirmado) → NÃO iterar empresas; só a 1ª.

## Verificação (manual, precisa de acesso SEFAZ real — só o Josué)

1. Sobe worker (`node worker/server.js`) + sidecar (`node harvester/harvest-server.js`).
2. SoftTech → Baixar NFCe → carrega relatório → Iniciar → modal CPF+senha → confirma.
3. Sidecar loga headless (invisível) → token colhido → download roda → ZIPs baixam.
4. 2º download no mesmo dia: não repede senha (cache). Senha errada: mensagem de erro.
5. Confirmar: sem senha/token em disco nem em log.

## Aberto / a decidir

- Task 0 (DOM do login) é pré-requisito.
- Headless pode divergir do headful (raro sem CAPTCHA) — se falhar, rodar `headless:false`
  pra depurar e voltar pra `true`.
- Empacotamento do sidecar (peso do Playwright) — Task 4.
