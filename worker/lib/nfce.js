/**
 * Fluxo NFCe no worker — porta a orquestração que vivia no browser
 * (`app.js` > createBaixarNfcePage) para o lado Node, onde NÃO há CORS.
 *
 * O browser continua só lendo os relatórios (parsing leve de xls/csv → chaves),
 * agrupando por empresa e disparando este worker; aqui rodam os fetches em massa
 * à SEFAZ-CE e a montagem do ZIP por empresa. Progresso é exposto por polling
 * (GET /nfce/status). A UI baixa cada ZIP por GET /nfce/zip/{jobId}/{cnpj}.
 *
 * Token FLEXÍVEL: o worker não conhece "modo". Cada empresa traz seu próprio
 * token + taxid. No modo "1 token global" a UI replica o mesmo token/taxid em
 * todas as empresas; no modo "por empresa" cada uma traz o seu. O worker só
 * processa empresas com (token, taxid, keys).
 *
 * PREMISSA AINDA NÃO VALIDADA (precisa token vivo + 2 CNPJs reais): um único
 * JWT serve N CNPJs distintos. Hoje taxid = CNPJ do token (sub do JWT).
 */
'use strict';

const { buildZip } = require('./zip');
// Explícito em vez do global: `URL` só virou global no Node 10, e este módulo tem que
// sobreviver em Node antigo (ver o bloco "SEFAZ fetch" e lib/ambiente.js).
const { URL } = require('url');

// URL da SEFAZ-CE. Override por env (SEFAZ_BASE) só p/ teste local com mock —
// em produção o default real é usado.
const API_BASE = process.env.SEFAZ_BASE || 'https://cfe.sefaz.ce.gov.br:8443/portalcfews/nfce';
const DEFAULT_CONCURRENCY = 10;
const MAX_RETRIES = 3;

const jobs = new Map();   // jobId -> job

// ID aleatório, não sequencial: com `nfce-1` qualquer um adivinha o job da sessão
// e baixa o ZIP sem nunca ter disparado nada.
const newJobId = () => require('./access').newJobId('nfce');

// ---------------------------------------------------------------- helpers ----
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => 500 * Math.pow(2, attempt); // 500, 1000, 2000ms
const cleanDigits = (s) => String(s || '').replace(/\D/g, '');
const sanitizeFileName = (s) => String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'EMPRESA';

function makeErr(kind, message) { const e = new Error(message); e.kind = kind; return e; }

// AAMM nas pos 3-6 da chave. Rótulo numérico "MM-YYYY" (ex.: "05-2026") p/ o ZIP;
// "YYYYMM" (ex.: "202605") p/ id de grupo (separa meses da mesma empresa).
function ymFromKey(chave) {
    const aa = String(chave).substring(2, 4);
    const mmNum = parseInt(String(chave).substring(4, 6), 10);
    const mm = (mmNum >= 1 && mmNum <= 12) ? String(mmNum).padStart(2, '0') : '00';
    return { mm, yyyy: '20' + aa };
}
function monthYearFromKey(chave) {
    const { mm, yyyy } = ymFromKey(chave);
    return mm + '-' + yyyy;
}
function yyyymmFromKey(chave) {
    const { mm, yyyy } = ymFromKey(chave);
    return yyyy + mm;
}

// Decodifica o CNPJ (sub) de um JWT sem validar assinatura — só p/ default de taxid.
function cnpjFromToken(token) {
    try {
        const parts = String(token || '').split('.');
        if (parts.length < 2) return '';
        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
        return /^\d{14}$/.test(String(payload.sub || '')) ? String(payload.sub) : '';
    } catch { return ''; }
}

