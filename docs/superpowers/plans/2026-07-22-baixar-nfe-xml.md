# Baixar NFe (XML) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Baixar XML de NFe (modelo 55) por lista de chaves usando o webservice oficial `NFeDistribuicaoDFe`/`consChNFe` com certificado A1, espelhando o pipeline Baixar NFCe.

**Architecture:** Reaproveita a engrenagem do NFCe (report → chaves → agrupa por CNPJ → job no worker Node loopback → ZIP por empresa → polling). Troca token JWT por certificado A1 (TLS mútuo) e REST GET por SOAP `consChNFe` ao Ambiente Nacional. Novo módulo `worker/lib/nfe.js` (funções puras + job manager), novas rotas `/nfe/*` no `server.js`, nova página browser com upload `.pfx`+senha por empresa.

**Tech Stack:** Node >=18 (só módulos nativos: `http`, `https`, `zlib`, `node:test`, `node:assert`). Worker zero-dep. Browser: JS vanilla em `assets/js/app.js`.

## Global Constraints

- **Zero dependências externas no worker** — só módulos nativos do Node (padrão do repo: `nfce.js`/`zip.js` não importam nada de `node_modules` runtime). Regex para XML, não parser de biblioteca.
- **Segurança do certificado:** `.pfx` (base64) e senha trafegam só browser → loopback `127.0.0.1:47620`; mantidos apenas em memória durante o job; nunca gravados em disco; nunca logados; descartados da memória ao fim do job (sucesso ou falha).
- **Isolamento por empresa:** falha de uma empresa (cert inválido, senha errada) registra erro só naquela empresa e não derruba as demais — mesmo contrato do `aborted`/`abortReason` em `nfce.js`.
- **Porta fixa** `47620`, host `127.0.0.1`. Endpoint SEFAZ overridável por env (`NFE_DISTDFE_URL`) só para teste com mock, como `SEFAZ_BASE` faz no NFCe.
- Chave NFe = 44 dígitos; modelo nas posições 20–21 (0-indexed `chave.substring(20,22)`), `55` = NFe, `65` = NFCe. cUF nas posições 0–1.

---

### Task 0: Fixar o contrato do webservice NFeDistribuicaoDFe (pesquisa, sem código de produção)

Antes de codar, confirmar os valores exatos no manual/WSDL oficial da SEFAZ (Manual de Orientação do Contribuinte / schema `distDFeInt`). NÃO chutar. Registrar os valores confirmados no topo de `worker/lib/nfe.js` como constantes documentadas.

**Files:**
- Create (rascunho): `docs/superpowers/notes/nfe-distdfe-contract.md`

**A confirmar e anotar:**
- [x] **Endpoints** (Ambiente Nacional) — **CONFIRMADO via busca web 2026-07-22:**
  - Homologação (literal, portal oficial): `https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` (substituto `hom1.nfe...`).
  - Produção (alta confiança, padrão AN comunidade ACBr/sped-nfe/DFe.NET): `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`. **Validar no 1º teste real** — é o único valor não pinado numa string literal de fonte oficial.
- [x] **SOAP:** 1.2 (`Content-Type: application/soap+xml; charset=utf-8`), método `nfeDistDFeInteresse`, namespace WSDL `http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe`. Confirmado (padrão AN).
- [x] **Schema `distDFeInt`:** atributo **`versao="1.01"`** — CONFIRMADO (XSD `distDFeInt_v1.01.xsd` em ACBr/sped-nfe + wiki UniNFe). ~~1.35 era palpite errado~~. Namespace do distDFeInt = `http://www.portalfiscal.inf.br/nfe`. Campos: `tpAmb`, `cUFAutor`, `CNPJ` (ou `CPF`), grupo `consChNFe` com `chNFe`.
- [ ] **`cUFAutor`:** o que a SEFAZ espera — UF do autor da consulta (destinatário). Decisão para o worker: derivar do CNPJ da empresa. Como o dado de UF não vem no report, definir fallback = cUF da 1ª chave do grupo (`chave.substring(0,2)`), e permitir override por campo `cufAutor` na empresa. Anotar a decisão.
- [ ] **Resposta:** caminho `retDistDFeInt` → `cStat`/`xMotivo` + `loteDistDFeInt` → `docZip` (atributos `NSU`, `schema`; conteúdo = base64 de gzip do XML). Confirmar que `consChNFe` de parte interessada retorna `procNFe` completo (não só resumo).
- [ ] **cStat relevantes:** `137`/`138` (sem docs), `656` (consumo indevido / rejeição por consulta fora de prazo), `100`/`138`. Anotar a lista real do manual.

- [ ] **Commit** do rascunho de notas.

```bash
git add docs/superpowers/notes/nfe-distdfe-contract.md
git commit -m "docs(nfe): contrato confirmado do webservice NFeDistribuicaoDFe"
```

---

### Task 1: Helper `unwrapDocZip` — decodifica um docZip (base64+gzip) para XML

**Files:**
- Create: `worker/lib/nfe.js`
- Test: `worker/test/nfe.test.mjs`

**Interfaces:**
- Produces: `unwrapDocZip(b64: string) -> string` (XML já descomprimido, utf8). Lança em base64/gzip inválido.

- [ ] **Step 1: Write the failing test**

```javascript
// worker/test/nfe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { unwrapDocZip } from '../lib/nfe.js';

test('unwrapDocZip: base64+gzip -> XML', () => {
    const xml = '<procNFe><NFe><infNFe Id="NFe12345678901234567890123456789012345678901234"></infNFe></NFe></procNFe>';
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    assert.strictEqual(unwrapDocZip(b64), xml);
});

test('unwrapDocZip: base64 inválido lança', () => {
    assert.throws(() => unwrapDocZip('%%%naoBase64%%%'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test worker/test/nfe.test.mjs`
