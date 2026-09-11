/* ------------------- NFCe sobre https.request: transporte e guarda de regressão -------------------
 *
 * Dois trabalhos distintos neste arquivo:
 *
 * 1. PROVAR o caminho feliz com o transporte novo. Um mock HTTP local no lugar da SEFAZ,
 *    job completo, ZIP conferido. Sem isso, a troca de `fetch` por `https.request` seria
 *    uma afirmação minha, não um fato medido.
 *
 * 2. TRAVAR a regressão que custou o diagnóstico da máquina da empresa. O download de NFCe
 *    pulava de 0% para 100% com todas as notas em erro porque `new AbortController()`
 *    estava FORA do try de `fetchWithRetry` — em Node < 15 isso rejeita antes de qualquer
 *    retry, instantaneamente, sem tocar a rede. O teste lê o FONTE de nfce.js e recusa o
 *    reaparecimento de `fetch(`/`AbortController`. É teste de código, não de comportamento,
 *    de propósito: o comportamento só diverge num Node que esta máquina não tem para rodar.
 *
 * Rodar:  node worker/test/nfce-http.test.mjs
 * -------------------------------------------------------------------------------------------------- */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(__dirname, '..', 'lib');

let passou = 0;
const falhas = [];
function ok(cond, nome, detalhe) {
    if (cond) { passou++; console.log('  ok   ' + nome); }
    else { falhas.push(nome + (detalhe ? ' -- ' + detalhe : '')); console.log('  FALHA ' + nome + (detalhe ? ' -- ' + detalhe : '')); }
}

// ---------------------------------------------------------------- fixtures ----
// Chave real em formato, dados inventados. Posições 2-6 = AAMM (2605 -> 05-2026);
// 6-20 = CNPJ do emitente. O nome do ZIP depende das duas coisas.
const CNPJ = '12345678000199';
const CHAVE_A = '23' + '2605' + CNPJ + '65' + '001' + '000000001' + '1' + '00000001' + '7';
const CHAVE_B = '23' + '2605' + CNPJ + '65' + '001' + '000000002' + '1' + '00000002' + '3';

function jwtFalso(sub) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // Assinatura não é verificada por nada no worker — só o payload `sub` é lido.
    return b64({ alg: 'HS256' }) + '.' + b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.xxxx';
}

const xmlDe = (chave) =>
    '<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe Id="NFe' + chave + '">' +
    '<emit><CNPJ>' + CNPJ + '</CNPJ><xNome>PADARIA TESTE LTDA</xNome></emit>' +
    '</infNFe></NFe></nfeProc>';

// ---------------------------------------------------------------- mock SEFAZ ----
// Reproduz só o contrato que o worker usa: extract -> {idNfe}, xml -> texto.
const vistos = { extract: 0, xml: 0, headers: [] };

const mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    vistos.headers.push({
        token: req.headers['x-authentication-token'] || '',
        taxid: req.headers['x-authentication-taxid'] || '',
    });

    // Só as duas chaves conhecidas existem. Qualquer outra cai no 404 do fim — é o que a
    // SEFAZ faz com cupom que o CNPJ não emitiu, e o teste do 404 depende disso.
    const CONHECIDAS = [CHAVE_A, CHAVE_B];

    let m = /\/coupons\/extract\/(\d{44})$/.exec(u.pathname);
    if (m && CONHECIDAS.indexOf(m[1]) !== -1) {
        vistos.extract++;
        // Aninhado de propósito: `extrairIdNfe` faz busca em profundidade rasa justamente
        // porque a API já mudou o nível do campo uma vez.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ coupon: { idNfe: 'ID-' + m[1].slice(-6) } }));
        return;
    }
    m = /\/fiscal-coupons\/xml\/ID-(\d{6})$/.exec(u.pathname);
    if (m) {
        vistos.xml++;
        const chave = u.searchParams.get('chaveAcesso') || '';
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(xmlDe(chave));
        return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"erro":"rota nao mockada"}');
});

await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + mock.address().port;

// ------------------------------------------------- simulação de Node antigo ----
// A máquina da empresa não está aqui para rodar teste, então o teste vai até ela: apagar
// `fetch` e `AbortController` do global reproduz um Node < 15 na parte que importa. Todo
// o resto deste arquivo roda nesse ambiente. Se alguém reintroduzir qualquer um dos dois
// em nfce.js, o caminho feliz abaixo quebra AQUI — não só na empresa, três dias depois.
const tinhaFetch = typeof globalThis.fetch !== 'undefined';
const tinhaAbort = typeof globalThis.AbortController !== 'undefined';
delete globalThis.fetch;
delete globalThis.AbortController;

// API_BASE é lido na carga do módulo: o env TEM que vir antes do require.
process.env.SEFAZ_BASE = base;
const require_ = createRequire(import.meta.url);
const nfce = require_(path.join(LIB, 'nfce.js'));

console.log('\n  NFCe sobre https.request (com fetch/AbortController apagados do global)\n');

