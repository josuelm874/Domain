import { test } from 'node:test';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { startJob, getStatus, getCompanyZip } from '../lib/nfe.js';

const CH = '23250312345678000199550010000000011000000017'; // modelo 55
const CH_NFCE = '23250312345678000199650010000000011000000015'; // modelo 65 -> deve ser ignorada

function docResp(chave) {
    const xml = `<procNFe><protNFe><infProt><chNFe>${chave}</chNFe></infProt></protNFe></procNFe>`;
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    return `<retDistDFeInt><cStat>138</cStat><loteDistDFeInt><docZip NSU="1" schema="procNFe">${b64}</docZip></loteDistDFeInt></retDistDFeInt>`;
}

test('startJob: baixa NFe (55), ignora NFCe (65), gera ZIP e descarta pfx', async () => {
    const job = startJob({
        concurrency: 1,
        _poster: async () => ({ status: 200, text: docResp(CH) }),
        companies: [{
            cnpj: '12345678000199', cufAutor: '23', tpAmb: 1,
            pfxB64: Buffer.from('fakepfx').toString('base64'), senha: 'pw',
            keys: [CH, CH_NFCE],
        }],
    });
    for (let i = 0; i < 50 && !getStatus(job.id).done; i++) await new Promise((r) => setTimeout(r, 20));
    const st = getStatus(job.id);
    assert.strictEqual(st.done, true);
    const c = st.companies[0];
    assert.strictEqual(c.total, 1);       // só a chave modelo 55
    assert.strictEqual(c.downloaded, 1);
    assert.ok(c.zipReady);
    const internal = job.companies.get(c.id);
    assert.strictEqual(internal.pfx, null);
    assert.strictEqual(internal.senha, '');
    const z = getCompanyZip(job.id, c.id);
    assert.ok(z && z.buffer.length > 0);
    assert.match(z.name, /^NFe .*\.zip$/);
});

test('startJob: empresa sem pfx é ignorada; job sem empresas válidas marca erro', () => {
    const job = startJob({ companies: [{ cnpj: '12345678000199', keys: [CH] }] }); // sem pfxB64
    assert.strictEqual(job.done, true);
    assert.match(job.error, /nenhuma empresa/i);
});