Expected: FAIL — `Cannot find module '../lib/nfe.js'` ou `unwrapDocZip is not a function`.

Nota: `nfe.js` é CommonJS (como `nfce.js`); o teste `.mjs` importa via `module.exports`. `import { unwrapDocZip } from '../lib/nfe.js'` funciona com interop do Node para `module.exports = { unwrapDocZip, ... }`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// worker/lib/nfe.js
'use strict';

const zlib = require('zlib');

// docZip = conteúdo base64 de um gzip do XML (procNFe/resNFe/procEventoNFe).
function unwrapDocZip(b64) {
    const buf = Buffer.from(String(b64 || '').replace(/\s+/g, ''), 'base64');
    if (!buf.length) throw new Error('docZip vazio');
    return zlib.gunzipSync(buf).toString('utf8');
}

module.exports = { unwrapDocZip };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test worker/test/nfe.test.mjs`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add worker/lib/nfe.js worker/test/nfe.test.mjs
git commit -m "feat(nfe): unwrapDocZip decodifica docZip base64+gzip para XML"
```

---

### Task 2: `buildDistDFeIntSoap` — monta o envelope SOAP consChNFe

**Files:**
- Modify: `worker/lib/nfe.js`
- Test: `worker/test/nfe.test.mjs`

**Interfaces:**
- Consumes: constantes de contrato da Task 0 (namespace, versao).
- Produces: `buildDistDFeIntSoap({ tpAmb: number, cufAutor: string, cnpj: string, chave: string }) -> string` (envelope SOAP completo, sem quebras que invalidem o XML).

- [ ] **Step 1: Write the failing test**

```javascript
import { buildDistDFeIntSoap } from '../lib/nfe.js';

test('buildDistDFeIntSoap: inclui CNPJ, chNFe, tpAmb, cUFAutor e namespace', () => {
    const soap = buildDistDFeIntSoap({
        tpAmb: 1, cufAutor: '23', cnpj: '12345678000199',
        chave: '23250312345678000199550010000000011000000017',
    });
    assert.match(soap, /<tpAmb>1<\/tpAmb>/);
    assert.match(soap, /<cUFAutor>23<\/cUFAutor>/);
    assert.match(soap, /<CNPJ>12345678000199<\/CNPJ>/);
    assert.match(soap, /<consChNFe>\s*<chNFe>23250312345678000199550010000000011000000017<\/chNFe>\s*<\/consChNFe>/);
    assert.match(soap, /portalfiscal\.inf\.br\/nfe\/wsdl\/NFeDistribuicaoDFe/);
    assert.match(soap, /<distDFeInt[^>]*versao="1\.01"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test worker/test/nfe.test.mjs`
Expected: FAIL — `buildDistDFeIntSoap is not a function`.

- [ ] **Step 3: Write minimal implementation**

Adicionar em `nfe.js` (usar os valores confirmados na Task 0; abaixo os da hipótese):

```javascript
const WSDL_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const DISTDFE_VERSAO = '1.01'; // confirmado: schema distDFeInt_v1.01.xsd

// Monta o envelope SOAP 1.2 para nfeDistDFeInteresse > consChNFe.
// Sem indentação dentro do distDFeInt para não introduzir texto espúrio.
function buildDistDFeIntSoap({ tpAmb, cufAutor, cnpj, chave }) {
    const distDFeInt =
        `<distDFeInt xmlns="${NFE_NS}" versao="${DISTDFE_VERSAO}">` +
        `<tpAmb>${tpAmb}</tpAmb>` +
        `<cUFAutor>${cufAutor}</cUFAutor>` +
        `<CNPJ>${cnpj}</CNPJ>` +
        `<consChNFe><chNFe>${chave}</chNFe></consChNFe>` +
        `</distDFeInt>`;
    return (
        `<?xml version="1.0" encoding="utf-8"?>` +
        `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
        `<soap12:Body>` +
        `<nfeDistDFeInteresse xmlns="${WSDL_NS}">` +
        `<nfeDadosMsg>${distDFeInt}</nfeDadosMsg>` +
        `</nfeDistDFeInteresse>` +
        `</soap12:Body></soap12:Envelope>`
    );
}

module.exports = { unwrapDocZip, buildDistDFeIntSoap };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test worker/test/nfe.test.mjs`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add worker/lib/nfe.js worker/test/nfe.test.mjs
git commit -m "feat(nfe): buildDistDFeIntSoap monta envelope consChNFe"
```

---

### Task 3: `parseRetDistDFe` — extrai cStat e docs (XML descomprimido) da resposta

**Files:**
- Modify: `worker/lib/nfe.js`
- Test: `worker/test/nfe.test.mjs`

**Interfaces:**
- Consumes: `unwrapDocZip`.
- Produces: `parseRetDistDFe(responseXml: string) -> { cStat: string, xMotivo: string, docs: Array<{ nsu: string, schema: string, xml: string }> }`. `docs` vazio quando não há `docZip`.

- [ ] **Step 1: Write the failing test**

