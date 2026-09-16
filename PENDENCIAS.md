# Pendências — SoftTech Fiscal

Itens conhecidos para resolver depois. Ordem não é prioridade.

## Aberto

### P1b — Rebuild do worker após mudança de identidade por grupo
- A UI agora endereça empresas por `id = <cnpj>-<YYYYMM>` (separação por mês). O worker (`worker/lib/nfce.js`) foi atualizado para casar.
- **Ação:** rebuildar/redistribuir o `.exe` do worker (na máquina pessoal) para a versão nova. Worker antigo + UI nova = anéis não atualizam (a UI tem fallback `id || cnpj`, mas o worker antigo não devolve `id`).

### P2 — Baixar NFe: teto de 20 consultas/hora inviabiliza lote grande
- **Medido em 2026-08-03** com certificado A1 real: a SEFAZ rejeita com cStat 656 —
  `Rejeicao: Consumo Indevido (Ultrapassou o limite de 20 consultas por hora)`.
- `consChNFe` (o modo implementado) gasta **1 consulta por nota**. Um mês de entradas
  reais (346 notas) precisaria de ~18 horas em rodadas de 20.
- **Mitigado, não resolvido:** o worker agora para no orçamento de 20 e entrega o ZIP do
  que baixou (`maxConsultas` em `worker/lib/nfe.js`); a tela avisa antes de começar.
- **Caminho para resolver:** `distNSU` — o modo em lote do mesmo webservice, até **50
  documentos por consulta** (20 consultas/hora × 50 = 1000 docs/hora). A spec original
  deixou fora de escopo (`docs/superpowers/specs/2026-07-22-baixar-nfe-xml-design.md`).
- **Risco a medir antes:** via `distNSU` a SEFAZ pode devolver `resNFe` (resumo) em vez
  de `procNFe` para notas sem manifestação do destinatário. Por `consChNFe` veio
  `procNFe` completo sem manifestação nenhuma — não se pode assumir que vale para os dois.

#### `distNSU` FUNCIONA — medido em 2026-08-14 em outro CNPJ

O bloqueio de 2026-08-03 era **do CNPJ da A&R**, não do serviço. Sondagem única
(`scripts/probe-distnsu.cjs`) num CNPJ diferente, com `ultNSU=0`, **não foi punida**:

```
cStat 138 | Documento(s) localizado(s)
ultNSU 000000000022844 | maxNSU 000000000023179 | docZip 50
21× procNFe_v4.00 · 23× resNFe_v1.01 · 6× resEvento_v1.01
```

Medido a partir desse lote (`scripts/analyze-distnsu-dump.cjs`, sem gastar consulta):

- **`procNFe` completo vem sem manifestação** — 21 dos 44. Os outros 23 vieram como
  resumo. Os NSU são **intercalados** (`resNFe` 22795..22844, `procNFe` 22798..22842),
  e não há evento 2102xx no lote: **o que separa completo de resumo continua desconhecido**.
  Não bloqueia — a regra operacional é pegar o completo e manifestar o resumo.
- **`distNSU` não entrega SAÍDAS.** Zero documentos com a empresa como emitente em 50
  amostras. Mesma regra do cStat 641 do `consChNFe`: a SEFAZ não redistribui ao emitente
  a nota que ele emitiu. **Não existe rota de API para XML de saída** — tem que vir do
  sistema emissor.
- **`ultNSU=0` é seguro em CNPJ sem consumidor externo.** A SEFAZ ignora o que passou dos
  90 dias e entrega do mais antigo vivo. Foi punido na A&R e não aqui: a variável é o CNPJ.
- **Volume:** estoque retido inteiro dessa empresa = 385 documentos = **8 chamadas**.
  O teto de 20/hora deixa de ser gargalo.

**Fronteira do Baixar NFe (confirmada com o usuario em 2026-08-14):** os XMLs de saida
vem do **sistema emissor do cliente**, por arquivo. Entradas por API, saidas por arquivo —
isso e fronteira do escopo, nao lacuna. Nenhuma rota de SEFAZ devolve ao emitente a nota
que ele emitiu.

