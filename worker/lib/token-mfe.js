/* ------------------------------ Token do MFe (Ambiente Seguro) ------------------------------
 *
 * Obtém o JWT que a API `portalcfews` exige, percorrendo o Ambiente Seguro da SEFAZ-CE por
 * HTTP puro. Zero dependência externa — só `https` nativo. Isso é deliberado: a única
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
const https = require('https');
const tls = require('tls');
const os = require('os');
const path = require('path');

const HOST_SEGURO = 'https://servicos.sefaz.ce.gov.br';
const BASE_SEGURO = HOST_SEGURO + '/internet/acessoSeguro/ServicoSenha/LogarUsuario';
const URL_LOGIN = BASE_SEGURO + '/cweb20011.asp';
const URL_MENU_MFE = BASE_SEGURO + '/cweb2003.asp?sm=104';
const REQ_TIMEOUT_MS = 30000;
const MAX_PASSOS = 25;          // ponytail: teto de saltos; sem ele um redirect ciclico roda para sempre

// Links que DESTROEM a sessao ou saem do fluxo. O andador clicou em EncerrarSessao no
// terceiro passo da primeira execucao e matou a propria sessao -- todo o resto da trilha
// voltou pagina deslogada. Filtro por 'logout|sair' nao pegava 'EncerrarSessao'.
const RE_PROIBIDO = /EncerrarSessao|cweb2005|cweb20011|logout|sair|login\.asp|\/index\.asp|cwebErro/i;

// Acesso a sistema no Ambiente Seguro: cweb1010java.asp?sis=<sistema>&sse=<id>.
// Descoberto na trilha. E por aqui que se chega ao MFe, entao vai na frente da fila.
const RE_ACESSO_SISTEMA = /cweb1010java\.asp/i;
const RE_PARECE_MFE = /mfe|cfe|fiscal|cupom|nfce/i;
const ARQUIVO_CRED = path.join(os.homedir(), '.softtech-ambiente-seguro.json');

// O form de login exige `cboTipoUsuario` (rotulado "Tipo/Vinculo do Usuario"). Nao e
// opcional: sem ele o POST volta 302 para cwebErro.asp com "Tipo de Usuario Nao Foi
// Selecionado". Padrao CONTADOR porque e o vinculo do Josue; outro vinculo se configura
// por "tipoUsuario" no arquivo de credenciais.
const TIPO_USUARIO_PADRAO = '3';
const TIPOS_CONHECIDOS = 'Valores de cboTipoUsuario: 3=CONTADOR, 4=DEPENDENTE DE CONTADOR, ' +
    '1=SOCIO, 2=DEPENDENTE DE SOCIO, 10=PORTAL FISCAL MESTRE, 11=PORTAL FISCAL DEPENDENTE, ' +
    '80=EMISSOR DE NFE. A lista completa esta no <select> de login.asp.';

// --------------------------------- credenciais ---------------------------------

/**
 * Lê usuário/senha de arquivo no home ou de env. O valor nunca é devolvido em mensagem
 * de erro nem logado — só um booleano de presença.
 */
