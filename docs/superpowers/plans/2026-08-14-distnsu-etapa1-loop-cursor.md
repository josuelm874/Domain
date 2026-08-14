# distNSU Etapa 1 — loop com cursor persistido

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa.
> Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** substituir o `consChNFe` (1 consulta por nota, teto de 20/hora) pelo `distNSU`
(50 documentos por consulta) num loop que persiste o cursor `ultNSU` por CNPJ e para frio
quando a SEFAZ recusa.

**Arquitetura:** um módulo novo no worker (`worker/lib/distnsu.js`) que reusa o transporte
mTLS e o parser já validados do `worker/lib/nfe.js` — o `nfe.js` **não é modificado** além
de dois exports novos. O cursor mora em **arquivo no disco do worker**, não no browser: só o
worker sabe que uma chamada foi gasta, e o bloqueio de 1 hora precisa sobreviver a refresh
da página e a restart do processo. O loop **falha fechado** — grava o bloqueio de 1 h *antes*
da chamada e só o afrouxa depois de uma resposta boa.

**Stack:** Node (worker, zero dependência nova), `node:test`, SOAP 1.2 sobre mTLS.

## Escopo — o que este plano NÃO faz

- **Sem UI.** Nenhuma linha de `assets/js/app.js`. A tela é plano separado; este entrega um
  worker completo, com rotas HTTP e um harness de linha de comando que exercita tudo.
  Motivo: são subsistemas independentes, e o worker é testável sozinho.
- **Sem manifestação 210210** (Etapa 2). O loop **separa** os `resNFe` numa lista própria
  para a Etapa 2 consumir, e para por aí.
- **Sem tocar no fluxo `consChNFe` existente.** As duas rotas convivem; a migração da tela é
  decisão da Etapa 3.

## Restrições globais

- **Node sem dependência nova.** O worker é empacotado com `pkg`; qualquer `npm i` novo tem
  que ser justificado. Este plano não precisa de nenhum.
- **`--openssl-legacy-provider` é obrigatório** para carregar `.pfx` de AC brasileira
  (ver `worker/lib/nfe.js:102`). O `server.js` já faz re-exec com a flag; scripts precisam
  passá-la à mão.
- **Senha de certificado nunca em argv, nunca em log, nunca em disco.** Só `$env:PFX_SENHA`
  ou corpo de POST, e descartada da memória ao fim do job (padrão de `nfe.js:456`).
- **Nada de conteúdo fiscal em log.** Só `cStat`, NSU, contagem e nome de schema — a regra
  que o `scripts/probe-distnsu.cjs` já segue.
- **NT 2014.002:** depois de `cStat 656` ou `137`, uma nova chamada **dentro da janela zera
  o relógio de 1 hora**. Esse é o invariante que o plano inteiro existe para proteger.
- **PowerShell 5.1:** `&&` não funciona nos comandos; use `;`.
- Testes rodam com `node --test`. Nenhum teste deste plano toca a SEFAZ.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `worker/lib/distnsu.js` **(criar)** | Envelope `distNSU`, uma rodada, o loop, o job lifecycle. |
| `worker/lib/cursor.js` **(criar)** | Ler/gravar o cursor por CNPJ em disco. Só isso. |
| `worker/lib/nfe.js` **(modificar, 1 linha)** | Exportar `sanitizeFileName` e `cleanDigits`. |
| `worker/server.js` **(modificar)** | 4 rotas novas, espelhando o bloco NFe. |
| `scripts/probe-distnsu.cjs` **(modificar)** | Importar `buildDistNsuSoap` da lib em vez de ter a própria cópia. |
| `scripts/distnsu-run.cjs` **(criar)** | Harness CLI: roda o loop de verdade, com portão offline. |
| `worker/test/distnsu.test.mjs` **(criar)** | Envelope, parse, uma rodada. |
| `worker/test/distnsu-loop.test.mjs` **(criar)** | O loop, a trava de 1 h, o cursor. |

---

### Task 1: `buildDistNsuSoap` sai do script e vira lib

Hoje o envelope vive dentro de `scripts/probe-distnsu.cjs:47`. O loop precisa do mesmo
envelope; copiar seria a segunda cópia da regra do XSD que já custou uma rejeição 215.

**Arquivos:**
- Criar: `worker/lib/distnsu.js`
- Criar: `worker/test/distnsu.test.mjs`
- Modificar: `scripts/probe-distnsu.cjs:47-60` (apagar a função local, importar da lib)

**Interfaces:**
- Consome: `DISTDFE_VERSAO` de `worker/lib/nfe.js` (já exportado).
- Produz: `buildDistNsuSoap({ tpAmb, cufAutor, cnpj, ultNSU }) -> string`

- [ ] **Passo 1: escrever o teste que falha**

```javascript
// worker/test/distnsu.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { buildDistNsuSoap } from '../lib/distnsu.js';

test('buildDistNsuSoap: ultNSU com 15 dígitos e ordem do XSD', () => {
    const soap = buildDistNsuSoap({ tpAmb: '1', cufAutor: '23', cnpj: '12345678000199', ultNSU: '103111' });
    assert.match(soap, /<ultNSU>000000000103111<\/ultNSU>/);
    assert.match(soap, /<distNSU><ultNSU>/);
    assert.ok(!/consChNFe/.test(soap), 'não pode sobrar consChNFe do irmão');
    assert.match(soap, /versao="1\.\d\d"/);
    const ordem = ['<tpAmb>', '<cUFAutor>', '<CNPJ>', '<distNSU>'].map((t) => soap.indexOf(t));
    assert.deepStrictEqual(ordem, [...ordem].sort((a, b) => a - b), 'ordem dos campos fora do XSD');
});

test('buildDistNsuSoap: ultNSU ausente vira zero', () => {
    const soap = buildDistNsuSoap({ tpAmb: '1', cufAutor: '23', cnpj: '12345678000199' });
    assert.match(soap, /<ultNSU>000000000000000<\/ultNSU>/);
});
```

- [ ] **Passo 2: rodar para ver falhar**

```bash
node --test worker/test/distnsu.test.mjs
```

Esperado: FAIL — `Cannot find module '../lib/distnsu.js'`.

- [ ] **Passo 3: criar a lib com a função**

```javascript
// worker/lib/distnsu.js
/**
 * Fluxo distNSU no worker — varre o acervo do CNPJ pelo webservice
 * `NFeDistribuicaoDFe` / `distNSU`, 50 documentos por consulta.
 *
 * Por que existe, ao lado de `nfe.js`: o `consChNFe` gasta 1 consulta por nota e a SEFAZ
 * dá 20/hora por CNPJ (cStat 656) — 200 notas viram 10 horas. Medido em 2026-08-14: o
 * acervo retido inteiro de uma empresa (385 documentos) sai em 8 chamadas.
 *
 * O transporte (mTLS), o parser da resposta e o unzip do docZip são REUSADOS de `nfe.js`.
 * Aqui mora só o que é específico do distNSU: o envelope, o loop e o cursor.
 *
 * Invariante que este módulo existe para proteger (NT 2014.002): depois de 656 ou 137,
 * uma nova chamada DENTRO da janela zera o relógio de 1 hora. Por isso o loop grava o
 * bloqueio ANTES da chamada e só o afrouxa com resposta boa — falha fechado.
 */
'use strict';

const { DISTDFE_VERSAO } = require('./nfe.js');

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const WSDL_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';

// Irmão do buildDistDFeIntSoap de nfe.js:49. Mesma casca, outro miolo.
// A ordem dos filhos (tpAmb, cUFAutor, CNPJ, distNSU) é validada pelo XSD: fora de
// ordem a SEFAZ devolve 215 e a consulta já foi gasta.
function buildDistNsuSoap({ tpAmb, cufAutor, cnpj, ultNSU }) {
    const nsu = String(ultNSU == null ? 0 : ultNSU).replace(/\D/g, '').padStart(15, '0');
    const distDFeInt =
        `<distDFeInt xmlns="${NFE_NS}" versao="${DISTDFE_VERSAO}">` +
        `<tpAmb>${tpAmb}</tpAmb>` +
        `<cUFAutor>${cufAutor}</cUFAutor>` +
        `<CNPJ>${cnpj}</CNPJ>` +
        `<distNSU><ultNSU>${nsu}</ultNSU></distNSU>` +
        `</distDFeInt>`;
    return `<?xml version="1.0" encoding="utf-8"?>` +
        `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
        `<soap12:Body><nfeDistDFeInteresse xmlns="${WSDL_NS}">` +
        `<nfeDadosMsg>${distDFeInt}</nfeDadosMsg>` +
        `</nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
}

module.exports = { buildDistNsuSoap };
```

