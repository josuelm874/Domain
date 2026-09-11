/* ------------------------------ Token do MFe (Ambiente Seguro) ------------------------------
 *
 * Obtém o JWT que a API `portalcfews` exige, percorrendo o Ambiente Seguro da SEFAZ-CE por
 * HTTP puro. Zero dependência externa — `fetch` e `zlib` nativos. Isso é deliberado: a única
 * dependência que o worker tinha (`exceljs`) foi o que o impediu de subir na máquina da
 * empresa por meses (ver P1). Chromium headless resolveria de forma mais direta e custaria
 * ~300 MB de `npm install` — o mesmo defeito, ampliado.
 *
 * Caminho mapeado com o Josué (2026-09-10):
 *   1. POST  /internet/acessoSeguro/ServicoSenha/LogarUsuario/cweb20011.asp  (txtUsuario, txtSenha)
 *   2. GET   /internet/acessoSeguro/ServicoSenha/LogarUsuario/cweb2003.asp?sm=104   (menu MFe)
 *   3. "Acessar MFe"      -> rota ainda não identificada
 *   4. selecionar empresa -> salto para cfe.sefaz.ce.gov.br; é AQUI que o JWT aparece
 *   5. o SPA passa a mandar o JWT em `x-authentication-token` (avisos, content, home, ...)
 *
 * Os passos 3 e 4 não foram capturados no DevTools em três tentativas, então este módulo
 * DESCOBRE em vez de assumir: segue links e forms a partir do passo 2 e varre cada resposta
 * procurando um JWT válido. `--descobrir` imprime o mapa do caminho para fixar as rotas
 * depois. Sem isso, eu estaria chutando URLs.
 *
 * Credenciais: `~/.softtech-ambiente-seguro.json` ou env. NUNCA são logadas, nem em erro.
 * HTTPS obrigatório — o portal também serve em HTTP, sem redirect, e ali a senha vai em claro.
 *
 * Rodar:  node worker/lib/token-mfe.js --descobrir
 * ------------------------------------------------------------------------------------------- */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST_SEGURO = 'https://servicos.sefaz.ce.gov.br';
const BASE_SEGURO = HOST_SEGURO + '/internet/acessoSeguro/ServicoSenha/LogarUsuario';
const URL_LOGIN = BASE_SEGURO + '/cweb20011.asp';
const URL_MENU_MFE = BASE_SEGURO + '/cweb2003.asp?sm=104';
const REQ_TIMEOUT_MS = 30000;
const MAX_PASSOS = 12;          // ponytail: teto de saltos; sem ele um redirect cíclico roda para sempre
const ARQUIVO_CRED = path.join(os.homedir(), '.softtech-ambiente-seguro.json');

// --------------------------------- credenciais ---------------------------------

/**
 * Lê usuário/senha de arquivo no home ou de env. O valor nunca é devolvido em mensagem
 * de erro nem logado — só um booleano de presença.
 */
function lerCredenciais() {
    if (process.env.SEFAZ_AS_USUARIO && process.env.SEFAZ_AS_SENHA) {
        return { usuario: process.env.SEFAZ_AS_USUARIO, senha: process.env.SEFAZ_AS_SENHA, origem: 'env' };
    }
    if (!fs.existsSync(ARQUIVO_CRED)) {
        throw new Error('Credenciais ausentes. Crie ' + ARQUIVO_CRED +
            ' com {"usuario":"<CPF>","senha":"<senha>"} ou defina SEFAZ_AS_USUARIO / SEFAZ_AS_SENHA.');
    }
    let j;
    try {
        j = JSON.parse(fs.readFileSync(ARQUIVO_CRED, 'utf8'));
    } catch (e) {
        throw new Error('Arquivo de credenciais inválido (JSON malformado): ' + ARQUIVO_CRED);
    }
    const usuario = String(j.usuario || '').replace(/\D/g, '');
    const senha = String(j.senha || '');
    if (!usuario || !senha) throw new Error('Arquivo de credenciais sem "usuario" ou "senha": ' + ARQUIVO_CRED);
    return { usuario, senha, origem: ARQUIVO_CRED };
}

// --------------------------------- cookie jar ---------------------------------

/**
 * Jar mínimo. O `fetch` do Node não guarda cookie, e o Ambiente Seguro é ASP clássico:
 * toda a sessão vive num `ASPSESSIONID...`. Sem jar, cada requisição volta para o login.
 * Não valida domínio/path de propósito: o jar é usado só nos dois hosts da SEFAZ.
 */
