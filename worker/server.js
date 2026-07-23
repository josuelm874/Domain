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
const nfce = require('./lib/nfce');
const dirbi = require('./lib/dirbi');

const HOST = '127.0.0.1';      // só loopback — nunca expor na rede
const PORT = 47620;            // porta fixa (briefing); alta p/ evitar colisão
const NAME = 'softtech-worker';
const VERSION = '0.4.0-nfe';

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

function sendZip(res, buffer, fileName) {
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(fileName) + '"',
        'Content-Length': buffer.length,
    });
    res.end(buffer);
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
        sendJson(res, 200, { ok: true, name: NAME, version: VERSION, time: new Date().toISOString(), dirbi: dirbi.inboxInfo() });
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

    // ====================== NFCe ======================
    // Dispara o job: recebe { companies:[{cnpj,token,taxid,keys,meta}], concurrency }.
    if (method === 'POST' && path === '/nfce/start') {
        try {
            const raw = await readBody(req, 64_000_000); // milhares de chaves de 44 díg
            const payload = raw ? JSON.parse(raw) : {};
            const job = nfce.startJob(payload);
            sendJson(res, 200, { ok: !job.error, jobId: job.id, error: job.error || '' });
        } catch (e) {
            sendJson(res, 400, { ok: false, error: (e && e.message) || 'payload inválido' });
        }
        return;
    }

    // Progresso (polling): GET /nfce/status/{jobId}
    if (method === 'GET' && path.startsWith('/nfce/status/')) {
        const jobId = decodeURIComponent(path.slice('/nfce/status/'.length));
        const st = nfce.getStatus(jobId);
        if (!st) { sendJson(res, 404, { ok: false, error: 'job não encontrado' }); return; }
        sendJson(res, 200, st);
        return;
    }

    // Detalhe (falhas + divergências) de uma empresa: GET /nfce/detail/{jobId}/{cnpj}
    if (method === 'GET' && path.startsWith('/nfce/detail/')) {
        const rest = path.slice('/nfce/detail/'.length).split('/');
        const detail = nfce.getCompanyDetail(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!detail) { sendJson(res, 404, { ok: false, error: 'job/empresa não encontrado' }); return; }
        sendJson(res, 200, detail);
        return;
    }

    // Download do ZIP de uma empresa: GET /nfce/zip/{jobId}/{cnpj}
    if (method === 'GET' && path.startsWith('/nfce/zip/')) {
        const rest = path.slice('/nfce/zip/'.length).split('/');
        const z = nfce.getCompanyZip(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!z) { sendJson(res, 404, { ok: false, error: 'ZIP indisponível (job/empresa não pronto)' }); return; }
        sendZip(res, z.buffer, z.name);
        return;
    }

    // ====================== NFe (XML) ======================
    // Dispara job NFe: { companies:[{id,cnpj,pfxB64,senha,cufAutor,tpAmb,keys,meta}], concurrency }.
    if (method === 'POST' && path === '/nfe/start') {
        try {
            const raw = await readBody(req, 128_000_000); // pfx base64 + milhares de chaves
            const payload = raw ? JSON.parse(raw) : {};
            const job = nfe.startJob(payload);
            sendJson(res, 200, { ok: !job.error, jobId: job.id, error: job.error || '' });
        } catch (e) {
            sendJson(res, 400, { ok: false, error: (e && e.message) || 'payload inválido' });
        }
        return;
    }
    if (method === 'GET' && path.startsWith('/nfe/status/')) {
        const jobId = decodeURIComponent(path.slice('/nfe/status/'.length));
        const st = nfe.getStatus(jobId);
        if (!st) { sendJson(res, 404, { ok: false, error: 'job não encontrado' }); return; }
        sendJson(res, 200, st);
        return;
    }
    if (method === 'GET' && path.startsWith('/nfe/detail/')) {
        const rest = path.slice('/nfe/detail/'.length).split('/');
        const detail = nfe.getCompanyDetail(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!detail) { sendJson(res, 404, { ok: false, error: 'job/empresa não encontrado' }); return; }
        sendJson(res, 200, detail);
        return;
    }
    if (method === 'GET' && path.startsWith('/nfe/zip/')) {
        const rest = path.slice('/nfe/zip/'.length).split('/');
        const z = nfe.getCompanyZip(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!z) { sendJson(res, 404, { ok: false, error: 'ZIP indisponível (job/empresa não pronto)' }); return; }
        sendZip(res, z.buffer, z.name);
        return;
    }

    // ====================== DIRBI ======================
    // Processa a inbox (XMLs no disco): { inboxPath? } -> { jobId }.
    if (method === 'POST' && path === '/dirbi/start') {
        try {
            const raw = await readBody(req, 1_000_000);
            const payload = raw ? JSON.parse(raw) : {};
            const job = dirbi.startJob(payload);
            sendJson(res, 200, { ok: !job.error, jobId: job.id, error: job.error || '' });
        } catch (e) {
            sendJson(res, 400, { ok: false, error: (e && e.message) || 'payload inválido' });
        }
        return;
    }

    if (method === 'GET' && path.startsWith('/dirbi/status/')) {
        const jobId = decodeURIComponent(path.slice('/dirbi/status/'.length));
        const st = dirbi.getStatus(jobId);
        if (!st) { sendJson(res, 404, { ok: false, error: 'job não encontrado' }); return; }
        sendJson(res, 200, st);
        return;
    }

    // Resultado: .xlsx (1 empresa) ou .zip (várias).
    if (method === 'GET' && path.startsWith('/dirbi/result/')) {
        const jobId = decodeURIComponent(path.slice('/dirbi/result/'.length));
        const r = dirbi.getResult(jobId);
        if (!r) { sendJson(res, 404, { ok: false, error: 'resultado indisponível' }); return; }
        const ctype = r.isZip ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        res.writeHead(200, {
            'Content-Type': ctype,
            'Content-Disposition': 'attachment; filename="' + encodeURIComponent(r.name) + '"',
            'Content-Length': r.buffer.length,
        });
        res.end(r.buffer);
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
    console.log(`         POST /nfce/start · GET /nfce/status/{job} · GET /nfce/zip/{job}/{cnpj} · GET /nfce/detail/{job}/{cnpj}`);
    console.log(`         POST /nfe/start · GET /nfe/status/{job} · GET /nfe/zip/{job}/{cnpj} · GET /nfe/detail/{job}/{cnpj}`);
    console.log(`         POST /dirbi/start · GET /dirbi/status/{job} · GET /dirbi/result/{job}`);
    console.log(`  (Ctrl+C para parar)\n`);
});
