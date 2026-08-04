/**
 * Controle de acesso do worker — primitivas puras, sem dependência externa.
 *
 * Vive num módulo próprio por dois motivos: `server.js` e `dirbi.js` precisam das
 * mesmas regras (uma decide origem/token, a outra valida caminho), e este arquivo
 * não importa `exceljs` — logo roda em teste sem `npm install` no worker.
 *
 * Contexto: loopback NÃO é fronteira de segurança para o navegador. Qualquer página
 * que o usuário abrir fala com 127.0.0.1 (é o que o Private Network Access habilita).
 * Sem estas travas, essa página lê os XMLs fiscais já baixados e manda o worker
 * varrer qualquer pasta do disco.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ORIGINS = [
    'https://softtech-fiscal.vercel.app',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
];

/**
 * Monta o conjunto de origens autorizadas a partir de um CSV (env var).
 * @param {string|undefined} csv
 * @returns {Set<string>}
 */
function parseOrigins(csv) {
    const list = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
    return new Set(list.length ? list : DEFAULT_ORIGINS);
}

/**
 * Origem ausente (curl, script) passa aqui — quem barra esse caso é o token.
 * Origem presente precisa estar na allowlist; eco de qualquer origem é o bug que
 * abria o worker para o site inteiro da internet.
 * @param {string|undefined} origin
 * @param {Set<string>} allowed
 * @returns {boolean}
 */
function isOriginAllowed(origin, allowed) {
    if (!origin) return true;
    return allowed.has(origin);
}

/**
 * Compara token em tempo constante. Comprimentos diferentes retornam false antes do
 * timingSafeEqual, que exige buffers do mesmo tamanho.
 * @param {string} sent
 * @param {string} expected
 * @returns {boolean}
 */
function tokensMatch(sent, expected) {
    const a = Buffer.from(String(sent || ''), 'utf8');
    const b = Buffer.from(String(expected || ''), 'utf8');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve um caminho pedido exigindo que ele fique dentro de `root`.
 * Cobre `..`, caminho absoluto e prefixo parecido ("/inbox-outro" não casa "/inbox").
 * @param {string} root
 * @param {string|undefined|null} requested  vazio = a própria raiz
 * @returns {{ok: true, dir: string} | {ok: false, error: string}}
 */
function resolveUnder(root, requested) {
    const base = path.resolve(root);
    if (!requested) return { ok: true, dir: base };
    const dir = path.resolve(base, String(requested));
    if (dir !== base && !dir.startsWith(base + path.sep)) {
        return { ok: false, error: 'caminho fora da pasta permitida (' + base + ')' };
    }
    return { ok: true, dir };
}

/**
 * Lê o token persistido ou gera um novo. Persistir evita novo pareamento a cada boot.
 * Falha de escrita não é fatal — o worker sobe com token de sessão e avisa.
 * @param {string} file
 * @param {(msg: string) => void} [warn]
 * @returns {string}
 */
function loadOrCreateToken(file, warn = () => {}) {
    try {
        const t = fs.readFileSync(file, 'utf8').trim();
        if (t.length >= 32) return t;
    } catch { /* primeiro boot */ }
    const t = crypto.randomBytes(24).toString('hex');
    try {
        fs.writeFileSync(file, t, { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
        warn(`não consegui gravar o token em ${file}: ${e.message} — ele muda a cada reinício.`);
    }
    return t;
}

/**
 * ID de job imprevisível. Sequencial (`nfce-1`) permite adivinhar o job da sessão e
 * baixar o ZIP sem nunca ter disparado nada.
 * @param {string} prefix
 * @returns {string}
 */
function newJobId(prefix) {
    return prefix + '-' + crypto.randomBytes(16).toString('hex');
}

module.exports = {
    DEFAULT_ORIGINS, parseOrigins, isOriginAllowed, tokensMatch,
    resolveUnder, loadOrCreateToken, newJobId,
};
