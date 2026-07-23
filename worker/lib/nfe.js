/**
 * Fluxo NFe (modelo 55) no worker — baixa XML via webservice oficial
 * `NFeDistribuicaoDFe` / `consChNFe` do Ambiente Nacional, autenticado por
 * certificado A1 (TLS mútuo). Espelha `lib/nfce.js`, trocando token JWT por
 * certificado e REST GET por SOAP.
 *
 * Contrato SEFAZ (confirmado 2026-07-22, ver docs/superpowers/plans/):
 *   - schema distDFeInt versao="1.01" (NÃO 1.35)
 *   - namespace distDFeInt: http://www.portalfiscal.inf.br/nfe
 *   - método SOAP 1.2: nfeDistDFeInteresse (namespace WSDL abaixo)
 *   - docZip = base64(gzip(XML))
 *   - cStat: 138 doc localizado · 137 nenhum doc · 656 consumo indevido
 *   - endpoint produção www1 é padrão AN (validar no 1º teste real).
 *
 * Segurança: pfx/senha só em memória; nunca em disco/log; descartados ao fim
 * do job (ver Task 6). Worker é loopback-only (server.js).
 */
'use strict';

const zlib = require('zlib');
const https = require('https');
const { URL } = require('url');
const { buildZip } = require('./zip');

// ---------------------------------------------------------------- contrato ----
const WSDL_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const DISTDFE_VERSAO = '1.01'; // confirmado: schema distDFeInt_v1.01.xsd

// Endpoint AN. Override por env (NFE_DISTDFE_URL) só p/ teste local com mock.
// Produção www1 = padrão comunidade (ACBr/sped-nfe/DFe.NET) — validar no 1º teste real.
const DISTDFE_URL_PROD = process.env.NFE_DISTDFE_URL ||
    'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

// ---------------------------------------------------------------- helpers ----
function makeErr(kind, message) { const e = new Error(message); e.kind = kind; return e; }

// docZip = conteúdo base64 de um gzip do XML (procNFe/resNFe/procEventoNFe).
function unwrapDocZip(b64) {
    const buf = Buffer.from(String(b64 || '').replace(/\s+/g, ''), 'base64');
    if (!buf.length) throw new Error('docZip vazio');
    return zlib.gunzipSync(buf).toString('utf8');
}

// ------------------------------------------------------------ montar SOAP ----
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

// ------------------------------------------------------------ parse resposta ----
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

// ------------------------------------------------------------ POST mTLS ----
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

// ------------------------------------------------------------ baixar 1 NFe ----
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

// ============================================================ job manager ====
// Espelha lib/nfce.js:152-325. Troca token/taxid por pfx/senha/cufAutor/tpAmb,
// filtra chaves p/ modelo 55, e descarta credenciais ao fim do job.
const DEFAULT_CONCURRENCY = 2; // SEFAZ limita consumo por CNPJ — conservador
const jobs = new Map();
let jobSeq = 0;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => 500 * Math.pow(2, attempt);
const cleanDigits = (s) => String(s || '').replace(/\D/g, '');
const sanitizeFileName = (s) => String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'EMPRESA';

function ymFromKey(chave) {
    const aa = String(chave).substring(2, 4);
    const mmNum = parseInt(String(chave).substring(4, 6), 10);
    const mm = (mmNum >= 1 && mmNum <= 12) ? String(mmNum).padStart(2, '0') : '00';
    return { mm, yyyy: '20' + aa };
}
function monthYearFromKey(chave) { const { mm, yyyy } = ymFromKey(chave); return mm + '-' + yyyy; }
function yyyymmFromKey(chave) { const { mm, yyyy } = ymFromKey(chave); return yyyy + mm; }

