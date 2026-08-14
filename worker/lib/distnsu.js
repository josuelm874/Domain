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

const {
    postDistDFe, postDistDFeVia, parseRetDistDFe, DISTDFE_URL_PROD,
} = require('./nfe.js');

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
    const alvo = { endpoint: DISTDFE_URL_PROD, pfx, passphrase, soap };
    // `poster` é hook de teste; produção não injeta nada e precisa do mTLS real. O irmão
    // fetchNfeXml faz `poster || httpsPostMtls` (nfe.js:164), mas httpsPostMtls não é
    // exportado — postDistDFe é exatamente ele amarrado ao postDistDFeVia (nfe.js:150).
    const texto = poster ? await postDistDFeVia(poster, alvo) : await postDistDFe(alvo);
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

module.exports = {
    buildDistNsuSoap, fetchDistNsuBatch, runLoop,
    startJob, getStatus, getCompanyDetail, getCompanyZip, jobs,
    UMA_HORA_MS,
};