- [ ] **Passo 4: rodar para ver passar**

```bash
node --test worker/test/distnsu.test.mjs
```

Esperado: PASS, 2 testes.

- [ ] **Passo 5: o probe passa a importar a lib**

Em `scripts/probe-distnsu.cjs`, apagar a função `buildDistNsuSoap` (linhas 46-60) e trocar
o import da linha 31 por:

```javascript
const { postDistDFe, parseRetDistDFe, DISTDFE_URL_PROD } = require('../worker/lib/nfe.js');
const { buildDistNsuSoap } = require('../worker/lib/distnsu.js');
```

O `selftest()` do probe fica como está — ele agora testa a lib, que é o que interessa.

- [ ] **Passo 6: confirmar que o probe continua íntegro, sem tocar a SEFAZ**

```bash
node scripts/probe-distnsu.cjs --selftest
```

Esperado: `selftest OK — envelope distNSU bem formado, nenhuma chamada feita.`

- [ ] **Passo 7: commit**

```bash
git add worker/lib/distnsu.js worker/test/distnsu.test.mjs scripts/probe-distnsu.cjs
git commit -m "refactor(distnsu): envelope sai do script e vira lib do worker"
```

---

### Task 2: cursor por CNPJ em disco

O cursor precisa sobreviver a refresh do browser e a restart do worker. **Decisão:** mora em
arquivo no disco do worker, não no Supabase KV do browser — só o worker sabe que uma chamada
foi gasta, e é o bloqueio de 1 h que não pode se perder.

**Arquivos:**
- Criar: `worker/lib/cursor.js`
- Criar: `worker/test/distnsu-loop.test.mjs`

**Interfaces:**
- Produz:
  - `read(cnpj) -> { ultNSU: string, maxNSU: string, bloqueadoAte: number, ultimoCStat: string }`
    (registro zerado se o CNPJ nunca rodou)
  - `write(cnpj, patch) -> void` (merge sobre o registro atual, grava o arquivo inteiro)
  - `bloqueado(cnpj, agora) -> boolean`
  - `CURSOR_PATH` (string, para o teste apontar para tmpdir via env)

- [ ] **Passo 1: escrever o teste que falha**

```javascript
// worker/test/distnsu-loop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O arquivo do cursor precisa ser apontado ANTES do require da lib.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'distnsu-'));
process.env.DISTNSU_CURSOR_FILE = path.join(TMP, 'cursors.json');

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const cursor = require('../lib/cursor.js');

test('cursor: CNPJ novo devolve registro zerado', () => {
    const r = cursor.read('12345678000199');
    assert.strictEqual(r.ultNSU, '0');
    assert.strictEqual(r.bloqueadoAte, 0);
});

test('cursor: write persiste e read releitura do disco enxerga', () => {
    cursor.write('12345678000199', { ultNSU: '22844', maxNSU: '23179', ultimoCStat: '138' });
    const bruto = JSON.parse(fs.readFileSync(process.env.DISTNSU_CURSOR_FILE, 'utf8'));
    assert.strictEqual(bruto['12345678000199'].ultNSU, '22844');
    assert.strictEqual(cursor.read('12345678000199').maxNSU, '23179');
});

test('cursor: write faz merge, não substitui o registro', () => {
    cursor.write('12345678000199', { ultimoCStat: '656' });
    const r = cursor.read('12345678000199');
    assert.strictEqual(r.ultNSU, '22844', 'ultNSU tem que sobreviver ao patch');
    assert.strictEqual(r.ultimoCStat, '656');
});

test('cursor: bloqueado respeita bloqueadoAte', () => {
    cursor.write('99999999000199', { bloqueadoAte: 5_000 });
    assert.strictEqual(cursor.bloqueado('99999999000199', 4_999), true);
    assert.strictEqual(cursor.bloqueado('99999999000199', 5_001), false);
});

test('cursor: arquivo corrompido não derruba o worker', () => {
    fs.writeFileSync(process.env.DISTNSU_CURSOR_FILE, '{ isso não é json');
    const r = cursor.read('12345678000199');
    assert.strictEqual(r.ultNSU, '0', 'arquivo ilegível = começa do zero, não crash');
});
```

- [ ] **Passo 2: rodar para ver falhar**

```bash
node --test worker/test/distnsu-loop.test.mjs
```

Esperado: FAIL — `Cannot find module '../lib/cursor.js'`.

- [ ] **Passo 3: implementar**

```javascript
// worker/lib/cursor.js
/**
 * Cursor `ultNSU` por CNPJ, em arquivo no disco do worker.
 *
 * Por que disco do worker e não Supabase KV (que é o padrão dos outros cadastros): só o
 * worker sabe que uma chamada foi gasta. Se o browser fosse o dono, um refresh no meio do
 * job perderia o registro do bloqueio de 1 hora — e recomeçar dentro da janela zera o
 * relógio (NT 2014.002). Perder o `ultNSU` custa re-download idempotente; perder o
 * bloqueio custa a janela do CNPJ.
 *
 * ponytail: cursor é por máquina. Se o escritório rodar o worker em duas máquinas com o
 * mesmo certificado, os bloqueios não são compartilhados e dá para queimar a janela do
 * CNPJ. Se isso acontecer, subir o registro para o Supabase KV (chave `distnsu_cursors`)
 * mantendo esta interface.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Ao lado do .exe quando empacotado com pkg; worker-local em dev. Mesma lógica do
// TEMPLATE_PATH do dirbi.js, simplificada — aqui o arquivo é escrito, não só lido.
const CURSOR_PATH = process.env.DISTNSU_CURSOR_FILE ||
    path.join(path.dirname(process.execPath), 'distnsu-cursors.json');

const VAZIO = { ultNSU: '0', maxNSU: '0', bloqueadoAte: 0, ultimoCStat: '', atualizadoEm: 0 };

function readAll() {
    try {
        const txt = fs.readFileSync(CURSOR_PATH, 'utf8');
        const obj = JSON.parse(txt);
        return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) {
        // Arquivo ausente, ilegível ou corrompido: começa do zero. Nunca derruba o worker
        // — um cursor perdido custa re-download, um crash custa o job inteiro.
        return {};
    }
}

function read(cnpj) {
    const all = readAll();
    return { ...VAZIO, ...(all[String(cnpj)] || {}) };
}

function write(cnpj, patch) {
    const all = readAll();
    const key = String(cnpj);
    all[key] = { ...VAZIO, ...(all[key] || {}), ...patch, atualizadoEm: Date.now() };
    const tmp = CURSOR_PATH + '.tmp';
    // Grava em temporário e renomeia: se o processo morrer no meio da escrita, o arquivo
    // bom continua no lugar em vez de virar JSON pela metade.
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, CURSOR_PATH);
}

function bloqueado(cnpj, agora) {
    return read(cnpj).bloqueadoAte > (agora == null ? Date.now() : agora);
}

module.exports = { read, write, bloqueado, CURSOR_PATH };
```

