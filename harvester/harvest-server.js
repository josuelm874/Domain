// harvest-server.js — sidecar Node+Playwright (loopback 127.0.0.1:47621).
//
// Elimina o passo manual de baixar uma NFCe só pra extrair o token. O SoftTech
// (browser file://) chama este sidecar: se há token em cache válido devolve; senão
// pede CPF+senha, loga headless no Ambiente Seguro SEFAZ-CE, colhe UM token
// (x-authentication-token da 1ª empresa — basta 1 pra baixar NFCe de qualquer uma)
// e cacheia em memória (~24h).
//
// Zero-dep de HTTP (http nativo, espelha worker/server.js). Playwright vive SÓ aqui
// (o worker 47620 é zero-dep; o browser file:// não roda Playwright).
//
// Rodar:  cd harvester && npm i && node harvest-server.js
//
// SEGURANÇA: cpf/senha só em memória, nunca em disco, nunca em log, limpos após uso.
// Token = segredo (24h), cache só em memória (some ao reiniciar). Nada persistido.
'use strict';

const http = require('http');
const { chromium } = require('playwright');

const HOST = '127.0.0.1';   // só loopback — nunca expor na rede
const PORT = 47621;         // sidecar (worker zero-dep fica no 47620)
const NAME = 'softtech-harvester';
const VERSION = '1.0.0';

const LOGIN_URL = 'https://servicos.sefaz.ce.gov.br/internet/acessoseguro/servicosenha/logarusuario/login.asp';

// Seletores do form login.asp (capturados do DOM real — Task 0).
const SEL = {
    usuario:    '#txtUsuario',            // CPF/usuário (input text)
    senha:      '#txtSenha',              // senha (input password)
    vinculo:    '#cboTipoUsuario',        // select de vínculo
    vinculoContador: '3',                 // value da opção "CONTADOR"
    entrar:     '#btEntrar',              // botão Entrar (type=button, dispara JS)
    // Pós-login (portal do Ambiente Seguro → MFe):
    menuMFE:    'text=MFE - Modulo Fiscal Eletronico',
    acessarMFe: 'text=Acessar MFe',
    companyRow: 'a[href^="JavaScript:submete"]',
};

const MARGIN_MS = 5 * 60 * 1000;   // trata token como expirado 5min antes do exp real

// Cache do token só em memória: { token, exp } (exp em ms epoch). Some ao reiniciar.
let cache = null;

// --- JWT: decodifica só o exp (não valida assinatura; é só pra saber a validade). ---
function decodeExp(jwt) {
    const parts = String(jwt).split('.');
    if (parts.length < 2) return 0;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    } catch {
        return 0;
    }
}

function cacheValid() {
    return !!(cache && cache.token && cache.exp - MARGIN_MS > Date.now());
}

// --- Login headless + colheita de 1 token. Devolve o JWT ou lança erro. ---
// cpf/senha: usados aqui e descartados pelo caller. Nunca logados, nunca gravados.
async function harvest(cpf, senha) {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        // efêmero: nada persistido. ignoreHTTPSErrors: cert da SEFAZ usa CA que o
        // Chromium não traz (o Chrome do trabalho confia por ter a raiz gov).
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

        // Captura o 1º x-authentication-token (dispara no boot do portal-mfe da
        // empresa selecionada). Por header → imune ao modal central do MFe.
        let token = '';
        ctx.on('request', (req) => {
            const t = req.headers()['x-authentication-token'];
            if (t && !token) token = t;
        });

        const page = await ctx.newPage();
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        await page.fill(SEL.usuario, cpf);
        await page.fill(SEL.senha, senha);
        await page.selectOption(SEL.vinculo, SEL.vinculoContador);
        await page.click(SEL.entrar);

        // menuMFE só aparece com login OK. Timeout aqui = credencial errada / login falhou.
        try {
            await page.waitForSelector(SEL.menuMFE, { timeout: 30000 });
        } catch {
            throw new Error('login falhou — CPF, senha ou vínculo (Contador) incorretos');
        }

        await page.click(SEL.menuMFE);
        await page.click(SEL.acessarMFe);
        await page.waitForSelector(SEL.companyRow, { timeout: 30000 });

        // 1ª empresa basta — 1 token baixa NFCe de qualquer uma.
        await page.locator(SEL.companyRow).first().click();

        for (let w = 0; w < 60 && !token; w++) await page.waitForTimeout(500);
        if (!token) throw new Error('token não capturado (MFe abriu mas nenhum header x-authentication-token)');

        return token;
    } finally {
        await browser.close();
    }
}

// --- HTTP: espelha o CORS/PNA do worker (público HTTPS → loopback exige PNA). ---
function applyCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function readBody(req, limitBytes = 100_000) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limitBytes) { reject(new Error('payload too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const { method } = req;
    const path = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
    // Log SEM corpo: nunca imprime cpf/senha/token.
    console.log(`[${new Date().toISOString()}] ${method} ${path} (origin: ${req.headers.origin || '-'})`);

    applyCors(req, res);
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true, name: NAME, version: VERSION, time: new Date().toISOString() });
        return;
    }

    // Cache válido? devolve o token. Senão sinaliza que precisa de login (200 c/ flag).
    if (method === 'GET' && path === '/nfce/token') {
        if (cacheValid()) sendJson(res, 200, { ok: true, token: cache.token });
        else sendJson(res, 200, { ok: false, needsLogin: true });
        return;
    }

    // Login headless + colheita. Body: {cpf, senha}. Credenciais descartadas ao fim.
    if (method === 'POST' && path === '/nfce/token') {
        let cpf, senha;
        try {
            const parsed = JSON.parse(await readBody(req));
            cpf = String(parsed.cpf || '').trim();
            senha = String(parsed.senha || '');
        } catch {
            sendJson(res, 400, { ok: false, error: 'body inválido' });
            return;
        }
        if (!cpf || !senha) { sendJson(res, 400, { ok: false, error: 'cpf e senha obrigatórios' }); return; }

        try {
            const token = await harvest(cpf, senha);
            cache = { token, exp: decodeExp(token) || Date.now() + 23 * 60 * 60 * 1000 };
            sendJson(res, 200, { ok: true, token });
        } catch (e) {
            sendJson(res, 200, { ok: false, error: (e && e.message) || 'colheita falhou' });
        } finally {
            cpf = null; senha = null;   // limpa credenciais da memória local
        }
        return;
    }

    sendJson(res, 404, { ok: false, error: 'rota inexistente' });
});

// Só sobe o servidor quando executado direto (não em require do teste unitário).
if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`${NAME} v${VERSION} ouvindo em http://${HOST}:${PORT}`);
        console.log('Rotas: GET /health | GET /nfce/token | POST /nfce/token {cpf,senha}');
    });
}

module.exports = { decodeExp, cacheValid, _setCache: (c) => { cache = c; } };
