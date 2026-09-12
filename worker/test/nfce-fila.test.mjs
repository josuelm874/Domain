/* ------------------------- Fila do download de NFCe -------------------------
 *
 * O que este arquivo trava: o worker processa UMA empresa por vez, na ordem em que a UI
 * mandou. Antes era round-robin (`ativos[job.rr % ativos.length]`), e 4 empresas andavam
 * juntas — nenhum ZIP saía antes do fim do lote inteiro.
 *
 * Testa `nextJob` direto, sem rede: é onde a ordem é decidida. Pela borda HTTP só daria
 * para ver a ordem com um lote grande e um mock temporizado — mais peça móvel, mesma
 * conclusão.
 *
 * Rodar:  node worker/test/nfce-fila.test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nfce = require('../lib/nfce.js');

let passou = 0;
const falhas = [];
function ok(cond, nome, detalhe) {
    if (cond) { passou++; console.log('  ok   ' + nome); }
    else { falhas.push(nome + (detalhe ? ' -- ' + detalhe : '')); console.log('  FALHA ' + nome + (detalhe ? ' -- ' + detalhe : '')); }
}

// Chave válida em formato (44 dígitos), CNPJ nas posições 6-20.
const chave = (cnpj, n) => '23' + '2605' + cnpj + '65' + '001' + String(n).padStart(9, '0') + '1' + '00000001' + '7';
const CNPJ_A = '11111111000111';
const CNPJ_B = '22222222000122';
const CNPJ_C = '33333333000133';

// Job montado à mão: mesma forma que `startJob` produz, sem disparar `runJob` (que iria
// à rede). Só o que `nextJob` lê.
function jobFalso(ordem) {
    const companies = new Map();
    for (const [cnpj, qtd] of ordem) {
        const keys = Array.from({ length: qtd }, (_, i) => chave(cnpj, i + 1));
        companies.set(cnpj + '-202605', { id: cnpj + '-202605', cnpj, pending: keys.slice(), total: qtd, aborted: false });
    }
    return { companies };
}

console.log('\n--- fila: uma empresa por vez, na ordem recebida ---');
{
    const job = jobFalso([[CNPJ_A, 2], [CNPJ_B, 2], [CNPJ_C, 1]]);
    const saida = [];
    for (let i = 0; i < 5; i++) saida.push(nfce.nextJob(job).comp.cnpj);
    ok(saida.join(',') === [CNPJ_A, CNPJ_A, CNPJ_B, CNPJ_B, CNPJ_C].join(','),
        'esvazia A, depois B, depois C', saida.join(','));
    ok(nfce.nextJob(job) === null, 'devolve null quando acaba');
}

console.log('\n--- fila: a ordem é a que a UI mandou, não a alfabética ---');
{
    const job = jobFalso([[CNPJ_C, 1], [CNPJ_A, 1]]);
    ok(nfce.nextJob(job).comp.cnpj === CNPJ_C, 'a 1a do Map vem primeiro mesmo sendo a maior');
}

console.log('\n--- fila: empresa abortada é pulada, não trava a fila ---');
{
    const job = jobFalso([[CNPJ_A, 1], [CNPJ_B, 1]]);
    job.companies.get(CNPJ_A + '-202605').aborted = true;
    const j = nfce.nextJob(job);
    ok(j && j.comp.cnpj === CNPJ_B, 'pula a abortada e entrega a seguinte', j ? j.comp.cnpj : 'null');
}

console.log('\n--- getStatus: marca quem está esperando a vez ---');
{
    // Aqui passa pelo `startJob` real. Sem token e sem `_obterToken`, `resolverTokens`
    // aborta as empresas — mas o status é lido ANTES do await do runJob chegar lá, que é
    // exatamente o instante em que a UI pinta os anéis pela primeira vez.
    const job = nfce.startJob({
        companies: [
            { id: CNPJ_A + '-202605', cnpj: CNPJ_A, token: 'x.y.z', taxid: CNPJ_A, keys: [chave(CNPJ_A, 1), chave(CNPJ_A, 2)] },
            { id: CNPJ_B + '-202605', cnpj: CNPJ_B, token: 'x.y.z', taxid: CNPJ_B, keys: [chave(CNPJ_B, 1)] },
            { id: CNPJ_C + '-202605', cnpj: CNPJ_C, token: 'x.y.z', taxid: CNPJ_C, keys: [chave(CNPJ_C, 1)] },
        ],
        concurrency: 1,
    });
    const st = nfce.getStatus(job.id);
    const a = st.companies.find((c) => c.cnpj === CNPJ_A);
    const b = st.companies.find((c) => c.cnpj === CNPJ_B);
    const c = st.companies.find((c) => c.cnpj === CNPJ_C);
    ok(!a.fila, 'a 1a da fila NÃO é marcada como esperando');
    ok(b.fila === true && b.posicao === 1, 'a 2a é 1a da espera', JSON.stringify({ fila: b.fila, pos: b.posicao }));
    ok(c.fila === true && c.posicao === 2, 'a 3a é 2a da espera', JSON.stringify({ fila: c.fila, pos: c.posicao }));
}

console.log('\n--- código: o round-robin não pode voltar ---');
{
    const fonte = require('node:fs').readFileSync(new URL('../lib/nfce.js', import.meta.url), 'utf8');
    ok(!/job\.rr/.test(fonte), 'nenhuma referência a job.rr sobrou em lib/nfce.js');
}

console.log('\n' + passou + ' ok, ' + falhas.length + ' falha(s)');
if (falhas.length) { falhas.forEach((f) => console.log('  - ' + f)); process.exit(1); }
process.exit(0);
