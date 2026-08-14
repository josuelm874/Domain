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
