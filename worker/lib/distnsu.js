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
    postDistDFeVia, parseRetDistDFe, DISTDFE_URL_PROD,
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

module.exports = { buildDistNsuSoap, fetchDistNsuBatch, runLoop, UMA_HORA_MS };
