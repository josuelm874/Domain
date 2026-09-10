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

## Resolvido

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