- [ ] **Passo 4: rodar para ver passar**

```bash
node --test worker/test/distnsu-loop.test.mjs
```

Esperado: PASS, 5 testes.

- [ ] **Passo 5: commit**

```bash
git add worker/lib/cursor.js worker/test/distnsu-loop.test.mjs
git commit -m "feat(distnsu): cursor ultNSU por CNPJ persistido em disco"
```

---

### Task 3: uma rodada de distNSU, com classificação dos documentos

Uma chamada só, sem loop. É a unidade que o loop da Task 4 repete — e a que os testes podem
exercitar sem tocar a SEFAZ, pelo mesmo hook `poster` que o `nfe.js` já usa (`nfe.js:285`).

**Arquivos:**
- Modificar: `worker/lib/distnsu.js`
- Modificar: `worker/test/distnsu.test.mjs`

**Interfaces:**
- Consome: `postDistDFeVia`, `parseRetDistDFe`, `DISTDFE_URL_PROD` de `worker/lib/nfe.js`.
- Produz:
  `fetchDistNsuBatch({ cnpj, cufAutor, tpAmb, ultNSU, pfx, passphrase, poster }) -> Promise<{ cStat, xMotivo, ultNSU, maxNSU, completos, resumos, eventos, totalDocs }>`
  - `completos`: `[{ nsu, chave, xml }]` — `procNFe`, XML inteiro, serve direto
  - `resumos`: `[{ nsu, chave }]` — `resNFe`, precisa da Etapa 2 (manifestação)
  - `eventos`: `[{ nsu, schema }]` — `resEvento`/`procEvento`, contados e descartados aqui

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar ao fim de `worker/test/distnsu.test.mjs`:

```javascript
import zlib from 'node:zlib';
import { fetchDistNsuBatch } from '../lib/distnsu.js';

const CH = '23250312345678000199550010000000011000000017';

const gz = (s) => zlib.gzipSync(Buffer.from(s, 'utf8')).toString('base64');

function respostaFake({ cStat = '138', ultNSU = '000000000022844', maxNSU = '000000000023179', docs = [] }) {
    const corpo = docs.map((d) =>
        `<docZip NSU="${d.nsu}" schema="${d.schema}">${gz(d.xml)}</docZip>`).join('');
    return `<retDistDFeInt><cStat>${cStat}</cStat><xMotivo>ok</xMotivo>` +
        `<ultNSU>${ultNSU}</ultNSU><maxNSU>${maxNSU}</maxNSU>` +
        `<loteDistDFeInt>${corpo}</loteDistDFeInt></retDistDFeInt>`;
}

const XML_PROC = `<procNFe><NFe><infNFe Id="NFe${CH}"></infNFe></NFe></procNFe>`;
const XML_RES = `<resNFe><chNFe>${CH}</chNFe></resNFe>`;

test('fetchDistNsuBatch: separa procNFe, resNFe e evento', async () => {
    const poster = async () => respostaFake({ docs: [
        { nsu: '000000000022798', schema: 'procNFe_v4.00.xsd', xml: XML_PROC },
        { nsu: '000000000022799', schema: 'resNFe_v1.01.xsd', xml: XML_RES },
        { nsu: '000000000022800', schema: 'resEvento_v1.01.xsd', xml: '<resEvento/>' },
    ] });
    const r = await fetchDistNsuBatch({
        cnpj: '12345678000199', cufAutor: '23', tpAmb: '1', ultNSU: '0',
        pfx: Buffer.from('x'), passphrase: '', poster,
    });
    assert.strictEqual(r.cStat, '138');
    assert.strictEqual(r.totalDocs, 3);
    assert.strictEqual(r.completos.length, 1);
    assert.strictEqual(r.completos[0].chave, CH);
    assert.match(r.completos[0].xml, /procNFe/);
    assert.strictEqual(r.resumos.length, 1);
    assert.strictEqual(r.resumos[0].chave, CH);
    assert.strictEqual(r.eventos.length, 1);
    assert.strictEqual(r.ultNSU, '000000000022844');
    assert.strictEqual(r.maxNSU, '000000000023179');
});

test('fetchDistNsuBatch: 137 volta sem documento e não é erro', async () => {
    const poster = async () => respostaFake({ cStat: '137', docs: [] });
    const r = await fetchDistNsuBatch({
        cnpj: '12345678000199', cufAutor: '23', tpAmb: '1', ultNSU: '22844',
        pfx: Buffer.from('x'), passphrase: '', poster,
    });
    assert.strictEqual(r.cStat, '137');
    assert.strictEqual(r.totalDocs, 0);
});

test('fetchDistNsuBatch: manda o ultNSU recebido no envelope', async () => {
    let enviado = '';
    const poster = async ({ body }) => { enviado = body; return respostaFake({ docs: [] }); };
    await fetchDistNsuBatch({
        cnpj: '12345678000199', cufAutor: '23', tpAmb: '1', ultNSU: '22844',
        pfx: Buffer.from('x'), passphrase: '', poster,
    });
    assert.match(enviado, /<ultNSU>000000000022844<\/ultNSU>/);
});
```

- [ ] **Passo 2: rodar para ver falhar**

```bash
node --test worker/test/distnsu.test.mjs
```

Esperado: FAIL — `fetchDistNsuBatch is not a function`.

- [ ] **Passo 3: implementar**

Acrescentar a `worker/lib/distnsu.js` (antes do `module.exports`, que é atualizado no fim):

```javascript
const {
    postDistDFeVia, parseRetDistDFe, DISTDFE_URL_PROD,
} = require('./nfe.js');

const SOAP_HEADERS = { 'Content-Type': 'application/soap+xml; charset=utf-8' };

// A chave está no Id do infNFe (procNFe) ou no chNFe (resNFe). Sem ela o documento não
// vira arquivo com nome útil no ZIP.
function chaveDoXml(xml) {
    const m = String(xml).match(/Id="NFe(\d{44})"/) || String(xml).match(/<chNFe>(\d{44})<\/chNFe>/);
    return m ? m[1] : '';
}

const ehCompleto = (schema) => /procNFe/i.test(schema || '');
const ehResumo = (schema) => /resNFe/i.test(schema || '');

/**
 * UMA chamada distNSU. Não repete, não faz backoff, não decide nada sobre quota —
 * quem decide é o loop da Task 4, que é o dono do cursor.
 */
async function fetchDistNsuBatch({ cnpj, cufAutor, tpAmb, ultNSU, pfx, passphrase, poster }) {
    const soap = buildDistNsuSoap({ tpAmb, cufAutor, cnpj, ultNSU });
    const texto = await postDistDFeVia(poster, {
        endpoint: DISTDFE_URL_PROD, pfx, passphrase, soap,
    });
    const ret = parseRetDistDFe(texto);
    const completos = [];
    const resumos = [];
    const eventos = [];
    for (const d of ret.docs) {
        if (ehCompleto(d.schema)) completos.push({ nsu: d.nsu, chave: chaveDoXml(d.xml), xml: d.xml });
        else if (ehResumo(d.schema)) resumos.push({ nsu: d.nsu, chave: chaveDoXml(d.xml) });
        else eventos.push({ nsu: d.nsu, schema: d.schema });
    }
    return {
        cStat: ret.cStat, xMotivo: ret.xMotivo,
        ultNSU: firstTagLocal(texto, 'ultNSU'), maxNSU: firstTagLocal(texto, 'maxNSU'),
        completos, resumos, eventos, totalDocs: ret.docs.length,
    };
}

// Mesmo firstTag de nfe.js:69 — não exportado de lá, e são 3 linhas.
function firstTagLocal(xml, tag) {
    const m = String(xml).match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
    return m ? m[1].trim() : '';
}
```

