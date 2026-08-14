/**
 * Cursor `ultNSU` por CNPJ, em arquivo no disco do worker.
 *
 * Por que disco do worker e não Supabase KV (que é o padrão dos outros cadastros): só o
 * worker sabe que uma chamada foi gasta. Se o browser fosse o dono, um refresh no meio do
 * job perderia o registro do bloqueio de 1 hora — e recomeçar dentro da janela zera o
 * relógio (NT 2014.002). Perder o `ultNSU` custa re-download idempotente; perder o
 * bloqueio custa a janela do CNPJ.
 *
 * ponytail: cursor é por máquina. Se o escritório rodar o worker em duas máquinas com o
 * mesmo certificado, os bloqueios não são compartilhados e dá para queimar a janela do
 * CNPJ. Se isso acontecer, subir o registro para o Supabase KV (chave `distnsu_cursors`)
 * mantendo esta interface.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Na home do usuário, ao lado do token de pareamento (server.js:89). Mesmo dono, mesmo
// ciclo de vida, e o caminho não muda entre `node worker/server.js` e o .exe do pkg.
//
// NÃO usar `path.dirname(process.execPath)` como o TEMPLATE_PATH do dirbi.js: lá o
// arquivo é LIDO (dá para trocar o modelo sem rebuildar), aqui é ESCRITO. Rodando com
// `node`, execPath é C:\Program Files\nodejs — escrever ali dá EPERM e derruba o loop
// antes da primeira chamada. Medido em 2026-08-14 no harness `scripts/distnsu-run.cjs`.
const CURSOR_PATH = process.env.DISTNSU_CURSOR_FILE ||
    path.join(os.homedir(), '.softtech-distnsu-cursors.json');

const VAZIO = { ultNSU: '0', maxNSU: '0', bloqueadoAte: 0, ultimoCStat: '', atualizadoEm: 0 };

function readAll() {
    try {
        const txt = fs.readFileSync(CURSOR_PATH, 'utf8');
        const obj = JSON.parse(txt);
        return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) {
        // Arquivo ausente, ilegível ou corrompido: começa do zero. Nunca derruba o worker
        // — um cursor perdido custa re-download, um crash custa o job inteiro.
        return {};
    }
}

function read(cnpj) {
    const all = readAll();
    return { ...VAZIO, ...(all[String(cnpj)] || {}) };
}

function write(cnpj, patch) {
    const all = readAll();
    const key = String(cnpj);
    all[key] = { ...VAZIO, ...(all[key] || {}), ...patch, atualizadoEm: Date.now() };
    const tmp = CURSOR_PATH + '.tmp';
    // Grava em temporário e renomeia: se o processo morrer no meio da escrita, o arquivo
    // bom continua no lugar em vez de virar JSON pela metade.
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, CURSOR_PATH);
}

function bloqueado(cnpj, agora) {
    return read(cnpj).bloqueadoAte > (agora == null ? Date.now() : agora);
}

module.exports = { read, write, bloqueado, CURSOR_PATH };