class CookieJar {
    constructor() { this.cookies = new Map(); }
    absorver(res) {
        const raw = typeof res.headers.getSetCookie === 'function'
            ? res.headers.getSetCookie()
            : [res.headers.get('set-cookie')].filter(Boolean);
        for (const linha of raw) {
            const par = String(linha).split(';')[0];
            const i = par.indexOf('=');
            if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
        }
    }
    header() {
        return Array.from(this.cookies.entries()).map(([k, v]) => k + '=' + v).join('; ');
    }
    get vazio() { return this.cookies.size === 0; }
}

// --------------------------------- extração do JWT ---------------------------------

const RE_JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function decodificarPayload(jwt) {
    try {
        const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
    } catch (e) { return null; }
}

/**
 * Acha um JWT em qualquer texto (HTML, JSON, header Location) e valida que é O token:
 * `sub` com 14 dígitos (CNPJ) e `exp` no futuro. Valida em vez de aceitar o primeiro
 * `eyJ` porque a página carrega outros JWTs (o de sessão do portal, por exemplo) que a
 * API `portalcfews` recusa — e um token errado falha chave por chave, sem dizer por quê.
 */
function extrairJwt(texto, cnpjEsperado) {
    if (!texto) return null;
    const agora = Math.floor(Date.now() / 1000);
    const vistos = new Set();
    for (const m of String(texto).matchAll(RE_JWT)) {
        const jwt = m[0];
        if (vistos.has(jwt)) continue;
        vistos.add(jwt);
        const p = decodificarPayload(jwt);
        if (!p) continue;
        const sub = String(p.sub || '').replace(/\D/g, '');
        if (!/^\d{14}$/.test(sub)) continue;
        if (p.exp && p.exp <= agora) continue;
        if (cnpjEsperado && sub !== String(cnpjEsperado).replace(/\D/g, '')) continue;
        return { jwt, cnpj: sub, exp: p.exp || 0 };
    }
    return null;
}

// --------------------------------- HTTP ---------------------------------