function lerCredenciais() {
    if (process.env.SEFAZ_AS_USUARIO && process.env.SEFAZ_AS_SENHA) {
        return {
            usuario: process.env.SEFAZ_AS_USUARIO,
            senha: process.env.SEFAZ_AS_SENHA,
            tipoUsuario: String(process.env.SEFAZ_AS_TIPO || TIPO_USUARIO_PADRAO),
            origem: 'env',
        };
    }
    if (!fs.existsSync(ARQUIVO_CRED)) {
        throw new Error('Credenciais ausentes. Crie ' + ARQUIVO_CRED +
            ' com {"usuario":"<CPF>","senha":"<senha>"} ou defina SEFAZ_AS_USUARIO / SEFAZ_AS_SENHA / SEFAZ_AS_TIPO. ' + TIPOS_CONHECIDOS);
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
    const tipoUsuario = String(j.tipoUsuario || j.tipo || TIPO_USUARIO_PADRAO).replace(/[^0-9]/g, '');
    if (!tipoUsuario) throw new Error('"tipoUsuario" invalido em ' + ARQUIVO_CRED + '. ' + TIPOS_CONHECIDOS);
    return { usuario, senha, tipoUsuario, origem: ARQUIVO_CRED };
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
        this.absorverLista(raw);
    }
    absorverLista(raw) {
        for (const linha of (raw || [])) {
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

// O Ambiente Seguro roda IIS 6.0 (2003) e negocia Diffie-Hellman com chave pequena. O
// OpenSSL do Node recusa com ERR_SSL_DH_KEY_TOO_SMALL (protecao contra Logjam) e o `fetch`
// nao permite ajustar cifra -- dai `https.request`, que aceita. SECLEVEL=0 enfraquece ESTA
// conexao; a alternativa seria HTTP puro, com a senha em claro na rede. E o menos pior.
// Confinado aos hosts da SEFAZ: nada mais no worker usa este helper.
// ponytail: SECLEVEL=0 e martelo; o correto seria a SEFAZ oferecer grupo DH maior.
const CIPHERS_LEGADO = 'DEFAULT:@SECLEVEL=0';

// A cadeia do servidor termina na "Autoridade Certificadora Raiz Brasileira v10", raiz da
// ICP-Brasil. Alguns Node a tem na store, outros nao -- SELF_SIGNED_CERT_IN_CHAIN. Em vez
// de desligar a verificacao (rejeitado: `rejectUnauthorized: false` abre MITM ativo, e um
// MITM aqui captura a senha), a raiz e a intermediaria vao PINADAS junto com a store
// padrao. Resultado: valida em qualquer Node, e mais estrito que o default.
// Regenerar quando a ICP-Brasil rotacionar: ver o cabecalho de ca-icp-brasil.pem.
const CA_PINADA = (() => {
    try {
        const pem = fs.readFileSync(path.join(__dirname, 'ca-icp-brasil.pem'), 'utf8');
        return [...tls.rootCertificates, pem];
    } catch (e) {
        return undefined;   // sem o .pem, cai na store padrao do Node
    }
})();

function req(jar, url, { method = 'GET', body = null, referer = '' } = {}) {
    if (!/^https:/i.test(url)) return Promise.reject(new Error('HTTPS obrigatorio -- recusado: ' + url));
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(url); } catch (e) { return reject(new Error('URL invalida: ' + url)); }
        const headers = {
            'user-agent': 'softtech-worker',
            'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        };
        if (!jar.vazio) headers.cookie = jar.header();
        if (referer) headers.referer = referer;
        if (body) {
            headers['content-type'] = 'application/x-www-form-urlencoded';
            headers['content-length'] = Buffer.byteLength(body);
        }
        const r = https.request({
            method,
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            headers,
            ciphers: CIPHERS_LEGADO,
            minVersion: 'TLSv1',
            ca: CA_PINADA,
        }, (res) => {
            jar.absorverLista(res.headers['set-cookie']);
            const pedacos = [];
            res.on('data', (c) => pedacos.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                loc: res.headers.location || '',
                tipo: res.headers['content-type'] || '',
                // latin1: ASP classico serve ISO-8859-1; JWT e ASCII, entao a regex nao sofre
                corpo: Buffer.concat(pedacos).toString('latin1'),
                url,
            }));
        });
        r.setTimeout(REQ_TIMEOUT_MS, () => r.destroy(
            new Error('sem resposta em ' + (REQ_TIMEOUT_MS / 1000) + 's: ' + url)));
        // Expor o `code` e a `cause`: "fetch failed" sozinho nao dizia nada e custou uma
        // rodada inteira para descobrir que era o handshake TLS.
        r.on('error', (e) => reject(new Error(
            ((e && e.message) || String(e)) +
            (e && e.code ? ' [' + e.code + ']' : '') +
            (e && e.cause && e.cause.code ? ' cause=' + e.cause.code : ''))));
        if (body) r.write(body);
        r.end();
    });
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

    // GET ANTES do POST: o ASP classico cria a sessao ao servir `login.asp`, e o POST sem
    // esse cookie cai em 302 -> cwebErro.asp. Era exatamente a falha observada. O
    // `submete()` da pagina so chama form.submit(), sem transformar a senha -- conferido,
    // entao POST em claro dos dois campos e o correto.
    await req(jar, BASE_SEGURO + '/login.asp');
    if (jar.vazio) {
        throw new Error('o GET de login.asp nao devolveu cookie de sessao -- o portal mudou?');
    }

    const body = new URLSearchParams({
        txtUsuario: cred.usuario,
        txtSenha: cred.senha,
        cboTipoUsuario: cred.tipoUsuario,
    }).toString();
    const r = await req(jar, URL_LOGIN, { method: 'POST', body, referer: BASE_SEGURO + '/login.asp' });

    // Falha chega como 302 para cwebErro.asp COM CORPO VAZIO: checar o Location, nao o
    // corpo. Antes eu testava so o corpo e por isso segui adiante com login recusado,
    // reportando "token nao encontrado" em vez da causa real.
    if (/erro/i.test(r.loc)) {
        let detalhe = '';
        try {
            const pag = await req(jar, absolutizar(URL_LOGIN, r.loc));
            detalhe = pag.corpo.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        } catch (e) { /* a mensagem e um extra: nao deixar mascarar o erro principal */ }
        const dicaTipo = /tipo de usu/i.test(detalhe)
            ? ' | tipoUsuario enviado: ' + cred.tipoUsuario + '. ' + TIPOS_CONHECIDOS
            : '';
        throw new Error('login recusado pelo Ambiente Seguro' + (detalhe ? ' -- ' + detalhe : '') +
            ' | confira as credenciais em ' + cred.origem + dicaTipo +
            '. NAO vou tentar de novo para nao bloquear a conta.');
    }
    if (/senha inv|usu.rio inv|n.o cadastrad|bloquead|incorret/i.test(r.corpo)) {
        throw new Error('login recusado pelo Ambiente Seguro. Confira as credenciais em ' +
            cred.origem + '. NAO vou tentar de novo para nao bloquear a conta.');
    }

    // Sucesso costuma vir como 302 para a pagina de servicos: seguir uma vez fecha o fluxo
    // de autenticacao antes do andador comecar.
    if (r.loc) {
        try { await req(jar, absolutizar(URL_LOGIN, r.loc)); } catch (e) { /* nao fatal */ }
    }
    return { status: r.status, loc: r.loc, cookies: jar.cookies.size };
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
            .filter((u) => !RE_PROIBIDO.test(u));

        // Ordem importa: acesso a sistema que parece MFe primeiro, depois os outros
        // acessos a sistema, e so no fim a navegacao generica. Sem isso o andador gasta
        // o orcamento de passos em paginas institucionais.
        const peso = (u) => (RE_ACESSO_SISTEMA.test(u) ? (RE_PARECE_MFE.test(u) ? 0 : 1) : (RE_PARECE_MFE.test(u) ? 2 : 3));
        alvos.sort((a, b) => peso(a) - peso(b));
        passo.candidatos = alvos.slice(0, 6);   // na trilha, para diagnosticar quando falhar
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
