import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// O arquivo do cursor precisa ser apontado ANTES do require da lib.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'distnsu-'));
process.env.DISTNSU_CURSOR_FILE = path.join(TMP, 'cursors.json');

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const cursor = require('../lib/cursor.js');

test('cursor: CNPJ novo devolve registro zerado', () => {
    const r = cursor.read('12345678000199');
    assert.strictEqual(r.ultNSU, '0');
    assert.strictEqual(r.bloqueadoAte, 0);
});

test('cursor: write persiste e read releitura do disco enxerga', () => {
    cursor.write('12345678000199', { ultNSU: '22844', maxNSU: '23179', ultimoCStat: '138' });
    const bruto = JSON.parse(fs.readFileSync(process.env.DISTNSU_CURSOR_FILE, 'utf8'));
    assert.strictEqual(bruto['12345678000199'].ultNSU, '22844');
    assert.strictEqual(cursor.read('12345678000199').maxNSU, '23179');
});

test('cursor: write faz merge, não substitui o registro', () => {
    cursor.write('12345678000199', { ultimoCStat: '656' });
    const r = cursor.read('12345678000199');
    assert.strictEqual(r.ultNSU, '22844', 'ultNSU tem que sobreviver ao patch');
    assert.strictEqual(r.ultimoCStat, '656');
});

test('cursor: bloqueado respeita bloqueadoAte', () => {
    cursor.write('99999999000199', { bloqueadoAte: 5_000 });
    assert.strictEqual(cursor.bloqueado('99999999000199', 4_999), true);
    assert.strictEqual(cursor.bloqueado('99999999000199', 5_001), false);
});

test('cursor: sem env, o arquivo cai em pasta gravável — não ao lado do node.exe', () => {
    // Subprocesso porque CURSOR_PATH é congelado na carga do módulo, e este processo já
    // carregou com DISTNSU_CURSOR_FILE setado. Sem isso o default nunca é exercitado.
    // Regressão real: `path.dirname(process.execPath)` é C:\Program Files\nodejs em dev,
    // e escrever ali dá EPERM — o harness da Task 7 não rodava.
    const env = { ...process.env };
    delete env.DISTNSU_CURSOR_FILE;
    const destino = execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(require(process.argv[1]).CURSOR_PATH)', require.resolve('../lib/cursor.js')],
        { env, encoding: 'utf8' },
    );
    assert.ok(destino.startsWith(os.homedir()),
        'cursor tem que ficar em pasta gravável do usuário; veio: ' + destino);
});

test('cursor: arquivo corrompido não derruba o worker', () => {
    fs.writeFileSync(process.env.DISTNSU_CURSOR_FILE, '{ isso não é json');
    const r = cursor.read('12345678000199');
    assert.strictEqual(r.ultNSU, '0', 'arquivo ilegível = começa do zero, não crash');
});

const { runLoop } = require('../lib/distnsu.js');
const zlib = require('node:zlib');

const CH = '23250312345678000199550010000000011000000017';
const gz = (s) => zlib.gzipSync(Buffer.from(s, 'utf8')).toString('base64');
const XML_PROC = `<procNFe><NFe><infNFe Id="NFe${CH}"></infNFe></NFe></procNFe>`;

// Contrato do poster injetado (nfe.js:139): { status, text }. Ver o comentário gêmeo em
// distnsu.test.mjs — string crua faria o postDistDFeVia estourar em `HTTP undefined`.
function resposta({ cStat, ultNSU, maxNSU, n = 0 }) {
    const docs = Array.from({ length: n }, (_, i) =>
        `<docZip NSU="${String(i).padStart(15, '0')}" schema="procNFe_v4.00.xsd">${gz(XML_PROC)}</docZip>`).join('');
    return { status: 200, text: `<retDistDFeInt><cStat>${cStat}</cStat><xMotivo>x</xMotivo>` +
        `<ultNSU>${ultNSU}</ultNSU><maxNSU>${maxNSU}</maxNSU>` +
        `<loteDistDFeInt>${docs}</loteDistDFeInt></retDistDFeInt>` };
}

const base = (cnpj) => ({
    cnpj, cufAutor: '23', tpAmb: '1', pfx: Buffer.from('x'), passphrase: '',
    maxChamadas: 20, intervalMs: 0,
});

test('runLoop: pagina até o acervo esgotar', async () => {
    const CNPJ = '11111111000199';
    const paginas = [
        resposta({ cStat: '138', ultNSU: '000000000000050', maxNSU: '000000000000120', n: 50 }),
        resposta({ cStat: '138', ultNSU: '000000000000100', maxNSU: '000000000000120', n: 50 }),
        resposta({ cStat: '138', ultNSU: '000000000000120', maxNSU: '000000000000120', n: 20 }),
    ];
    let i = 0;
    const poster = async () => paginas[i++];
    const r = await runLoop({ ...base(CNPJ), poster });
    assert.strictEqual(r.chamadas, 3);
    assert.strictEqual(r.completos.length, 120);
    assert.strictEqual(r.motivoParada, 'acervo-esgotado');
    assert.strictEqual(cursor.read(CNPJ).ultNSU, '000000000000120');
});

