/**
 * Fluxo DIRBI no worker — porta `processDirbiXmls` do browser (`app.js`) p/ Node.
 *
 * Motivo de ir pro Node: volume (~500k XMLs / ~2GB). O navegador lê tudo na RAM;
 * aqui lemos a pasta INBOX do disco arquivo-a-arquivo (memória baixa — só os
 * acumuladores por empresa ficam em memória, não os XMLs).
 *
 * Entrada: pasta inbox com .xml soltos e/ou .zip de XMLs. Para volume gigante,
 * prefira XMLs soltos (lidos um a um); um .zip de 2GB seria carregado inteiro.
 *
 * Saída: 1 planilha DIRBI por empresa (modelo `assets/js/DIRBI MES-ANO.xlsx`,
 * fórmulas F/G de Pis/Cofins preservadas via calcProperties.fullCalcOnLoad).
 * 1 empresa → .xlsx; várias → DIRBI_{periodo}.zip (montado com lib/zip.js).
 *
 * XML parseado por regex (Node não tem DOMParser) — mesma extração do browser:
 * emit>CNPJ (agrupamento), emit>xNome (razão predominante), ide>dhEmi (período),
 * por <prod>: NCM + vProd → soma na linha do modelo que casa o NCM.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { buildZip, readZip } = require('./zip');

const TEMPLATE_PATH = process.env.DIRBI_TEMPLATE ||
    path.join(__dirname, '..', '..', 'assets', 'js', 'DIRBI MES-ANO.xlsx');
const INBOX_DEFAULT = process.env.DIRBI_INBOX || path.join(__dirname, '..', 'inbox');

const jobs = new Map();
let jobSeq = 0;

// ----------------------------------------------------- regras do modelo ----
// Idêntico ao browser: D4:D21, cada célula 1+ NCMs separados por não-dígitos.
function parseDirbiNcmRules(ws) {
    const rules = [];
    for (let r = 4; r <= 21; r++) {
        const raw = ws.getCell('D' + r).value;
        if (raw === null || raw === undefined || raw === '') continue;
        const prefixes = String(raw).split(/[^0-9]+/).map((s) => s.trim()).filter(Boolean);
        if (prefixes.length) rules.push({ row: r, prefixes });
    }
    return rules;
}
// Primeira regra cujo prefixo casa o início do NCM (evita dupla contagem).
function matchDirbiRow(ncm, rules) {
    for (const rule of rules) {
        for (const p of rule.prefixes) if (ncm.startsWith(p)) return rule.row;
    }
    return null;
}

// ------------------------------------------------------- parse de 1 XML ----
const reEmit = /<emit\b[^>]*>([\s\S]*?)<\/emit>/i;
const reCnpj = /<CNPJ>\s*([\d]+)\s*<\/CNPJ>/i;
const reXNome = /<xNome>\s*([^<]*?)\s*<\/xNome>/i;
const reDhEmi = /<dhEmi>\s*(\d{4})-(\d{2})/i;
const reProd = /<prod\b[^>]*>([\s\S]*?)<\/prod>/gi;
const reNcm = /<NCM>\s*([^<]+?)\s*<\/NCM>/i;
const reVProd = /<vProd>\s*([^<]+?)\s*<\/vProd>/i;

// Acumula um XML nos `empresas`. Retorna true se foi um XML válido de NFC-e.
function accumulateXml(text, rules, empresas, ctx) {
    if (!text || text.indexOf('<prod') === -1) return false;
    const emitM = text.match(reEmit);
    const emitBlock = emitM ? emitM[1] : '';
    const cnpjM = emitBlock.match(reCnpj);
    const cnpj = cnpjM ? cnpjM[1].replace(/\D/g, '') : 'sem-cnpj';
    const emp = empresas[cnpj] || (empresas[cnpj] = {
        somas: {}, razaoCount: {}, periodo: '', xmlLidos: 0, produtosCasados: 0, produtosSemRegra: 0,
    });

    const nomeM = emitBlock.match(reXNome);
    if (nomeM && nomeM[1].trim()) {
        const nome = nomeM[1].trim();
        emp.razaoCount[nome] = (emp.razaoCount[nome] || 0) + 1;
    }
    if (!emp.periodo) {
        const dh = text.match(reDhEmi);
        if (dh) { emp.periodo = dh[2] + '-' + dh[1]; if (!ctx.periodoGlobal) ctx.periodoGlobal = emp.periodo; }
    }

    let m, achouProd = false;
    reProd.lastIndex = 0;
    while ((m = reProd.exec(text)) !== null) {
        const block = m[1];
        const ncmM = block.match(reNcm);
        const vM = block.match(reVProd);
        if (!ncmM || !vM) continue;
        achouProd = true;
        const ncm = ncmM[1].replace(/\D/g, '');
        if (!ncm) continue;
        const valor = parseFloat(String(vM[1]).replace(',', '.')) || 0;
        const row = matchDirbiRow(ncm, rules);
        if (row == null) { emp.produtosSemRegra++; continue; }
        emp.somas[row] = (emp.somas[row] || 0) + valor;
        emp.produtosCasados++;
    }
    if (!achouProd) return false;
    emp.xmlLidos++;
    return true;
}

// ------------------------------------------------------- leitura inbox ----
// Itera os arquivos da inbox chamando onXml(text) por XML. .xml lidos um a um
// (memória baixa); .zip carregado inteiro e expandido (caveat de 2GB).
// Lista .xml/.zip recursivamente (a pasta pode ter subpastas com XML).
function listFilesRec(dir, acc) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) listFilesRec(full, acc);
        else if (/\.(xml|zip)$/i.test(e.name)) acc.push(full);
    }
    return acc;
}

function forEachInboxXml(inboxDir, onXml, onProgress) {
    let files;
    try { files = listFilesRec(inboxDir, []); } catch (e) {
        throw new Error('pasta não encontrada/ilegível: ' + inboxDir);
    }
    let done = 0;
    for (const full of files) {
        try {
            if (/\.zip$/i.test(full)) {
                const items = readZip(fs.readFileSync(full), (n) => /\.xml$/i.test(n));
                for (const it of items) onXml(it.data.toString('utf8'));
            } else {
                onXml(fs.readFileSync(full, 'utf8'));
            }
        } catch (e) { /* arquivo ilegível: ignora, segue */ }
        done++;
        if (onProgress) onProgress(done, files.length);
    }
    return files.length;
}