E trocar o `module.exports` do arquivo por:

```javascript
module.exports = { buildDistNsuSoap, fetchDistNsuBatch };
```

> **Atenção ao `postDistDFeVia`:** a assinatura real é
> `postDistDFeVia(httpPostFn, { endpoint, pfx, passphrase, soap })` (`nfe.js:139`). Antes de
> escrever o código, abra `worker/lib/nfe.js:139-157` e confirme o formato exato do objeto
> que o `poster` recebe — o teste do Passo 1 depende de `body` ser o campo com o SOAP.
> Se o campo tiver outro nome, ajuste o teste, não a lib.

- [ ] **Passo 4: rodar para ver passar**

```bash
node --test worker/test/distnsu.test.mjs
```

Esperado: PASS, 5 testes.

- [ ] **Passo 5: commit**

```bash
git add worker/lib/distnsu.js worker/test/distnsu.test.mjs
git commit -m "feat(distnsu): uma rodada, com procNFe/resNFe/evento separados"
```

---

### Task 4: o loop, com trava de 1 hora que falha fechado

O coração do plano. Repete a rodada enquanto vier documento, gravando o cursor a cada volta.

**Regras, todas testáveis:**
1. **Antes de cada chamada**, grava `bloqueadoAte = agora + 1 h`. Se o processo morrer no
   meio, o próximo run assume que a chamada foi gasta. Errar para o lado seguro custa uma
   hora de espera; errar para o outro queima a janela do CNPJ.
2. Resposta `138` (documento localizado): grava o `ultNSU` devolvido e **afrouxa** o bloqueio
   para `agora + intervalMs`. Continua.
3. Resposta `137` (nada a partir daqui) ou `656` (consumo indevido): **para frio**, mantém a
   hora cheia, grava o `ultimoCStat`. Não tenta o próximo NSU.
4. Para também quando `ultNSU >= maxNSU` (acervo esgotado) ou quando o teto de chamadas do
   job acabou.
5. Se o CNPJ já estiver bloqueado quando o job começa, **nem faz a primeira chamada**.

**Arquivos:**
- Modificar: `worker/lib/distnsu.js`
- Modificar: `worker/test/distnsu-loop.test.mjs`

**Interfaces:**
- Consome: `fetchDistNsuBatch` (Task 3), `cursor.read/write/bloqueado` (Task 2).
- Produz:
  `runLoop({ cnpj, cufAutor, tpAmb, pfx, passphrase, poster, maxChamadas, intervalMs, agora }) -> Promise<{ chamadas, completos, resumos, eventos, cStatFinal, ultNSU, motivoParada }>`
  - `motivoParada` ∈ `'acervo-esgotado' | 'sem-documentos' | 'consumo-indevido' | 'teto-de-chamadas' | 'cnpj-bloqueado'`

- [ ] **Passo 1: escrever os testes que falham**

Acrescentar a `worker/test/distnsu-loop.test.mjs`:

```javascript
const { runLoop } = require('../lib/distnsu.js');
const zlib = require('node:zlib');

const CH = '23250312345678000199550010000000011000000017';
const gz = (s) => zlib.gzipSync(Buffer.from(s, 'utf8')).toString('base64');
const XML_PROC = `<procNFe><NFe><infNFe Id="NFe${CH}"></infNFe></NFe></procNFe>`;

function resposta({ cStat, ultNSU, maxNSU, n = 0 }) {
    const docs = Array.from({ length: n }, (_, i) =>
        `<docZip NSU="${String(i).padStart(15, '0')}" schema="procNFe_v4.00.xsd">${gz(XML_PROC)}</docZip>`).join('');
    return `<retDistDFeInt><cStat>${cStat}</cStat><xMotivo>x</xMotivo>` +
        `<ultNSU>${ultNSU}</ultNSU><maxNSU>${maxNSU}</maxNSU>` +
        `<loteDistDFeInt>${docs}</loteDistDFeInt></retDistDFeInt>`;
}

const base = (cnpj) => ({
    cnpj, cufAutor: '23', tpAmb: '1', pfx: Buffer.from('x'), passphrase: '',
    maxChamadas: 20, intervalMs: 0,
});

test('runLoop: pagina até o acervo esgotar', async () => {
    const CNPJ = '11111111000199';
    const paginas = [
        resposta({ cStat: '138', ultNSU: '000000000000050', maxNSU: '000000000000120', n: 50 }),
        resposta({ cStat: '138', ultNSU: '000000000000100', maxNSU: '000000000000120', n: 50 }),
        resposta({ cStat: '138', ultNSU: '000000000000120', maxNSU: '000000000000120', n: 20 }),
    ];
    let i = 0;
    const poster = async () => paginas[i++];
    const r = await runLoop({ ...base(CNPJ), poster });
    assert.strictEqual(r.chamadas, 3);
    assert.strictEqual(r.completos.length, 120);
    assert.strictEqual(r.motivoParada, 'acervo-esgotado');
    assert.strictEqual(cursor.read(CNPJ).ultNSU, '000000000000120');
});

test('runLoop: 656 para frio e mantém a hora cheia', async () => {
    const CNPJ = '22222222000199';
    let chamadas = 0;
    const poster = async () => {
        chamadas++;
        return resposta({ cStat: '656', ultNSU: '000000000000000', maxNSU: '000000000000000' });
    };
    const agora = 1_000_000;
    const r = await runLoop({ ...base(CNPJ), poster, agora });
    assert.strictEqual(chamadas, 1, 'não pode insistir depois de 656');
    assert.strictEqual(r.motivoParada, 'consumo-indevido');
    const c = cursor.read(CNPJ);
    assert.strictEqual(c.bloqueadoAte, agora + 3_600_000, 'a hora cheia tem que ficar de pé');
    assert.strictEqual(c.ultimoCStat, '656');
});

test('runLoop: 137 para frio e mantém a hora cheia', async () => {
    const CNPJ = '33333333000199';
    let chamadas = 0;
    const poster = async () => {
        chamadas++;
        return resposta({ cStat: '137', ultNSU: '000000000000050', maxNSU: '000000000000050' });
    };
    const r = await runLoop({ ...base(CNPJ), poster, agora: 2_000_000 });
    assert.strictEqual(chamadas, 1);
    assert.strictEqual(r.motivoParada, 'sem-documentos');
    assert.strictEqual(cursor.read(CNPJ).bloqueadoAte, 2_000_000 + 3_600_000);
});

test('runLoop: CNPJ bloqueado não faz nenhuma chamada', async () => {
    const CNPJ = '44444444000199';
    cursor.write(CNPJ, { bloqueadoAte: 9_000_000 });
    let chamadas = 0;
    const poster = async () => { chamadas++; return resposta({ cStat: '138', ultNSU: '1', maxNSU: '9' }); };
    const r = await runLoop({ ...base(CNPJ), poster, agora: 8_000_000 });
    assert.strictEqual(chamadas, 0, 'bloqueio existe justamente para não gastar a chamada');
    assert.strictEqual(r.motivoParada, 'cnpj-bloqueado');
});

test('runLoop: respeita o teto de chamadas', async () => {
    const CNPJ = '55555555000199';
    let chamadas = 0;
    const poster = async () => {
        chamadas++;
        return resposta({ cStat: '138', ultNSU: '000000000000050', maxNSU: '000000000099999', n: 50 });
    };
    const r = await runLoop({ ...base(CNPJ), poster, maxChamadas: 2 });
    assert.strictEqual(chamadas, 2);
    assert.strictEqual(r.motivoParada, 'teto-de-chamadas');
});

test('runLoop: retoma do cursor gravado, não do zero', async () => {
    const CNPJ = '66666666000199';
    cursor.write(CNPJ, { ultNSU: '000000000000777', bloqueadoAte: 0 });
    let enviado = '';
    const poster = async ({ body }) => {
        enviado = body;
        return resposta({ cStat: '137', ultNSU: '000000000000777', maxNSU: '000000000000777' });
    };
    await runLoop({ ...base(CNPJ), poster });
    assert.match(enviado, /<ultNSU>000000000000777<\/ultNSU>/);
});
```

