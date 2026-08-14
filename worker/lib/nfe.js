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
const { newJobId } = require('./access');

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
/**
 * Erro de carga do certificado A1. O OpenSSL 3 (Node >= 17) tira RC2-40/3DES-SHA1 do
 * provider padrão, e é exatamente isso que quase todo .pfx de AC brasileira usa —
 * então o Node recusa com "Unsupported PKCS12 PFX data" mesmo com a senha certa.
 * Quem resolve é o provider legacy (ver o re-exec em server.js); aqui só traduzimos
 * a mensagem, porque a original manda o usuário procurar erro de senha que não existe.
 * Medido em 2026-08-03 com um A1 real: sem a flag falha 100%, com a flag carrega.
 */
function translatePfxError(e) {
    const msg = (e && e.message) || '';
    if (/PKCS12|pkcs12|mac verify/i.test(msg)) {
        const legacy = /Unsupported PKCS12 PFX data/i.test(msg);
        return makeErr('cert', legacy
            ? 'certificado em formato legado: o worker precisa rodar com o provider legacy do OpenSSL ' +
              '(NODE_OPTIONS=--openssl-legacy-provider). Reinicie o worker por uma versão nova.'
            : 'certificado ou senha inválidos (' + msg + ')');
    }
    return e;
}

// Poster real: https.request com TLS mútuo (pfx). Zero deps.
function httpsPostMtls({ url, headers, body, pfx, passphrase }) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        let req;
        try {
            req = https.request({
                method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
                headers, pfx, passphrase, // TLS client cert
            }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
            });
        } catch (e) {
            reject(translatePfxError(e)); // pfx ruim estoura já na montagem do request
            return;
        }
        req.on('error', (e) => reject(translatePfxError(e)));
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
// Só `procNFe` é a NF-e completa. O mesmo lote pode trazer `resNFe` (resumo, ~10
// campos — devolvido quando falta manifestação do destinatário) e `procEventoNFe`.
// Aceitar qualquer um deles gera um ZIP de arquivos inúteis com nome de XML: falha
// silenciosa, pior que erro. Medido em 2026-08-03: entradas voltam procNFe_v4.00.
const isProcNFe = (d) => /procNFe/i.test(d.schema || '') ||
    /<(nfeProc|NFe)\b/.test(String(d.xml || '').slice(0, 400));
const isResumo = (d) => /resNFe/i.test(d.schema || '') || /<resNFe\b/.test(String(d.xml || '').slice(0, 400));

async function fetchNfeXml({ chave, cnpj, cufAutor, tpAmb, pfx, passphrase, endpoint, poster }) {
    const soap = buildDistDFeIntSoap({ tpAmb: tpAmb || 1, cufAutor, cnpj, chave });
    const text = await postDistDFeVia(poster || httpsPostMtls, { endpoint: endpoint || DISTDFE_URL_PROD, pfx, passphrase, soap });
    const ret = parseRetDistDFe(text);
    if (ret.cStat === '656') throw makeErr('consumo', 'Consumo indevido (656): ' + (ret.xMotivo || ''));
    // 641: a SEFAZ não entrega ao emitente a NF-e que ele mesmo emitiu por este
    // webservice (ele já a tem). Relatório de SAÍDAS não serve para este fluxo.
    if (ret.cStat === '641') throw makeErr('emitente', 'NF-e emitida pela própria empresa — a SEFAZ não a distribui ao emitente (641). Use o relatório de entradas.');
    if (!ret.docs.length) {
        if (ret.cStat === '137' || ret.cStat === '138') throw makeErr('notfound', 'Sem documento p/ a chave (cStat ' + ret.cStat + ')');
        throw makeErr('cstat', 'cStat ' + ret.cStat + ': ' + (ret.xMotivo || ''));
    }
    // Acha o doc cuja chave bate (o lote pode trazer eventos além da NFe).
    const daChave = ret.docs.filter((d) => d.xml.indexOf(chave) !== -1);
    const candidatos = daChave.length ? daChave : ret.docs;
    const hit = candidatos.find(isProcNFe);
    if (!hit) {
        if (candidatos.some(isResumo)) throw makeErr('resumo', 'SEFAZ devolveu só o resumo (resNFe) — falta manifestação do destinatário para liberar o XML completo.');
        throw makeErr('schema', 'lote sem procNFe (schemas: ' + candidatos.map((d) => d.schema || '?').join(', ') + ')');
    }
    const innerM = hit.xml.match(/Id="NFe(\d{44})"/) || hit.xml.match(/<chNFe>(\d{44})<\/chNFe>/);
    if (innerM && innerM[1] !== chave) throw makeErr('mismatch', 'XML retornou chave ' + innerM[1] + ', esperado ' + chave);
    return hit.xml;
}

