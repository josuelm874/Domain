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
const os = require('os');
const path = require('path');

/*
 * ============ PROVIDER LEGACY DO OPENSSL (certificados A1) ============
 *
 * O OpenSSL 3 (Node >= 17) move RC2-40-CBC e 3DES-SHA1 para o provider "legacy", e é
 * exatamente esse o cifrário que as ACs brasileiras usam no .pfx do certificado A1.
 * Sem o provider carregado, `https.request({ pfx })` falha com
 * "Unsupported PKCS12 PFX data" mesmo com a senha correta — e o fluxo NFe inteiro morre
 * antes do primeiro byte. Medido em 2026-08-03 com um A1 real: sem a flag, 100% de
 * falha; com ela, o certificado carrega e a SEFAZ responde.
 *
 * Não dá para exigir que o usuário lembre da flag: o worker é distribuído como .exe
 * para quem não abre terminal. Então o worker se re-executa UMA vez com a flag no
 * NODE_OPTIONS. O marcador de env impede loop caso o runtime ignore a flag.
 *
 * A flag apenas disponibiliza algoritmos antigos ao carregar chaves; não afeta as
 * cifras negociadas no TLS de saída.
 */
const LEGACY_FLAG = '--openssl-legacy-provider';
(function ensureLegacyProvider() {
    const jaAtivo = String(process.env.NODE_OPTIONS || '').includes(LEGACY_FLAG) ||
        process.execArgv.includes(LEGACY_FLAG);
    if (jaAtivo || process.env.SOFTTECH_LEGACY_RETRY === '1') return;
    const { spawnSync } = require('child_process');
    // Empacotado (pkg): argv[1] aponta para o snapshot virtual — repassar só os args.
    const args = process.pkg ? process.argv.slice(2) : process.argv.slice(1);
    console.log(`  reiniciando com ${LEGACY_FLAG} (necessário para ler certificados A1)…`);
    const r = spawnSync(process.execPath, args, {
        stdio: 'inherit',
        env: {
            ...process.env,
            SOFTTECH_LEGACY_RETRY: '1',
            NODE_OPTIONS: (String(process.env.NODE_OPTIONS || '') + ' ' + LEGACY_FLAG).trim(),
        },
    });
    process.exit(r.status == null ? 1 : r.status);
})();
const access = require('./lib/access');
const nfce = require('./lib/nfce');
const nfe = require('./lib/nfe');
const distnsu = require('./lib/distnsu.js');
const dirbi = require('./lib/dirbi');

const HOST = '127.0.0.1';      // só loopback — nunca expor na rede
const PORT = 47620;            // porta fixa (briefing); alta p/ evitar colisão
const NAME = 'softtech-worker';
const VERSION = '0.5.0-nfe-auth';

/*
 * ==================== CONTROLE DE ACESSO ====================
 *
 * Loopback NÃO é fronteira de segurança para um navegador. Qualquer página que o
 * usuário abra (anúncio, link de e-mail) consegue falar com 127.0.0.1 — é justamente
 * o que o `Access-Control-Allow-Private-Network` habilita. Sem allowlist de origem e
 * sem token, essa página lê os XMLs fiscais já baixados e manda o worker varrer
 * qualquer pasta do disco. Duas travas, ambas necessárias:
 *
 *   1. Allowlist de origem — barra o preflight de sites não autorizados.
 *   2. Token de pareamento em `x-worker-token` — barra clientes não-browser (curl,
 *      script) e requisições "simples" que escapam do preflight.
 *
 * Terceira trava, em lib/nfce.js e lib/dirbi.js: IDs de job aleatórios. Sequencial
 * (`nfce-1`) é adivinhável, o que dispensaria o atacante de saber qualquer coisa.
 */

const ALLOWED_ORIGINS = access.parseOrigins(process.env.WORKER_ALLOWED_ORIGINS);

// Token persistido no home do usuário (não em __dirname: quando empacotado com pkg,
// __dirname aponta para o snapshot virtual, que é somente-leitura).
const TOKEN_FILE = path.join(os.homedir(), '.softtech-worker-token');
const PAIR_TOKEN = access.loadOrCreateToken(TOKEN_FILE, (m) => console.warn('[AVISO] ' + m));

const checkToken = (req) => access.tokensMatch(req.headers['x-worker-token'], PAIR_TOKEN);

/**
 * Aplica CORS + Private Network Access. Retorna false quando a origem não está na
 * allowlist — nesse caso o chamador responde 403 e NÃO emite `Allow-Origin`, o que
 * faz o navegador descartar a resposta e reprovar o preflight.
 *
 * Requisição sem `Origin` (curl, script) não recebe header de CORS: quem barra ela
 * é o token.
 */