- [ ] **Passo 2: rodar para ver falhar**

```bash
node --test worker/test/distnsu-loop.test.mjs
```

Esperado: FAIL — `runLoop is not a function`.

- [ ] **Passo 3: implementar**

Acrescentar a `worker/lib/distnsu.js`:

```javascript
const cursor = require('./cursor.js');

const UMA_HORA_MS = 3_600_000;
const DEFAULT_MAX_CHAMADAS = 20;   // mesmo teto por hora do consChNFe; conservador aqui
const DEFAULT_INTERVAL_MS = 1_500; // folga entre páginas; a NT não exige, mas não custa

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const nsuNum = (s) => parseInt(String(s || '0').replace(/\D/g, ''), 10) || 0;

/**
 * Varre o acervo de UM CNPJ, paginando pelo ultNSU. Grava o cursor a cada volta.
 *
 * `agora` é injetável só para o teste conseguir afirmar sobre o bloqueio sem depender do
 * relógio de parede; em produção fica undefined e vale Date.now().
 */
async function runLoop(opts) {
    const {
        cnpj, cufAutor, tpAmb, pfx, passphrase, poster,
        maxChamadas = DEFAULT_MAX_CHAMADAS,
        intervalMs = DEFAULT_INTERVAL_MS,
    } = opts;
    const agora = () => (opts.agora == null ? Date.now() : opts.agora);

    const saida = {
        chamadas: 0, completos: [], resumos: [], eventos: [],
        cStatFinal: '', ultNSU: cursor.read(cnpj).ultNSU, motivoParada: '',
    };

    if (cursor.bloqueado(cnpj, agora())) {
        saida.motivoParada = 'cnpj-bloqueado';
        return saida;
    }

    for (;;) {
        if (saida.chamadas >= maxChamadas) { saida.motivoParada = 'teto-de-chamadas'; return saida; }

        // FALHA FECHADO: o bloqueio da hora cheia é gravado ANTES da chamada. Se o processo
        // morrer entre o POST e a resposta, o próximo run assume que a consulta foi gasta.
        cursor.write(cnpj, { bloqueadoAte: agora() + UMA_HORA_MS });

        const lote = await fetchDistNsuBatch({
            cnpj, cufAutor, tpAmb, ultNSU: saida.ultNSU, pfx, passphrase, poster,
        });
        saida.chamadas++;
        saida.cStatFinal = lote.cStat;

        if (lote.cStat === '656' || lote.cStat === '137') {
            // Hora cheia fica de pé — retomar dentro da janela zera o relógio (NT 2014.002).
            cursor.write(cnpj, { ultimoCStat: lote.cStat, maxNSU: lote.maxNSU || undefined });
            saida.motivoParada = lote.cStat === '656' ? 'consumo-indevido' : 'sem-documentos';
            return saida;
        }

        saida.completos.push(...lote.completos);
        saida.resumos.push(...lote.resumos);
        saida.eventos.push(...lote.eventos);
        saida.ultNSU = lote.ultNSU || saida.ultNSU;

        // Resposta boa: afrouxa o bloqueio para o intervalo curto e avança o cursor.
        cursor.write(cnpj, {
            ultNSU: saida.ultNSU, maxNSU: lote.maxNSU, ultimoCStat: lote.cStat,
            bloqueadoAte: agora() + intervalMs,
        });

        if (nsuNum(saida.ultNSU) >= nsuNum(lote.maxNSU)) {
            saida.motivoParada = 'acervo-esgotado';
            return saida;
        }
        if (intervalMs) await delay(intervalMs);
    }
}
```

E atualizar o export:

```javascript
module.exports = { buildDistNsuSoap, fetchDistNsuBatch, runLoop, UMA_HORA_MS };
```

- [ ] **Passo 4: rodar para ver passar**

```bash
node --test worker/test/distnsu-loop.test.mjs
```

Esperado: PASS, 11 testes (5 do cursor + 6 do loop).

- [ ] **Passo 5: rodar a suíte inteira do worker, para garantir que o NFe não regrediu**

```bash
node --test worker/test/nfe.test.mjs worker/test/nfe-job.test.mjs worker/test/distnsu.test.mjs worker/test/distnsu-loop.test.mjs
```

Esperado: PASS em todos.

- [ ] **Passo 6: commit**

```bash
git add worker/lib/distnsu.js worker/test/distnsu-loop.test.mjs
git commit -m "feat(distnsu): loop paginado com trava de 1h que falha fechado"
```

---

### Task 5: job com várias empresas e ZIP por empresa

Espelha o lifecycle do `nfe.js` (`startJob`/`getStatus`/`getCompanyZip`) para a tela poder
consumir igual. Uma empresa por CNPJ, um ZIP por empresa.

**Arquivos:**
- Modificar: `worker/lib/distnsu.js`
- Modificar: `worker/lib/nfe.js` (só a linha do `module.exports`)
- Modificar: `worker/test/distnsu-loop.test.mjs`

**Interfaces:**
- Consome: `runLoop` (Task 4), `buildZip` de `worker/lib/zip.js`, `newJobId` de
  `worker/lib/access.js`, `sanitizeFileName` e `cleanDigits` de `worker/lib/nfe.js`.
- Produz:
  - `startJob(payload) -> { id, done, error }` com
    `payload = { companies: [{ id?, cnpj, pfxB64, senha, cufAutor?, tpAmb?, maxChamadas?, intervalMs?, _poster? }] }`
  - `getStatus(jobId) -> { ok, jobId, done, error, companies: [...] } | null`
  - `getCompanyZip(jobId, groupId) -> { buffer, name } | null`
  - `getCompanyDetail(jobId, groupId) -> { ..., resumos, motivoParada } | null`

- [ ] **Passo 1: exportar os dois helpers do `nfe.js`**

Trocar a última linha do `module.exports` de `worker/lib/nfe.js:491-495` por:

```javascript
module.exports = {
    unwrapDocZip, buildDistDFeIntSoap, parseRetDistDFe, postDistDFe, postDistDFeVia, fetchNfeXml,
    startJob, getStatus, getCompanyDetail, getCompanyZip, jobs,
    DISTDFE_URL_PROD, DISTDFE_VERSAO,
    sanitizeFileName, cleanDigits,
};
```

Nenhuma outra linha do `nfe.js` muda. O arquivo é validado contra a SEFAZ; mexer nele além
disso é fora de escopo deste plano.

- [ ] **Passo 2: escrever o teste que falha**

Acrescentar a `worker/test/distnsu-loop.test.mjs`:

```javascript
const distnsu = require('../lib/distnsu.js');

test('startJob: duas empresas, um ZIP cada, credenciais descartadas no fim', async () => {
    const paginaCheia = resposta({ cStat: '138', ultNSU: '000000000000050', maxNSU: '000000000000050', n: 50 });
    const job = distnsu.startJob({
        companies: [
            { cnpj: '77777777000199', pfxB64: Buffer.from('x').toString('base64'), senha: 's',
              cufAutor: '23', intervalMs: 0, _poster: async () => paginaCheia },
            { cnpj: '88888888000199', pfxB64: Buffer.from('x').toString('base64'), senha: 's',
              cufAutor: '23', intervalMs: 0, _poster: async () => paginaCheia },
        ],
    });
    // O job roda em background; espera terminar.
    for (let i = 0; i < 200 && !distnsu.getStatus(job.id).done; i++) await new Promise((r) => setTimeout(r, 10));

    const st = distnsu.getStatus(job.id);
    assert.strictEqual(st.done, true);
    assert.strictEqual(st.companies.length, 2);
    for (const c of st.companies) {
        assert.strictEqual(c.completos, 50);
        assert.strictEqual(c.zipReady, true);
        assert.match(c.zipName, /\.zip$/);
    }
    const z = distnsu.getCompanyZip(job.id, '77777777000199');
    assert.ok(z && z.buffer && z.buffer.length > 0);
});

test('startJob: empresa sem certificado é recusada, não trava o job', () => {
    const job = distnsu.startJob({ companies: [{ cnpj: '99999999000188', pfxB64: '' }] });
    assert.strictEqual(job.done, true);
    assert.match(job.error, /nenhuma empresa/);
});
```

- [ ] **Passo 3: rodar para ver falhar**

```bash
node --test worker/test/distnsu-loop.test.mjs
```

Esperado: FAIL — `distnsu.startJob is not a function`.

- [ ] **Passo 4: implementar**

Acrescentar a `worker/lib/distnsu.js`:

```javascript
const { buildZip } = require('./zip.js');
const { newJobId } = require('./access.js');
const { sanitizeFileName, cleanDigits } = require('./nfe.js');

const jobs = new Map();

function startJob(payload) {
    // ID aleatório, não sequencial — mesmo motivo do nfe.js:294: `distnsu-1` seria
    // adivinhável e dispensaria o atacante de saber qualquer coisa para baixar o ZIP.
    const id = newJobId('distnsu');
    const companies = new Map();

    for (const c of (Array.isArray(payload.companies) ? payload.companies : [])) {
        const cnpj = cleanDigits(c.cnpj);
        if (cnpj.length !== 14) continue;
        const pfxB64 = String(c.pfxB64 || '').trim();
        if (!pfxB64) continue;
        let pfx;
        try { pfx = Buffer.from(pfxB64, 'base64'); } catch { continue; }
        if (!pfx || !pfx.length) continue;
        const gid = String(c.id || '').trim() || cnpj;
        companies.set(gid, {
            id: gid, cnpj, pfx, senha: String(c.senha || ''),
            cufAutor: cleanDigits(c.cufAutor) || '23',
            tpAmb: parseInt(c.tpAmb, 10) || 1,
            maxChamadas: c.maxChamadas, intervalMs: c.intervalMs,
            poster: c._poster || null, // hook de teste; produção usa mTLS real
            phase: 'download', chamadas: 0, completos: 0, resumosPend: [],
            eventos: 0, motivoParada: '', erro: '',
            nome: '', xmls: [], zipBuffer: null, zipName: '',
        });
    }

    const job = { id, companies, done: false, error: '' };
    jobs.set(id, job);
    if (!companies.size) {
        job.done = true;
        job.error = 'nenhuma empresa com CNPJ + certificado válidos';
        return job;
    }
    runJob(job).catch((e) => { job.error = (e && e.message) || 'erro interno'; job.done = true; });
    return job;
}

async function runJob(job) {
    // Sequencial de propósito: a quota da SEFAZ é por CNPJ, mas o acervo é grande e não há
    // ganho real em paralelizar empresas — e serializar mantém o log legível quando dá 656.
    for (const comp of job.companies.values()) {
        try {
            const r = await runLoop({
                cnpj: comp.cnpj, cufAutor: comp.cufAutor, tpAmb: comp.tpAmb,
                pfx: comp.pfx, passphrase: comp.senha, poster: comp.poster,
                maxChamadas: comp.maxChamadas, intervalMs: comp.intervalMs,
            });
            comp.chamadas = r.chamadas;
            comp.completos = r.completos.length;
            comp.eventos = r.eventos.length;
            comp.resumosPend = r.resumos;      // insumo da Etapa 2 (manifestação 210210)
            comp.motivoParada = r.motivoParada;
            comp.xmls = r.completos.map((d) => ({
                name: (d.chave || ('nsu-' + d.nsu)) + '.xml', data: d.xml,
            }));
            tryResolveNome(comp, r.completos);
        } catch (e) {
            comp.erro = (e && e.message) || 'erro';
        }
        finalizeCompany(comp);
    }
    // Segurança: descarta credenciais da memória ao fim do job (nfe.js:456).
    job.companies.forEach((c) => { c.pfx = null; c.senha = ''; c.poster = null; });
    job.done = true;
}

// Nome da empresa DONA do job, para batizar o ZIP. Tem que casar o CNPJ do certificado:
// num acervo de entradas o <emit> é o FORNECEDOR (a armadilha registrada em nfe.js:263).
function tryResolveNome(comp, docs) {
    for (const d of docs) {
        for (const tag of ['dest', 'emit']) {
            const bloco = String(d.xml).match(new RegExp('<' + tag + '>[\\s\\S]*?</' + tag + '>'));
            if (!bloco) continue;
            const doc = bloco[0].match(/<CNPJ>(\d{14})<\/CNPJ>/);
            if (!doc || doc[1] !== comp.cnpj) continue;
            const nome = bloco[0].match(/<xNome>([^<]+)<\/xNome>/);
            if (nome && nome[1]) { comp.nome = nome[1].trim(); return; }
        }
    }
}

function finalizeCompany(comp) {
    if (!comp.xmls.length) { comp.phase = 'done'; return; }
    comp.phase = 'zip';
    try {
        comp.zipBuffer = buildZip(comp.xmls);
        comp.zipName = 'NFe distNSU_' +
            sanitizeFileName(comp.nome || ('CNPJ ' + comp.cnpj)) + '.zip';
        comp.xmls = [];
    } catch (e) {
        comp.erro = 'falha ao gerar ZIP: ' + ((e && e.message) || e);
    }
    comp.phase = 'done';
}

function companyStatus(c) {
    return {
        id: c.id, cnpj: c.cnpj, nome: c.nome || ('CNPJ ' + c.cnpj),
        phase: c.phase, chamadas: c.chamadas, completos: c.completos,
        resumos: c.resumosPend.length, eventos: c.eventos,
        motivoParada: c.motivoParada, erro: c.erro,
        zipReady: !!c.zipBuffer, zipName: c.zipName,
    };
}

function getStatus(jobId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    const companies = [];
    job.companies.forEach((c) => companies.push(companyStatus(c)));
    return { ok: true, jobId: job.id, done: job.done, error: job.error || '', companies };
}

function acharComp(jobId, groupId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    return job.companies.get(String(groupId || '')) || job.companies.get(cleanDigits(groupId)) || null;
}

function getCompanyDetail(jobId, groupId) {
    const c = acharComp(jobId, groupId);
    if (!c) return null;
    // As chaves dos resumos são o insumo da Etapa 2 — só chave e NSU, nada de conteúdo.
    return { ok: true, ...companyStatus(c), resumosChaves: c.resumosPend.map((r) => r.chave) };
}

function getCompanyZip(jobId, groupId) {
    const c = acharComp(jobId, groupId);
    if (!c || !c.zipBuffer) return null;
    return { buffer: c.zipBuffer, name: c.zipName };
}
```