// ------------------------------------------------------------ SEFAZ fetch ----
// Transporte: `lib/http.js` (https.request nativo), NÃO o `fetch` global.
//
// Duas razões, ambas medidas:
//
// 1. TIMEOUT. O `fetch` do Node não tem timeout padrão. Requisição que abre e nunca
//    responde pendura a promise para sempre, o slot do pool nunca volta e
//    `maybeFinalizeCompany` nunca satisfaz `downloaded + errors === total` — job eterno,
//    ZIP nunca sai. Medido em 2026-09-10: 3332 de 3339 baixadas, 7 penduradas.
//
// 2. PORTABILIDADE. Na máquina da EMPRESA (Node 32-bit pré-instalado, sem npm install,
//    sem admin) este download pulava de 0% para 100% com TODAS as notas em erro,
//    instantaneamente. A causa do *instantâneo* não era o `fetch` ausente — esse lançava
//    dentro do try e caía no retry, ~3,5 s por chave (≈19 min para 3339). Era o
//    `new AbortController()`, que ficava FORA do try: sem retry, sem backoff, sem tocar
//    a rede. Node < 15 não o tem. `req.setTimeout` faz o mesmo trabalho desde sempre.
//
// Nada aqui pode depender de global introduzido depois do Node 12 — ver lib/ambiente.js,
// que afere isso no boot em vez de supor.
const { pedir } = require('./http');

const REQ_TIMEOUT_MS = 45000;
const MAX_REDIRECTS = 3;

async function fetchWithRetry(url, options, attempt = 0, saltos = 0) {
    try {
        const res = await pedir(url, {
            method: (options && options.method) || 'GET',
            headers: (options && options.headers) || {},
            body: (options && options.body) || null,
            timeoutMs: REQ_TIMEOUT_MS,
        });

        if (res.status === 401 || res.status === 403) throw makeErr('auth', 'Token expirado/inválido (HTTP ' + res.status + ')');
        if (res.status === 404) throw makeErr('notfound', 'Cupom não encontrado (404)');

        // `fetch` seguia redirect sozinho; `https.request` não. Seguir SÓ na mesma origem:
        // os headers carregam o JWT, e repeti-los num host que o servidor escolheu é
        // entregar o token a terceiro. Redirect para fora vira erro que DIZ o destino —
        // em ASP/Java de fisco, um 302 costuma ser sessão morta disfarçada de sucesso.
        if (res.status >= 300 && res.status < 400) {
            const destino = res.header('location');
            if (!destino) throw makeErr('http', 'HTTP ' + res.status + ' sem Location');
            if (saltos >= MAX_REDIRECTS) throw makeErr('http', 'redirect em excesso (' + MAX_REDIRECTS + ') a partir de ' + url);
            const abs = new URL(destino, url);
            if (abs.origin !== new URL(url).origin) {
                throw makeErr('http', 'redirect para outra origem, recusado (token não é reenviado): ' + abs.origin);
            }
            return fetchWithRetry(abs.toString(), options, attempt, saltos + 1);
        }

        if (!res.ok) {
            if (attempt < MAX_RETRIES) { await delay(backoff(attempt)); return fetchWithRetry(url, options, attempt + 1, saltos); }
            throw makeErr('http', 'HTTP ' + res.status);
        }
        return res;
    } catch (err) {
        if (err && err.kind) {
            if (err.kind === 'http' && attempt < MAX_RETRIES) { await delay(backoff(attempt)); return fetchWithRetry(url, options, attempt + 1, saltos); }
            throw err;
        }
        if (attempt < MAX_RETRIES) { await delay(backoff(attempt)); return fetchWithRetry(url, options, attempt + 1, saltos); }
        // A mensagem de `lib/http.js` já traz code/cause/host. Repassar inteira: motivo que
        // não diz o que houve custou quatro rodadas neste projeto.
        throw makeErr('network', (err && err.message) || 'Falha de rede');
    }
}

function jsonHeaders(token, taxid) {
    return { 'x-authentication-token': token, 'x-authentication-taxid': taxid, 'accept': 'application/json' };
}
function xmlHeaders(token, taxid) {
    return { 'x-authentication-token': token, 'x-authentication-taxid': taxid, 'accept': '*/*' };
}