// ------- conferência (porta de nfce.js; divergência NÃO é erro de download) --
function normalizeDate(s) {
    const t = String(s || '').trim();
    let m = t.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = t.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (m) return m[3] + '-' + m[2] + '-' + m[1];
    m = t.match(/(\d{2})-(\d{2})-(\d{4})/); if (m) return m[3] + '-' + m[2] + '-' + m[1];
    return t.slice(0, 10);
}
function parseBrlValue(s) {
    let t = String(s || '').replace(/[^\d.,-]/g, '');
    if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
    return parseFloat(t);
}
function conferirXml(xml, exp) {
    const diffs = [];
    if (exp.nNF) {
        const mN = xml.match(/<nNF>(\d+)<\/nNF>/);
        const e = parseInt(String(exp.nNF).replace(/\D/g, ''), 10);
        const g = mN ? parseInt(mN[1], 10) : NaN;
        if (!Number.isNaN(e) && (Number.isNaN(g) || e !== g)) diffs.push({ campo: 'nNF', esperado: String(exp.nNF), obtido: mN ? mN[1] : '(ausente)' });
    }
    if (exp.dhEmi) {
        const mD = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/);
        const xmlD = mD ? normalizeDate(mD[1].slice(0, 10)) : '';
        if (!xmlD || xmlD !== normalizeDate(exp.dhEmi)) diffs.push({ campo: 'data', esperado: exp.dhEmi, obtido: xmlD || '(ausente)' });
    }
    if (exp.vNF) {
        const mV = xml.match(/<vNF>([\d.]+)<\/vNF>/);
        const e = parseBrlValue(exp.vNF);
        const g = mV ? parseFloat(mV[1]) : NaN;
        if (Number.isNaN(g) || Number.isNaN(e) || Math.abs(e - g) > 0.01) diffs.push({ campo: 'valor', esperado: exp.vNF, obtido: mV ? mV[1] : '(ausente)' });
    }
    return diffs;
}
function tryResolveName(comp, xml) {
    if (comp.nomeResolved) return;
    const m = xml.match(/<emit>[\s\S]*?<xNome>([^<]+)<\/xNome>/) || xml.match(/<emit>[\s\S]*?<xFant>([^<]+)<\/xFant>/);
    if (m && m[1]) { comp.nome = m[1].trim(); comp.nomeResolved = true; }
}

// ------------------------------------------------------------ lifecycle ----
function startJob(payload) {
    const concurrency = Math.max(1, Math.min(20, parseInt(payload.concurrency, 10) || DEFAULT_CONCURRENCY));
    const incoming = Array.isArray(payload.companies) ? payload.companies : [];
    const poster = payload._poster || null; // hook de teste; produção usa mTLS real
    const id = 'nfe-' + (++jobSeq);
    const companies = new Map();

    for (const c of incoming) {
        const pfxB64 = String(c.pfxB64 || '').trim();
        if (!pfxB64) continue; // sem certificado não processa
        const keys = [];
        const seen = new Set();
        for (const k of (c.keys || [])) {
            const key = cleanDigits(k);
            // só NFe modelo 55 (posições 20-21); 65 = NFCe, fora deste fluxo
            if (key.length === 44 && key.substring(20, 22) === '55' && !seen.has(key)) { seen.add(key); keys.push(key); }
        }
        if (!keys.length) continue;
        let pfx;
        try { pfx = Buffer.from(pfxB64, 'base64'); } catch { continue; }
        if (!pfx || !pfx.length) continue;
        const cnpj = cleanDigits(c.cnpj) || (keys[0] ? keys[0].substring(6, 20) : '');
        const gid = String(c.id || '').trim() || (cnpj + '-' + (keys[0] ? yyyymmFromKey(keys[0]) : '000000'));
        const cufAutor = cleanDigits(c.cufAutor) || (keys[0] ? keys[0].substring(0, 2) : '');
        const tpAmb = parseInt(c.tpAmb, 10) || 1;
        const meta = new Map();
        if (c.meta && typeof c.meta === 'object') {
            for (const k of Object.keys(c.meta)) { const kk = cleanDigits(k); if (kk.length === 44) meta.set(kk, c.meta[k]); }
        }
        companies.set(gid, {
            id: gid, cnpj, pfx, senha: String(c.senha || ''), cufAutor, tpAmb, poster,
            nome: '', nomeResolved: false,
            monthLabel: keys[0] ? monthYearFromKey(keys[0]) : '',
            keys, pending: keys.slice(), total: keys.length,
            downloaded: 0, errors: 0, phase: 'download', aborted: false, abortReason: '',
            failures: [], meta, confChecked: 0, confOk: 0, confDiverg: 0, confResults: [],
            xmls: [], zipBuffer: null, zipName: '',
        });
    }

    const job = { id, createdAt: 0, concurrency, companies, done: false, rr: 0, error: '' };
    jobs.set(id, job);
    if (!companies.size) { job.done = true; job.error = 'nenhuma empresa com certificado + chaves NFe válidas'; return job; }
    runJob(job).catch((e) => { job.error = (e && e.message) || 'erro interno'; job.done = true; });
    return job;
}

function nextJob(job) {
    const ativos = [];
    job.companies.forEach((c) => { if (c.pending.length && !c.aborted) ativos.push(c); });
    if (!ativos.length) return null;
    const comp = ativos[job.rr % ativos.length];
    job.rr++;
    return { comp, chave: comp.pending.shift() };
}