Export final do arquivo:

```javascript
module.exports = {
    buildDistNsuSoap, fetchDistNsuBatch, runLoop,
    startJob, getStatus, getCompanyDetail, getCompanyZip, jobs,
    UMA_HORA_MS,
};
```

- [ ] **Passo 5: rodar para ver passar**

```bash
node --test worker/test/distnsu-loop.test.mjs
```

Esperado: PASS, 13 testes.

- [ ] **Passo 6: commit**

```bash
git add worker/lib/distnsu.js worker/lib/nfe.js worker/test/distnsu-loop.test.mjs
git commit -m "feat(distnsu): job por empresa com ZIP e lista de resumos p/ Etapa 2"
```

---

### Task 6: rotas no worker

Quatro rotas, espelhando exatamente o bloco NFCe de `worker/server.js:214-251`.

**Arquivos:**
- Modificar: `worker/server.js` (import no topo + bloco de rotas depois do bloco NFe)

**Interfaces:**
- Consome: `startJob`, `getStatus`, `getCompanyDetail`, `getCompanyZip` (Task 5).
- Produz: `POST /distnsu/start`, `GET /distnsu/status/{jobId}`,
  `GET /distnsu/detail/{jobId}/{cnpj}`, `GET /distnsu/zip/{jobId}/{cnpj}`.

- [ ] **Passo 1: adicionar o import**

Junto dos outros `require` do topo de `worker/server.js` (ao lado do `nfe`):

```javascript
const distnsu = require('./lib/distnsu.js');
```

- [ ] **Passo 2: adicionar o bloco de rotas**

Logo depois do bloco `====================== NFe (XML) ======================`, colar:

```javascript
    // ====================== distNSU (acervo por CNPJ) ======================
    // Dispara o loop: { companies:[{id,cnpj,pfxB64,senha,cufAutor,tpAmb,maxChamadas}] }.
    // Não recebe chaves — o distNSU descobre o acervo sozinho, essa é a graça dele.
    if (method === 'POST' && path === '/distnsu/start') {
        try {
            const raw = await readBody(req, 128_000_000); // .pfx em base64 por empresa
            const payload = raw ? JSON.parse(raw) : {};
            const job = distnsu.startJob(payload);
            sendJson(res, 200, { ok: !job.error, jobId: job.id, error: job.error || '' });
        } catch (e) {
            sendJson(res, 400, { ok: false, error: (e && e.message) || 'payload inválido' });
        }
        return;
    }

    // Progresso (polling): GET /distnsu/status/{jobId}
    if (method === 'GET' && path.startsWith('/distnsu/status/')) {
        const jobId = decodeURIComponent(path.slice('/distnsu/status/'.length));
        const st = distnsu.getStatus(jobId);
        if (!st) { sendJson(res, 404, { ok: false, error: 'job não encontrado' }); return; }
        sendJson(res, 200, st);
        return;
    }

    // Detalhe (chaves em resumo, motivo da parada): GET /distnsu/detail/{jobId}/{cnpj}
    if (method === 'GET' && path.startsWith('/distnsu/detail/')) {
        const rest = path.slice('/distnsu/detail/'.length).split('/');
        const detail = distnsu.getCompanyDetail(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!detail) { sendJson(res, 404, { ok: false, error: 'job/empresa não encontrado' }); return; }
        sendJson(res, 200, detail);
        return;
    }

    // Download do ZIP de uma empresa: GET /distnsu/zip/{jobId}/{cnpj}
    if (method === 'GET' && path.startsWith('/distnsu/zip/')) {
        const rest = path.slice('/distnsu/zip/'.length).split('/');
        const z = distnsu.getCompanyZip(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!z) { sendJson(res, 404, { ok: false, error: 'ZIP indisponível (job/empresa não pronto)' }); return; }
        sendZip(res, z.buffer, z.name);
        return;
    }
```

- [ ] **Passo 3: conferir que as rotas estão atrás do controle de acesso**

Abrir `worker/server.js` e confirmar, **a olho**, que o bloco novo está **depois** da
verificação de origem/token (a allowlist introduzida em `89be027`) — igual aos blocos NFCe
e NFe. Uma rota antes do portão aceita requisição de qualquer página aberta no navegador.

Se estiver antes, mover o bloco para depois. Não seguir para o passo 4 sem isso.

- [ ] **Passo 4: subir o worker e bater nas rotas**

```bash
node worker/server.js
```

Noutro terminal, com o token que o worker imprimiu no boot:

```bash
curl -s -X POST http://127.0.0.1:PORTA/distnsu/start -H "Content-Type: application/json" -H "X-Worker-Token: SEU_TOKEN" -d "{\"companies\":[]}"
```

Esperado: `{"ok":false,"jobId":"distnsu-...","error":"nenhuma empresa com CNPJ + certificado válidos"}`
— o caminho HTTP funciona ponta a ponta sem nenhum certificado envolvido.

- [ ] **Passo 5: commit**

```bash
git add worker/server.js
git commit -m "feat(distnsu): rotas start/status/detail/zip no worker"
```

---

### Task 7: harness de linha de comando, com portão offline

O jeito de rodar contra a SEFAZ de verdade sem depender da tela. Herda a disciplina do
`probe-distnsu.cjs`: senha só por env, nada de conteúdo fiscal em log, e um `--dry-run` que
exercita o loop inteiro com respostas falsas antes de gastar consulta.

**Arquivos:**
- Criar: `scripts/distnsu-run.cjs`

**Interfaces:**
- Consome: `runLoop` (Task 4), `cursor.read` (Task 2).

- [ ] **Passo 1: escrever o script**

```javascript
#!/usr/bin/env node
/*
 * Roda o loop distNSU de UM CNPJ contra a SEFAZ, gravando o cursor.
 *
 * Diferente do probe (que faz UMA chamada e serve para responder pergunta), este é a
 * ferramenta de produção sem tela: pagina o acervo até esgotar, parar em 656/137 ou bater
 * o teto de chamadas — e persiste o cursor, então rodar de novo continua de onde parou.
 *
 * DISCIPLINA — o custo do erro é 1 hora de janela do CNPJ:
 *   - `--dry-run` primeiro. Ele exercita o loop inteiro com respostas falsas, sem rede.
 *   - Se o cursor disser que o CNPJ está bloqueado, o loop nem chama. Isso é proteção,
 *     não bug: espere a hora acabar.
 *   - Nada de conteúdo fiscal na tela. Só contagem, cStat e motivo da parada.
 *
 * Uso (PowerShell) — a senha NUNCA vai no argv:
 *
 *   $env:PFX_SENHA = 'senha-do-certificado'
 *   node --openssl-legacy-provider scripts/distnsu-run.cjs `
 *        --pfx "C:\caminho\certificado.pfx" --cnpj 00000000000000 --cuf 23 --out .\saida
 *
 * A flag --openssl-legacy-provider é obrigatória (ver worker/lib/nfe.js:102).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { runLoop } = require('../worker/lib/distnsu.js');
const cursor = require('../worker/lib/cursor.js');

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const digits = (s) => String(s || '').replace(/\D/g, '');