function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!access.isOriginAllowed(origin, ALLOWED_ORIGINS)) return false;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'content-type, x-worker-token, x-authentication-token, x-authentication-taxid'
    );
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    return true;
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

    if (!applyCors(req, res)) {
        console.warn(`  ↳ BLOQUEADO: origin fora da allowlist (${req.headers.origin})`);
        sendJson(res, 403, { ok: false, error: 'origin não autorizada' });
        return;
    }

    // Preflight: responde antes de qualquer rota. É aqui que o PNA é negociado.
    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Health-check: única rota sem token — a UI precisa detectar o worker ANTES de
    // estar pareada. Por isso não devolve caminho de disco nem nada sensível.
    if (method === 'GET' && path === '/health') {
        sendJson(res, 200, {
            ok: true, name: NAME, version: VERSION, time: new Date().toISOString(),
            paired: checkToken(req),
        });
        return;
    }

    // Daqui para baixo, tudo exige o token de pareamento.
    if (!checkToken(req)) {
        console.warn('  ↳ BLOQUEADO: x-worker-token ausente ou inválido');
        sendJson(res, 401, { ok: false, error: 'token de pareamento ausente ou inválido' });
        return;
    }

    // Info da inbox (caminhos locais) — atrás do token, por isso não fica no /health.
    if (method === 'GET' && path === '/dirbi/info') {
        sendJson(res, 200, { ok: true, dirbi: dirbi.inboxInfo() });
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
    // Body maior que o do NFCe porque cada empresa carrega o .pfx em base64.
    if (method === 'POST' && path === '/nfe/start') {
        try {
            const raw = await readBody(req, 128_000_000);
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

    // ====================== distNSU (acervo por CNPJ) ======================
    // Dispara o loop: { companies:[{id,cnpj,pfxB64,senha,cufAutor,tpAmb,maxChamadas}] }.
    // Não recebe chaves — o distNSU descobre o acervo sozinho, essa é a graça dele.
    if (method === 'POST' && path === '/distnsu/start') {
        try {
            const raw = await readBody(req, 128_000_000); // .pfx em base64 por empresa
            const payload = raw ? JSON.parse(raw) : {};
            const job = distnsu.startJob(payload);
            sendJson(res, 200, { ok: !job.error, jobId: job.id, error: job.error || '' });
        } catch (e) {
            sendJson(res, 400, { ok: false, error: (e && e.message) || 'payload inválido' });
        }
        return;
    }

    // Progresso (polling): GET /distnsu/status/{jobId}
    if (method === 'GET' && path.startsWith('/distnsu/status/')) {
        const jobId = decodeURIComponent(path.slice('/distnsu/status/'.length));
        const st = distnsu.getStatus(jobId);
        if (!st) { sendJson(res, 404, { ok: false, error: 'job não encontrado' }); return; }
        sendJson(res, 200, st);
        return;
    }

    // Detalhe (chaves em resumo, motivo da parada): GET /distnsu/detail/{jobId}/{cnpj}
    if (method === 'GET' && path.startsWith('/distnsu/detail/')) {
        const rest = path.slice('/distnsu/detail/'.length).split('/');
        const detail = distnsu.getCompanyDetail(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
        if (!detail) { sendJson(res, 404, { ok: false, error: 'job/empresa não encontrado' }); return; }
        sendJson(res, 200, detail);
        return;
    }

    // Download do ZIP de uma empresa: GET /distnsu/zip/{jobId}/{cnpj}
    if (method === 'GET' && path.startsWith('/distnsu/zip/')) {
        const rest = path.slice('/distnsu/zip/'.length).split('/');
        const z = distnsu.getCompanyZip(decodeURIComponent(rest[0] || ''), decodeURIComponent(rest[1] || ''));
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
    console.log('');
    console.log('  ┌──────────────────── PAREAMENTO ────────────────────');
    console.log('  │ Cole este token no sistema quando ele pedir:');
    console.log(`  │   ${PAIR_TOKEN}`);
    console.log(`  │ (guardado em ${TOKEN_FILE} — só precisa colar uma vez)`);
    console.log('  └────────────────────────────────────────────────────');
    console.log('');
    console.log(`  origens autorizadas: ${Array.from(ALLOWED_ORIGINS).join(', ')}`);
    console.log(`  rotas: GET /health · POST /echo`);
    console.log(`         POST /nfce/start · GET /nfce/status/{job} · GET /nfce/zip/{job}/{cnpj} · GET /nfce/detail/{job}/{cnpj}`);
    console.log(`         POST /nfe/start · GET /nfe/status/{job} · GET /nfe/zip/{job}/{grupo} · GET /nfe/detail/{job}/{grupo}`);
    console.log(`         POST /dirbi/start · GET /dirbi/status/{job} · GET /dirbi/result/{job}`);
    console.log(`  (Ctrl+C para parar)\n`);
});