async function req(jar, url, { method = 'GET', body = null, referer = '' } = {}) {
    if (!/^https:/i.test(url)) throw new Error('HTTPS obrigatório — recusado: ' + url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
    try {
        const headers = {
            'user-agent': 'softtech-worker',
            'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        };
        if (!jar.vazio) headers.cookie = jar.header();
        if (referer) headers.referer = referer;
        if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
        // redirect manual: o token pode viver no header `Location` do salto
        const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: ctrl.signal });
        jar.absorver(res);
        const loc = res.headers.get('location') || '';
        const tipo = res.headers.get('content-type') || '';
        const corpo = /^(3\d\d)$/.test(String(res.status)) ? '' : await res.text();
        return { status: res.status, loc, tipo, corpo, url };
    } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('sem resposta em ' + (REQ_TIMEOUT_MS / 1000) + 's: ' + url);
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function absolutizar(base, href) {
    try { return new URL(href, base).toString(); } catch (e) { return ''; }
}

// --------------------------------- login ---------------------------------

/**
 * Faz o POST do formulário `frmASeguro`. Login que falha NÃO é retentado: portal do fisco
 * bloqueia conta após N tentativas erradas, e um worker em laço travaria a conta do Josué.
 */
async function login(jar) {
    const cred = lerCredenciais();
    const body = new URLSearchParams({ txtUsuario: cred.usuario, txtSenha: cred.senha }).toString();
    const r = await req(jar, URL_LOGIN, { method: 'POST', body, referer: BASE_SEGURO + '/login.asp' });
    if (jar.vazio) throw new Error('login não devolveu cookie de sessão — o portal pode ter mudado.');
    const falhou = /senha inv|usu.rio inv|n.o cadastrad|bloquead|incorret/i.test(r.corpo);
    if (falhou) {
        // NÃO retentar. Corrigir o arquivo e rodar de novo é ação humana.
        throw new Error('login recusado pelo Ambiente Seguro. Confira as credenciais em ' +
            cred.origem + '. NÃO vou tentar de novo para não bloquear a conta.');
    }
    return { status: r.status, loc: r.loc };
}

// --------------------------------- descoberta do caminho ---------------------------------

/**
 * Anda do menu MFe em diante seguindo redirects, links e forms, varrendo cada resposta
 * por um JWT válido. Devolve o token e a trilha percorrida.
 *
 * ponytail: busca em largura ingênua com teto de MAX_PASSOS. Quando as rotas dos passos 3
 * e 4 forem confirmadas, isto vira três requisições fixas e este andador sai.
 */
async function descobrirToken(jar, { cnpj = '', verboso = false } = {}) {
    const trilha = [];
    const fila = [URL_MENU_MFE];
    const visitados = new Set();

    while (fila.length && trilha.length < MAX_PASSOS) {
        const url = fila.shift();
        if (!url || visitados.has(url)) continue;
        visitados.add(url);

        let r;
        try { r = await req(jar, url); }
        catch (e) { trilha.push({ url, erro: (e && e.message) || String(e) }); continue; }

        const passo = { url, status: r.status, tipo: r.tipo.split(';')[0], bytes: r.corpo.length };
        if (r.loc) passo.loc = r.loc;

        // o token pode estar no Location do salto, ou no corpo
        const achado = extrairJwt(r.loc, cnpj) || extrairJwt(r.corpo, cnpj);
        if (achado) {
            passo.token = 'ACHADO (CNPJ ' + achado.cnpj + ')';
            trilha.push(passo);
            if (verboso) trilha.forEach((p) => console.log('  ' + JSON.stringify(p)));
            return { ...achado, trilha };
        }
        trilha.push(passo);

        if (r.loc) { fila.push(absolutizar(url, r.loc)); continue; }

        // enfileira links e actions que continuem dentro da SEFAZ
        const alvos = [
            ...String(r.corpo).matchAll(/(?:href|action)\s*=\s*["']([^"'#]+)["']/gi),
        ].map((m) => absolutizar(url, m[1]))
            .filter((u) => /^https:\/\/(servicos|cfe)\.sefaz\.ce\.gov\.br/.test(u))
            .filter((u) => !/\.(css|js|png|jpe?g|gif|svg|ico|woff2?)(\?|$)/i.test(u))
            .filter((u) => !/login\.asp|logout|sair/i.test(u));
        for (const u of alvos) if (!visitados.has(u)) fila.push(u);
    }

    const e = new Error('token não encontrado em ' + trilha.length + ' passo(s). ' +
        'As rotas de "Acessar MFe" e de seleção de empresa provavelmente exigem POST com ' +
        'parâmetros que este andador não adivinha. Rode com --descobrir e me mande a trilha.');
    e.trilha = trilha;
    throw e;
}

// --------------------------------- cache ---------------------------------

let cache = null;   // { jwt, cnpj, exp }

/** Reaproveita o token até 5 min antes de expirar — evita um login por chamada. */
async function obterToken({ cnpj = '', forcar = false } = {}) {
    const agora = Math.floor(Date.now() / 1000);
    if (!forcar && cache && cache.exp - 300 > agora && (!cnpj || cache.cnpj === cnpj)) return cache;
    const jar = new CookieJar();
    await login(jar);
    const t = await descobrirToken(jar, { cnpj });
    cache = { jwt: t.jwt, cnpj: t.cnpj, exp: t.exp };
    return cache;
}

module.exports = { obterToken, login, descobrirToken, extrairJwt, CookieJar, lerCredenciais, ARQUIVO_CRED };

// --------------------------------- CLI ---------------------------------

if (require.main === module) {
    (async () => {
        const cnpj = (process.argv.find((a) => /^--cnpj=/.test(a)) || '').split('=')[1] || '';
        console.log('  arquivo de credenciais: ' + ARQUIVO_CRED);
        const jar = new CookieJar();
        try {
            const l = await login(jar);
            console.log('  login: HTTP ' + l.status + (l.loc ? ' -> ' + l.loc : '') + ' | cookies: ' + jar.cookies.size);
            const t = await descobrirToken(jar, { cnpj, verboso: true });
            console.log('  TOKEN OBTIDO | CNPJ ' + t.cnpj + ' | expira ' +
                (t.exp ? new Date(t.exp * 1000).toLocaleString('pt-BR') : '(sem exp)'));
            console.log('  (o valor do token não é impresso de propósito)');
        } catch (e) {
            console.error('  FALHOU: ' + ((e && e.message) || e));
            if (e && e.trilha) {
                console.error('  trilha percorrida:');
                e.trilha.forEach((p) => console.error('    ' + JSON.stringify(p)));
            }
            process.exitCode = 1;
        }
    })();
}