// ------------------------------------------------------ geração xlsx ----
function loadTemplateBuffer() {
    return fs.promises.readFile(TEMPLATE_PATH);
}

async function makeCompanyXlsx(modelBuffer, emp, rules) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(modelBuffer);
    const ws = wb.getWorksheet('DIRBI') || wb.worksheets[0];
    ws.autoFilter = null; // remove o filtro da linha 3 que vem do modelo
    for (const rule of rules) {
        ws.getCell('E' + rule.row).value = Math.round((emp.somas[rule.row] || 0) * 100) / 100;
    }
    const razaoFinal = Object.keys(emp.razaoCount).reduce(
        (a, b) => (emp.razaoCount[a] >= emp.razaoCount[b] ? a : b), '');
    if (razaoFinal) ws.getCell('B2').value = razaoFinal;
    // F/G são fórmulas com cache stale (modelo tem E vazio → 0). fullCalcOnLoad
    // força Excel/WPS a recalcular ao abrir. NÃO tocamos F/G.
    wb.calcProperties = { fullCalcOnLoad: true };
    const buffer = await wb.xlsx.writeBuffer();
    return { razaoFinal, buffer: Buffer.from(buffer) };
}

const sanitize = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'empresa';

// ------------------------------------------------------- job lifecycle ----
function startJob(payload) {
    const inbox = (payload && payload.inboxPath) ? String(payload.inboxPath) : INBOX_DEFAULT;
    const id = 'dirbi-' + (++jobSeq);
    const job = {
        id, inbox, createdAt: Date.now(), phase: 'lendo',
        filesDone: 0, filesTotal: 0, empresas: 0, xmlInvalidos: 0,
        done: false, error: '', resultName: '', resultBuffer: null, isZip: false, resumo: [],
    };
    jobs.set(id, job);
    runJob(job).catch((e) => { job.error = (e && e.message) || 'erro interno'; job.done = true; });
    return job;
}