// A API devolveu HTTP 200 mas sem o campo esperado -- "Resposta sem idNfe" em 100%
// das chaves (medido 2026-09-10: auth, rede e taxid todos OK). O parser antigo fixava
// dois caminhos (`data.idNfe` e `data.coupon.idNfe`); qualquer renomeacao ou nivel novo
// quebrava tudo. Procura em profundidade rasa e, se nao achar, o erro DIZ quais campos
// vieram -- a mensagem antiga nao dava nada para diagnosticar.
// ponytail: heuristica por nome de campo; o certo seria a API ter contrato versionado.
function extrairIdNfe(data) {
    const NOMES = ['idnfe', 'id', 'nfeid', 'idnf', 'idnotafiscal'];
    const busca = (o, prof) => {
        if (!o || typeof o !== 'object' || prof > 3) return '';
        for (const k of Object.keys(o)) {
            const v = o[k];
            if (NOMES.indexOf(k.toLowerCase()) !== -1 &&
                (typeof v === 'string' || typeof v === 'number') && String(v).trim()) {
                return String(v).trim();
            }
        }
        for (const k of Object.keys(o)) {
            const r = busca(o[k], prof + 1);
            if (r) return r;
        }
        return '';
    };
    return busca(data, 0);
}

function camposDe(data) {
    if (!data || typeof data !== 'object') return typeof data;
    const ks = Object.keys(data);
    return ks.length ? ks.join(', ') : '(objeto vazio)';
}

async function resolveIdNfe(chave, token, taxid) {
    const url = API_BASE + '/coupons/extract/' + encodeURIComponent(chave);
    const res = await fetchWithRetry(url, { headers: jsonHeaders(token, taxid) });
    const data = await res.json();
    const idNfe = extrairIdNfe(data);
    if (!idNfe) throw makeErr('parse', 'Resposta sem idNfe. Campos recebidos: ' + camposDe(data));
    return idNfe;
}

function xmlUrl(idNfe, chave, token) {
    return API_BASE + '/fiscal-coupons/xml/' + encodeURIComponent(idNfe) +
        '?chaveAcesso=' + encodeURIComponent(chave) + '&apiKey=' + encodeURIComponent(token);
}

async function fetchXml(idNfe, chave, token, taxid) {
    const res = await fetchWithRetry(xmlUrl(idNfe, chave, token), { headers: xmlHeaders(token, taxid) });
    return await res.text();
}

// ----------------------------------------------------------- conferência ----
// Porta conferirXml do client: divergência NÃO é erro de download (o XML já é válido).
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