test('runLoop: 656 para frio e mantém a hora cheia', async () => {
    const CNPJ = '22222222000199';
    let chamadas = 0;
    const poster = async () => {
        chamadas++;
        return resposta({ cStat: '656', ultNSU: '000000000000000', maxNSU: '000000000000000' });
    };
    const agora = 1_000_000;
    const r = await runLoop({ ...base(CNPJ), poster, agora });
    assert.strictEqual(chamadas, 1, 'não pode insistir depois de 656');
    assert.strictEqual(r.motivoParada, 'consumo-indevido');
    const c = cursor.read(CNPJ);
    assert.strictEqual(c.bloqueadoAte, agora + 3_600_000, 'a hora cheia tem que ficar de pé');
    assert.strictEqual(c.ultimoCStat, '656');
});

test('runLoop: 137 para frio e mantém a hora cheia', async () => {
    const CNPJ = '33333333000199';
    let chamadas = 0;
    const poster = async () => {
        chamadas++;
        return resposta({ cStat: '137', ultNSU: '000000000000050', maxNSU: '000000000000050' });
    };
    const r = await runLoop({ ...base(CNPJ), poster, agora: 2_000_000 });
    assert.strictEqual(chamadas, 1);
    assert.strictEqual(r.motivoParada, 'sem-documentos');
    assert.strictEqual(cursor.read(CNPJ).bloqueadoAte, 2_000_000 + 3_600_000);
});

test('runLoop: CNPJ bloqueado não faz nenhuma chamada', async () => {
    const CNPJ = '44444444000199';
    cursor.write(CNPJ, { bloqueadoAte: 9_000_000 });
    let chamadas = 0;
    const poster = async () => { chamadas++; return resposta({ cStat: '138', ultNSU: '1', maxNSU: '9' }); };
    const r = await runLoop({ ...base(CNPJ), poster, agora: 8_000_000 });
    assert.strictEqual(chamadas, 0, 'bloqueio existe justamente para não gastar a chamada');
    assert.strictEqual(r.motivoParada, 'cnpj-bloqueado');
});

test('runLoop: respeita o teto de chamadas', async () => {
    const CNPJ = '55555555000199';
    let chamadas = 0;
    const poster = async () => {
        chamadas++;
        return resposta({ cStat: '138', ultNSU: '000000000000050', maxNSU: '000000000099999', n: 50 });
    };
    const r = await runLoop({ ...base(CNPJ), poster, maxChamadas: 2 });
    assert.strictEqual(chamadas, 2);
    assert.strictEqual(r.motivoParada, 'teto-de-chamadas');
});

test('runLoop: retoma do cursor gravado, não do zero', async () => {
    const CNPJ = '66666666000199';
    cursor.write(CNPJ, { ultNSU: '000000000000777', bloqueadoAte: 0 });
    let enviado = '';
    const poster = async ({ body }) => {
        enviado = body;
        return resposta({ cStat: '137', ultNSU: '000000000000777', maxNSU: '000000000000777' });
    };
    await runLoop({ ...base(CNPJ), poster });
    assert.match(enviado, /<ultNSU>000000000000777<\/ultNSU>/);
});

const distnsu = require('../lib/distnsu.js');

test('startJob: duas empresas, um ZIP cada, credenciais descartadas no fim', async () => {
    const paginaCheia = resposta({ cStat: '138', ultNSU: '000000000000050', maxNSU: '000000000000050', n: 50 });
    const job = distnsu.startJob({
        companies: [
            { cnpj: '77777777000199', pfxB64: Buffer.from('x').toString('base64'), senha: 's',
              cufAutor: '23', intervalMs: 0, _poster: async () => paginaCheia },
            { cnpj: '88888888000199', pfxB64: Buffer.from('x').toString('base64'), senha: 's',
              cufAutor: '23', intervalMs: 0, _poster: async () => paginaCheia },
        ],
    });
    // O job roda em background; espera terminar.
    for (let i = 0; i < 200 && !distnsu.getStatus(job.id).done; i++) await new Promise((r) => setTimeout(r, 10));

    const st = distnsu.getStatus(job.id);
    assert.strictEqual(st.done, true);
    assert.strictEqual(st.companies.length, 2);
    for (const c of st.companies) {
        assert.strictEqual(c.completos, 50);
        assert.strictEqual(c.zipReady, true);
        assert.match(c.zipName, /\.zip$/);
    }
    const z = distnsu.getCompanyZip(job.id, '77777777000199');
    assert.ok(z && z.buffer && z.buffer.length > 0);
});

test('startJob: empresa sem certificado é recusada, não trava o job', () => {
    const job = distnsu.startJob({ companies: [{ cnpj: '99999999000188', pfxB64: '' }] });
    assert.strictEqual(job.done, true);
    assert.match(job.error, /nenhuma empresa/);
});
