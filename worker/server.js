/**
 * SoftTech Worker — sidecar local (SPIKE da ponte).
 *
 * Objetivo deste arquivo: validar EMPIRICAMENTE que uma página HTTPS na Vercel
 * consegue chamar este worker em http://localhost no Chrome do trabalho.
 * É o risco-mãe da arquitetura: se a ponte não passa aqui, NFCe/DIRBI não saem
 * do navegador. Por isso o spike vem antes de qualquer fluxo pesado.
 *
 * Sem dependências externas (só `http` nativo) — facilita empacotar como
 * executável standalone (pkg/bun compile) nas máquinas de trabalho sem Node.
 *
 * Rodar:  node server.js     (ou o .exe empacotado)
 * Testar: ver worker/README.md (snippet de console na página da Vercel).
 */
'use strict';

const http = require('http');

const HOST = '127.0.0.1';      // só loopback — nunca expor na rede
const PORT = 47620;            // porta fixa (briefing); alta p/ evitar colisão
const NAME = 'softtech-worker';
const VERSION = '0.1.0-spike';

/**
 * Aplica CORS + Private Network Access em TODA resposta.
 * O header decisivo para o caso público(HTTPS)→loopback é
 * `Access-Control-Allow-Private-Network: true`, exigido no preflight do Chrome.
 */
function applyCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'content-type, x-authentication-token, x-authentication-taxid'
    );
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

function readBody(req, limitBytes = 1_000_000) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limitBytes) {
                reject(new Error('payload too large'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const { method } = req;
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const path = url.pathname;
    console.log(`[${new Date().toISOString()}] ${method} ${path} (origin: ${req.headers.origin || '-'})`);

    applyCors(req, res);

    // Preflight: responde antes de qualquer rota. É aqui que o PNA é negociado.
    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Health-check: a UI usa isto para detectar "worker ausente" e instruir o uso.
    if (method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true, name: NAME, version: VERSION, time: new Date().toISOString() });
        return;
    }

    // Echo: força o caminho real (POST + content-type json + header custom →
    // dispara o preflight PNA). Se isto passa no Chrome do trabalho, a ponte
    // serve para NFCe e DIRBI.
    if (method === 'POST' && path === '/echo') {
        try {
            const raw = await readBody(req);
            let parsed = null;
            try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
            sendJson(res, 200, {
                ok: true,
                received: parsed,
                sawCustomHeader: req.headers['x-authentication-token'] != null,
            });
        } catch (e) {
            sendJson(res, 413, { ok: false, error: e.message });
        }
        return;
    }

    sendJson(res, 404, { ok: false, error: 'not found', path });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n[ERRO] A porta ${PORT} já está em uso. Feche o outro processo ou troque PORT em server.js.\n`);
    } else {
        console.error('[ERRO]', err);
    }
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    console.log(`\n  ${NAME} v${VERSION}`);
    console.log(`  ouvindo em http://${HOST}:${PORT}`);
    console.log(`  rotas: GET /health · POST /echo`);
    console.log(`  (Ctrl+C para parar)\n`);
});