// ============================================================ job manager ====
// Espelha lib/nfce.js:152-325. Troca token/taxid por pfx/senha/cufAutor/tpAmb,
// filtra chaves p/ modelo 55, e descarta credenciais ao fim do job.
const DEFAULT_CONCURRENCY = 2; // SEFAZ limita consumo por CNPJ — conservador
const ABORT_KINDS = new Set(['consumo', 'cert', 'emitente']);

/*
 * TETO DA SEFAZ — 20 consultas por hora, por CNPJ.
 *
 * Medido em 2026-08-03 com certificado real: 346 chaves em rajada morreram na 16ª, e a
 * própria SEFAZ disse o número em cStat 656 —
 *   "Rejeicao: Consumo Indevido (Ultrapassou o limite de 20 consultas por hora)".
 *
 * O teto é ABSOLUTO (consultas por hora), não de frequência: espaçar as chamadas não
 * compra mais nenhuma. Como `consChNFe` gasta 1 consulta por nota, o modo por lista de
 * chaves só serve para lotes pequenos. Em vez de queimar a quota com tentativas que já
 * nascem rejeitadas, o job para no orçamento e diz quantas chaves ficaram.
 *
 * Volume grande pede `distNSU` (até 50 documentos por consulta), que a spec original
 * deixou fora de escopo — ver docs/superpowers/plans/2026-07-22-baixar-nfe-xml.md.
 */
const MAX_CONSULTAS_HORA = 20;
const DEFAULT_INTERVAL_MS = 1000; // espaçamento gentil; não é o que protege a quota

const jobs = new Map();

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
/**
 * Nome da empresa DONA do job, para batizar o ZIP. Tem que ser a parte cujo CNPJ é o do
 * certificado: num relatório de entradas o `<emit>` é o FORNECEDOR, e usar o primeiro
 * deles nomeava o ZIP com o nome de outra empresa (visto no E2E de 2026-08-03:
 * "NFe 06-2026_J. SLEIMAN..." num ZIP de notas da A&R). Sem casar CNPJ, fica sem nome —
 * o ZIP cai no rótulo "CNPJ nnn", que é feio mas verdadeiro.
 */
function tryResolveName(comp, xml) {
    if (comp.nomeResolved) return;
    for (const tag of ['dest', 'emit']) {
        const bloco = xml.match(new RegExp('<' + tag + '>[\\s\\S]*?</' + tag + '>'));
        if (!bloco) continue;
        const doc = bloco[0].match(/<CNPJ>(\d{14})<\/CNPJ>/);
        if (!doc || doc[1] !== comp.cnpj) continue;
        const nome = bloco[0].match(/<xNome>([^<]+)<\/xNome>/) || bloco[0].match(/<xFant>([^<]+)<\/xFant>/);
        if (nome && nome[1]) { comp.nome = nome[1].trim(); comp.nomeResolved = true; return; }
    }
}