```javascript
import { parseRetDistDFe } from '../lib/nfe.js';

test('parseRetDistDFe: extrai cStat e descomprime docZip', () => {
    const xml = '<procNFe><protNFe><infProt><chNFe>23250312345678000199550010000000011000000017</chNFe></infProt></protNFe></procNFe>';
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const resp =
        '<soap:Envelope><soap:Body><nfeDistDFeInteresseResponse><nfeDistDFeInteresseResult>' +
        '<retDistDFeInt><cStat>138</cStat><xMotivo>Documento localizado</xMotivo>' +
        '<loteDistDFeInt><docZip NSU="000000000000123" schema="procNFe_v4.00.xsd">' + b64 + '</docZip>' +
        '</loteDistDFeInt></retDistDFeInt>' +
        '</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>';
    const out = parseRetDistDFe(resp);
    assert.strictEqual(out.cStat, '138');
    assert.strictEqual(out.docs.length, 1);
    assert.strictEqual(out.docs[0].nsu, '000000000000123');
    assert.match(out.docs[0].xml, /<chNFe>23250312345678000199550010000000011000000017<\/chNFe>/);
});

test('parseRetDistDFe: sem docs quando cStat 137', () => {
    const resp = '<retDistDFeInt><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo></retDistDFeInt>';
    const out = parseRetDistDFe(resp);
    assert.strictEqual(out.cStat, '137');
    assert.strictEqual(out.docs.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test worker/test/nfe.test.mjs`
Expected: FAIL — `parseRetDistDFe is not a function`.

- [ ] **Step 3: Write minimal implementation**

```javascript
function firstTag(xml, tag) {
    const m = String(xml).match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
    return m ? m[1].trim() : '';
}

// Extrai cStat/xMotivo e cada <docZip ...>base64</docZip>, descomprimindo o conteúdo.
function parseRetDistDFe(responseXml) {
    const xml = String(responseXml || '');
    const cStat = firstTag(xml, 'cStat');
    const xMotivo = firstTag(xml, 'xMotivo');
    const docs = [];
    const re = /<docZip\b([^>]*)>([\s\S]*?)<\/docZip>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const attrs = m[1] || '';
        const nsuM = attrs.match(/NSU="([^"]*)"/);
        const schemaM = attrs.match(/schema="([^"]*)"/);
        let doc;
        try { doc = unwrapDocZip(m[2]); } catch { continue; }
        docs.push({ nsu: nsuM ? nsuM[1] : '', schema: schemaM ? schemaM[1] : '', xml: doc });
    }
    return { cStat, xMotivo, docs };
}

module.exports = { unwrapDocZip, buildDistDFeIntSoap, parseRetDistDFe };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test worker/test/nfe.test.mjs`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add worker/lib/nfe.js worker/test/nfe.test.mjs
git commit -m "feat(nfe): parseRetDistDFe extrai cStat + docs descomprimidos"
```

---

### Task 4: `postDistDFe` — POST SOAP com TLS mútuo (certificado A1), injetável para teste

**Files:**
- Modify: `worker/lib/nfe.js`
- Test: `worker/test/nfe.test.mjs`

**Interfaces:**
- Produces: `postDistDFe({ endpoint: string, pfx: Buffer, passphrase: string, soap: string }) -> Promise<string>` (corpo da resposta). Usa `https.request` com `pfx`/`passphrase` (TLS mútuo). Endpoint default = `process.env.NFE_DISTDFE_URL || <URL AN produção confirmada na Task 0>`.
- Testabilidade: expor também `postDistDFeVia(httpPostFn, opts)` onde `httpPostFn({url, headers, body, pfx, passphrase}) -> Promise<{status, text}>`. `postDistDFe` chama `postDistDFeVia` com o poster real (`https.request`). O teste injeta um poster fake — **sem rede, sem cert real**.

- [ ] **Step 1: Write the failing test**

```javascript
import { postDistDFeVia } from '../lib/nfe.js';

test('postDistDFeVia: repassa soap ao poster e retorna o texto', async () => {
    let seen = null;
    const fakePoster = async (o) => { seen = o; return { status: 200, text: '<retDistDFeInt><cStat>137</cStat></retDistDFeInt>' }; };
    const text = await postDistDFeVia(fakePoster, {
        endpoint: 'https://example/NFeDistribuicaoDFe.asmx',
        pfx: Buffer.from('fake'), passphrase: 'pw', soap: '<x/>',
    });
    assert.match(text, /cStat>137/);
    assert.strictEqual(seen.body, '<x/>');
    assert.match(seen.headers['Content-Type'], /application\/soap\+xml/);
});

