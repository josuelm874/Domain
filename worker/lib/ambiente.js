/* ------------------------------ Afericao do ambiente Node ------------------------------
 *
 * Diz, NO BOOT, em que Node o worker esta rodando e o que falta nele. Existe porque a
 * mesma build funcionava na maquina pessoal e falhava na da empresa, e o sintoma na tela
 * ("todas as notas em erro") nao continha uma unica palavra sobre a causa. Foram rodadas
 * de hipotese para um fato que `process.version` responderia em 5 segundos.
 *
 * Regra do projeto que isto materializa: erro e o que o instrumento mede, nao o que o
 * sintoma sugere. Entao o worker passa a MEDIR o proprio interpretador e a imprimir o
 * resultado antes de qualquer job -- e o repete em /health, onde a UI consegue ler.
 *
 * Este arquivo e deliberadamente o mais conservador do repo em sintaxe (sem `class`, sem
 * catch sem binding, sem `?.`/`??`): se o Node for velho demais para o resto do worker, o
 * que precisa sobreviver e justamente a mensagem que explica isso.
 * --------------------------------------------------------------------------------------- */
'use strict';

// Piso real do worker hoje. Nao e chute: `lib/token-mfe.js` usa `String.matchAll`
// (Node 12) e varios modulos usam catch sem binding (Node 10). Abaixo de 12 alguma coisa
// quebra em runtime; abaixo de 10 nem faz parse.
var NODE_MINIMO = 12;

// Globais que o worker JA dependeu e que nao existem em Node antigo. Cada entrada diz
// onde doi, porque "AbortController ausente" sozinho nao explica nada a quem le o log.
var GLOBAIS = [
    { nome: 'fetch', desde: 18, onde: 'download de NFCe (substituido por lib/http.js)' },
    { nome: 'AbortController', desde: 15, onde: 'timeout de requisicao (substituido por req.setTimeout)' },
    { nome: 'structuredClone', desde: 17, onde: '(nao usado hoje -- guarda contra regressao)' }
];

function versaoNumerica() {
    var m = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version || '');
    if (!m) return { major: 0, minor: 0, patch: 0 };
    return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

/** Aferido, nao suposto: testa cada global de verdade em vez de inferir pela versao. */
function faltantes() {
    var fora = [];
    for (var i = 0; i < GLOBAIS.length; i++) {
        var g = GLOBAIS[i];
        if (typeof global[g.nome] === 'undefined') fora.push(g);
    }
    return fora;
}

/**
 * Retrato do interpretador. `arch` entra porque o requisito do ambiente e Node 32-bit
 * pre-instalado em "C:\Program Files (x86)\nodejs": se um dia alguem trocar por 64-bit
 * e algo mudar, o log ja registra qual era.
 *
 * SEM `execPath` de proposito: isto e servido em /health, a unica rota sem pareamento.
 * Caminho de disco nao sai por ali. O boot local imprime o execPath a parte.
 */
function diagnostico() {
    var v = versaoNumerica();
    var fora = faltantes();
    return {
        versao: process.version,
        major: v.major,
        arch: process.arch,
        plataforma: process.platform,
        suportado: v.major >= NODE_MINIMO,
        minimo: NODE_MINIMO,
        globaisAusentes: fora.map(function (g) { return g.nome; }),
        // Nao e so a lista: e o que a ausencia custa, para a linha de log ser acionavel.
        avisos: fora.map(function (g) {
            return g.nome + ' ausente (existe a partir do Node ' + g.desde + ') -- ' + g.onde;
        })
    };
}

/**
 * Imprime o retrato. Chamado uma vez no boot do server.
 *
 * NAO aborta o processo quando o Node e velho: o worker tem caminhos que funcionam em
 * Node antigo (NFe ja usava `https.request`) e derrubar tudo trocaria uma falha explicada
 * por uma tela preta. Avisa alto e segue.
 */
function imprimir(log) {
    var out = log || console;
    var d = diagnostico();
    out.log('  node ' + d.versao + ' (' + d.arch + ', ' + d.plataforma + ')');
    // Só no console local: confirma QUAL instalação está rodando. Na máquina da empresa a
    // exigência é o Node 32-bit de "C:\Program Files (x86)\nodejs"; ter isso no log evita
    // a rodada de "mas eu instalei o 20" quando o PATH aponta para outro.
    out.log('  binário: ' + process.execPath);
    if (!d.suportado) {
        out.log('  [AVISO] Node ' + d.major + ' esta abaixo do minimo testado (' + d.minimo + ').' +
            ' O worker vai tentar rodar mesmo assim.');
    }
    for (var i = 0; i < d.avisos.length; i++) out.log('  [AVISO] ' + d.avisos[i]);
    if (d.suportado && !d.avisos.length) out.log('  ambiente: ok (nenhum global moderno em falta)');
    return d;
}

module.exports = { diagnostico, imprimir, NODE_MINIMO };
