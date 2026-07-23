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

module.exports = {
    unwrapDocZip, buildDistDFeIntSoap, parseRetDistDFe, postDistDFe, postDistDFeVia, fetchNfeXml,
    // constantes p/ reuso no job manager (Task 6)
    DISTDFE_URL_PROD, DISTDFE_VERSAO,
};