test('postDistDFeVia: status != 200 lança com kind http', async () => {
    const fakePoster = async () => ({ status: 500, text: 'erro' });
    await assert.rejects(
        () => postDistDFeVia(fakePoster, { endpoint: 'x', pfx: Buffer.from('a'), passphrase: '', soap: '<x/>' }),
        (e) => e.kind === 'http'
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test worker/test/nfe.test.mjs`
Expected: FAIL — `postDistDFeVia is not a function`.

- [ ] **Step 3: Write minimal implementation**

```javascript
const https = require('https');
const { URL } = require('url');

const DISTDFE_URL_PROD = process.env.NFE_DISTDFE_URL ||
    'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'; // confirmar Task 0

function makeErr(kind, message) { const e = new Error(message); e.kind = kind; return e; }

// Poster real: https.request com TLS mútuo (pfx). Zero deps.
function httpsPostMtls({ url, headers, body, pfx, passphrase }) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
            headers, pfx, passphrase, // TLS client cert
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Testável: recebe o poster por injeção.
async function postDistDFeVia(httpPostFn, { endpoint, pfx, passphrase, soap }) {
    const headers = {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(soap),
    };
    const { status, text } = await httpPostFn({ url: endpoint, headers, body: soap, pfx, passphrase });
    if (status !== 200) throw makeErr('http', 'HTTP ' + status);
    return text;
}

function postDistDFe(opts) {
    return postDistDFeVia(httpsPostMtls, { endpoint: opts.endpoint || DISTDFE_URL_PROD, ...opts });
}

module.exports = { unwrapDocZip, buildDistDFeIntSoap, parseRetDistDFe, postDistDFe, postDistDFeVia };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test worker/test/nfe.test.mjs`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add worker/lib/nfe.js worker/test/nfe.test.mjs
git commit -m "feat(nfe): postDistDFe (mTLS via https.request) injetável p/ teste"
```

---

### Task 5: `processChave` + mapa cStat — baixa uma NFe e mapeia resultado

**Files:**
- Modify: `worker/lib/nfe.js`
- Test: `worker/test/nfe.test.mjs`

**Interfaces:**
- Consumes: `buildDistDFeIntSoap`, `parseRetDistDFe`, um poster injetável.
- Produces: `fetchNfeXml({ chave, cnpj, cufAutor, tpAmb, pfx, passphrase, endpoint, poster }) -> Promise<string>` — retorna o XML `procNFe` ou lança `makeErr(kind, msg)` com kind ∈ {`notfound` (137/sem doc), `consumo` (656), `cstat` (outros), `mismatch`}. Valida que o XML retornado contém a chave pedida.

- [ ] **Step 1: Write the failing test**

```javascript
import { fetchNfeXml } from '../lib/nfe.js';

const CH = '23250312345678000199550010000000011000000017';

test('fetchNfeXml: retorna XML quando doc presente e chave bate', async () => {
    const xml = `<procNFe><protNFe><infProt><chNFe>${CH}</chNFe></infProt></protNFe></procNFe>`;
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const resp = `<retDistDFeInt><cStat>138</cStat><loteDistDFeInt><docZip NSU="1" schema="procNFe">${b64}</docZip></loteDistDFeInt></retDistDFeInt>`;
    const poster = async () => ({ status: 200, text: resp });
    const out = await fetchNfeXml({ chave: CH, cnpj: '12345678000199', cufAutor: '23', tpAmb: 1, pfx: Buffer.from('x'), passphrase: '', poster });
    assert.match(out, new RegExp('<chNFe>' + CH + '</chNFe>'));
});

test('fetchNfeXml: cStat 137 -> kind notfound', async () => {
    const poster = async () => ({ status: 200, text: '<retDistDFeInt><cStat>137</cStat></retDistDFeInt>' });
    await assert.rejects(
        () => fetchNfeXml({ chave: CH, cnpj: '12345678000199', cufAutor: '23', tpAmb: 1, pfx: Buffer.from('x'), passphrase: '', poster }),
        (e) => e.kind === 'notfound'
    );
});

test('fetchNfeXml: cStat 656 -> kind consumo', async () => {
    const poster = async () => ({ status: 200, text: '<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo></retDistDFeInt>' });
    await assert.rejects(
        () => fetchNfeXml({ chave: CH, cnpj: '12345678000199', cufAutor: '23', tpAmb: 1, pfx: Buffer.from('x'), passphrase: '', poster }),
        (e) => e.kind === 'consumo'
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test worker/test/nfe.test.mjs`
Expected: FAIL — `fetchNfeXml is not a function`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// cStat que indicam "documento presente no lote".
function hasDoc(cStat) { return cStat === '138'; } // 138 = documento localizado

async function fetchNfeXml({ chave, cnpj, cufAutor, tpAmb, pfx, passphrase, endpoint, poster }) {
    const soap = buildDistDFeIntSoap({ tpAmb: tpAmb || 1, cufAutor, cnpj, chave });
    const text = await postDistDFeVia(poster || httpsPostMtls, { endpoint: endpoint || DISTDFE_URL_PROD, pfx, passphrase, soap });
    const ret = parseRetDistDFe(text);
    if (ret.cStat === '656') throw makeErr('consumo', 'Consumo indevido (656): ' + (ret.xMotivo || ''));
    if (!ret.docs.length) {
        if (ret.cStat === '137' || ret.cStat === '138') throw makeErr('notfound', 'Sem documento p/ a chave (cStat ' + ret.cStat + ')');
        throw makeErr('cstat', 'cStat ' + ret.cStat + ': ' + (ret.xMotivo || ''));
    }
    // Acha o doc cuja chave bate (o lote pode trazer eventos além da NFe).
    const hit = ret.docs.find((d) => d.xml.indexOf(chave) !== -1) || ret.docs[0];
    const innerM = hit.xml.match(/Id="NFe(\d{44})"/) || hit.xml.match(/<chNFe>(\d{44})<\/chNFe>/);
    if (innerM && innerM[1] !== chave) throw makeErr('mismatch', 'XML retornou chave ' + innerM[1] + ', esperado ' + chave);
    return hit.xml;
}

module.exports = { unwrapDocZip, buildDistDFeIntSoap, parseRetDistDFe, postDistDFe, postDistDFeVia, fetchNfeXml };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test worker/test/nfe.test.mjs`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add worker/lib/nfe.js worker/test/nfe.test.mjs
git commit -m "feat(nfe): fetchNfeXml baixa 1 NFe + mapeia cStat (notfound/consumo/mismatch)"
```

---

### Task 6: Job manager — startJob/getStatus/getCompanyDetail/getCompanyZip (espelha nfce.js)

**Files:**
- Modify: `worker/lib/nfe.js`
- Test: `worker/test/nfe-job.test.mjs`

**Interfaces:**
- Consumes: `fetchNfeXml`, `buildZip` de `./zip`.
- Produces (mesma forma do `nfce.js`, para a UI reusar o padrão):
  - `startJob(payload) -> job` — payload `{ concurrency, companies:[{id?, cnpj, pfxB64, senha, cufAutor?, tpAmb?, keys:[...], meta?}] }`.
  - `getStatus(jobId) -> { ok, jobId, done, error, companies:[companyStatus] }`.
  - `getCompanyDetail(jobId, groupId) -> { ok, ...companyStatus, failures, confResults }`.
  - `getCompanyZip(jobId, groupId) -> { buffer, name } | null`.
  - `companyStatus` idêntico ao do NFCe: `{ id, cnpj, nome, total, downloaded, errors, phase, aborted, zipReady, zipName, conf }`.
- Diferenças vs `nfce.js`: sem token/taxid; cada empresa carrega `pfx` (Buffer, de `pfxB64`) + `senha` + `cufAutor` (fallback = cUF da 1ª chave) + `tpAmb` (default 1). Filtra chaves para **modelo 55** apenas. ZIP nomeado `NFe <MM-YYYY>_<nome|CNPJ>.zip`. Ao finalizar o job, **zera `pfx` e `senha`** de cada empresa (`comp.pfx = null; comp.senha = '';`).
- Concorrência default **conservadora** = `2` (SEFAZ limita consumo por CNPJ; ajustar após Task 0). Reusa round-robin/retry no estilo `nfce.js`. Em erro `kind==='consumo'`, aborta só a empresa (como `auth` no NFCe) com backoff.

- [ ] **Step 1: Write the failing test** (usa poster injetável via env de teste — o job usa `fetchNfeXml` com poster real; para testar sem rede, o job aceita `payload._poster` só quando `process.env.NFE_TEST_POSTER` estiver setado; documentar que é hook de teste)

```javascript
// worker/test/nfe-job.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { startJob, getStatus, getCompanyZip } from '../lib/nfe.js';

const CH = '23250312345678000199550010000000011000000017'; // modelo 55
const CH_NFCE = '23250312345678000199650010000000011000000015'; // modelo 65 -> deve ser ignorada

function docResp(chave) {
    const xml = `<procNFe><protNFe><infProt><chNFe>${chave}</chNFe></infProt></protNFe></procNFe>`;
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    return `<retDistDFeInt><cStat>138</cStat><loteDistDFeInt><docZip NSU="1" schema="procNFe">${b64}</docZip></loteDistDFeInt></retDistDFeInt>`;
}

test('startJob: baixa NFe (55), ignora NFCe (65), gera ZIP e descarta pfx', async () => {
    const job = startJob({
        concurrency: 1,
        _poster: async () => ({ status: 200, text: docResp(CH) }),
        companies: [{
            cnpj: '12345678000199', cufAutor: '23', tpAmb: 1,
            pfxB64: Buffer.from('fakepfx').toString('base64'), senha: 'pw',
            keys: [CH, CH_NFCE],
        }],
    });
    // espera o job terminar
    for (let i = 0; i < 50 && !getStatus(job.id).done; i++) await new Promise((r) => setTimeout(r, 20));
    const st = getStatus(job.id);
    assert.strictEqual(st.done, true);
    const c = st.companies[0];
    assert.strictEqual(c.total, 1);       // só a chave modelo 55
    assert.strictEqual(c.downloaded, 1);
    assert.ok(c.zipReady);
    // pfx descartado
    const internal = job.companies.get(c.id);
    assert.strictEqual(internal.pfx, null);
    assert.strictEqual(internal.senha, '');
    // ZIP existe
    const z = getCompanyZip(job.id, c.id);
    assert.ok(z && z.buffer.length > 0);
    assert.match(z.name, /^NFe .*\.zip$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test worker/test/nfe-job.test.mjs`
Expected: FAIL — export ausente / `startJob is not a function`.

- [ ] **Step 3: Write minimal implementation**

Portar o esqueleto de `nfce.js` (linhas 152–325: `startJob`, `nextJob`, `processChave`, `maybeFinalizeCompany`, `runJob`, `companyStatus`, `getStatus`, `getCompanyDetail`, `getCompanyZip`) com estas mudanças exatas:

- helpers `cleanDigits`, `sanitizeFileName`, `delay`, `backoff`, `monthYearFromKey`, `yyyymmFromKey`, `ymFromKey` — copiar de `nfce.js` (idênticos).
- `startJob`: para cada empresa, exigir `pfxB64` + `keys`. Filtrar chaves: `key.length === 44 && key.substring(20,22) === '55'`. Construir `pfx = Buffer.from(pfxB64, 'base64')`, `senha = String(c.senha||'')`, `cufAutor = cleanDigits(c.cufAutor) || (keys[0] ? keys[0].substring(0,2) : '')`, `tpAmb = c.tpAmb || 1`. Guardar `poster = payload._poster || null`. Sem token/taxid. `id` do grupo = `c.id || (cnpj + '-' + yyyymmFromKey(keys[0]))`.
- estado da empresa: trocar `{token, taxid}` por `{pfx, senha, cufAutor, tpAmb, poster}`. Manter `pending`, `downloaded`, `errors`, `failures`, `phase`, `aborted`, `abortReason`, `xmls`, `zipBuffer`, `zipName`, `meta`, `conf*`.
- `processChave(comp, chave)`: chamar `const xml = await fetchNfeXml({ chave, cnpj: comp.cnpj, cufAutor: comp.cufAutor, tpAmb: comp.tpAmb, pfx: comp.pfx, passphrase: comp.senha, poster: comp.poster });` (poster real quando `poster` é null). Reusar conferência `conferirXml`/`tryResolveName` (copiar de `nfce.js`, iguais). Em `catch`, no `err.kind === 'consumo'` abortar só a empresa (espelhar o bloco `auth` do NFCe).
- `maybeFinalizeCompany`: idêntico, mas `zipName = 'NFe ' + monthLabel + '_' + sanitizeFileName(nome || ('CNPJ ' + cnpj)) + '.zip'`.
- `runJob`: ao final, além de `maybeFinalizeCompany`, **descartar credenciais**: `job.companies.forEach((c) => { c.pfx = null; c.senha = ''; c.poster = null; });`.
- `DEFAULT_CONCURRENCY = 2`.
- exportar tudo que já existia + `startJob, getStatus, getCompanyDetail, getCompanyZip, jobs`.

(Reproduzir o corpo completo portado seguindo `worker/lib/nfce.js:152-325` com as substituições acima. Não deixar TODO — copiar e adaptar linha a linha.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test worker/test/nfe-job.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run all worker tests**

Run: `node --test worker/test/`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add worker/lib/nfe.js worker/test/nfe-job.test.mjs
git commit -m "feat(nfe): job manager espelhando nfce.js (filtro modelo 55, descarte de pfx)"
```

---

### Task 7: Rotas `/nfe/*` no server.js

**Files:**
- Modify: `worker/server.js` (require no topo; bloco de rotas após o de NFCe ~linha 156; log em `listen` ~linha 211; `VERSION`)

**Interfaces:**
- Consumes: `nfe.startJob/getStatus/getCompanyDetail/getCompanyZip`.
- Produces: `POST /nfe/start`, `GET /nfe/status/{jobId}`, `GET /nfe/detail/{jobId}/{groupId}`, `GET /nfe/zip/{jobId}/{groupId}` — espelham os handlers `/nfce/*` (server.js:119-156).

- [ ] **Step 1: Write the failing test** (teste de fumaça HTTP, sem rede SEFAZ — usa `_poster`? Não dá via HTTP. Em vez disso, testar `/nfe/start` com payload vazio → erro esperado, provando que a rota existe e chama o módulo)

```javascript
// worker/test/nfe-routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

// sobe o server.js numa porta efêmera? server.js usa porta fixa. Em vez disso,
// testar por import não é possível (server.js auto-listen). Estratégia: iniciar o
// processo e bater na 47620. Se a porta estiver ocupada, pular.
function post(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({ host: '127.0.0.1', port: 47620, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
            (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() })); });
        req.on('error', reject); req.write(data); req.end();
    });
}

test('POST /nfe/start com companies vazio responde ok:false com erro', { skip: process.env.WORKER_UP !== '1' }, async () => {
    const r = await post('/nfe/start', { companies: [] });
    assert.strictEqual(r.status, 200);
    const j = JSON.parse(r.body);
    assert.strictEqual(j.ok, false);
    assert.match(j.error, /nenhuma empresa/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: em um terminal `node worker/server.js`; em outro `WORKER_UP=1 node --test worker/test/nfe-routes.test.mjs`
Expected: FAIL — rota `/nfe/start` retorna 404 `not found` (ainda não existe) → o teste falha no `j.ok`/`match`.

- [ ] **Step 3: Write minimal implementation**

No topo: `const nfe = require('./lib/nfe');` (após `const nfce = ...`).

Após o bloco `/nfce/zip/` (server.js:156), colar espelhando (`readBody` com limite alto p/ o pfx base64 — usar `128_000_000`):

```javascript
    // ====================== NFe (XML) ======================
    if (method === 'POST' && path === '/nfe/start') {
        try {
            const raw = await readBody(req, 128_000_000); // pfx base64 + milhares de chaves
            const payload = raw ? JSON.parse(raw) : {};
            const job = nfe.startJob(payload);
            sendJson(res, 200, { ok: !job.error, jobId: job.id, error: job.error || '' });
        } catch (e) {
            sendJson(res, 400, { ok: false, error: (e && e.message) || 'payload inválido' });
        }
        return;
    }
    if (method === 'GET' && path.startsWith('/nfe/status/')) {
        const jobId = decodeURIComponent(path.slice('/nfe/status/'.length));
        const st = nfe.getStatus(jobId);
        if (!st) { sendJson(res, 404, { ok: false, error: 'job não encontrado' }); return; }
        sendJson(res, 200, st);
        return;
    }
    if (method === 'GET' && path.startsWith('/nfe/detail/')) {
        const rest = path.slice('/nfe/detail/'.length).split('/');
        const detail = nfe.getCompanyDetail(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!detail) { sendJson(res, 404, { ok: false, error: 'job/empresa não encontrado' }); return; }
        sendJson(res, 200, detail);
        return;
    }
    if (method === 'GET' && path.startsWith('/nfe/zip/')) {
        const rest = path.slice('/nfe/zip/'.length).split('/');
        const z = nfe.getCompanyZip(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!z) { sendJson(res, 404, { ok: false, error: 'ZIP indisponível (job/empresa não pronto)' }); return; }
        sendZip(res, z.buffer, z.name);
        return;
    }
```

Atualizar `VERSION` → `'0.4.0-nfe'` e adicionar linha de log em `listen` para as rotas `/nfe/*`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node worker/server.js` + `WORKER_UP=1 node --test worker/test/nfe-routes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/server.js worker/test/nfe-routes.test.mjs
git commit -m "feat(nfe): rotas /nfe/start|status|detail|zip no worker"
```

---

### Task 8: Incluir nfe.js no bundle do worker

**Files:**
- Modify: `scripts/bundle-worker.js:30-39` (array `FILES`), `worker/README.md` (tabela de rotas)

**Interfaces:** nenhuma nova; garante que o `.exe`/zip distribuído contém `lib/nfe.js`.

- [ ] **Step 1: Adicionar ao array `FILES`**

```javascript
    ['lib/nfce.js', 'lib/nfce.js'],
    ['lib/nfe.js', 'lib/nfe.js'],   // <-- nova linha
    ['lib/dirbi.js', 'lib/dirbi.js'],
```

- [ ] **Step 2: Regenerar o bundle**

Run: `node scripts/bundle-worker.js`
Expected: `OK: .../download/softtech-worker.zip (N arquivos, ... bytes)` com N incrementado em 1.

- [ ] **Step 3: Atualizar a tabela de rotas em `worker/README.md`** — acrescentar as 4 rotas `/nfe/*` espelhando as `/nfce/*`.

- [ ] **Step 4: Commit**

```bash
git add scripts/bundle-worker.js worker/README.md download/softtech-worker.zip
git commit -m "build(nfe): inclui lib/nfe.js no bundle do worker + doc de rotas"
```

---

### Task 9: UI — página "Baixar NFe" (espelha createBaixarNfcePage com deltas)

**Files:**
- Modify: `assets/js/app.js` (nova função `createBaixarNfePage`, ~ao lado de `createBaixarNfcePage:9079`; entrada de menu ~`1347`; helpers `cnpjFromKey`/`yyyymmFromKey`/`monthYearFromKey` já existem e são reusados)
- Modify: `Dominium.html` (item de menu/nav para a nova aba, espelhando o de NFCe)

**Interfaces:**
- Consome as rotas `/nfe/*`. Reusa `extractToken`? Não — NFe não usa token. Reusa `cnpjFromKey`, `yyyymmFromKey`, `escapeHtml`, `enqueueDownload`, o sistema de anéis (`createCompany`/`updateRing`/`downloadCompanyZip`) e o polling.

**Deltas exatos vs `createBaixarNfcePage` (9079-9820):**
1. **Sem token:** remover `tokenInput`, `globalModeChk`, `extractToken`, `validateJwt`. Substituir por, **por empresa (grupo CNPJ)**, um `<input type="file" accept=".pfx,.p12">` + `<input type="password">` (senha). Renderizar a lista de grupos detectados (CNPJ + nº de chaves) com esses dois campos cada.
2. **Filtro modelo 55:** ao montar grupos a partir dos reports, aceitar só `chave.substring(20,22) === '55'`. (No NFCe implícito era 65.) Se um report só tem 65, o grupo não aparece aqui.
3. **`buildCompanies`:** agrupar por `cnpj + '-' + yyyymmFromKey(chave)`; cada grupo vira `{ id, cnpj, keys, meta }`. **Não** anexar token. `pfxB64`/`senha` vêm dos inputs do grupo no momento do submit (ler arquivo via `FileReader.readAsArrayBuffer` → base64).
4. **Validação pré-submit:** todo grupo precisa de `.pfx` selecionado + senha não vazia, senão bloquear e destacar o grupo faltante. (Não enviar grupo sem cert.)
5. **`launchJob`:** POST `/nfe/start` com `{ concurrency: 2, companies:[{id,cnpj,pfxB64,senha,keys,meta}] }`. Resto (anéis, polling, download do ZIP) idêntico, trocando `/nfce/` por `/nfe/` nas 3 URLs (`start`, `status`, `zip`).
6. **Segurança na UI:** nunca logar `pfxB64`/senha; limpar os campos de senha (`value=''`) após o submit.
7. **Fallback browser ausente:** NFe **não tem** fallback no navegador (mTLS + SOAP não roda no browser por CORS/cert). Se o worker não for detectado (`detectWorker()` false), mostrar instrução para baixar/rodar o worker (reusar a mensagem que o NFCe já usa quando cai no fallback, mas aqui **sem** processar no browser).

- [ ] **Step 1:** Localizar a definição de menu/rota que chama `createBaixarNfcePage(mainContent)` (app.js:1347) e o item correspondente em `Dominium.html`. Adicionar item "Baixar NFe" que chama `createBaixarNfePage(mainContent)`.

- [ ] **Step 2:** Implementar `createBaixarNfePage(mainContent)` aplicando os deltas 1–7 acima sobre a estrutura de `createBaixarNfcePage`. Reusar todos os helpers de anel/polling/download já presentes no escopo do módulo (não duplicar — extrair para função compartilhada se estiverem aninhados dentro de `createBaixarNfcePage`; nesse caso, mover os helpers reutilizáveis para o escopo do arquivo antes de reusar).

- [ ] **Step 3: Verificação visual manual** (não há harness de UI). Subir o preview e o worker:
  - `node worker/server.js` (deixar aberto)
  - abrir o app (preview), ir na aba "Baixar NFe", carregar um report com chaves modelo 55, conferir que os grupos por CNPJ aparecem com campos `.pfx`+senha.
  - Sem cert real não dá para baixar de verdade; validar até o POST `/nfe/start` retornar `jobId` (worker tentará SEFAZ e marcará erro por chave — esperado sem cert válido). O objetivo do step é validar UI + integração de rota, não o download real.

- [ ] **Step 4: Commit**

```bash
git add assets/js/app.js Dominium.html
git commit -m "feat(nfe): pagina Baixar NFe (upload .pfx+senha por empresa, rotas /nfe)"
```

---

### Task 10: Teste E2E real (manual, com certificado A1 verdadeiro) — validação de aceite

**Files:** nenhum (validação).

Só o Josué pode rodar (precisa de `.pfx` real + senha + chaves reais de entradas onde a empresa é destinatária).

- [ ] Subir o worker: `node worker/server.js`.
- [ ] No app, aba "Baixar NFe": carregar report com chaves modelo 55 de 1 empresa; anexar `.pfx` + senha dessa empresa.
- [ ] Disparar. Acompanhar o anel/polling.
- [ ] **Aceite:** ZIP `NFe <MM-YYYY>_<empresa>.zip` baixado, contendo os XMLs `procNFe` das chaves onde a empresa é parte interessada. Chaves fora do interesse aparecem em "não encontradas" (cStat 137/138) no detail — comportamento esperado, não bug.
- [ ] Repetir com uma 2ª empresa (outro `.pfx`) no mesmo job para validar isolamento por empresa (cert de uma não vaza para outra).
- [ ] Confirmar no worker que não há `.pfx`/senha em disco nem em log.

---

## Self-Review

**Spec coverage:**
- Fluxo report→chaves→CNPJ (filtro modelo 55) → Task 6 (worker) + Task 9 (browser). ✓
- UI upload .pfx+senha por empresa → Task 9. ✓
- Worker lib/nfe.js (mTLS, SOAP consChNFe, gunzip docZip, ZIP) → Tasks 1–6. ✓
- Rotas /nfe/* → Task 7. ✓
- Segurança (loopback, memória, sem disco/log, descarte) → Global Constraints + Task 6 (descarte) + Task 9 (UI). ✓
- Mapa cStat (100/150, 137/138, 656, cert/senha) → Task 5. ✓
- Testes (mock endpoint, carga pfx, filtro modelo, isolamento) → Tasks 1–6. ✓
- A-verificar (endpoint, mTLS, limites) → Task 0. ✓
- Bundle/distribuição → Task 8. ✓

**Placeholder scan:** Task 6 Step 3 descreve o port de `nfce.js:152-325` em vez de reproduzir ~170 linhas literais — mitigado com lista exata de substituições e âncora de linhas. Task 9 idem (mirror com deltas enumerados) — justificado por DRY (não reproduzir 740 linhas de UI). Demais steps têm código concreto.

**Type consistency:** `companyStatus` e as assinaturas `getStatus/getCompanyDetail/getCompanyZip/startJob` batem com o consumo do browser (`applyStatus` usa `cs.id||cs.cnpj`, `zipReady`, `zipName`, `phase`). `fetchNfeXml`/`postDistDFeVia`/`parseRetDistDFe`/`buildDistDFeIntSoap`/`unwrapDocZip` consistentes entre tasks. ✓

**Nota de honestidade:** endpoint SEFAZ, `versao` do schema e `cUFAutor` são hipóteses até a Task 0 confirmar. Nenhum valor chutado entra em produção sem essa confirmação.

---

## Resultado do E2E real — 2026-08-03 (Task 10 executada)

Rodado com certificado A1 de produção da A&R (CNPJ 19154453000109) e dois relatórios
reais de junho/2026 do portal da SEFAZ-CE: 50 chaves de saídas (empresa emitente) e
346 de entradas (empresa destinatária). Tudo abaixo é medição, não suposição.

### Confirmado

- **Endpoint e contrato:** `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`
  com `distDFeInt versao="1.01"` responde. Entradas voltam `cStat 138`, `schema=procNFe_v4.00.xsd`,
  XML `nfeProc` completo (~16 KB), sem manifestação do destinatário.
- **Pipeline inteiro:** mTLS → SOAP → `docZip` base64+gzip → XML → ZIP por empresa →
  download pelo worker. 15 XMLs válidos, nome do arquivo = chave, `<dest>` = a empresa.

### Refutado (o plano assumia errado)

1. **`--openssl-legacy-provider` é obrigatório.** O OpenSSL 3 recusa o PKCS#12 das ACs
   brasileiras (`Unsupported PKCS12 PFX data`) mesmo com a senha certa. Sem isso, nenhum
   certificado A1 carrega. O worker passou a se re-executar com a flag (`server.js`).
2. **Relatório de saídas não serve.** Toda chave emitida pela própria empresa volta
   `cStat 641 — NF-e indisponivel para o emitente`. O webservice distribui a terceiros
   interessados, não ao emitente. O caso de uso é só entradas.
3. **O CNPJ interessado não está na chave.** Em entradas, `chave[6:20]` é o CNPJ do
   fornecedor: 346 chaves deram 102 CNPJs distintos. A UI agrupava por aí e pediria 102
   certificados. Agora a empresa é escolhida por relatório.
4. **Teto de 20 consultas/hora por CNPJ** (`cStat 656`, texto da própria SEFAZ). É
   absoluto, não de frequência: espaçar não compra consulta. `consChNFe` gasta uma por
   nota, então lote grande é inviável por esta rota. Ver P2 em PENDENCIAS.md (`distNSU`).
5. **`cUFAutor` é validado só contra o XSD.** `23` e `35` devolveram o mesmo documento;
   `99` deu rejeição 215. Derivar da chave é seguro — não precisa de campo na tela.

### Fora do plano, corrigido no caminho

- `resNFe` (resumo) era aceito como se fosse a NF-e: viraria um ZIP de arquivos inúteis
  com nome de XML. Agora só `procNFe` entra; resumo vira falha explicada.
- O ZIP era batizado com o `<emit>` do primeiro XML — em entradas, o nome do fornecedor.
  Agora o nome sai da parte cujo CNPJ é o do certificado.
