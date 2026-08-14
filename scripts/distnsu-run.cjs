#!/usr/bin/env node
/*
 * Roda o loop distNSU de UM CNPJ contra a SEFAZ, gravando o cursor.
 *
 * Diferente do probe (que faz UMA chamada e serve para responder pergunta), este é a
 * ferramenta de produção sem tela: pagina o acervo até esgotar, parar em 656/137 ou bater
 * o teto de chamadas — e persiste o cursor, então rodar de novo continua de onde parou.
 *
 * DISCIPLINA — o custo do erro é 1 hora de janela do CNPJ:
 *   - `--dry-run` primeiro. Ele exercita o loop inteiro com respostas falsas, sem rede.
 *   - Se o cursor disser que o CNPJ está bloqueado, o loop nem chama. Isso é proteção,
 *     não bug: espere a hora acabar.
 *   - Nada de conteúdo fiscal na tela. Só contagem, cStat e motivo da parada.
 *
 * Uso (PowerShell) — a senha NUNCA vai no argv:
 *
 *   $env:PFX_SENHA = 'senha-do-certificado'
 *   node --openssl-legacy-provider scripts/distnsu-run.cjs `
 *        --pfx "C:\caminho\certificado.pfx" --cnpj 00000000000000 --cuf 23 --out .\saida
 *
 * A flag --openssl-legacy-provider é obrigatória (ver worker/lib/nfe.js:102).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { runLoop } = require('../worker/lib/distnsu.js');
const cursor = require('../worker/lib/cursor.js');

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const digits = (s) => String(s || '').replace(/\D/g, '');

// Portão offline: exercita o loop inteiro com respostas falsas. Zero rede, zero quota.
async function dryRun() {
    const CH = '23250312345678000199550010000000011000000017';
    const xml = `<procNFe><NFe><infNFe Id="NFe${CH}"></infNFe></NFe></procNFe>`;
    const gz = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const pagina = (ult, max, n) => ({ status: 200, text:
        `<retDistDFeInt><cStat>138</cStat><xMotivo>ok</xMotivo><ultNSU>${ult}</ultNSU>` +
        `<maxNSU>${max}</maxNSU><loteDistDFeInt>` +
        Array.from({ length: n }, (_, i) =>
            `<docZip NSU="${String(i).padStart(15, '0')}" schema="procNFe_v4.00.xsd">${gz}</docZip>`).join('') +
        `</loteDistDFeInt></retDistDFeInt>` });
    const paginas = [
        pagina('000000000000050', '000000000000100', 50),
        pagina('000000000000100', '000000000000100', 50),
    ];
    let i = 0;
    const r = await runLoop({
        cnpj: '00000000000191', cufAutor: '23', tpAmb: '2',
        pfx: Buffer.from('x'), passphrase: '', intervalMs: 0,
        poster: async () => paginas[i++],
    });
    const assert = require('assert');
    assert.strictEqual(r.chamadas, 2, 'o loop tem que paginar duas vezes');
    assert.strictEqual(r.completos.length, 100, 'os 100 documentos das duas páginas');
    assert.strictEqual(r.motivoParada, 'acervo-esgotado');
    console.log('dry-run OK — loop paginou 2×, 100 documentos, parou por acervo esgotado.');
    console.log('Nenhuma chamada à SEFAZ foi feita.');
}

async function main() {
    if (process.argv.includes('--dry-run')) { await dryRun(); return; }

    const pfxPath = arg('pfx');
    const cnpj = digits(arg('cnpj'));
    const cufAutor = digits(arg('cuf'));
    const tpAmb = digits(arg('tpamb', '1')) || '1';
    const maxChamadas = parseInt(arg('max', '20'), 10);
    const outDir = arg('out', '.');
    const senha = process.env.PFX_SENHA;

    const faltando = [];
    if (!pfxPath) faltando.push('--pfx');
    if (cnpj.length !== 14) faltando.push('--cnpj (14 dígitos)');
    if (!cufAutor) faltando.push('--cuf');
    if (!senha) faltando.push('$env:PFX_SENHA');
    if (faltando.length) {
        console.error('Faltou: ' + faltando.join(', '));
        console.error('Veja o cabeçalho deste arquivo. Rode --dry-run antes da primeira vez.');
        process.exit(2);
    }
    if (!fs.existsSync(pfxPath)) { console.error('Certificado não encontrado: ' + pfxPath); process.exit(2); }

    const antes = cursor.read(cnpj);
    console.log('CNPJ ' + cnpj + ' · cUFAutor ' + cufAutor + ' · tpAmb ' + tpAmb);
    console.log('cursor: ultNSU ' + antes.ultNSU + ' · maxNSU ' + antes.maxNSU +
        (antes.bloqueadoAte > Date.now()
            ? ' · BLOQUEADO até ' + new Date(antes.bloqueadoAte).toLocaleTimeString()
            : ' · liberado'));
    console.log('teto de ' + maxChamadas + ' chamadas nesta rodada\n');

    const r = await runLoop({
        cnpj, cufAutor, tpAmb, maxChamadas,
        pfx: fs.readFileSync(pfxPath), passphrase: senha,
    });

    console.log('chamadas   ' + r.chamadas);
    console.log('completos  ' + r.completos.length + ' (procNFe, servem direto)');
    console.log('resumos    ' + r.resumos.length + ' (resNFe, precisam da Etapa 2)');
    console.log('eventos    ' + r.eventos.length);
    console.log('cStat      ' + (r.cStatFinal || '(nenhuma chamada)'));
    console.log('parou por  ' + r.motivoParada);
    console.log('cursor     ultNSU ' + cursor.read(cnpj).ultNSU);

    if (r.completos.length) {
        fs.mkdirSync(outDir, { recursive: true });
        for (const d of r.completos) {
            fs.writeFileSync(path.join(outDir, (d.chave || ('nsu-' + d.nsu)) + '.xml'), d.xml);
        }
        console.log('\n' + r.completos.length + ' XML gravados em ' + path.resolve(outDir));
    }
    if (r.resumos.length) {
        const lista = path.join(outDir, 'resumos-para-manifestar.txt');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(lista, r.resumos.map((x) => x.chave).join('\n'));
        console.log('Chaves em resumo (insumo da Etapa 2): ' + lista);
    }
    if (r.motivoParada === 'consumo-indevido' || r.motivoParada === 'sem-documentos') {
        console.log('\nPARE. Nada de nova chamada neste CNPJ por 1 hora — retomar dentro da');
        console.log('janela zera o relógio (NT 2014.002). O cursor já está gravado.');
    }
}

main().catch((e) => { console.error(e && e.message); process.exit(1); });
