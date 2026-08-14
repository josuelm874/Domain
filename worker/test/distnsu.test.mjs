import { test } from 'node:test';
import assert from 'node:assert';
import { buildDistNsuSoap } from '../lib/distnsu.js';

test('buildDistNsuSoap: ultNSU com 15 dígitos e ordem do XSD', () => {
    const soap = buildDistNsuSoap({ tpAmb: '1', cufAutor: '23', cnpj: '12345678000199', ultNSU: '103111' });
    assert.match(soap, /<ultNSU>000000000103111<\/ultNSU>/);
    assert.match(soap, /<distNSU><ultNSU>/);
    assert.ok(!/consChNFe/.test(soap), 'não pode sobrar consChNFe do irmão');
    assert.match(soap, /versao="1\.\d\d"/);
    const ordem = ['<tpAmb>', '<cUFAutor>', '<CNPJ>', '<distNSU>'].map((t) => soap.indexOf(t));
    assert.deepStrictEqual(ordem, [...ordem].sort((a, b) => a - b), 'ordem dos campos fora do XSD');
});

test('buildDistNsuSoap: ultNSU ausente vira zero', () => {
    const soap = buildDistNsuSoap({ tpAmb: '1', cufAutor: '23', cnpj: '12345678000199' });
    assert.match(soap, /<ultNSU>000000000000000<\/ultNSU>/);
});