// Portão offline: exercita o loop inteiro com respostas falsas. Zero rede, zero quota.
async function dryRun() {
    const CH = '23250312345678000199550010000000011000000017';
    const xml = `<procNFe><NFe><infNFe Id="NFe${CH}"></infNFe></NFe></procNFe>`;
    const gz = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const pagina = (ult, max, n) =>
        `<retDistDFeInt><cStat>138</cStat><xMotivo>ok</xMotivo><ultNSU>${ult}</ultNSU>` +
        `<maxNSU>${max}</maxNSU><loteDistDFeInt>` +
        Array.from({ length: n }, (_, i) =>
            `<docZip NSU="${String(i).padStart(15, '0')}" schema="procNFe_v4.00.xsd">${gz}</docZip>`).join('') +
        `</loteDistDFeInt></retDistDFeInt>`;
    const paginas = [
        pagina('000000000000050', '000000000000100', 50),
        pagina('000000000000100', '000000000000100', 50),
    ];
    let i = 0;
    const r = await runLoop({
        cnpj: '00000000000191', cufAutor: '23', tpAmb: '2',
        pfx: Buffer.from('x'), passphrase: '', intervalMs: 0,
        poster: async () => paginas[i++],
    });
    const assert = require('assert');
    assert.strictEqual(r.chamadas, 2, 'o loop tem que paginar duas vezes');
    assert.strictEqual(r.completos.length, 100, 'os 100 documentos das duas páginas');
    assert.strictEqual(r.motivoParada, 'acervo-esgotado');
    console.log('dry-run OK — loop paginou 2×, 100 documentos, parou por acervo esgotado.');
    console.log('Nenhuma chamada à SEFAZ foi feita.');
}

async function main() {
    if (process.argv.includes('--dry-run')) { await dryRun(); return; }

    const pfxPath = arg('pfx');
    const cnpj = digits(arg('cnpj'));
    const cufAutor = digits(arg('cuf'));
    const tpAmb = digits(arg('tpamb', '1')) || '1';
    const maxChamadas = parseInt(arg('max', '20'), 10);
    const outDir = arg('out', '.');
    const senha = process.env.PFX_SENHA;

    const faltando = [];
    if (!pfxPath) faltando.push('--pfx');
    if (cnpj.length !== 14) faltando.push('--cnpj (14 dígitos)');
    if (!cufAutor) faltando.push('--cuf');
    if (!senha) faltando.push('$env:PFX_SENHA');
    if (faltando.length) {
        console.error('Faltou: ' + faltando.join(', '));
        console.error('Veja o cabeçalho deste arquivo. Rode --dry-run antes da primeira vez.');
        process.exit(2);
    }
    if (!fs.existsSync(pfxPath)) { console.error('Certificado não encontrado: ' + pfxPath); process.exit(2); }

    const antes = cursor.read(cnpj);
    console.log('CNPJ ' + cnpj + ' · cUFAutor ' + cufAutor + ' · tpAmb ' + tpAmb);
    console.log('cursor: ultNSU ' + antes.ultNSU + ' · maxNSU ' + antes.maxNSU +
        (antes.bloqueadoAte > Date.now()
            ? ' · BLOQUEADO até ' + new Date(antes.bloqueadoAte).toLocaleTimeString()
            : ' · liberado'));
    console.log('teto de ' + maxChamadas + ' chamadas nesta rodada\n');

    const r = await runLoop({
        cnpj, cufAutor, tpAmb, maxChamadas,
        pfx: fs.readFileSync(pfxPath), passphrase: senha,
    });

    console.log('chamadas   ' + r.chamadas);
    console.log('completos  ' + r.completos.length + ' (procNFe, servem direto)');
    console.log('resumos    ' + r.resumos.length + ' (resNFe, precisam da Etapa 2)');
    console.log('eventos    ' + r.eventos.length);
    console.log('cStat      ' + (r.cStatFinal || '(nenhuma chamada)'));
    console.log('parou por  ' + r.motivoParada);
    console.log('cursor     ultNSU ' + cursor.read(cnpj).ultNSU);

    if (r.completos.length) {
        fs.mkdirSync(outDir, { recursive: true });
        for (const d of r.completos) {
            fs.writeFileSync(path.join(outDir, (d.chave || ('nsu-' + d.nsu)) + '.xml'), d.xml);
        }
        console.log('\n' + r.completos.length + ' XML gravados em ' + path.resolve(outDir));
    }
    if (r.resumos.length) {
        const lista = path.join(outDir, 'resumos-para-manifestar.txt');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(lista, r.resumos.map((x) => x.chave).join('\n'));
        console.log('Chaves em resumo (insumo da Etapa 2): ' + lista);
    }
    if (r.motivoParada === 'consumo-indevido' || r.motivoParada === 'sem-documentos') {
        console.log('\nPARE. Nada de nova chamada neste CNPJ por 1 hora — retomar dentro da');
        console.log('janela zera o relógio (NT 2014.002). O cursor já está gravado.');
    }
}

main().catch((e) => { console.error(e && e.message); process.exit(1); });
```

- [ ] **Passo 2: rodar o portão offline**

```bash
node scripts/distnsu-run.cjs --dry-run
```

Esperado: `dry-run OK — loop paginou 2×, 100 documentos, parou por acervo esgotado.`

- [ ] **Passo 3: commit**

```bash
git add scripts/distnsu-run.cjs
git commit -m "feat(distnsu): harness CLI com portao offline (--dry-run)"
```

- [ ] **Passo 4: a suíte inteira, uma última vez**

```bash
node --test worker/test/nfe.test.mjs worker/test/nfe-job.test.mjs worker/test/distnsu.test.mjs worker/test/distnsu-loop.test.mjs
```

Esperado: PASS em todos. Se algo do NFe quebrou, a causa é o export da Task 5 — reverta o
`nfe.js` e reveja.

---

## Teste real contra a SEFAZ — fora do plano, feito pelo Josué

Nenhuma tarefa acima toca a SEFAZ. Quando as 7 estiverem verdes, o primeiro teste real é:

```bash
node --openssl-legacy-provider scripts/distnsu-run.cjs --pfx "C:\caminho\cert.pfx" --cnpj CNPJ_QUE_FUNCIONA --cuf 23 --max 3 --out .\saida-distnsu
```

- **`--max 3`** na primeira vez. Se algo estiver torto, o prejuízo é 3 consultas, não 20.
- **Não usar o CNPJ da A&R.** Ele está bloqueado por consumidor externo, medido duas vezes.
- Se der `656` na primeira chamada, o cursor grava a hora cheia e o script avisa. Isso é o
  comportamento correto — espere, não insista.

## Auto-revisão

**Cobertura:** as três exigências do handoff estão cobertas — loop (Task 4), cursor
persistido por CNPJ (Task 2, consumido na 4), e "em 656 ou 137, parar frio, gravar o cursor,
esperar 1 h cheia" (Task 4, passos 2 e 3, com teste dedicado para cada cStat).

**Consistência de tipos:** `runLoop` devolve `{ chamadas, completos, resumos, eventos,
cStatFinal, ultNSU, motivoParada }` na Task 4 e é consumido com esses mesmos nomes na Task 5
(`runJob`) e na Task 7 (`main`). `cursor.read` devolve `{ ultNSU, maxNSU, bloqueadoAte,
ultimoCStat, atualizadoEm }` na Task 2 e é lido com esses campos nas Tasks 4 e 7.

**Ponto frágil, declarado:** o formato do objeto que o `poster` recebe (`{ body }` nos testes
das Tasks 3 e 4) vem de `postDistDFeVia` (`nfe.js:139`), que eu não li linha a linha. O
Passo 3 da Task 3 manda conferir antes de escrever. Se o campo tiver outro nome, o ajuste é
no teste, não na lib — dois testes tocados, nada de arquitetura.