- **Verificado em 2026-08-14 — o sistema JÁ ingere XML de saída por arquivo.** O grep
  fechou o assunto: existe caminho de saída, não só de entrada.
  - **Saída (empresa é a emitente): tela DIRBI.** `createDirbiPage`
    ([app.js:4204](assets/js/app.js#L4204)) → `processDirbiXmls`
    ([app.js:4318](assets/js/app.js#L4318)) agrupa por `emit>CNPJ`. Aceita `.xml` avulso
    e `.zip` (drop ou seleção múltipla) via `expandXmlInputs`
    ([app.js:3956](assets/js/app.js#L3956)). Com o worker Node ligado, aceita **caminho de
    pasta com subpastas** — `listFilesRec` em [worker/lib/dirbi.js:182](worker/lib/dirbi.js#L182),
    preso sob `INBOX_ROOT` contra travessia de diretório. Sem filtro de modelo: qualquer
    XML com `emit>CNPJ` entra (NF-e 55 e NFC-e 65).
  - **Entrada (empresa é a destinatária): tela ICMS Withholding.**
    `createIcmsWithholdingPage` ([app.js:2789](assets/js/app.js#L2789)) → `processIcmsXmls`
    ([app.js:3057](assets/js/app.js#L3057)), mesmo `expandXmlInputs`. Filtra
    `CFOP_VALIDOS` 5101/5102/5103/5105/5910 e `UF_VALIDO 23`
    ([app.js:2749](assets/js/app.js#L2749)) — CFOP de saída **do fornecedor**, que é
    entrada da empresa.
  - **`tpNF` não é lido em lugar nenhum do código.** A separação entrada/saída é feita por
    qual CNPJ agrupa (emitente vs destinatário), não pelo campo da NF-e.

- **Lacunas que sobram (não bloqueiam o Baixar NFe; nenhuma foi aprovada):**
  1. Ingestão de saída existe **só dentro da DIRBI** e só desemboca na planilha DIRBI. Não
     há importação de saída genérica que alimente outra apuração.
  2. **Pasta só pelo worker Node, e só na DIRBI.** No browser nenhuma tela tem
     `webkitdirectory` — pasta vira multi-seleção de arquivos ou `.zip`. Se valer a pena,
     é `webkitdirectory` no input de [app.js:4219](assets/js/app.js#L4219) (~1 linha, mais
     o filtro de extensão no handler de drop).
  3. **Nenhum XML é persistido.** Toda tela é upload → planilha → descarta (`indexedDB` só
     guarda file handles do SPED). Cada apuração reimporta os mesmos arquivos.

#### Sondagens de `distNSU` em 2026-08-03 — rejeitadas, e o diagnóstico estava incompleto

> Superado pela medição de 2026-08-14 acima. O serviço nunca esteve fechado; o CNPJ da
> A&R é que está. Mantido como registro do caso patológico.

Duas tentativas, com 1 h de intervalo, as duas com a mesma resposta:

```
cStat 656 | Rejeicao: Consumo Indevido (Deve ser utilizado o ultNSU nas
solicitacoes subsequentes. Tente apos 1 hora)
ultNSU retornado: 000000000103111 | maxNSU: 000000000000000
```

- 22:24 com `ultNSU=0` (partida do zero é punida, é o comportamento documentado).
- 23:30 com `ultNSU=103111` — o cursor que a própria SEFAZ devolveu na 1ª rejeição,
  que é o padrão de "solicitação subsequente". **Mesma rejeição**, e o `ultNSU` devolvido
  não mudou. Como na 1ª tentativa mandei `0` e recebi `103111`, o número é dado real da
  SEFAZ, não eco do que enviei: o fluxo DFe deste CNPJ já está em 103111.
- **Não sabemos ainda** se `distNSU` devolve `procNFe` ou `resNFe`: nenhuma das duas
  chamadas chegou a retornar documento.
- **Hipótese principal, não provada:** outro sistema (fsist ou o que a empresa usa)
  já consome esse fluxo e avançou o cursor até 103111. Se a penalidade/quota de consumo
  é por CNPJ, estamos disputando a mesma janela com um consumidor que não controlamos —
  o que inviabilizaria `distNSU` aqui sem antes descobrir e coordenar com esse consumidor.
- **Próximo passo sugerido (não é mais sondagem cega):** descobrir quem consome o fluxo
  da A&R antes de gastar outra hora. Sondar de novo só depois disso.

### P5 — Transferências: 30 notas com CFOP 5152 na saída escrituradas como 1409 na entrada
- Das 148 transferências conferidas, 118 batem e **30 divergem, todas só no CFOP**.
  Valor idêntico nos dois lados em **30/30**; nenhuma nota ausente.
- Padrão: 28× saída `5152 / 5409` → entrada `1409`; 2× saída `5152` → entrada `1409`.
- Concentração: 26 das 30 saem da **FILIAL 002** (25 para a FILIAL 003).

**Hipótese descartada (2026-08-25).** A primeira leitura foi "o ERP consolida os CFOPs no
lado da entrada". Os dados contradizem:

| Medição na ENTRADA (2.296 notas) | |
|---|---|
| Notas com mais de um CFOP na mesma célula | 290 (12,6%) — `1102/1403` aparece 267× |
| Notas com CFOP 1409 | 133 |
| …com 1409 **sozinho** | 133 |
| …com 1409 acompanhado de outro CFOP | **0** |
| Notas com 1152 em qualquer posição | 6 |

O relatório de entrada exibe dois CFOPs quando eles existem (267 vezes). `1409` nunca vem
acompanhado. Logo não é artefato de exibição — a entrada está registrada só como 1409.

- **Leitura provisória:** a filial destinatária escritura a nota inteira como ST (1409),
  inclusive a parcela que a origem emitiu como 5152 (fora do ST). Confirmação é do contador.
- **Decidido (2026-08-25, Josué):** conferência validada — as 30 são divergência real de
  escrituração, não falso positivo. `compararTransferencias` (`assets/js/transf-check.js`)
  **fica como está**: igualdade de conjunto de CFOPs é a regra correta. O achado é fiscal,
  não de software — tratar na escrituração da filial destinatária.
- Planilha de conferência com as 30 notas (chave de acesso completa) gerada em 2026-08-25.

### P6 — Baixar NFCe: planilha de 35 mil chaves esbarra em token e memória
- O travamento do pool foi corrigido (2026-09-10). Estes dois **ainda não**, e só aparecem
  agora que a corrida consegue ir longe.
- **Token JWT expira no meio.** 34.922 chaves = ~70 mil requisições (2 por chave). A 10
  simultâneas isso passa de 1h. Hoje o 401 drena o `pending` inteiro contando erro e gera
  um ZIP **parcial** — parece "quebrado" de novo. Existe a branch não mergeada
  `claude/pensive-leavitt-2e90a8` (auto-token NFCe); ler "Armadilha do merge" no handoff antes
  de tocar nela.
- **Memória do browser.** `comp.zip.file()` acumula os 35 mil XMLs em RAM antes do
  `generateAsync`. Estimativa (não medida): ~4-6 KB por XML = 150-200 MB de string, mais o
  blob final sem compressão. Se estourar, a aba morre. Saída seria fatiar em ZIPs por lote.
- **Worker sem timeout também.** `worker/lib/nfce.js` usa o `fetch` do Node, que igualmente
  não tem timeout padrão. Não corrigido porque o worker não roda na máquina da empresa (P1),
  mas o defeito é o mesmo do browser.
- **Sem throttle.** 70 mil chamadas a 10 simultâneas contra a SEFAZ, sem espaçamento. O
  `fetchWithRetry` retenta HTTP 3× (500/1000/2000ms) e desiste — sob 429 sustentado vira
  massa de erro contabilizado.
- **Antes da corrida cheia:** testar com uma fatia (~2.000 chaves) para isolar o conserto do
  pool destes três.

### P7 — A API da SEFAZ-CE não suporta CORS: NFCe pelo navegador é impossível
**Medido em 2026-09-10** contra `cfe.sefaz.ce.gov.br:8443`:

| Sonda | Resultado |
|---|---|
| `OPTIONS` simples | HTTP 200 em 0,08s |
| `OPTIONS` com `Access-Control-Request-Headers` | **pendura — HTTP 000, >50s** |
| `GET` com `Origin:` | 401 em 0,076s, **sem `Access-Control-Allow-Origin`** |

Dois bloqueios independentes, cada um fatal sozinho. Como `x-authentication-token` não é
simple header, o browser **sempre** manda preflight — e ele nunca volta. Toda requisição
morre pendurada antes de sair. Confirmado no console do Josué: `0/21831` com os 10 slots
ocupados desde o primeiro segundo.

- **Não é bug do código.** O fallback do browser em `createBaixarNfcePage` não tem conserto
  possível no cliente. Já estava dito no topo de `worker/lib/nfce.js`: "no lado Node NÃO há CORS".
- **Isso promove a P1 a bloqueador.** Sem worker, não há download de NFCe — em nenhuma máquina.
- **Paliativo aplicado:** curto-circuito que aborta e explica na tela em vez de fingir que
  trabalha. Não faz baixar; só para de mentir.
- **A decidir:** proxy server-side (Vercel Function) contra consertar a P1 do worker. Ver
  trade-offs discutidos na sessão de 2026-09-10.

### P3 — Rebundle do worker (`download/softtech-worker.zip`) desatualizado
- `scripts/bundle-worker.js` passou a incluir `lib/access.js` (token/allowlist) e
  `lib/nfe.js`. O zip publicado em `download/` ainda é o antigo: quem baixar hoje pega um
  worker que quebra no `require('./lib/access')`.
- **Ação:** rodar `node scripts/bundle-worker.js` e republicar. Ver também P1b.

### P8 — NFCe na máquina da EMPRESA: 0% → 100% instantâneo, tudo em erro — corrigido, **falta confirmar**
Sintoma: o worker sobe, o download começa e termina no mesmo instante com **todas** as notas
em erro. Mesma build funciona na máquina pessoal. É a continuação direta de P1: lá o
`require('exceljs')` impedia o worker de subir; aqui ele sobe e o NFCe falha sozinho.

**Causa raiz — e a leitura óbvia estava errada.** A hipótese natural era `fetch` ausente
(global só a partir do Node 18). Ela não explica o *instantâneo*: em `lib/nfce.js` o `fetch`
ficava **dentro** do `try` de `fetchWithRetry`, então o `ReferenceError` caía no ramo de
retry — 500 + 1000 + 2000 ms por chave. Com 3339 chaves e concorrência 10 isso daria
**≈19 minutos** de barra andando, não segundos.

O que dá salto instantâneo é a linha logo acima: `new AbortController()` estava **fora** do
`try`. Global ausente ali rejeita a função antes de qualquer retry, backoff ou pacote na
rede. `AbortController` só existe a partir do **Node 15** — ou seja, o sintoma aponta para
Node **< 15**, não para a faixa 15–17.

Duas evidências independentes apontam para o mesmo lugar:
- Naquela máquina o Node recusou `--openssl-legacy-provider` em `NODE_OPTIONS` (registrado
  em P1). Essa flag só existe a partir do Node 17.
- O NFCe era **o único** fluxo do worker sobre `fetch`. NFe, distNSU e DIRBI já usavam
  `https.request` (`lib/nfe.js`) e nunca apresentaram esse sintoma. O worker tinha dois
  padrões de rede e só o moderno quebrava.

**Consertado** (sem adicionar dependência — dependência instalável foi o que quebrou o
worker na empresa em primeiro lugar):
- `worker/lib/http.js` **novo**: cliente sobre `https.request` nativo, com timeout por
  `req.setTimeout` (o que o `AbortController` fazia), erro carregando `code`/`cause`/`host`,
  e `json()` que mostra o início do corpo quando a resposta não é JSON.
- `worker/lib/nfce.js`: `fetch` + `AbortController` fora. Redirect passa a ser seguido
  **só na mesma origem** — os headers levam o JWT, e repeti-los num host escolhido pelo
  servidor seria entregar o token a terceiro.
- `worker/lib/ambiente.js` **novo**: no boot o worker **afere** o próprio interpretador
  (versão, arquitetura, binário, globais em falta) e imprime. O mesmo diagnóstico sai em
  `GET /health`, que é a única rota sem pareamento — dá para responder "que Node é esse?"
  à distância. Sem execPath no JSON; caminho de disco fica só no console local.
- `worker/test/nfce-http.test.mjs` **novo**, 17 asserções: job completo contra mock HTTP
  local (ZIP relido, headers de auth conferidos, 404 com motivo legível) mais guarda de
  regressão que lê o fonte e recusa a volta de `fetch(`/`AbortController` em `nfce.js`.

**Piso de portabilidade declarado: Node 12.** `package.json` ainda diz `engines: >=18`;
é declaração, não é verificado por nada.

**Falta confirmar na máquina da empresa.** O que fecha isto é uma linha, não uma hipótese:
`node --version` lá, ou o motivo literal de uma nota no card da empresa
(`/nfce/detail/{job}/{cnpj}`). Se o motivo NÃO mencionar `fetch`/`AbortController`, a causa
é outra — 401/403 da SEFAZ (`processChave` marca `comp.aborted` e **drena a fila inteira**
contando erro, o que também dá salto instantâneo) ou proxy corporativo interceptando TLS
para `cfe.sefaz.ce.gov.br:8443`.

### P9 — Token automático do MFe: faltam as rotas dos passos 3 e 4
`worker/lib/token-mfe.js` faz login e anda pelo Ambiente Seguro, mas não chega ao JWT.
Três execuções de `--descobrir` não fixaram as rotas. A trilha de 2026-09-10 trouxe duas
pistas que estavam sendo ignoradas:

1. **Referer.** Todo `cweb1010java.asp?sis=…&sse=…` devolveu
   `302 → cwebErro.asp?de=…Página de origem desconhecida00.` Esse texto é a tradução literal
   de um teste de `HTTP_REFERER` — anti-deep-link padrão em ASP clássico. O `login()` já
   mandava Referer; o andador não mandava em lugar nenhum, então **todo** acesso a sistema
   era recusado antes de executar. Corrigido: a fila carrega a página de origem, e `login()`
   devolve `paginaFinal` para o primeiro salto não precisar chutar.
2. **Links em JavaScript.** As 18 páginas `cweb2003.asp?sm=NNN` visitadas tinham **bytes
   diferentes** (16873, 19922, 17647, …) e devolveram a **mesma** lista de 6 candidatos.
   Conteúdo que muda com candidatos que não mudam = o extrator só lia `href=`/`action=` e
   colhia a navegação estática. Corrigido: `extrairAlvos` também lê `window.open(…)`,
   `location.href=…`, `.replace(…)`/`.assign(…)` e qualquer `cweb1010java.asp?…` solto no
   texto. 15 asserções novas em `scripts/test-token-mfe.mjs` (32 no total).

Também novo: `--dump=<pasta>` grava o HTML de cada passo (latin1→utf8, senão o acento de
"Acessar MFe" quebra justo no rótulo que é a pista), e a falha passa a listar **todos** os
pares `sis/sse` vistos em vez de truncar em 6.

**O dump resolveu (2026-09-11).** As duas rotas que faltavam saíram do HTML salvo, não de
dedução:

**Passo 3 — "Acessar MFe" não é `cweb1010java.asp`.** É outro script
(`00-cweb2003.asp_sm_104.html:403`):
```html
<a href="cweb1010.asp?sse=104&sts=448" class="off">Acessar MFe</a>
```
`cweb1010.asp` **sem "java"**, parâmetros `sse` (menu) + `sts` (serviço) — não `sis`+`sse`.
Era exatamente por isso que três execuções do andador falharam: `RE_ACESSO_SISTEMA` só
casava `cweb1010java\.asp`, então o link do MFe **nunca entrou na fila**. Ele responde
`302 → EmpresasDoCPF/cweb2010.asp?SSE=104&Destino=MFe/RedirJavaMFe.asp`.

Nota de processo: na execução de 2026-09-11 o andador **chegou** nesse 302 (passo 25) e o
enfileirou — mas a fila é FIFO e o salto ficou atrás de 14 páginas de menu, com o orçamento
de 40 passos acabando antes. O achado estava a um hop de distância.

**Passo 4 — seleção de empresa é POST, submetido por JS.** A página lista 195 empresas do
CPF e cada linha chama:
```js
function submete(plst, pNum){ form1.lstEmpresa.value=plst; form1.num.value=pNum; form1.submit(); }
<a href="JavaScript:submete('<plst>','1');">62124510</a>   // texto do link = CGF
```
POST em `cweb2010.asp` com `num`, `lstEmpresa`, `hidControle`, `destino`, `SSE`. O `plst` é
string de campos concatenados em largura fixa. **Não decodificamos** — copiamos verbatim da
página, que é o que o browser faz; decodificar layout de ASP de 2003 seria inventar contrato,
e uma mudança de largura escolheria a empresa errada **em silêncio**.

**Implementado:** `obterTokenPorCaminho()` percorre 2→3→4→5 de forma determinística, com
Referer em todo passo e erro que diz em qual passo parou e o que veio. O andador
(`--descobrir`) continua, mas virou **ferramenta de diagnóstico, não plano B automático**:
produção não cai nele se o caminho quebrar — crawler cego contra portal de fisco, disparado
por job de usuário, bate em dezenas de páginas por tentativa.

`escolherEmpresa` **explode em ambiguidade** em vez de pegar a primeira: escolher errado
aqui baixa cupom de outro contribuinte, o que é pior que falhar. Sem `--cnpj`, recusa.

64 asserções em `scripts/test-token-mfe.mjs` (eram 16), com as strings reais do dump.

**Passo 5/6 resolvido (2026-09-11, mesma sessão).** Os passos 2→4 rodaram limpos com
sessão viva (empresa CGF 67114776 selecionada), e a execução parou em `RedirJavaMFe.asp`
com "nenhum JWT em 6 saltos". A hipótese registrada acima estava certa: **não havia salto**.
A página termina com

```html
<script>window.open('http://cfe.sefaz.ce.gov.br/mfe/portal#/login?key=…&auth=…
        &vinculo=3&cgf=…&cnpj=…&siglaSistema=portal-mfe');history.back();</script>
```

Os parâmetros vão no **fragmento** (`#`), que por definição nunca chega ao servidor — quem
lê é o SPA, no browser. Nenhum número de saltos acharia o token.

A troca saiu do próprio SPA (asset público, sem credencial):
`/mfe/assets/javascripts/authentication/services/AuthenticationRepository.js` declara
`route = 'mfe/authentication'` e `loginAmbienteSeguro(credentials)` faz
`restangular.all(route + "/login").post(credentials)`; o `AuthenticationController` passa o
`$location.search()` **inteiro**. A base vem do `<meta name="endpoint">` do index do portal:
`https://cfe.sefaz.ce.gov.br:8443/portalcfews` — o mesmo host:porta que `lib/nfce.js` já usa.

```
POST https://cfe.sefaz.ce.gov.br:8443/portalcfews/mfe/authentication/login
Content-Type: application/json
{ key, auth, vinculo, cgf, cnpj, siglaSistema }        → JWT
```

Implementado como passo 6. O objeto do fragmento é repassado **inteiro**, sem filtrar por
nome conhecido: se a SEFAZ acrescentar um campo, ele passa junto — filtrar quebraria em
silêncio. O JWT é procurado no header `x-authentication-token` **e** no corpo; escolher só
um devolveria "sem token" com o token na mão.

⚠️ **`key`/`auth` são credenciais de sessão vivas** — quem as tiver entra como o usuário.
Nunca são logadas nem entram em mensagem de erro (só os nomes dos campos). Dump que as
contenha é material sensível: `C:\temp\mfe3` tem um.

**FUNCIONA de ponta a ponta — medido 2026-09-11 14:07.** Login → menu → Acessar MFe →
seleção da empresa (CGF 67114776) → fragmento → troca. `TOKEN OBTIDO | CNPJ 19154453000109`,
validade ~24 h. Os seis passos rodaram sem intervenção, e o passo 6 (o único que ainda era
leitura de código do SPA, não medição) respondeu na primeira tentativa.

**INTEGRADO em 2026-09-11.** Itens 1–4 feitos:

1. `POST /mfe/token` no `server.js` — **não devolve o JWT**. Devolve `{cnpj, exp}`. A única
   razão para a UI ter o token seria mandá-lo de volta ao worker, que é quem o usa; expor ao
   browser só amplia onde ele pode vazar sem habilitar nada. Serve para testar credenciais e
   aquecer o cache. `require` tardio de `token-mfe` — módulo que falta não pode derrubar o
   worker na carga (P1).
2. `resolverTokens()` em `lib/nfce.js`, antes dos runners: empresa sem token ganha um, **um
   login para o lote inteiro**, `taxid = sub do token` (o CNPJ da empresa daria 409). Falha
   morre UMA vez com o recado literal do portal em vez de 3339 vezes com "token ausente".
   Empresa que traz o próprio token nunca passa por ali — é o fallback.
3. Tela: com o worker no ar o botão libera só com chaves, o relatório sem token deixa de ser
   descartado em silêncio, e a dica muda para "o token é obtido automaticamente".
   `?v=` bumpado para `20260911a`.
4. `token-mfe.js` + `ca-icp-brasil.pem` no bundle (feito antes, commit `813a9fd`).

30 asserções em `worker/test/nfce-http.test.mjs` (eram 19), com hook `_obterToken` no
padrão do `poster` do `distnsu`: cobrem um-login-para-o-lote, `taxid` do token, empresa com
token próprio não logando, e a falha carregando o motivo literal.

**RODADO DE PONTA A PONTA NA TELA em 2026-09-11 16:4x** — worker local, planilha `.txt`
com 1 chave real, **sem colar token**:

```
E L DE OLIVEIRA JUNIOR ME: 1 | 1  100%   0 erros
ZIP: "NFCe 08-2026_E L DE OLIVEIRA JUNIOR ME.zip"
```

O nome da empresa saiu do XML baixado, não da planilha. Botão liberou sozinho com o worker
no ar.

**Repetido em escala real, mesma sessão** — planilha `.xlsx` de produção
(`NFC-E_A DE ALMEIDA MATRIZ.xlsx`, 3.339 chaves), de novo **sem colar token**:

```
A DE ALMEIDA COSTA: 3339 | 3339   100%   0 erros     (406 s, ~8 chaves/s)
ZIP 13,7 MB · 3.339 entradas · 3.339 nomes únicos (sem duplicata)
1º XML: chave interna == nome do arquivo
```

Mesmo volume da execução histórica de 2026-09-10 (3339/3339), que precisou de token colado
à mão. Agora o worker obtém sozinho, **um login para o lote**. P9 fechada.

**O teste de tela achou três defeitos que a suíte não achava** — todos corrigidos em
`ffa39ed`, e todos de classes que já tinham mordido antes:

1. **TDZ engolida por `.catch`.** A detecção antecipada chamava `detectWorker()` ~500 linhas
   antes de `const WORKER_BASE` existir. ReferenceError, capturado pelo meu próprio catch: a
   tela mostrava "Worker detectado" **e** o botão travado. Duas detecções independentes
   divergindo — agora é uma só, a mesma que pinta o badge.
2. **`resolverTokens` chamava `obterToken()` sem CNPJ.** A guarda do passo 4 (não escolher
   empresa sozinho, entre 195) estava certa; faltava o chamador obedecer. Usa o CNPJ da
   primeira empresa sem token do lote.
3. **Sessão pendurada em caminho de erro.** `encerrar` só rodava no sucesso, então cada
   falha trancava a tentativa seguinte com "O usuário já está logado no sistema" — um
   defeito virando dois. Agora é `finally`, e `encerrar` é `true` por padrão.

**Medido em 2026-09-11** (`scripts/test-token-multi-cnpj.mjs`, dois CNPJs reais, chave real,
token vivo). Três achados, dois deles não previstos:

| sonda | status | leitura |
|---|---|---|
| token A + taxid A | **200** cupom | controle — e o token **sobreviveu ao logout** |
| token A + taxid B | **409** | `Usuário identificado não confere com o informado` |
| token B + taxid B | **200** cupom | controle positivo |

1. **O JWT sobrevive ao encerramento da sessão do portal.** As sondas rodaram *depois* do
   `encerrar: true`. Ou seja: o worker pode (e deve) deslogar assim que pega o token —
   obrigatório, porque o Ambiente Seguro é sessão única e sem logout o próprio usuário fica
   trancado fora do portal.
2. **`x-authentication-taxid` tem que ser o `sub` do token.** Divergir dá 409, não 401.
   `lib/nfce.js` classificava 409 no ramo genérico e **retentava 3× por chave** — 3,5 s cada
   para reproduzir o mesmo erro e terminar com "HTTP 409", que não diz nada. Corrigido:
   `kind 'auth'`, sem retry, drena a empresa com o motivo literal.
3. **A chave pedida NÃO é conferida contra o taxid.** A primeira sonda usou uma chave da
   empresa **B** com token e taxid de **A**, e voltou 200 com cupom completo. Se confirmar,
   **um login serve o lote inteiro** — basta mandar sempre o taxid do próprio token. Isso
   derruba o medo dos 195 logins.

   **CONFIRMADO na segunda execução (2026-09-11 15:12):** `chaveNfe devolvida CONFERE com
   a pedida`. Não foi outro documento — foi exatamente o cupom da empresa B, obtido com
   token e taxid de A.

**Conclusão para o desenho: UM LOGIN SERVE O LOTE INTEIRO.** Basta mandar sempre
`x-authentication-taxid` = CNPJ do próprio token. 195 empresas = 1 login, não 195. O medo
que motivou esta medição não se realizou.

⚠️ **Isso depende de a SEFAZ não checar o vínculo chave↔taxid.** É comportamento do lado
deles, não contrato: pode ser fechado sem aviso, e aí volta a ser um token por empresa. O
desenho tem que manter o caminho "token por empresa" como fallback — que é, aliás, o que
`lib/nfce.js` já suporta hoje (cada empresa traz o seu token; a UI é que replica um só).

Nota de leitura que quase passou: o **409 sozinho não decide nada**. Ele diz apenas que o
*header* `taxid` é amarrado ao token. A pergunta que decide o desenho é sobre a *chave*, e
quem responde é a sonda de controle — a primeira versão do veredito olhou só o 409 e
concluiu "195 logins", o oposto do que os dados diziam. Corrigido.

```
node <worktree>/worker/lib/token-mfe.js --cnpj=<14 dígitos> --dump=C:\temp\mfe2
```

### P10 — Redesign: o que ficou de fora da fatia do esqueleto

O esqueleto (topbar, sidebar, faixa de KPI, cartao, sub-aba, campo de formulario,
dropzone) foi ao ar em 2026-09-16. Sobrou, em ordem de valor:

- ~~**Seletor de empresa na topbar.**~~ **Feito em 2026-09-16.** Le e escreve
  `empresaAtiva_<usuario>`. Consumidores: faixa de KPI, Pendencias (nascem carimbadas),
  Baixar NFCe, Baixar NFe, ICMS ST e Apuracao.
  **Regra que vale nas telas de processamento:** o CNPJ vem do ARQUIVO (chave de 44
  digitos ou XML), e o arquivo e a fonte da verdade. O foco CONFERE e avisa; descarte
  so acontece se o usuario clicar ("Manter so X" no download) ou marcar a opcao
  ("Processar so os XMLs de X" no ICMS ST, que nasce DESMARCADA). Descartar nota em
  silencio geraria planilha incompleta sem ninguem saber por que.
  Checagem da regra: `node scripts/check-foco-empresa.mjs`.
- **A aba Apuracao ainda nao apura.** Virou o ponto de partida (empresa em foco +
  atalhos para ICMS ST, DIRBI, SPED e PIS/COFINS), no lugar do cartao vazio que era
  antes. O CSS `.apuration-table` / `.apuration-modal` continua sem dono: existe uma
  planilha de apuracao desenhada e nunca construida. Construir ou apagar.
- **Telas que ainda ignoram o foco:** Correcao Fortes, NFe x NFCe, SPED, DIRBI e
  Checagem de Transferencias. Nelas o CNPJ tambem vem do arquivo, entao o mesmo
  `conferirFocoEmpresa` serve -- e so plugar onde cada uma agrupa por empresa.
- **Tela de login reconstruida em 2026-09-16.** Ficou de fora da imagem de referencia,
  de proposito: "Continue with Google" (o projeto so tem auth por e-mail/senha no
  Supabase) e "Sign up" (usuario aqui e criado pelo administrador). "Esqueceu a senha?"
  virou texto em vez de link porque nao existe fluxo de recuperacao.
- **Largura das telas de upload.** ICMS ST, SPED, DIRBI, Fortes e NFe x NFCe ainda
  centralizam o conteudo em ~800px com estilo inline na propria pagina. Em monitor
  largo sobra area morta dos dois lados. Resolver exige mexer no container de cada uma
  das cinco, nao so no CSS comum.
- **Animacao de saida nos modais.** Eles entram com `fadeInUp` e somem com `.remove()`
  seco. Quem fecha um modal grande ve a tela piscar.
- **Barra de progresso anima `width`.** `main.css` (`.progress-container .progress-bar`)
  e o progresso do SPED. Sao barras de 8-20px de altura, entao o custo de layout e
  desprezivel; trocar por `transform: scaleX()` exigiria um elemento interno para o
  raio nao distorcer. Registrado como excecao consciente, nao como esquecimento.
- **Rotulo flutuante do login anima `top`.** Mesmo caso, na tela de login, que tem
  desenho proprio e nao entrou nesta fatia.

Verificado e OK (nao precisa mexer): contraste WCAG AA nos dois temas (12 pares
medidos, 12 passam), foco visivel em 21/21 controles focaveis do painel,
`prefers-reduced-motion` degradando de fato (0.4s vira 0.00001s), 12 abas x 2 temas
sem erro de console e sem rolagem horizontal em 375/768/1024/1600.

## Resolvido

### ✓ Baixar NFCe pelo worker — FUNCIONANDO de ponta a ponta (2026-09-10)
**3.339 de 3.339 baixadas, ZIP gerado.** Confirmado pelo Josué na máquina pessoal.

Foram **cinco** defeitos em série, cada um escondendo o seguinte:
1. Slot vazado no pool do browser (`.then` sem `.catch`) — `8d7eb79`
2. Sem timeout de requisição no browser — `37f27e7`
3. **CORS**: a API da SEFAZ não responde preflight, o caminho do browser é impossível — `8b77477` (P7)
4. Worker não subia: `require('exceljs')` no topo + flag via `NODE_OPTIONS` — `105d782`, `565f2d1` (P1)
5. `idNfe` com parser rígido, e **sem timeout no worker** — `be1a692`, `7884b1d`

O 5 foi o último: 7 requisições penduradas travavam `maybeFinalizeCompany` para sempre
(`downloaded + errors < total`). Estava **registrado em P6 e não corrigido** — lição: quando o
conserto é do tamanho do registro, registrar é a escolha errada.

**Caminho válido hoje: worker Node.** O fallback do browser continua morto por CORS (P7).

### ✓ P1 — Worker não subia fora da máquina pessoal: era o `require` do exceljs (2026-09-10)
**Causa raiz.** `worker/server.js` faz `require('./lib/dirbi')` na carga, e `lib/dirbi.js`
fazia `require('exceljs')` no topo. O bundle **nunca incluiu** `node_modules` — por desenho,
o launcher rodava `npm install` na 1ª vez. Em máquina corporativa esse install falha
(proxy/registry bloqueado), e aí o `server.js` **morria no require antes de escutar a porta**.
Browser recebia `ERR_CONNECTION_REFUSED` e nenhuma pista. Nada a ver com firewall na 47620 nem
com SmartScreen — as duas hipóteses que estavam registradas aqui desde junho.

A ironia: o download de NFCe **não usa exceljs**. Usa `fetch` nativo e o `lib/zip.js`
artesanal sobre `zlib`. A única dependência externa do worker, usada só pela DIRBI,
bloqueava justamente a feature que o Josué precisava.

**Consertado:**
- `lib/dirbi.js`: `exceljs` carregado sob demanda via `getExcelJS()`, com mensagem clara se
  faltar. O worker sobe sem `node_modules`; só a DIRBI exige o pacote.
- `bundle-worker.js`: `lib/distnsu.js` e `lib/cursor.js` entraram no FILES (o `server.js` os
  requer e eles faltavam — era a P3, mesma classe de falha).
- Launchers: `npm install` deixou de ser bloqueante. O `start.sh` tinha `set -e` e **morria**
  quando o install falhava.
- `LEIA-ME.txt`: documenta o **pareamento por token**, que não estava em lugar nenhum —
  worker no ar e não pareado parece "não funcionou".

**Segunda causa, achada no teste do Josué na empresa (mesmo dia).** Passado o `require`,
o worker morria no auto-restart: `server.js` se re-executava com `--openssl-legacy-provider`
**via `NODE_OPTIONS`**, e a allowlist do `NODE_OPTIONS` não aceita essa flag em toda versão
(`Program Files (x86)
odejs` — Node 32-bit mais antigo). O filho morria no arranque e o pai
propagava o status com `process.exit`. A flag serve ao **certificado A1 do NFe**; o NFCe usa
token JWT e nem toca nela. Consertado: flag na **linha de comando** em vez de `NODE_OPTIONS`,
e se o runtime recusar, o worker **segue sem ela** avisando que só o NFe com A1 vai falhar.
Atalho para destravar sem atualizar: `SOFTTECH_LEGACY_RETRY=1 node server.js` (validado).

**Provado** com o zip novo extraído em pasta limpa, sem `node_modules`: `/health` respondeu
HTTP 200. Contrafactual na mesma pasta: `require('./lib/dirbi')` com o require eager falha
com MODULE_NOT_FOUND. **Falta confirmar na máquina da empresa.**

### ✓ Transferências — notas canceladas e ausência de CST (2026-08-25)
- **Notas canceladas.** As 43 linhas de saída com chave válida mas CFOP e valor em branco
  são **notas canceladas** (confirmado pelo Josué). Medição: sem CFOP = 43, sem valor = 43,
  sem os dois = 43, e **zero** linhas com um e não o outro — o critério conjuntivo identifica
  exatamente esse conjunto. `lerPlanilha` passou a excluí-las de `rows` e a contá-las à
  parte, o que corrigiu a contagem de notas lidas na saída (539 → 496 + 43 canceladas).
  Aparecem na linha de resumo do modal, não no banner de avisos. Uma linha sem CFOP **mas
  com valor** continua gerando aviso — caso desconhecido não vira rótulo errado.
- **CST.** Esta conferência não tem informação de CST para comparar (confirmado pelo Josué).
  O suporte condicional no código fica — se um relatório futuro trouxer a coluna, ela é
  comparada. Mas a UI parou de anunciar a ausência: sem aviso, sem sufixo na contagem, e a
  coluna CST some das tabelas e dos exports quando `temCst` é falso. Estado permanente e
  esperado não ocupa o banner — senão o aviso que pede ação se perde no ruído.
- Resultado com os 10 relatórios reais: 148 transferências, 118 sem divergência, 30
  divergentes (ver P5, fechado), 0 ausentes, **0 avisos**.

### ✓ Zip NFCe — separação por mês + nome com mês 2 dígitos (2026-06-29)
- Agrupamento passou de só-CNPJ para `CNPJ + mês`: meses diferentes da mesma empresa geram ZIPs separados.
- Nome do ZIP: `NFCe Mai-2026_...` → `NFCe 05-2026_...` (mês numérico 2 dígitos).
- Arquivos: `assets/js/app.js` (`buildCompanies`, `monthYearFromKey`, `createCompany`, `applyStatus`, `downloadCompanyZip`, `runBrowser`), `worker/lib/nfce.js` (`startJob`, `companyStatus`, `getCompanyDetail`, `getCompanyZip`).
