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

// ---------------------------------------------------------------------------
// Extratores de CNPJ que alimentam a conferência nas telas de processamento.
// ---------------------------------------------------------------------------
const cnpjsDeChaves = eval(`(${extrairFuncao('cnpjsDeChaves')})`);
const cnpjDoSped = eval(`(${extrairFuncao('cnpjDoSped')})`);

// 6. A chave de acesso carrega o CNPJ do emitente nas posições 7-20 (1-based).
const chaveAlfa = '23' + '2608' + ALFA + '65' + '001' + '000000001' + '1' + '12345678' + '0';
assert.equal(chaveAlfa.length, 44, 'chave de teste precisa ter 44 dígitos');
assert.deepEqual(cnpjsDeChaves([chaveAlfa]), [ALFA], 'CNPJ deveria sair das posições 7-20');

// 7. Chave com máscara e chave curta: uma entra limpa, a outra é descartada.
assert.deepEqual(
    cnpjsDeChaves([chaveAlfa.replace(/(\d{4})/g, '$1 '), '123', '']),
    [ALFA],
    'máscara deveria ser tolerada e chave curta descartada');

// 8. Duas notas da mesma empresa contam como uma empresa só.
const chaveAlfa2 = '23' + '2608' + ALFA + '65' + '001' + '000000002' + '1' + '87654321' + '0';
assert.deepEqual(cnpjsDeChaves([chaveAlfa, chaveAlfa2]), [ALFA]);

// 9. SPED: o CNPJ é o campo 7 do registro |0000|.
const sped = [
    '|0000|017|0|01012026|31012026|EMPRESA EXEMPLO LTDA|' + ALFA + '||CE|0612345|2304400|||A|1|',
    '|0001|0|',
].join('\n');
assert.equal(cnpjDoSped(sped), ALFA, 'CNPJ deveria sair do campo 7 do |0000|');

// Terminação Windows (\r\n) é o caso comum de SPED e não pode sujar o CNPJ.
assert.equal(cnpjDoSped(sped.replace(/\n/g, '\r\n')), ALFA, 'CRLF deveria ser tolerado');

// 10. Arquivo sem |0000| (ou .fs) devolve vazio — e vazio não vira aviso.
assert.equal(cnpjDoSped('|C100|0|1|\n|C170|1|'), '', 'sem |0000| deveria devolver vazio');
assert.equal(cnpjDoSped(''), '');

console.log('OK — conferirFocoEmpresa, cnpjsDeChaves e cnpjDoSped passaram nas 10 checagens.');
