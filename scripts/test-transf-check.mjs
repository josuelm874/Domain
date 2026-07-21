/* Self-check do núcleo da Checagem de Transferências:  node scripts/test-transf-check.mjs
 * Cobre a normalização das células do relatório (CFOP com ponto de milhar / ".0" /
 * múltiplos por nota) e as três saídas da comparação: ausente, divergente, compatível. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/transf-check.js');

// --- normalização de CFOP ---
assert.deepEqual(core.normCfops(5409), ['5409']);
assert.deepEqual(core.normCfops('5409.0'), ['5409']);              // float renderizado
assert.deepEqual(core.normCfops('5.152;5.409'), ['5152', '5409']); // ponto de milhar
assert.deepEqual(core.normCfops(''), []);

// --- CST ---
assert.deepEqual(core.normCsts('060'), ['060']);
assert.deepEqual(core.normCsts(60), ['060']);
assert.deepEqual(core.normCsts('040;060'), ['040', '060']);

// --- valor ---
assert.equal(core.parseValor(4100.85), 4100.85);
assert.equal(core.parseValor('1.036,88'), 1036.88);  // BR
assert.equal(core.parseValor('1,036.88'), 1036.88);  // US

// --- sentido do CFOP ---
assert.equal(core.cfopEntradaParaSaida('1409'), '5409');
assert.equal(core.cfopEntradaParaSaida('2409'), '6409');
assert.equal(core.cfopEntradaParaSaida('5409'), '5409');

const CHAVE_A = '2'.repeat(44);
const CHAVE_B = '3'.repeat(44);
const CHAVE_C = '4'.repeat(44);
const linha = (chave, cfops, csts, valor) => ({ chave, cfops, csts, valor, origem: 'teste.xls' });

// A = compatível (5409 -> 1409) | B = valor divergente | C = ausente na entrada
const saida = [
    linha(CHAVE_A, ['5409'], ['060'], 153.0),
    linha(CHAVE_B, ['5152'], ['060'], 245.0),
    linha(CHAVE_C, ['5409'], ['060'], 99.0),
    linha('9'.repeat(44), ['5411'], ['060'], 41.63), // não é transferência: ignorada
];
const entrada = [
    linha(CHAVE_A, ['1409'], ['060'], 153.0),
    linha(CHAVE_B, ['1152'], ['060'], 200.0),
];

const r = core.compararTransferencias(saida, entrada);
assert.equal(r.totalTransferencias, 3, 'só as notas com CFOP 5409/5152 entram na checagem');
assert.equal(r.ok, 1);
assert.deepEqual(r.faltantes.map((f) => f.chave), [CHAVE_C]);
assert.equal(r.divergentes.length, 1);
assert.deepEqual(r.divergentes[0].campos.map((c) => c.campo), ['Valor']);

// CST repetido uma vez por CFOP não é divergência de CST — só o CFOP consolidado acusa.
const parcial = core.compararTransferencias(
    [linha(CHAVE_A, ['5152', '5409'], ['060', '060'], 100.0)],
    [linha(CHAVE_A, ['1409'], ['060'], 100.0)]
);
assert.deepEqual(parcial.divergentes[0].campos.map((c) => c.campo), ['CFOP']);

// Tudo batendo -> nenhum achado (o "Transferências Compatíveis" da UI).
const limpo = core.compararTransferencias([saida[0]], [entrada[0]]);
assert.equal(limpo.faltantes.length + limpo.divergentes.length, 0);

console.log('✅ test-transf-check: todas as asserções passaram');
