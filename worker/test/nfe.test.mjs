import { test } from 'node:test';
import assert from 'node:assert';
import zlib from 'node:zlib';
import {
    unwrapDocZip, buildDistDFeIntSoap, parseRetDistDFe, postDistDFeVia, fetchNfeXml,
} from '../lib/nfe.js';

const CH = '23250312345678000199550010000000011000000017'; // modelo 55

// ---------------------------------------------------------------- Task 1 ----
test('unwrapDocZip: base64+gzip -> XML', () => {
    const xml = '<procNFe><NFe><infNFe Id="NFe12345678901234567890123456789012345678901234"></infNFe></NFe></procNFe>';
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    assert.strictEqual(unwrapDocZip(b64), xml);
});

test('unwrapDocZip: base64 inválido lança', () => {
    assert.throws(() => unwrapDocZip('%%%naoBase64%%%'));
});

// ---------------------------------------------------------------- Task 2 ----
test('buildDistDFeIntSoap: inclui CNPJ, chNFe, tpAmb, cUFAutor e namespace', () => {
    const soap = buildDistDFeIntSoap({ tpAmb: 1, cufAutor: '23', cnpj: '12345678000199', chave: CH });
    assert.match(soap, /<tpAmb>1<\/tpAmb>/);
    assert.match(soap, /<cUFAutor>23<\/cUFAutor>/);
    assert.match(soap, /<CNPJ>12345678000199<\/CNPJ>/);
    assert.match(soap, /<consChNFe>\s*<chNFe>23250312345678000199550010000000011000000017<\/chNFe>\s*<\/consChNFe>/);
    assert.match(soap, /portalfiscal\.inf\.br\/nfe\/wsdl\/NFeDistribuicaoDFe/);
    assert.match(soap, /<distDFeInt[^>]*versao="1\.01"/);
});

// ---------------------------------------------------------------- Task 3 ----
test('parseRetDistDFe: extrai cStat e descomprime docZip', () => {
    const xml = '<procNFe><protNFe><infProt><chNFe>23250312345678000199550010000000011000000017</chNFe></infProt></protNFe></procNFe>';
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const resp =
        '<soap:Envelope><soap:Body><nfeDistDFeInteresseResponse><nfeDistDFeInteresseResult>' +
        '<retDistDFeInt><cStat>138</cStat><xMotivo>Documento localizado</xMotivo>' +
        '<loteDistDFeInt><docZip NSU="000000000000123" schema="procNFe_v4.00.xsd">' + b64 + '</docZip>' +
        '</loteDistDFeInt></retDistDFeInt>' +
        '</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>';
    const out = parseRetDistDFe(resp);
    assert.strictEqual(out.cStat, '138');
    assert.strictEqual(out.docs.length, 1);
    assert.strictEqual(out.docs[0].nsu, '000000000000123');
    assert.match(out.docs[0].xml, /<chNFe>23250312345678000199550010000000011000000017<\/chNFe>/);
});

test('parseRetDistDFe: sem docs quando cStat 137', () => {
    const resp = '<retDistDFeInt><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo></retDistDFeInt>';
    const out = parseRetDistDFe(resp);
    assert.strictEqual(out.cStat, '137');
    assert.strictEqual(out.docs.length, 0);
});

// ---------------------------------------------------------------- Task 4 ----
test('postDistDFeVia: repassa soap ao poster e retorna o texto', async () => {
    let seen = null;
    const fakePoster = async (o) => { seen = o; return { status: 200, text: '<retDistDFeInt><cStat>137</cStat></retDistDFeInt>' }; };
    const text = await postDistDFeVia(fakePoster, {
        endpoint: 'https://example/NFeDistribuicaoDFe.asmx',
        pfx: Buffer.from('fake'), passphrase: 'pw', soap: '<x/>',
    });
    assert.match(text, /cStat>137/);
    assert.strictEqual(seen.body, '<x/>');
    assert.match(seen.headers['Content-Type'], /application\/soap\+xml/);
});

test('postDistDFeVia: status != 200 lança com kind http', async () => {
    const fakePoster = async () => ({ status: 500, text: 'erro' });
    await assert.rejects(
        () => postDistDFeVia(fakePoster, { endpoint: 'x', pfx: Buffer.from('a'), passphrase: '', soap: '<x/>' }),
        (e) => e.kind === 'http'
    );
});

// ---------------------------------------------------------------- Task 5 ----
test('fetchNfeXml: retorna XML quando doc presente e chave bate', async () => {
    const xml = `<procNFe><protNFe><infProt><chNFe>${CH}</chNFe></infProt></protNFe></procNFe>`;
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const resp = `<retDistDFeInt><cStat>138</cStat><loteDistDFeInt><docZip NSU="1" schema="procNFe">${b64}</docZip></loteDistDFeInt></retDistDFeInt>`;
    const poster = async () => ({ status: 200, text: resp });
    const out = await fetchNfeXml({ chave: CH, cnpj: '12345678000199', cufAutor: '23', tpAmb: 1, pfx: Buffer.from('x'), passphrase: '', poster });
    assert.match(out, new RegExp('<chNFe>' + CH + '</chNFe>'));
});

test('fetchNfeXml: cStat 137 -> kind notfound', async () => {
    const poster = async () => ({ status: 200, text: '<retDistDFeInt><cStat>137</cStat></retDistDFeInt>' });
    await assert.rejects(
        () => fetchNfeXml({ chave: CH, cnpj: '12345678000199', cufAutor: '23', tpAmb: 1, pfx: Buffer.from('x'), passphrase: '', poster }),
        (e) => e.kind === 'notfound'
    );
});

test('fetchNfeXml: cStat 656 -> kind consumo', async () => {
    const poster = async () => ({ status: 200, text: '<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo></retDistDFeInt>' });
    await assert.rejects(
        () => fetchNfeXml({ chave: CH, cnpj: '12345678000199', cufAutor: '23', tpAmb: 1, pfx: Buffer.from('x'), passphrase: '', poster }),
        (e) => e.kind === 'consumo'
    );
});
