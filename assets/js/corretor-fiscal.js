/*
 * Corretor Fiscal — transformações determinísticas de texto para arquivos SPED e FS.
 *
 * Funções puras (string -> { texto, resumo, stats }). Sem dependência de DOM, para
 * rodarem tanto no navegador quanto em harness Node (guard module.exports no fim).
 *
 * ENCODING: os arquivos são tratados como latin1 (ISO-8859-1) ponta a ponta. Cada
 * byte vira exatamente 1 caractere (0-255), então o round-trip é byte-a-byte para
 * linhas intactas, e "length" === número de bytes. Isso casa com o validador, que
 * conta bytes (regra 4: "Esperado: 60; Informado: 62" bate com a contagem de bytes,
 * mesmo em arquivos UTF-8 com acento). Quem lê/escreve (app.js / harness) é
 * responsável por decodificar/encodar em latin1; aqui só manipulamos a string.
 *
 * QUEBRAS DE LINHA: split por '\n' preservando o '\r' (arquivos FS são CRLF; o SPED
 * de teste é LF). O '\r' fica grudado no ÚLTIMO campo de cada linha; como nenhuma das
 * regras edita o último campo dos registros envolvidos, o '\r' é preservado no rejoin.
 */

// Tipo do registro de uma linha FS (sem pipe inicial): "PRO|..." -> "PRO".
function regFs(line) {
    if (!line) return '';
    const i = line.indexOf('|');
    return i === -1 ? line : line.slice(0, i);
}

// Detecta SPED vs FS pelo conteúdo das primeiras linhas não vazias.
function detectarTipo(text) {
    const lines = text.split('\n');
    const limite = Math.min(lines.length, 50);
    for (let i = 0; i < limite; i++) {
        const l = lines[i];
        if (l.startsWith('|0000|') || l.startsWith('|0190|') || l.startsWith('|C170|')) return 'sped';
        if (l.startsWith('CAB|') || l.startsWith('NOP|') || l.startsWith('NVC|') || l.startsWith('PRO|')) return 'fs';
    }
    return null;
}

/*
 * SPED — Regra 1: unidade inválida no registro C170.
 * Monta o conjunto de códigos de unidade declarados nos 0190 (campo2 = elemento[2],
 * por causa do pipe inicial). Para cada C170, se o campo6 (elemento[6]) não estiver
 * nesse conjunto, troca por "UN". Global.
 */
function corrigirSped(text) {
    const lines = text.split('\n');

    const unidades = new Set();
    for (const l of lines) {
        if (l.startsWith('|0190|')) {
            const p = l.split('|');
            if (p[2] !== undefined && p[2] !== '') unidades.add(p[2]);
        }
    }

    let totalC170 = 0;
    let trocadas = 0;
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('|C170|')) continue;
        totalC170++;
        const p = lines[i].split('|');
        if (p[6] === undefined) continue;
        if (!unidades.has(p[6])) {
            p[6] = 'UN';
            lines[i] = p.join('|');
            trocadas++;
        }
    }

    const resumo = [
        `Regra 1 — unidade inválida (C170): ${trocadas} de ${totalC170} unidade(s) trocada(s) para "UN" ` +
        `(${unidades.size} unidade(s) válida(s) no 0190).`,
    ];
    return { texto: lines.join('\n'), resumo, stats: { totalC170, trocadas, unidades0190: unidades.size } };
}

// Parseia o relatório de erros FS: cada linha começa com 10 dígitos (nº da linha).
// Linhas de prosa explicativa (sem nº) são ignoradas. Retorna { duplicados: [int] }
// com os nº de linha dos "Documento já cadastrado" (única regra dirigida pelo relatório).
function parseRelatorioFs(relatorioTxt) {
    const duplicados = [];
    if (!relatorioTxt) return { duplicados };
    for (const raw0 of relatorioTxt.split('\n')) {
        const raw = raw0.replace(/\r$/, ''); // CRLF: tira o \r para o $ ancorar
        const m = raw.match(/^(\d{10})\s+(.*)$/);
        if (!m) continue;
        const linha = parseInt(m[1], 10); // tira zeros à esquerda
        // Tolerante a acento: o relatório pode vir UTF-8 lido como latin1 ("já" -> "jÃ¡").
        // Casa "Documento j...cadastrado" sem depender do byte do "á".
        if (/Documento j.{0,4}cadastrado/i.test(m[2])) duplicados.push(linha);
    }
    return { duplicados };
}

// Acha um token de data AAAAMMDD plausível (8 dígitos, ano 19xx/20xx) numa linha NVC,
// para o fallback da regra 3 quando nenhum campo10 está preenchido.
function acharDataQualquer(lines) {
    for (const l of lines) {
        if (regFs(l) !== 'NVC') continue;
        const p = l.split('|');
        for (const c of p) {
            if (/^(19|20)\d{6}$/.test(c)) return c;
        }
    }
    return null;
}

// 1º dia do mês anterior a uma data AAAAMMDD, no mesmo formato (sem separador).
function primeiroDiaMesAnterior(aaaammdd) {
    let ano = parseInt(aaaammdd.slice(0, 4), 10);
    let mes = parseInt(aaaammdd.slice(4, 6), 10);
    mes -= 1;
    if (mes < 1) { mes = 12; ano -= 1; }
    return String(ano) + String(mes).padStart(2, '0') + '01';
}

