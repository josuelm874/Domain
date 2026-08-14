import { test } from 'node:test';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { buildDistNsuSoap, fetchDistNsuBatch } from '../lib/distnsu.js';

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

const CH = '23250312345678000199550010000000011000000017';

const gz = (s) => zlib.gzipSync(Buffer.from(s, 'utf8')).toString('base64');

// O poster injetado é o mesmo contrato do httpsPostMtls (nfe.js:139): recebe
// { url, headers, body, pfx, passphrase } e devolve { status, text }. Devolver a string
// crua faria o postDistDFeVia estourar em `HTTP undefined` antes de chegar no parser.
function respostaFake({ cStat = '138', ultNSU = '000000000022844', maxNSU = '000000000023179', docs = [] }) {
    const corpo = docs.map((d) =>
        `<docZip NSU="${d.nsu}" schema="${d.schema}">${gz(d.xml)}</docZip>`).join('');
    return { status: 200, text: `<retDistDFeInt><cStat>${cStat}</cStat><xMotivo>ok</xMotivo>` +
        `<ultNSU>${ultNSU}</ultNSU><maxNSU>${maxNSU}</maxNSU>` +
        `<loteDistDFeInt>${corpo}</loteDistDFeInt></retDistDFeInt>` };
}

const XML_PROC = `<procNFe><NFe><infNFe Id="NFe${CH}"></infNFe></NFe></procNFe>`;
const XML_RES = `<resNFe><chNFe>${CH}</chNFe></resNFe>`;

test('fetchDistNsuBatch: separa procNFe, resNFe e evento', async () => {
    const poster = async () => respostaFake({ docs: [
        { nsu: '000000000022798', schema: 'procNFe_v4.00.xsd', xml: XML_PROC },
        { nsu: '000000000022799', schema: 'resNFe_v1.01.xsd', xml: XML_RES },
        { nsu: '000000000022800', schema: 'resEvento_v1.01.xsd', xml: '<resEvento/>' },
    ] });
    const r = await fetchDistNsuBatch({
        cnpj: '12345678000199', cufAutor: '23', tpAmb: '1', ultNSU: '0',
        pfx: Buffer.from('x'), passphrase: '', poster,
    });
    assert.strictEqual(r.cStat, '138');
    assert.strictEqual(r.totalDocs, 3);
    assert.strictEqual(r.completos.length, 1);
    assert.strictEqual(r.completos[0].chave, CH);
    assert.match(r.completos[0].xml, /procNFe/);
    assert.strictEqual(r.resumos.length, 1);
    assert.strictEqual(r.resumos[0].chave, CH);
    assert.strictEqual(r.eventos.length, 1);
    assert.strictEqual(r.ultNSU, '000000000022844');
    assert.strictEqual(r.maxNSU, '000000000023179');
});

test('fetchDistNsuBatch: 137 volta sem documento e não é erro', async () => {
    const poster = async () => respostaFake({ cStat: '137', docs: [] });
    const r = await fetchDistNsuBatch({
        cnpj: '12345678000199', cufAutor: '23', tpAmb: '1', ultNSU: '22844',
        pfx: Buffer.from('x'), passphrase: '', poster,
    });
    assert.strictEqual(r.cStat, '137');
    assert.strictEqual(r.totalDocs, 0);
});

test('fetchDistNsuBatch: manda o ultNSU recebido no envelope', async () => {
    let enviado = '';
    const poster = async ({ body }) => { enviado = body; return respostaFake({ docs: [] }); };
    await fetchDistNsuBatch({
        cnpj: '12345678000199', cufAutor: '23', tpAmb: '1', ultNSU: '22844',
        pfx: Buffer.from('x'), passphrase: '', poster,
    });
    assert.match(enviado, /<ultNSU>000000000022844<\/ultNSU>/);
});
