// Checagem de `conferirFocoEmpresa` — a regra que decide o que está "fora do
// foco" nas telas de download e de apuração.
//
// Roda em Node, sem framework e sem dependência:
//     node scripts/check-foco-empresa.mjs
//
// A função vive dentro de assets/js/app.js, que é um script de navegador sem
// exports. Em vez de fatiá-la num módulo só para testar (diff grande, dois
// lugares para manter), este script EXTRAI a declaração do arquivo e avalia.
// Efeito colateral desejado: se alguém renomear ou apagar a função, o script
// falha na extração — que é justamente o aviso que se quer.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'assets/js/app.js'), 'utf8');

/** Recorta `function <nome>(...) { ... }` casando chaves. */
function extrairFuncao(nome) {
    const inicio = fonte.indexOf(`function ${nome}(`);
    assert.notEqual(inicio, -1, `função ${nome} não existe mais em assets/js/app.js`);
    let i = fonte.indexOf('{', inicio);
    let nivel = 0;
    for (; i < fonte.length; i++) {
        if (fonte[i] === '{') nivel++;
        else if (fonte[i] === '}' && --nivel === 0) return fonte.slice(inicio, i + 1);
    }
    throw new Error(`chaves desbalanceadas em ${nome}`);
}

// `conferirFocoEmpresa` chama getEmpresaAtiva; o stub entra pelo escopo do eval.
let empresaEmFoco = null;
const getEmpresaAtiva = () => empresaEmFoco;
const conferirFocoEmpresa = eval(`(${extrairFuncao('conferirFocoEmpresa')})`);

const ALFA = '12345678000190';
const BETA = '98765432000110';

// 1. Sem empresa em foco não existe "fora do foco" — nenhuma tela deve avisar.
empresaEmFoco = null;
assert.equal(conferirFocoEmpresa([ALFA, BETA]), null, 'sem foco deveria devolver null');

// 2. Lote todo da empresa em foco: silêncio. Avisar quando está certo é ruído.
empresaEmFoco = { cnpj: ALFA, razaoSocial: 'ALFA' };
assert.equal(conferirFocoEmpresa([ALFA, ALFA]), null, 'lote 100% no foco deveria devolver null');

// 3. Lote misto: separa, e a máscara do CNPJ não pode mudar o resultado.
const misto = conferirFocoEmpresa(['12.345.678/0001-90', BETA]);
assert.ok(misto, 'lote misto deveria avisar');
assert.deepEqual(misto.dentro, [ALFA], 'CNPJ mascarado deveria contar como dentro');
assert.deepEqual(misto.fora, [BETA]);

// 4. Repetido conta uma vez só — senão o aviso diria "3 empresas" para 1.
const repetido = conferirFocoEmpresa([BETA, BETA, BETA]);
assert.deepEqual(repetido.fora, [BETA], 'CNPJ repetido deveria ser contado uma vez');
assert.deepEqual(repetido.dentro, [], 'nada do foco no lote');

// 5. Entradas vazias/sujas são ignoradas, não viram empresa fantasma.
empresaEmFoco = { cnpj: ALFA, razaoSocial: 'ALFA' };
assert.equal(conferirFocoEmpresa(['', null, undefined, '   ', ALFA]), null,
    'lixo + só o CNPJ do foco deveria devolver null');

console.log('OK — conferirFocoEmpresa passou nas 5 checagens.');