/*
 * FS — aplica as 5 regras (2,3,4 globais detectadas no próprio arquivo; 5 dirigida
 * pelo relatório). As regras 2/3/4 não mudam a contagem de linhas, então a 5
 * (que deleta blocos) usa os nº de linha do relatório contra a indexação original.
 */
function corrigirFs(text, relatorioTxt) {
    const lines = text.split('\n');
    const resumo = [];
    const stats = {};

    // --- Regra 2: gênero do produto = 0 (PRO campo11 = elemento[10]) ---
    const freq = new Map();
    for (const l of lines) {
        if (regFs(l) !== 'PRO') continue;
        const p = l.split('|');
        const g = (p[10] || '').replace(/\r$/, '');
        if (g !== '0' && g !== '') freq.set(g, (freq.get(g) || 0) + 1);
    }
    let generoComum = null;
    let melhor = -1;
    for (const [g, n] of freq) {
        if (n > melhor) { melhor = n; generoComum = g; }
    }
    let genTrocados = 0;
    if (generoComum !== null) {
        for (let i = 0; i < lines.length; i++) {
            if (regFs(lines[i]) !== 'PRO') continue;
            const p = lines[i].split('|');
            if (p[10] === '0') {
                p[10] = generoComum;
                lines[i] = p.join('|');
                genTrocados++;
            }
        }
    }
    stats.generoTrocados = genTrocados;
    stats.generoComum = generoComum;
    resumo.push(generoComum !== null
        ? `Regra 2 — gênero PRO=0: ${genTrocados} trocado(s) para "${generoComum}" (gênero mais comum).`
        : `Regra 2 — gênero PRO=0: nenhum gênero válido encontrado; nada alterado.`);

    // --- Regra 3: data de emissão vazia (NVC campo10 = elemento[9]) ---
    let donor = null;
    for (const l of lines) {
        if (regFs(l) !== 'NVC') continue;
        const p = l.split('|');
        const d = (p[9] || '').trim();
        if (d !== '') { donor = d; break; }
    }
    if (!donor) {
        const qualquer = acharDataQualquer(lines);
        if (qualquer) donor = primeiroDiaMesAnterior(qualquer);
    }
    let dataPreenchidas = 0;
    if (donor) {
        for (let i = 0; i < lines.length; i++) {
            if (regFs(lines[i]) !== 'NVC') continue;
            const p = lines[i].split('|');
            if (p[9] !== undefined && p[9].trim() === '') {
                p[9] = donor;
                lines[i] = p.join('|');
                dataPreenchidas++;
            }
        }
    }
    stats.dataPreenchidas = dataPreenchidas;
    stats.dataUsada = donor;
    resumo.push(donor
        ? `Regra 3 — data emissão NVC vazia: ${dataPreenchidas} preenchida(s) com "${donor}".`
        : `Regra 3 — data emissão NVC vazia: nenhuma data de referência encontrada; nada alterado.`);

    // --- Regra 4: descrição > 60 (NOP e PRO, campo3 = elemento[2]) ---
    let descTruncadas = 0;
    for (let i = 0; i < lines.length; i++) {
        const reg = regFs(lines[i]);
        if (reg !== 'NOP' && reg !== 'PRO') continue;
        const p = lines[i].split('|');
        if (p[2] !== undefined && p[2].length > 60) {
            p[2] = p[2].slice(0, 60);
            lines[i] = p.join('|');
            descTruncadas++;
        }
    }
    stats.descTruncadas = descTruncadas;
    resumo.push(`Regra 4 — descrição >60 (NOP/PRO): ${descTruncadas} truncada(s) para 60.`);

    // --- Regra 5: documento já cadastrado (dirigida pelo relatório) ---
    // Bloco do documento = da linha NVC informada até a linha anterior ao próximo NVC
    // (consome PNC e o(s) IVC finais). 5 dos 8 blocos reais têm IVC múltiplo, então
    // anchorar no "1º IVC" deixaria IVC órfão e corromperia o arquivo.
    const { duplicados } = parseRelatorioFs(relatorioTxt);
    let blocosRemovidos = 0;
    let linhasRemovidas = 0;
    if (duplicados.length) {
        const apagar = new Array(lines.length).fill(false);
        for (const linha of duplicados) {
            const start = linha - 1; // 1-based -> 0-based
            if (start < 0 || start >= lines.length) continue;
            if (regFs(lines[start]) !== 'NVC') continue; // sanidade
            let end = start;
            let j = start + 1;
            while (j < lines.length && regFs(lines[j]) !== 'NVC') { end = j; j++; }
            for (let k = start; k <= end; k++) {
                if (!apagar[k]) { apagar[k] = true; linhasRemovidas++; }
            }
            blocosRemovidos++;
        }
        const kept = [];
        for (let i = 0; i < lines.length; i++) if (!apagar[i]) kept.push(lines[i]);
        lines.length = 0;
        for (const l of kept) lines.push(l);
    }
    stats.blocosRemovidos = blocosRemovidos;
    stats.linhasRemovidas = linhasRemovidas;
    if (relatorioTxt) {
        resumo.push(`Regra 5 — documento duplicado: ${blocosRemovidos} bloco(s) NVC removido(s) (${linhasRemovidas} linha(s)).`);
    } else {
        resumo.push(`Regra 5 — documento duplicado: relatório de erros não fornecido; regra ignorada.`);
    }

    return { texto: lines.join('\n'), resumo, stats };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { corrigirSped, corrigirFs, detectarTipo, parseRelatorioFs, primeiroDiaMesAnterior };
}