// ------------------------------------------------------------ lifecycle ----
function startJob(payload) {
    const concurrency = Math.max(1, Math.min(20, parseInt(payload.concurrency, 10) || DEFAULT_CONCURRENCY));
    const incoming = Array.isArray(payload.companies) ? payload.companies : [];
    const poster = payload._poster || null; // hook de teste; produção usa mTLS real
    // 0 desliga a pausa (usado nos testes, que não falam com a SEFAZ).
    const intervalMs = payload.intervalMs == null
        ? DEFAULT_INTERVAL_MS
        : Math.max(0, Math.min(60_000, parseInt(payload.intervalMs, 10) || 0));
    // 0 = sem orçamento (testes). Padrão = o teto medido da SEFAZ.
    const maxConsultas = payload.maxConsultas == null
        ? MAX_CONSULTAS_HORA
        : Math.max(0, parseInt(payload.maxConsultas, 10) || 0);
    // ID aleatório: sequencial (`nfe-1`) é adivinhável e dispensaria o atacante de
    // saber qualquer coisa para baixar o ZIP de outra sessão.
    const id = newJobId('nfe');
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
        // CNPJ do INTERESSADO (dono do certificado) — obrigatório e não dedutível da
        // chave: em relatório de entradas a chave carrega o CNPJ do FORNECEDOR, não o
        // da empresa. Assinar com um CNPJ perguntando por outro é rejeição na certa.
        const cnpj = cleanDigits(c.cnpj);
        if (cnpj.length !== 14) continue;
        const gid = String(c.id || '').trim() || (cnpj + '-' + (keys[0] ? yyyymmFromKey(keys[0]) : '000000'));
        // cUFAutor: medido em 2026-08-03 que a SEFAZ só valida contra o XSD (código de
        // UF existente), não contra o certificado — 23 e 35 devolveram o mesmo doc, 99
        // deu rejeição 215 (falha de esquema). Derivar da chave é seguro.
        const cufAutor = cleanDigits(c.cufAutor) || (keys[0] ? keys[0].substring(0, 2) : '');
        const tpAmb = parseInt(c.tpAmb, 10) || 1;
        const meta = new Map();
        if (c.meta && typeof c.meta === 'object') {
            for (const k of Object.keys(c.meta)) { const kk = cleanDigits(k); if (kk.length === 44) meta.set(kk, c.meta[k]); }
        }
        companies.set(gid, {
            id: gid, cnpj, pfx, senha: String(c.senha || ''), cufAutor, tpAmb, poster,
            intervalMs, proximaEm: 0, maxConsultas, consultas: 0,
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

// Espera a vez desta empresa. Serializa as consultas do mesmo CNPJ mesmo com vários
// runners: a quota da SEFAZ é por CNPJ, não por conexão.
async function aguardarVez(comp) {
    if (!comp.intervalMs) return;
    const agora = Date.now();
    const quando = Math.max(agora, comp.proximaEm || 0);
    comp.proximaEm = quando + comp.intervalMs;
    if (quando > agora) await delay(quando - agora);
}

// Encerra a empresa quando o orçamento de consultas acabou. As chaves que sobraram não
// viram tentativa: elas seriam 656 na certa e ainda contariam contra a próxima hora.
function pararPorLimite(comp, chave) {
    const motivo = 'não baixada: teto de ' + comp.maxConsultas +
        ' consultas/hora da SEFAZ atingido — rode de novo na próxima hora';
    comp.aborted = true;
    comp.abortReason = motivo;
    const restantes = [chave].concat(comp.pending.splice(0));
    for (const k of restantes) {
        comp.errors++;
        comp.failures.push({ chave: k, motivo });
    }
}

async function processChave(comp, chave) {
    if (comp.maxConsultas && comp.consultas >= comp.maxConsultas) {
        pararPorLimite(comp, chave);
        maybeFinalizeCompany(comp);
        return;
    }
    comp.consultas++;
    try {
        await aguardarVez(comp);
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
        // Falhas que valem para TODAS as chaves da empresa — insistir só queima quota:
        //   consumo  SEFAZ bloqueou o CNPJ
        //   cert     .pfx não carrega (formato/senha) — nenhuma chave vai passar
        //   emitente relatório é de saídas; a SEFAZ rejeita a empresa emitente inteira
        // Aborta SÓ esta empresa; as outras do job seguem.
        if (err && ABORT_KINDS.has(err.kind) && !comp.aborted) {
            comp.aborted = true;
            comp.abortReason = err.message;
            while (comp.pending.length) {
                const k = comp.pending.shift();
                comp.errors++;
                comp.failures.push({ chave: k, motivo: 'não tentado (' + err.kind + ': ' + err.message + ')' });
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
    sanitizeFileName, cleanDigits,
};