async function runJob(job) {
    let modelBuffer;
    try { modelBuffer = await loadTemplateBuffer(); }
    catch (e) { job.error = 'modelo DIRBI não encontrado (' + TEMPLATE_PATH + ')'; job.done = true; return; }

    // Regras do modelo (uma vez).
    const wbProbe = new ExcelJS.Workbook();
    await wbProbe.xlsx.load(modelBuffer);
    const wsProbe = wbProbe.getWorksheet('DIRBI') || wbProbe.worksheets[0];
    const rules = parseDirbiNcmRules(wsProbe);
    if (!rules.length) { job.error = 'modelo sem regras de NCM (D4:D21 vazias)'; job.done = true; return; }

    // Varre a inbox acumulando por empresa.
    const empresas = {};
    const ctx = { periodoGlobal: '' };
    job.phase = 'lendo';
    try {
        forEachInboxXml(job.inbox, (text) => {
            const ok = accumulateXml(text, rules, empresas, ctx);
            if (!ok) job.xmlInvalidos++;
        }, (done, total) => {
            job.filesDone = done; job.filesTotal = total;
        });
    } catch (e) { job.error = e.message; job.done = true; return; }

    const cnpjs = Object.keys(empresas);
    if (!cnpjs.length) { job.error = 'nenhum XML válido de NFC-e na inbox'; job.done = true; return; }

    // Gera as planilhas.
    job.phase = 'planilhas';
    job.empresas = cnpjs.length;
    const arquivos = [];
    for (const cnpj of cnpjs) {
        const emp = empresas[cnpj];
        const { razaoFinal, buffer } = await makeCompanyXlsx(modelBuffer, emp, rules);
        const nome = 'DIRBI ' + (emp.periodo || 'sem-periodo') + '_' + sanitize(razaoFinal || cnpj) + '.xlsx';
        arquivos.push({ name: nome, data: buffer });
        job.resumo.push((razaoFinal || cnpj) + ' — ' + emp.xmlLidos + ' XML, ' + emp.produtosCasados +
            ' produto(s)' + (emp.produtosSemRegra ? ', ' + emp.produtosSemRegra + ' sem NCM' : ''));
    }

    if (arquivos.length === 1) {
        job.resultBuffer = arquivos[0].data;
        job.resultName = arquivos[0].name;
        job.isZip = false;
    } else {
        job.resultBuffer = buildZip(arquivos);
        job.resultName = 'DIRBI_' + (ctx.periodoGlobal || 'sem-periodo') + '.zip';
        job.isZip = true;
    }
    job.phase = 'done';
    job.done = true;
}

function getStatus(jobId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    return {
        ok: true, jobId: job.id, done: job.done, error: job.error || '', phase: job.phase,
        filesDone: job.filesDone, filesTotal: job.filesTotal, empresas: job.empresas,
        xmlInvalidos: job.xmlInvalidos, resultName: job.resultName, isZip: job.isZip,
        resultReady: !!job.resultBuffer, resumo: job.resumo,
    };
}

function getResult(jobId) {
    const job = jobs.get(jobId);
    if (!job || !job.resultBuffer) return null;
    return { buffer: job.resultBuffer, name: job.resultName, isZip: job.isZip };
}

function inboxInfo() {
    return { inbox: INBOX_DEFAULT, template: TEMPLATE_PATH, templateExists: fs.existsSync(TEMPLATE_PATH) };
}

module.exports = { startJob, getStatus, getResult, inboxInfo, parseDirbiNcmRules, matchDirbiRow, accumulateXml };
