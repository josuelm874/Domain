#!/usr/bin/env node
/*
 * Sondagem ÚNICA de distNSU. Uma chamada, sem loop, sem retentativa.
 *
 * Por que existe: `consChNFe` gasta 1 consulta por nota e a SEFAZ dá 20/hora por CNPJ
 * (cStat 656) — 200 notas viram 10 horas. `distNSU` devolve até 50 documentos por
 * consulta. Antes de construir o loop, uma pergunta precisa de resposta:
 *
 *   distNSU entrega o `procNFe` completo, ou só o resumo `resNFe`?
 *
 * As duas sondagens de 2026-08-03 (22:24 ultNSU=0, 23:30 ultNSU=103111, no CNPJ da
 * A&R) morreram em 656 sem devolver documento — ver PENDENCIAS.md. A segunda estava
 * FORA do bloqueio de 1 h e caiu igual, o que aponta para um consumidor externo
 * segurando a quota daquele CNPJ. Por isso esta sondagem deve rodar em OUTRO CNPJ.
 *
 * DISCIPLINA — o custo do erro é 1 hora de janela do CNPJ:
 *   - UMA chamada. Deu 656 ou 137, pare. Não rode de novo dentro de 1 hora:
 *     a NT 2014.002 zera o relógio a cada tentativa dentro da janela.
 *   - Nada é impresso do conteúdo fiscal. Só cStat, NSU e o nome do schema.
 *
 * Uso (PowerShell) — a senha NUNCA vai no argv, só por variável de ambiente:
 *
 *   $env:PFX_SENHA = 'senha-do-certificado'
 *   node --openssl-legacy-provider scripts/probe-distnsu.cjs `
 *        --pfx "C:\caminho\certificado.pfx" --cnpj 00000000000000 --cuf 23 --ultnsu 0
 *
 * A flag --openssl-legacy-provider é obrigatória: o .pfx das ACs brasileiras usa
 * cifra que o OpenSSL 3 tirou do provider padrão (ver nfe.js:102).
 */
const fs = require('fs');
const { postDistDFe, parseRetDistDFe, DISTDFE_URL_PROD } = require('../worker/lib/nfe.js');
const { buildDistNsuSoap } = require('../worker/lib/distnsu.js');

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const digits = (s) => String(s || '').replace(/\D/g, '');
const tag = (xml, t) => {
    const m = String(xml).match(new RegExp('<' + t + '>([\\s\\S]*?)<\\/' + t + '>'));
    return m ? m[1].trim() : '';
};

// Envelope malformado custa 1 hora de janela (a SEFAZ devolve 215 e a consulta já
// foi gasta). Este check roda offline e é o portão antes de qualquer chamada real.
function selftest() {
    const assert = require('assert');
    const soap = buildDistNsuSoap({ tpAmb: '1', cufAutor: '23', cnpj: '12345678000199', ultNSU: '103111' });
    assert.match(soap, /<ultNSU>000000000103111<\/ultNSU>/, 'ultNSU precisa de 15 dígitos');
    assert.match(soap, /<distNSU><ultNSU>/, 'distNSU envolve o ultNSU');
    assert.ok(!/consChNFe/.test(soap), 'não pode sobrar consChNFe do irmão');
    assert.match(soap, /versao="1\.\d\d"/, 'versão do distDFeInt ausente');
    // A ordem dos filhos é validada pelo XSD: tpAmb, cUFAutor, CNPJ, distNSU.
    const ordem = ['<tpAmb>', '<cUFAutor>', '<CNPJ>', '<distNSU>'].map((t) => soap.indexOf(t));
    assert.deepStrictEqual(ordem, [...ordem].sort((a, b) => a - b), 'ordem dos campos fora do XSD');
    console.log('selftest OK — envelope distNSU bem formado, nenhuma chamada feita.');
}

async function main() {
    if (process.argv.includes('--selftest')) { selftest(); return; }
    const pfxPath = arg('pfx');
    const cnpj = digits(arg('cnpj'));
    const cufAutor = digits(arg('cuf'));
    const ultNSU = digits(arg('ultnsu', '0'));
    const tpAmb = digits(arg('tpamb', '1')) || '1';
    const senha = process.env.PFX_SENHA;

    const faltando = [];
    if (!pfxPath) faltando.push('--pfx');
    if (cnpj.length !== 14) faltando.push('--cnpj (14 dígitos)');
    if (!cufAutor) faltando.push('--cuf');
    if (!senha) faltando.push('$env:PFX_SENHA');
    if (faltando.length) {
        console.error('Faltou: ' + faltando.join(', '));
        console.error('Veja o cabeçalho deste arquivo para o exemplo de uso.');
        process.exit(2);
    }
    if (!fs.existsSync(pfxPath)) { console.error('Certificado não encontrado: ' + pfxPath); process.exit(2); }

    console.log('CNPJ ' + cnpj + ' · cUFAutor ' + cufAutor + ' · tpAmb ' + tpAmb + ' · ultNSU ' + ultNSU);
    console.log('UMA chamada em ' + DISTDFE_URL_PROD);

    const soap = buildDistNsuSoap({ tpAmb, cufAutor, cnpj, ultNSU });
    let text;
    try {
        text = await postDistDFe({ pfx: fs.readFileSync(pfxPath), passphrase: senha, soap });
    } catch (e) {
        console.error('FALHOU antes da SEFAZ responder: ' + (e && e.message));
        process.exit(1);
    }

    const ret = parseRetDistDFe(text);
    console.log('\ncStat    ' + ret.cStat + ' — ' + ret.xMotivo);
    console.log('ultNSU   ' + (tag(text, 'ultNSU') || '(ausente)'));
    console.log('maxNSU   ' + (tag(text, 'maxNSU') || '(ausente)'));
    console.log('docZip   ' + ret.docs.length);

    // Só o schema. O conteúdo é dado fiscal de terceiros e não vai para a tela.
    const porSchema = new Map();
    for (const d of ret.docs) porSchema.set(d.schema || '?', (porSchema.get(d.schema || '?') || 0) + 1);
    for (const [schema, n] of porSchema) console.log('  ' + n + '× ' + schema);

    // A resposta crua fica em disco para inspeção manual, fora do repo.
    const dump = require('path').join(require('os').tmpdir(), 'distnsu-' + cnpj + '-' + ultNSU + '.xml');
    fs.writeFileSync(dump, text);
    console.log('\nResposta crua: ' + dump);

    const temProc = [...porSchema.keys()].some((s) => /procNFe/i.test(s));
    const temRes = [...porSchema.keys()].some((s) => /resNFe/i.test(s));
    console.log('\nVEREDITO');
    if (ret.cStat === '656') console.log('  656 — quota/bloqueio. PARE. Nada de nova chamada neste CNPJ por 1 hora.');
    else if (ret.cStat === '137') console.log('  137 — sem documentos a partir deste ultNSU. PARE por 1 hora (regra da NT).');
    else if (temProc) console.log('  procNFe COMPLETO sem manifestar. distNSU resolve sozinho — 50 notas por consulta.');
    else if (temRes) console.log('  só resNFe. Precisa do evento 210210 (Ciência da Operação) para liberar o procNFe.');
    else console.log('  cStat ' + ret.cStat + ' sem procNFe nem resNFe — ler a resposta crua acima.');
    console.log('\nUMA chamada foi feita. Não rode de novo neste CNPJ dentro de 1 hora.');
}

main().catch((e) => { console.error(e && e.message); process.exit(1); });
