import { test } from 'node:test';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { startJob, getStatus, getCompanyZip, getCompanyDetail } from '../lib/nfe.js';

const CH = '23250312345678000199550010000000011000000017'; // modelo 55
const CH_NFCE = '23250312345678000199650010000000011000000015'; // modelo 65 -> deve ser ignorada

function docResp(chave) {
    const xml = `<procNFe><protNFe><infProt><chNFe>${chave}</chNFe></infProt></protNFe></procNFe>`;
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    return `<retDistDFeInt><cStat>138</cStat><loteDistDFeInt><docZip NSU="1" schema="procNFe">${b64}</docZip></loteDistDFeInt></retDistDFeInt>`;
}

test('startJob: baixa NFe (55), ignora NFCe (65), gera ZIP e descarta pfx', async () => {
    const job = startJob({
        concurrency: 1, intervalMs: 0,
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
    const job = startJob({ intervalMs: 0, companies: [{ cnpj: '12345678000199', keys: [CH] }] }); // sem pfxB64
    assert.strictEqual(job.done, true);
    assert.match(job.error, /nenhuma empresa/i);
});

// Em relatório de entradas a chave carrega o CNPJ do fornecedor: deduzir o interessado
// dela mandaria a consulta assinada por um CNPJ perguntando por outro.
test('startJob: sem cnpj explícito a empresa é recusada (não deduz da chave)', () => {
    const job = startJob({
        intervalMs: 0,
        companies: [{ pfxB64: Buffer.from('fakepfx').toString('base64'), senha: 'pw', keys: [CH] }],
    });
    assert.strictEqual(job.done, true);
    assert.match(job.error, /nenhuma empresa/i);
});

// Em entradas o <emit> é o fornecedor; batizar o ZIP com ele dava
// "NFe 06-2026_J. SLEIMAN..." num pacote de notas de outra empresa (visto no E2E real).
test('startJob: nome do ZIP sai do <dest> quando o CNPJ do dest é o da empresa', async () => {
    const xml = `<nfeProc><NFe><infNFe Id="NFe${CH}">` +
        '<emit><CNPJ>99999999000191</CNPJ><xNome>FORNECEDOR SA</xNome></emit>' +
        '<dest><CNPJ>12345678000199</CNPJ><xNome>EMPRESA DO CERTIFICADO LTDA</xNome></dest>' +
        '</infNFe></NFe></nfeProc>';
    const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const job = startJob({
        concurrency: 1, intervalMs: 0,
        _poster: async () => ({ status: 200, text: `<retDistDFeInt><cStat>138</cStat><docZip schema="procNFe_v4.00.xsd">${b64}</docZip></retDistDFeInt>` }),
        companies: [{
            cnpj: '12345678000199', cufAutor: '23', tpAmb: 1,
            pfxB64: Buffer.from('fakepfx').toString('base64'), senha: 'pw', keys: [CH],
        }],
    });
    for (let i = 0; i < 50 && !getStatus(job.id).done; i++) await new Promise((r) => setTimeout(r, 20));
    assert.match(getCompanyZip(job.id, getStatus(job.id).companies[0].id).name, /EMPRESA DO CERTIFICADO/);
});

// A SEFAZ corta com 656 quando as consultas vêm em rajada; sem a pausa o lote inteiro
// morre nas primeiras chaves (medido: 16ª chave, ~3 s de execução).
test('startJob: intervalMs espaça as consultas da mesma empresa', async () => {
    const CH2 = '23250312345678000199550010000000021000000024';
    const CH3 = '23250312345678000199550010000000031000000031';
    const t0 = Date.now();
    const job = startJob({
        concurrency: 3, intervalMs: 120,
        _poster: async () => ({ status: 200, text: docResp(CH) }),
        companies: [{
            cnpj: '12345678000199', cufAutor: '23', tpAmb: 1,
            pfxB64: Buffer.from('fakepfx').toString('base64'), senha: 'pw',
            keys: [CH, CH2, CH3],
        }],
    });
    for (let i = 0; i < 100 && !getStatus(job.id).done; i++) await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(getStatus(job.id).done, true);
    // 3 chaves × 120 ms: a 1ª sai na hora, as outras esperam a vez -> >= 240 ms.
    assert.ok(Date.now() - t0 >= 240, 'esperado >= 240ms, foi ' + (Date.now() - t0) + 'ms');
});

// A SEFAZ libera 20 consultas/hora por CNPJ (ela mesma diz no 656). Passar disso só
// queima quota da hora seguinte, então o job para no orçamento e zipa o que veio.
test('startJob: para no teto de consultas e ainda entrega o ZIP do que baixou', async () => {
    const keys = Array.from({ length: 5 }, (_, i) =>
        '2325031234567800019955001000000000' + String(i + 1).padStart(2, '0') + '00000001');
    let chamadas = 0;
    const job = startJob({
        concurrency: 1, intervalMs: 0, maxConsultas: 2,
        // devolve o doc da chave que foi pedida (senão cai no check de mismatch)
        _poster: async ({ body }) => {
            chamadas++;
            return { status: 200, text: docResp(body.match(/<chNFe>(\d{44})<\/chNFe>/)[1]) };
        },
        companies: [{
            cnpj: '12345678000199', cufAutor: '23', tpAmb: 1,
            pfxB64: Buffer.from('fakepfx').toString('base64'), senha: 'pw', keys,
        }],
    });
    for (let i = 0; i < 50 && !getStatus(job.id).done; i++) await new Promise((r) => setTimeout(r, 20));
    const c = getStatus(job.id).companies[0];
    assert.strictEqual(chamadas, 2, 'não pode gastar consulta além do teto');
    assert.strictEqual(c.downloaded, 2);
    assert.strictEqual(c.errors, 3);
    assert.ok(c.zipReady, 'o que baixou tem que sair no ZIP');
    const det = getCompanyDetail(job.id, c.id);
    assert.match(det.failures[0].motivo, /teto de 2 consultas\/hora/);
});

test('startJob: cStat 641 aborta só a empresa e marca todas as chaves', async () => {
    const job = startJob({
        concurrency: 1, intervalMs: 0,
        _poster: async () => ({ status: 200, text: '<retDistDFeInt><cStat>641</cStat><xMotivo>NF-e indisponivel para o emitente</xMotivo></retDistDFeInt>' }),
        companies: [{
            cnpj: '12345678000199', cufAutor: '23', tpAmb: 1,
            pfxB64: Buffer.from('fakepfx').toString('base64'), senha: 'pw',
            keys: [CH, '23250312345678000199550010000000021000000024'],
        }],
    });
    for (let i = 0; i < 50 && !getStatus(job.id).done; i++) await new Promise((r) => setTimeout(r, 20));
    const c = getStatus(job.id).companies[0];
    assert.strictEqual(c.errors, 2);       // a 2ª nem é tentada
    assert.strictEqual(c.downloaded, 0);
    assert.strictEqual(c.aborted, true);
});
