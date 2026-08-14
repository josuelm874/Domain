import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

test('cursor: arquivo corrompido não derruba o worker', () => {
    fs.writeFileSync(process.env.DISTNSU_CURSOR_FILE, '{ isso não é json');
    const r = cursor.read('12345678000199');
    assert.strictEqual(r.ultNSU, '0', 'arquivo ilegível = começa do zero, não crash');
});