// ----------------------------------------------------------- job lifecycle ----
function startJob(payload) {
    const concurrency = Math.max(1, Math.min(20, parseInt(payload.concurrency, 10) || DEFAULT_CONCURRENCY));
    const incoming = Array.isArray(payload.companies) ? payload.companies : [];
    const id = newJobId();
    const companies = new Map();

    for (const c of incoming) {
        const token = String(c.token || '').trim();
        if (!token) continue;
        const keys = [];
        const seen = new Set();
        for (const k of (c.keys || [])) {
            const key = cleanDigits(k);
            if (key.length === 44 && !seen.has(key)) { seen.add(key); keys.push(key); }
        }
        if (!keys.length) continue;
        const cnpj = cleanDigits(c.cnpj) || (keys[0] ? keys[0].substring(6, 20) : '');
        // id = identidade do grupo (1 ZIP). A UI manda "<cnpj>-<YYYYMM>"; se faltar,
        // derivamos da 1ª chave. Chaveia o Map por id p/ não colidir meses do mesmo CNPJ.
        const id = String(c.id || '').trim() || (cnpj + '-' + (keys[0] ? yyyymmFromKey(keys[0]) : '000000'));
        const taxid = cleanDigits(c.taxid) || cnpjFromToken(token) || cnpj;
        const meta = new Map();
        if (c.meta && typeof c.meta === 'object') {
            for (const k of Object.keys(c.meta)) { const kk = cleanDigits(k); if (kk.length === 44) meta.set(kk, c.meta[k]); }
        }
        companies.set(id, {
            id, cnpj, token, taxid, nome: '', nomeResolved: false,
            monthLabel: keys[0] ? monthYearFromKey(keys[0]) : '',
            keys, pending: keys.slice(), total: keys.length,
            downloaded: 0, errors: 0, phase: 'download', aborted: false, abortReason: '',
            failures: [], meta, confChecked: 0, confOk: 0, confDiverg: 0, confResults: [],
            xmls: [], zipBuffer: null, zipName: '',
        });
    }

    const job = { id, createdAt: Date.now(), concurrency, companies, done: false, rr: 0, error: '' };
    jobs.set(id, job);
    if (!companies.size) { job.done = true; job.error = 'nenhuma empresa com token + chaves válidas'; return job; }
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

function tryResolveName(comp, xml) {
    if (comp.nomeResolved) return;
    const m = xml.match(/<emit>[\s\S]*?<xNome>([^<]+)<\/xNome>/) || xml.match(/<emit>[\s\S]*?<xFant>([^<]+)<\/xFant>/);
    if (m && m[1]) { comp.nome = m[1].trim(); comp.nomeResolved = true; }
}

async function processChave(comp, chave) {
    try {
        const idNfe = await resolveIdNfe(chave, comp.token, comp.taxid);
        const xml = await fetchXml(idNfe, chave, comp.token, comp.taxid);
        // Salvaguarda: a chave interna do XML tem que bater com a pedida.
        let innerKey = '';
        const mk = xml.match(/Id="NFe(\d{44})"/) || xml.match(/<chNFe>(\d{44})<\/chNFe>/);
        if (mk) innerKey = mk[1];
        if (innerKey && innerKey !== chave) throw makeErr('mismatch', 'XML retornou chave ' + innerKey + ', esperado ' + chave);
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
        if (err && err.kind === 'auth' && !comp.aborted) {
            // Token morto desta empresa: aborta SÓ ela (não o job inteiro).
            comp.aborted = true;
            comp.abortReason = err.message;
            while (comp.pending.length) {
                const k = comp.pending.shift();
                comp.errors++;
                comp.failures.push({ chave: k, motivo: 'não tentado (token abortado: ' + err.message + ')' });
            }
        }
    }
    // Fora do try acima de propos... e por isso protegido aqui: se maybeFinalizeCompany
    // lançar, o runner morre, o Promise.all de runJob rejeita e o job inteiro cai.
    try { maybeFinalizeCompany(comp); }
    catch (e) { comp.failures.push({ chave, motivo: 'falha ao finalizar: ' + ((e && e.message) || e) }); }
}

function maybeFinalizeCompany(comp) {
    if (comp.phase !== 'download') return;
    if (comp.pending.length) return;
    if (comp.downloaded + comp.errors < comp.total) return;
    if (comp.downloaded === 0) { comp.phase = 'done'; return; }
    comp.phase = 'zip';
    // buildZip é síncrono; Node single-thread garante que não há corrida aqui.
    try {
        comp.zipBuffer = buildZip(comp.xmls);
        comp.zipName = 'NFCe ' + comp.monthLabel + '_' + sanitizeFileName(comp.nome || ('CNPJ ' + comp.cnpj)) + '.zip';
        comp.xmls = []; // libera os XMLs crus; o ZIP já os contém
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
                // Um runner que morre reduz a concorrência em silêncio até o job travar.
                try { await processChave(j.comp, j.chave); }
                catch (e) { job.error = job.error || ('runner: ' + ((e && e.message) || e)); }
            }
        })());
    }
    await Promise.all(runners);
    // Garante finalização de qualquer empresa de borda (ex.: 0 chaves baixadas).
    job.companies.forEach((c) => maybeFinalizeCompany(c));
    job.done = true;
}

// ------------------------------------------------------------ leitura/API ----
function companyStatus(c) {
    return {
        id: c.id,
        cnpj: c.cnpj,
        nome: c.nome || ('CNPJ ' + c.cnpj),
        total: c.total,
        downloaded: c.downloaded,
        errors: c.errors,
        phase: c.phase,
        aborted: c.aborted,
        zipReady: !!c.zipBuffer,
        zipName: c.zipName,
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

// Detalhe (failures + divergências) de um grupo — p/ a UI mostrar relatório.
// `groupId` = "<cnpj>-<YYYYMM>" (tem hífen → NÃO passar por cleanDigits).
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

module.exports = { startJob, getStatus, getCompanyDetail, getCompanyZip, jobs };