ok(tinhaFetch && tinhaAbort, 'este Node TINHA fetch e AbortController antes da simulação');
ok(typeof globalThis.fetch === 'undefined' && typeof globalThis.AbortController === 'undefined',
    'simulação ativa: nenhum dos dois existe daqui para baixo');

// ---------------------------------------------------------------- 1. caminho feliz ----
const token = jwtFalso(CNPJ);
const job = nfce.startJob({
    concurrency: 4,
    companies: [{ cnpj: CNPJ, token, keys: [CHAVE_A, CHAVE_B] }],
});

const limite = Date.now() + 20000;
while (!job.done && Date.now() < limite) await new Promise((r) => setTimeout(r, 50));

ok(job.done, 'job termina');
ok(!job.error, 'job sem erro global', job.error);

const comp = Array.from(job.companies.values())[0];
ok(!!comp, 'empresa registrada');
ok(comp && comp.downloaded === 2, 'duas chaves baixadas', comp && ('downloaded=' + comp.downloaded));
ok(comp && comp.errors === 0, 'nenhum erro',
    comp && comp.failures.map((f) => f.chave + ': ' + f.motivo).join(' | '));
ok(vistos.extract === 2 && vistos.xml === 2, 'mock viu 2 extract + 2 xml',
    'extract=' + vistos.extract + ' xml=' + vistos.xml);

// Os headers de autenticação sobreviveram à troca de transporte? `fetch` normalizava
// nomes de header sozinho; `https.request` não. Se caíssem, a SEFAZ responderia 401 e o
// sintoma voltaria a ser "todas as notas em erro" — desta vez por outro motivo.
const todosComToken = vistos.headers.length > 0 &&
    vistos.headers.every((h) => h.token === token && h.taxid === CNPJ);
ok(todosComToken, 'x-authentication-token e -taxid chegam em toda requisição',
    JSON.stringify(vistos.headers[0] || {}));

ok(comp && comp.phase === 'done', 'empresa finalizada', comp && comp.phase);
ok(comp && comp.zipBuffer && comp.zipBuffer.length > 0, 'ZIP gerado');
ok(comp && /PADARIA TESTE LTDA/.test(comp.zipName), 'nome do emitente extraído do XML para o ZIP',
    comp && comp.zipName);
ok(comp && /^NFCe 05-2026_/.test(comp.zipName), 'mês/ano derivado da chave no nome do ZIP',
    comp && comp.zipName);

// O ZIP tem que ser lido de volta, não só existir: `buildZip` é implementação própria.
const { readZip } = require_(path.join(LIB, 'zip.js'));
let nomesNoZip = [];
try { nomesNoZip = readZip(comp.zipBuffer).map((e) => e.name).sort(); } catch (e) { /* cai na asserção */ }
ok(nomesNoZip.length === 2 && nomesNoZip[0] === CHAVE_A + '.xml',
    'ZIP relê com os dois XMLs', nomesNoZip.join(','));

// ---------------------------------------------------------------- 2. 404 vira motivo legível ----
const job404 = nfce.startJob({
    concurrency: 1,
    // Chave válida em formato mas ausente do mock: o extract responde 404.
    companies: [{ cnpj: CNPJ, token, keys: ['99' + CHAVE_A.slice(2)] }],
});
const limite404 = Date.now() + 20000;
while (!job404.done && Date.now() < limite404) await new Promise((r) => setTimeout(r, 50));
const c404 = Array.from(job404.companies.values())[0];
ok(c404 && c404.errors === 1, 'chave inexistente conta como erro');
ok(c404 && /404/.test(c404.failures[0] && c404.failures[0].motivo || ''),
    'motivo do erro nomeia o 404 em vez de "erro"', c404 && JSON.stringify(c404.failures[0]));

// ---------------------------------------------------------------- 3. guarda de regressão ----
// A causa raiz do 0->100% instantâneo na máquina da empresa. Ler o fonte é feio e é o
// ponto: se alguém reintroduzir `fetch` aqui, o defeito só aparece numa máquina que não
// temos para rodar teste. Falhar agora é mais barato que descobrir lá.
const fonte = fs.readFileSync(path.join(LIB, 'nfce.js'), 'utf8');
const semComentario = fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

ok(!/\bnew\s+AbortController\b/.test(semComentario),
    'nfce.js não constrói AbortController (não existe em Node < 15)');
ok(!/[^.\w]fetch\s*\(/.test(semComentario),
    'nfce.js não chama o fetch global (não existe em Node < 18)');
ok(/require\(['"]\.\/http['"]\)/.test(semComentario),
    'nfce.js usa o transporte de lib/http.js');

// ---------------------------------------------------------------- fim ----
mock.close();
console.log('\n  ' + passou + ' asserções ok, ' + falhas.length + ' falha(s)\n');
if (falhas.length) { falhas.forEach((f) => console.error('    - ' + f)); process.exit(1); }