async function processChave(comp, chave) {
    try {
        const xml = await fetchNfeXml({
            chave, cnpj: comp.cnpj, cufAutor: comp.cufAutor, tpAmb: comp.tpAmb,
            pfx: comp.pfx, passphrase: comp.senha, poster: comp.poster,
        });
        comp.xmls.push({ name: chave + '.xml', data: xml });
        comp.downloaded++;
        tryResolveName(comp, xml);
        if (comp.meta.has(chave)) {
            comp.confChecked++;
            const diffs = conferirXml(xml, comp.meta.get(chave));
            if (diffs.length) { comp.confDiverg++; comp.confResults.push({ chave, diffs }); }
            else comp.confOk++;
        }
    } catch (err) {
        comp.errors++;
        comp.failures.push({ chave, motivo: (err && err.message) || 'erro' });
        // Consumo indevido = SEFAZ bloqueou esta empresa: aborta SÓ ela (não o job).
        if (err && err.kind === 'consumo' && !comp.aborted) {
            comp.aborted = true;
            comp.abortReason = err.message;
            while (comp.pending.length) {
                const k = comp.pending.shift();
                comp.errors++;
                comp.failures.push({ chave: k, motivo: 'não tentado (consumo indevido: ' + err.message + ')' });
            }
        }
    }
    maybeFinalizeCompany(comp);
}

function maybeFinalizeCompany(comp) {
    if (comp.phase !== 'download') return;
    if (comp.pending.length) return;
    if (comp.downloaded + comp.errors < comp.total) return;
    if (comp.downloaded === 0) { comp.phase = 'done'; return; }
    comp.phase = 'zip';
    try {
        comp.zipBuffer = buildZip(comp.xmls);
        comp.zipName = 'NFe ' + comp.monthLabel + '_' + sanitizeFileName(comp.nome || ('CNPJ ' + comp.cnpj)) + '.zip';
        comp.xmls = [];
        comp.phase = 'done';
    } catch (e) {
        comp.phase = 'done';
        comp.failures.push({ chave: '(zip)', motivo: 'falha ao gerar ZIP: ' + ((e && e.message) || e) });
    }
}

async function runJob(job) {
    const totalKeys = Array.from(job.companies.values()).reduce((a, c) => a + c.total, 0);
    const n = Math.max(1, Math.min(job.concurrency, totalKeys));
    const runners = [];
    for (let i = 0; i < n; i++) {
        runners.push((async () => {
            for (;;) {
                const j = nextJob(job);
                if (!j) return;
                await processChave(j.comp, j.chave);
            }
        })());
    }
    await Promise.all(runners);
    job.companies.forEach((c) => maybeFinalizeCompany(c));
    // Segurança: descarta credenciais da memória ao fim do job.
    job.companies.forEach((c) => { c.pfx = null; c.senha = ''; c.poster = null; });
    job.done = true;
}

// ------------------------------------------------------------ leitura/API ----
function companyStatus(c) {
    return {
        id: c.id, cnpj: c.cnpj, nome: c.nome || ('CNPJ ' + c.cnpj),
        total: c.total, downloaded: c.downloaded, errors: c.errors,
        phase: c.phase, aborted: c.aborted, zipReady: !!c.zipBuffer, zipName: c.zipName,
        conf: { checked: c.confChecked, ok: c.confOk, diverg: c.confDiverg },
    };
}
function getStatus(jobId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    const companies = [];
    job.companies.forEach((c) => companies.push(companyStatus(c)));
    return { ok: true, jobId: job.id, done: job.done, error: job.error || '', companies };
}
function getCompanyDetail(jobId, groupId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    const c = job.companies.get(String(groupId || '')) || job.companies.get(cleanDigits(groupId));
    if (!c) return null;
    return { ok: true, ...companyStatus(c), failures: c.failures, confResults: c.confResults };
}
function getCompanyZip(jobId, groupId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    const c = job.companies.get(String(groupId || '')) || job.companies.get(cleanDigits(groupId));
    if (!c || !c.zipBuffer) return null;
    return { buffer: c.zipBuffer, name: c.zipName };
}

module.exports = {
    unwrapDocZip, buildDistDFeIntSoap, parseRetDistDFe, postDistDFe, postDistDFeVia, fetchNfeXml,
    startJob, getStatus, getCompanyDetail, getCompanyZip, jobs,
    DISTDFE_URL_PROD, DISTDFE_VERSAO,
};
