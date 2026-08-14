#!/usr/bin/env node
/*
 * Lê o dump cru deixado por probe-distnsu.cjs e responde, SEM gastar consulta:
 *
 *   1. Em quais documentos a empresa é emitente e em quais é destinatária?
 *   2. O `procNFe` completo vem para os dois papéis, ou só para um?
 *   3. O que separa os que vieram completos dos que vieram como resumo `resNFe`?
 *
 * A pergunta 1 decide se `distNSU` serve para SAÍDAS. Está medido que `consChNFe`
 * recusa a própria nota ao emitente (cStat 641, ver nfe.js:169) — falta saber se
 * `distNSU` faz o mesmo.
 *
 * Só agrega. Nenhum conteúdo fiscal é impresso: apenas contagens, papéis e chaves
 * truncadas.
 *
 * Uso:
 *   node scripts/analyze-distnsu-dump.cjs --dump "C:\...\distnsu-CNPJ-0.xml" --cnpj 00000000000000
 */
const fs = require('fs');
const { parseRetDistDFe } = require('../worker/lib/nfe.js');

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const digits = (s) => String(s || '').replace(/\D/g, '');
const pick = (xml, tag) => {
    const m = String(xml).match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
    return m ? m[1].trim() : '';
};

// Chave de acesso: posições 6..19 são o CNPJ do EMITENTE. Vale para qualquer NF-e,
// e é o único jeito de saber o papel quando o doc é resumo (resNFe não traz <dest>).
const emitFromChave = (chave) => String(chave || '').substring(6, 20);

function chaveDe(doc) {
    const m = doc.xml.match(/Id="NFe(\d{44})"/) ||
              doc.xml.match(/<chNFe>(\d{44})<\/chNFe>/) ||
              doc.xml.match(/chNFe="(\d{44})"/);
    return m ? m[1] : '';
}

function main() {
    const dumpPath = arg('dump');
    const cnpj = digits(arg('cnpj'));
    if (!dumpPath || cnpj.length !== 14) {
        console.error('Uso: --dump <arquivo.xml> --cnpj <14 dígitos>');
        process.exit(2);
    }
    const ret = parseRetDistDFe(fs.readFileSync(dumpPath, 'utf8'));
    console.log('CNPJ analisado: ' + cnpj);
    console.log('Documentos no lote: ' + ret.docs.length + '\n');

    const linhas = [];
    const resumo = new Map(); // "schema | papel" -> contagem

    for (const d of ret.docs) {
        const schema = (d.schema || '?').replace(/_v[\d.]+\.xsd$/, '');
        const chave = chaveDe(d);
        const emit = chave ? emitFromChave(chave) : '';
        // <dest> só existe no procNFe. No resNFe o papel se deduz da chave.
        const dest = digits(pick(d.xml.match(/<dest>[\s\S]*?<\/dest>/)?.[0] || '', 'CNPJ'));

        let papel = 'indefinido';
        if (emit === cnpj) papel = 'EMITENTE (saída)';
        else if (dest === cnpj) papel = 'destinatária (entrada)';
        else if (emit && emit !== cnpj) papel = 'destinatária (entrada, por chave)';

        const k = schema + ' | ' + papel;
        resumo.set(k, (resumo.get(k) || 0) + 1);
        linhas.push({ nsu: d.nsu, schema, papel, chave: chave ? chave.slice(0, 6) + '…' + chave.slice(-4) : '(sem chave)' });
    }

    console.log('AGREGADO — schema × papel da empresa');
    for (const [k, n] of [...resumo.entries()].sort()) console.log('  ' + String(n).padStart(3) + '× ' + k);

    const procs = linhas.filter((l) => /procNFe/i.test(l.schema));
    const res = linhas.filter((l) => /resNFe/i.test(l.schema));
    const procSaida = procs.filter((l) => l.papel.startsWith('EMITENTE'));

    console.log('\nVEREDITO — distNSU serve para SAÍDAS?');
    if (procSaida.length) {
        console.log('  SIM. ' + procSaida.length + ' procNFe completo(s) em que a empresa é a emitente.');
        console.log('  A regra do cStat 641 do consChNFe não se aplica ao distNSU.');
    } else if (procs.length) {
        console.log('  NÃO neste lote. Os ' + procs.length + ' procNFe são todos de entrada.');
        console.log('  Coerente com o 641: a SEFAZ não redistribui ao emitente a própria nota.');
    } else {
        console.log('  Inconclusivo: nenhum procNFe neste lote.');
    }

    console.log('\nPor que uns vêm completos e outros só como resumo');
    console.log('  procNFe: ' + procs.length + '  ·  resNFe: ' + res.length);
    const papeisProc = new Set(procs.map((l) => l.papel));
    const papeisRes = new Set(res.map((l) => l.papel));
    console.log('  papéis nos procNFe: ' + ([...papeisProc].join(', ') || '—'));
    console.log('  papéis nos resNFe:  ' + ([...papeisRes].join(', ') || '—'));
    if (procs.length && res.length && [...papeisProc].join() === [...papeisRes].join()) {
        console.log('  Mesmo papel nos dois grupos — a diferença NÃO é emitente/destinatário.');
        console.log('  Hipótese restante: manifestação já registrada libera o procNFe.');
    }
}

main();
