/* ------------------------------ Token do MFe (Ambiente Seguro) ------------------------------
 *
 * Obtém o JWT que a API `portalcfews` exige, percorrendo o Ambiente Seguro da SEFAZ-CE por
 * HTTP puro. Zero dependência externa — só `https` nativo. Isso é deliberado: a única
 * dependência que o worker tinha (`exceljs`) foi o que o impediu de subir na máquina da
 * empresa por meses (ver P1). Chromium headless resolveria de forma mais direta e custaria
 * ~300 MB de `npm install` — o mesmo defeito, ampliado.
 *
 * Caminho COMPLETO, fixado com os dumps de 2026-09-10/11 (nenhum passo é dedução):
 *   1. GET   .../LogarUsuario/login.asp        (cria a sessão ASP; sem isso o POST cai em erro)
 *      POST  .../LogarUsuario/cweb20011.asp    (txtUsuario, txtSenha, cboTipoUsuario)
 *   2. GET   .../LogarUsuario/cweb2003.asp?sm=104            (menu do MFe)
 *   3. GET   .../LogarUsuario/cweb1010.asp?sse=104&sts=448   ("Acessar MFe")
 *         -> 302 EmpresasDoCPF/cweb2010.asp?SSE=104&Destino=MFe/RedirJavaMFe.asp
 *   4. GET   essa lista (195 empresas) e POST cweb2010.asp com lstEmpresa/num/hidControle
 *         -> 302 MFe/RedirJavaMFe.asp
 *   5. essa página NÃO redireciona: termina com
 *         window.open('http://cfe.sefaz.ce.gov.br/mfe/portal#/login?key=..&auth=..&cgf=..&cnpj=..')
 *      Os parâmetros vão no FRAGMENTO, que nunca chega ao servidor. Quem lê é o SPA.
 *   6. POST  https://cfe.sefaz.ce.gov.br:8443/portalcfews/mfe/authentication/login
 *      com esses parâmetros em JSON  ->  o JWT.
 *
 * O passo 6 é XHR, não navegação: por isso seguir redirects nunca achava o token, por mais
 * saltos que se desse. A rota saiu do próprio SPA (asset público, sem credencial):
 * `authentication/services/AuthenticationRepository.js` (route 'mfe/authentication',
 * loginAmbienteSeguro posta o `$location.search()` inteiro) e o `<meta name="endpoint">`
 * do index do portal.
 *
 * `--descobrir` mantém o andador que mapeou isto. É ferramenta de diagnóstico para quando o
 * portal mudar, NÃO plano B automático: crawler cego contra portal de fisco, disparado por
 * job de usuário, bate em dezenas de páginas por tentativa.
 *
 * `key`/`auth` do passo 5 são CREDENCIAIS DE SESSÃO vivas. Nunca são logadas, nunca entram
 * em mensagem de erro — só os nomes dos campos. Um dump com elas é material sensível.
 *
 * Credenciais: `~/.softtech-ambiente-seguro.json` ou env. NUNCA são logadas, nem em erro.
 * HTTPS obrigatório — o portal também serve em HTTP, sem redirect, e ali a senha vai em claro.
 *
 * Rodar:  node worker/lib/token-mfe.js --cnpj=<14 dígitos> [--dump=<pasta>]
 *         node worker/lib/token-mfe.js --descobrir --dump=<pasta>   (remapear)
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

// Passo 3, FIXADO pelo dump de 2026-09-11 (C:\temp\mfe\00-cweb2003.asp_sm_104.html:403).
// O link "Acessar MFe" NAO e `cweb1010java.asp?sis=&sse=` -- e outro script:
//     <a href="cweb1010.asp?sse=104&sts=448">Acessar MFe</a>
// Por isso tres execucoes do andador nao acharam: ele so reconhecia `cweb1010java.asp`.
// `cweb1010.asp` (sem "java"), parametros `sse` (menu) + `sts` (servico). Responde 302 ->
//     ../../EMPRESASDOCPF/CWEB2010.ASP?SSE=104&Destino=MFe/RedirJavaMFe.asp
const URL_ACESSAR_MFE = BASE_SEGURO + '/cweb1010.asp?sse=104&sts=448';
// Logout. Visto no dump de RedirJavaMFe.asp ("| Sair"). O Ambiente Seguro e de SESSAO
// UNICA: sem encerrar, o proximo login -- do worker ou do proprio usuario no browser --
// e recusado com "O usuario ja esta logado no sistema".
const URL_ENCERRAR = HOST_SEGURO + '/internet/acessoSeguro/ServicoSenha/EncerrarSessao/cweb2005.asp';
const MAX_SALTOS_FINAIS = 6;
const REQ_TIMEOUT_MS = 30000;
// Teto de saltos; sem ele um redirect ciclico roda para sempre. Subiu de 25 para 40 com
// evidencia: na execucao de 2026-09-10, 18 dos 25 passos foram gastos em paginas de menu
// `cweb2003.asp?sm=NNN` que nao levavam a lugar nenhum -- o orcamento acabou antes de o
// andador chegar a qualquer sistema. Com o Referer corrigido, os acessos a sistema param
// de ser recusados de cara e o orcamento passa a ser gasto em pagina util.
// ponytail: teto arbitrario continua sendo teto arbitrario.
const MAX_PASSOS = 40;

// Links que DESTROEM a sessao ou saem do fluxo. O andador clicou em EncerrarSessao no
// terceiro passo da primeira execucao e matou a propria sessao -- todo o resto da trilha
// voltou pagina deslogada. Filtro por 'logout|sair' nao pegava 'EncerrarSessao'.
const RE_PROIBIDO = /EncerrarSessao|cweb2005|cweb20011|logout|sair|login\.asp|\/index\.asp|cwebErro/i;

// Acesso a sistema no Ambiente Seguro: cweb1010java.asp?sis=<sistema>&sse=<id>.
// Descoberto na trilha. E por aqui que se chega ao MFe, entao vai na frente da fila.
// DOIS scripts, nao um -- foi o que fez o andador errar tres vezes:
//   cweb1010java.asp?sis=<nome>&sse=<id>   sistemas "java" (PostoFiscal, Sitram, ...)
//   cweb1010.asp?sse=<menu>&sts=<servico>  os demais -- e o MFe esta AQUI (sse=104&sts=448)
// O padrao antigo so casava o primeiro, entao "Acessar MFe" nunca entrava na fila.
const RE_ACESSO_SISTEMA = /cweb1010(java)?\.asp\?/i;
const RE_PARECE_MFE = /mfe|cfe|fiscal|cupom|nfce/i;
const ARQUIVO_CRED = path.join(os.homedir(), '.softtech-ambiente-seguro.json');

// O form de login exige `cboTipoUsuario` (rotulado "Tipo/Vinculo do Usuario"). Nao e
// opcional: sem ele o POST volta 302 para cwebErro.asp com "Tipo de Usuario Nao Foi
// Selecionado". Padrao CONTADOR porque e o vinculo do Josue; outro vinculo se configura
// por "tipoUsuario" no arquivo de credenciais.
const TIPO_USUARIO_PADRAO = '3';
// Mesma lista, em forma de dado: a UI monta o <select> de "Vinculo" a partir daqui, em vez
// de repetir os codigos numa segunda tabela que sai de sincronia com esta.
const TIPOS_USUARIO = [
    { codigo: '3', nome: 'CONTADOR' },
    { codigo: '4', nome: 'DEPENDENTE DE CONTADOR' },
    { codigo: '1', nome: 'SOCIO' },
    { codigo: '2', nome: 'DEPENDENTE DE SOCIO' },
    { codigo: '10', nome: 'PORTAL FISCAL MESTRE' },
    { codigo: '11', nome: 'PORTAL FISCAL DEPENDENTE' },
    { codigo: '80', nome: 'EMISSOR DE NFE' },
];
const TIPOS_CONHECIDOS = 'Valores de cboTipoUsuario: ' +
    TIPOS_USUARIO.map((t) => t.codigo + '=' + t.nome).join(', ') +
    '. A lista completa esta no <select> de login.asp.';

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

/**
 * Estado das credenciais, SEM devolver senha nem CPF inteiro.
 *
 * Existe porque a máquina da empresa não tem o arquivo e o sintoma disso só aparecia no
 * meio de um lote de milhares de chaves, como "não foi possível obter o token do MFe".
 * A tela agora pergunta antes de começar.
 *
 * `origem` importa: env GANHA do arquivo em `lerCredenciais`. Se alguém definiu
 * SEFAZ_AS_USUARIO nesta máquina, gravar o arquivo não muda nada — e a tela precisa
 * dizer isso, senão o usuário digita, salva, e continua falhando com a credencial antiga.
 */
function statusCredenciais() {
    const porEnv = !!(process.env.SEFAZ_AS_USUARIO && process.env.SEFAZ_AS_SENHA);
    try {
        const c = lerCredenciais();
        return {
            configurado: true,
            origem: porEnv ? 'env' : 'arquivo',
            arquivo: ARQUIVO_CRED,
            usuario: mascararCpf(c.usuario),
            tipoUsuario: c.tipoUsuario,
            travadoPorEnv: porEnv,
        };
    } catch (e) {
        return { configurado: false, origem: '', arquivo: ARQUIVO_CRED, usuario: '', tipoUsuario: TIPO_USUARIO_PADRAO, travadoPorEnv: porEnv };
    }
}

function mascararCpf(d) {
    const s = String(d || '').replace(/\D/g, '');
    if (s.length !== 11) return s ? '*'.repeat(Math.max(0, s.length - 2)) + s.slice(-2) : '';
    return '***.***.' + s.slice(6, 9) + '-**';
}

/**
 * Grava as credenciais no home do usuário desta máquina. NÃO sai do disco local: quem
 * chama é a rota do worker em 127.0.0.1, e o site na Vercel nunca vê o valor de volta
 * (`statusCredenciais` só devolve máscara).
 *
 * `mode: 0o600` é honesto no Linux/Mac e decorativo no Windows (o NTFS ignora o modo
 * POSIX). No Windows quem protege é o lugar: o perfil do usuário. Não vendo isso como
 * criptografia — não é.
 */
function gravarCredenciais({ usuario, senha, tipoUsuario }) {
    const cpf = String(usuario || '').replace(/\D/g, '');
    if (cpf.length !== 11) throw new Error('CPF inválido: informe os 11 dígitos do CPF que entra no Ambiente Seguro.');
    const pass = String(senha == null ? '' : senha);
    if (!pass) throw new Error('Senha vazia.');
    const tipo = String(tipoUsuario || TIPO_USUARIO_PADRAO).replace(/\D/g, '');
    if (!TIPOS_USUARIO.some((t) => t.codigo === tipo)) {
        throw new Error('Vínculo desconhecido: "' + tipo + '". ' + TIPOS_CONHECIDOS);
    }
    fs.writeFileSync(ARQUIVO_CRED, JSON.stringify({ usuario: cpf, senha: pass, tipoUsuario: tipo }, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(ARQUIVO_CRED, 0o600); } catch { /* Windows: sem equivalente, segue */ }
    return statusCredenciais();
}

function apagarCredenciais() {
    try { fs.unlinkSync(ARQUIVO_CRED); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return statusCredenciais();
}

// --------------------------------- cookie jar ---------------------------------

/**
 * Jar mínimo. O `fetch` do Node não guarda cookie, e o Ambiente Seguro é ASP clássico:
 * toda a sessão vive num `ASPSESSIONID...`. Sem jar, cada requisição volta para o login.
 * Não valida domínio/path de propósito: o jar é usado só nos dois hosts da SEFAZ.
 */
class CookieJar {
    constructor() { this.cookies = new Map(); }
    // Aceita as tres formas que ja apareceram: Headers.getSetCookie() (Node 19.7+),
    // Headers.get() e o objeto cru do `http` nativo, onde `set-cookie` ja e array. A
    // ultima e a que a producao usa desde a troca de `fetch` por `https.request`; as duas
    // primeiras so sobrevivem para nao quebrar chamador antigo -- e `getSetCookie` nem
    // existe no Node da maquina da empresa, entao depender so dela seria a mesma armadilha
    // de novo.
    absorver(res) {
        const h = (res && res.headers) || {};
        let raw;
        if (typeof h.getSetCookie === 'function') raw = h.getSetCookie();
        else if (typeof h.get === 'function') raw = [h.get('set-cookie')].filter(Boolean);
        else raw = [].concat(h['set-cookie'] || []);
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

function req(jar, url, { method = 'GET', body = null, referer = '', contentType = '' } = {}) {
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
            headers['content-type'] = contentType || 'application/x-www-form-urlencoded';
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
                // headers inteiros: a API do MFe devolve o JWT em `x-authentication-token`,
                // que e o mesmo header que lib/nfce.js manda de volta a cada chave.
                headers: res.headers,
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

// --------------------------------- extração de alvos ---------------------------------

// O extrator antigo só lia `href=` e `action=`. A trilha de 2026-09-10 mostrou o custo:
// as 18 páginas `cweb2003.asp?sm=NNN` visitadas devolveram bytes DIFERENTES (16873,
// 19922, 17647, ...) e a MESMA lista de 6 candidatos, sempre. Conteúdo que muda com
// candidatos que não mudam significa uma coisa só: o que foi colhido era a navegação
// estática da página, e os links de verdade — os que dependem do `sm` — estão em
// JavaScript. ASP clássico dessa geração abre sistema por `window.open(...)` /
// `location.href=...` num `onclick`, não por âncora.
const PADROES_ALVO = [
    /(?:href|action)\s*=\s*["']([^"'#]+)["']/gi,        // âncoras e forms
    /window\.open\s*\(\s*["']([^"']+)["']/gi,           // abre em nova janela
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
    /(?:\.replace|\.assign)\s*\(\s*["']([^"']+)["']/gi,
    // Rede de segurança: a URL de acesso a sistema em QUALQUER lugar do texto, inclusive
    // concatenada dentro de função JS que os padrões acima não desmontam.
    /(cweb1010java\.asp\?[A-Za-z0-9_=&%.\-]+)/gi,
];

/**
 * Todos os alvos navegáveis de uma página, absolutos, únicos e já filtrados.
 * Devolve na ordem de prioridade: acesso a sistema que parece MFe, outros acessos a
 * sistema, resto. Sem isso o andador gasta o orçamento de passos em página institucional.
 */
function extrairAlvos(base, corpo) {
    const brutos = new Set();
    for (const re of PADROES_ALVO) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(corpo)) !== null) {
            const v = String(m[1] || '').trim();
            if (v && !/^(javascript:|mailto:|tel:|#)/i.test(v)) brutos.add(v);
        }
    }
    const alvos = Array.from(brutos)
        .map((h) => absolutizar(base, h))
        .filter((u) => /^https:\/\/(servicos|cfe)\.sefaz\.ce\.gov\.br/.test(u))
        .filter((u) => !/\.(css|js|png|jpe?g|gif|svg|ico|woff2?)(\?|$)/i.test(u))
        .filter((u) => !RE_PROIBIDO.test(u));

    const peso = (u) => (RE_ACESSO_SISTEMA.test(u)
        ? (RE_PARECE_MFE.test(u) ? 0 : 1)
        : (RE_PARECE_MFE.test(u) ? 2 : 3));
    return Array.from(new Set(alvos)).sort((a, b) => peso(a) - peso(b));
}

// --------------------------------- seleção de empresa (passo 4) ---------------------------------

// A pagina `EmpresasDoCPF/cweb2010.asp` lista as empresas do CPF (195 no caso do Josue) e
// submete por JS, nao por link:
//     function submete(plst, pNum){ form1.lstEmpresa.value=plst; form1.num.value=pNum;
//                                   form1.submit(); }
//     <a href="JavaScript:submete('<plst>','<num>');">62124510</a>   <- texto = CGF
// `plst` e uma string opaca de campos concatenados em largura fixa (sequencial, CGF,
// CPF/CNPJ, nome). NAO decodificamos: copiamos verbatim da pagina, que e o que o browser
// faz. Decodificar layout de campo fixo de ASP de 2003 seria inventar contrato -- e
// qualquer mudanca de largura quebraria em silencio, escolhendo a empresa errada.
const RE_LINHA_EMPRESA = /submete\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)\s*;?\s*"?\s*>\s*([^<]*)</gi;
const RE_HIDDEN = /<input[^>]*type\s*=\s*["']hidden["'][^>]*>/gi;

/** Valor de um input hidden pelo `name`, como o browser leria. */
function valorHidden(html, nome) {
    RE_HIDDEN.lastIndex = 0;
    let m;
    while ((m = RE_HIDDEN.exec(html)) !== null) {
        const tag = m[0];
        const n = /name\s*=\s*["']([^"']+)["']/i.exec(tag);
        if (!n || n[1].toLowerCase() !== String(nome).toLowerCase()) continue;
        const v = /value\s*=\s*["']([^"']*)["']/i.exec(tag);
        return v ? v[1] : '';
    }
    return null;   // null = campo AUSENTE; '' = presente e vazio. A diferenca importa no erro.
}

/** Linhas de empresa da pagina de selecao: { plst, num, cgf, digitos }. */
function lerEmpresas(html) {
    const linhas = [];
    RE_LINHA_EMPRESA.lastIndex = 0;
    let m;
    while ((m = RE_LINHA_EMPRESA.exec(html)) !== null) {
        const plst = m[1];
        if (!plst || plst === 'plst') continue;        // pula a propria declaracao da funcao
        linhas.push({
            plst,
            num: m[2],
            cgf: String(m[3] || '').trim(),
            digitos: plst.replace(/\D/g, ''),
        });
    }
    // A mesma empresa aparece em mais de uma celula da linha (CGF e nome): deduplica.
    const vistos = new Set();
    return linhas.filter((l) => (vistos.has(l.plst) ? false : (vistos.add(l.plst), true)));
}

/**
 * Escolhe a empresa por CNPJ (ou CGF). Sem chute: se nao achar, o erro diz quantas
 * empresas a pagina trouxe e algumas amostras -- escolher a errada aqui significa baixar
 * cupom de outro contribuinte, o que e pior que falhar.
 */
function escolherEmpresa(empresas, alvo) {
    const d = String(alvo || '').replace(/\D/g, '');
    if (!d) return null;
    const porDigitos = empresas.filter((e) => e.digitos.indexOf(d) !== -1);
    if (porDigitos.length === 1) return porDigitos[0];
    if (porDigitos.length > 1) {
        const e = new Error('CNPJ/CGF ' + d + ' casa com ' + porDigitos.length +
            ' empresas da lista (CGFs: ' + porDigitos.map((x) => x.cgf).join(', ') +
            '). Passe o CNPJ completo de 14 digitos.');
        e.ambiguo = true;
        throw e;
    }
    const porCgf = empresas.filter((e) => e.cgf.replace(/\D/g, '') === d);
    return porCgf.length === 1 ? porCgf[0] : null;
}

/** Pares sis/sse de uma URL de acesso a sistema — o que falta descobrir é exatamente isso. */
function parSistema(u) {
    const m = /cweb1010java\.asp\?(.*)$/i.exec(u);
    if (!m) return null;
    try {
        const q = new URLSearchParams(m[1]);
        const sis = q.get('sis') || '';
        const sse = q.get('sse') || '';
        return sis || sse ? { sis, sse, url: u } : null;
    } catch (e) { return null; }
}

// --------------------------------- login ---------------------------------

/**
 * Faz o POST do formulário `frmASeguro`. Login que falha NÃO é retentado: portal do fisco
 * bloqueia conta após N tentativas erradas, e um worker em laço travaria a conta do Josué.
 */
async function login(jar, { dump = '' } = {}) {
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
    // `paginaFinal` vira o Referer do primeiro passo seguinte. O portal recusa acesso a
    // sistema com "Pagina de origem desconhecida" quando o HTTP_REFERER nao bate, entao o
    // proximo passo precisa saber de onde veio -- e isso e aqui que se sabe, sem chutar.
    let paginaFinal = BASE_SEGURO + '/login.asp';
    let mensagem = '';
    if (r.loc) {
        const destino = absolutizar(URL_LOGIN, r.loc);
        try {
            const pag = await req(jar, destino, { referer: BASE_SEGURO + '/login.asp' });
            paginaFinal = destino;
            if (dump) gravarDump(dump, 0, pag, 'login-');

            // O login pode "dar certo" e ainda assim parar numa PAGINA DE RECADO. Medido em
            // 2026-09-11: o 302 foi para `cwebmsg.asp` em vez do `cweb2002.asp` habitual, e
            // dali o menu do MFe voltou HTTP 200 com 3761 bytes e nenhum `<body>` -- casca.
            // O teste antigo era so `/erro/i.test(r.loc)`, e `cwebmsg` nao tem "erro" no
            // nome: passava batido e o defeito reaparecia tres passos depois como "o portal
            // mudou". Guardar o texto LITERAL e devolve-lo faz a mensagem do portal chegar
            // em quem le o erro.
            if (/cwebmsg|aviso|mensagem|termo/i.test(destino)) {
                mensagem = textoVisivel(pag.corpo).slice(0, 400);
            }
        } catch (e) { /* nao fatal: segue com o login.asp como origem */ }
    }
    return { status: r.status, loc: r.loc, cookies: jar.cookies.size, paginaFinal, mensagem };
}

// --------------------------------- passo 5: a troca key+auth -> JWT ---------------------------------

// O passo 5 NAO e mais um redirect -- por isso seguir saltos nunca ia achar nada.
// `RedirJavaMFe.asp` termina com (medido 2026-09-11, 04-RedirJavaMFe.asp.html):
//
//   <script>window.open('http://cfe.sefaz.ce.gov.br/mfe/portal#/login?key=<hex>&auth=<...>
//            &vinculo=3&cgf=<cgf>&cnpj=<cnpj>&siglaSistema=portal-mfe');history.back();</script>
//
// Os parametros vao no FRAGMENTO (`#`), que por definicao nunca chega ao servidor: quem le
// e o SPA, no browser. Ele nao navega para lugar nenhum com isso -- troca por JWT numa
// chamada XHR. Nenhum numero de saltos acharia o token.
//
// A troca, lida do proprio SPA (asset publico, sem credencial):
//   /mfe/assets/javascripts/authentication/services/AuthenticationRepository.js
//       AbstractRepository.call(this, restangular, 'mfe/authentication');
//       this.loginAmbienteSeguro = function (credentials) {
//           return this.restangular.all(this.route + "/login").post(credentials); };
//   AuthenticationController.js -> loginAmbienteSeguro($location.search())
//       ou seja: o objeto inteiro do fragmento vira o corpo JSON.
//   index do SPA: <meta name="endpoint" content="https://cfe.sefaz.ce.gov.br:8443/portalcfews">
const URL_API_MFE = process.env.MFE_API_BASE || 'https://cfe.sefaz.ce.gov.br:8443/portalcfews';
const ROTA_LOGIN_MFE = '/mfe/authentication/login';

// `history.back()` na mesma linha nao e ruido: confirma que a pagina so serve de mensageiro.
const RE_REDIR_MFE = /window\.open\(\s*['"]([^'"]*\/mfe\/portal#[^'"]*)['"]/i;

/**
 * Extrai os parâmetros do fragmento `#/login?...` que o RedirJavaMFe.asp entrega ao SPA.
 *
 * Devolve um objeto com TODOS os parâmetros, sem filtrar por nome: o SPA manda
 * `$location.search()` inteiro, e adivinhar quais campos importam seria reinventar o
 * contrato. Se a SEFAZ acrescentar um campo, ele passa junto.
 */
function extrairCredenciaisMfe(html) {
    const m = RE_REDIR_MFE.exec(String(html || ''));
    if (!m) return null;
    const bruto = m[1];
    const i = bruto.indexOf('#');
    const frag = i === -1 ? '' : bruto.slice(i + 1);
    const q = frag.indexOf('?');
    if (q === -1) return null;
    const params = {};
    for (const [k, v] of new URLSearchParams(frag.slice(q + 1))) params[k] = v;
    return Object.keys(params).length ? params : null;
}

/**
 * Troca key+auth pelo JWT, como o SPA faz.
 *
 * O token pode voltar no corpo ou no header `x-authentication-token` — é o header que o
 * worker já manda de volta em `lib/nfce.js`. Varre os dois em vez de escolher um: escolher
 * errado aqui devolveria "sem token" com o token na mão.
 *
 * As credenciais NUNCA são logadas nem entram em mensagem de erro. `key`/`auth` são
 * credenciais de sessão vivas — quem tiver isso entra como o usuário.
 */
async function trocarPorJwt(jar, credenciais, cnpjEsperado) {
    const url = URL_API_MFE + ROTA_LOGIN_MFE;
    const r = await req(jar, url, {
        method: 'POST',
        body: JSON.stringify(credenciais),
        contentType: 'application/json',
        referer: 'http://cfe.sefaz.ce.gov.br/mfe/portal',
    });
    const noHeader = r.headers ? (r.headers['x-authentication-token'] || '') : '';
    const achado = extrairJwt(noHeader, cnpjEsperado) || extrairJwt(r.corpo, cnpjEsperado);
    if (achado) return achado;

    // Sem token: dizer o que veio, menos o que é segredo. Campos recebidos em vez de
    // "falhou" — a lição que custou quatro rodadas neste projeto.
    let resumo = '';
    try {
        const j = JSON.parse(r.corpo);
        resumo = ' | campos da resposta: ' + Object.keys(j).join(', ');
    } catch (e) {
        resumo = ' | corpo: ' + textoVisivel(r.corpo).slice(0, 200);
    }
    throw new Error('a troca key+auth -> JWT respondeu HTTP ' + r.status + ' sem token válido em ' +
        url + resumo + ' | parâmetros enviados: ' + Object.keys(credenciais).join(', ') +
        ' (valores omitidos de propósito: são credenciais de sessão)');
}

// --------------------------------- caminho fixo (passos 3 a 5) ---------------------------------

/**
 * Percorre o caminho CONHECIDO, sem andar às cegas. Cada passo foi fixado com evidência —
 * o dump de 2026-09-11, não dedução:
 *
 *   3. GET  cweb1010.asp?sse=104&sts=448        (link "Acessar MFe" do menu sm=104)
 *      -> 302 EmpresasDoCPF/cweb2010.asp?SSE=104&Destino=MFe/RedirJavaMFe.asp
 *   4. GET  essa lista, escolhe a empresa, POST cweb2010.asp com lstEmpresa/num/hidControle
 *   5. segue os saltos até cfe.sefaz.ce.gov.br, varrendo por JWT
 *
 * Referer em TODO passo: o portal recusa com "Página de origem desconhecida" sem ele.
 *
 * Falha com mensagem que diz em QUAL passo parou e o que veio. O andador (`descobrirToken`)
 * continua existindo para quando o portal mudar — mas ele é o plano B, não o caminho.
 */
async function obterTokenPorCaminho(jar, { cnpj = '', origem = '', dump = '', mensagemLogin = '' } = {}) {
    const trilha = [];
    const registrar = (r, rotulo) => {
        const p = { passo: rotulo, url: r.url, status: r.status, bytes: r.corpo.length };
        if (r.loc) p.loc = r.loc;
        if (dump) p.arquivo = gravarDump(dump, trilha.length, r);
        trilha.push(p);
        return p;
    };
    const falhar = (msg) => { const e = new Error(msg); e.trilha = trilha; throw e; };

    // Passo 2 refeito aqui de propósito: é ele que vira o Referer legítimo do passo 3.
    const menu = await req(jar, URL_MENU_MFE, { referer: origem || (BASE_SEGURO + '/cweb2002.asp') });
    registrar(menu, '2-menu-mfe');
    if (menu.status !== 200) falhar('menu MFe (sm=104) respondeu HTTP ' + menu.status + ' — sessão caiu?');

    // Duas causas distintas para "não achei o link", e consertos OPOSTOS. Separar aqui
    // porque em 2026-09-11 o menu voltou HTTP 200 com 3761 bytes, nenhum `<body>` e zero
    // texto, e a mensagem dizia "o portal mudou" — diagnóstico errado que mandaria alguém
    // remapear rotas que estão certas. A página cheia tem ~17 KB.
    if (pareceCasca(menu.corpo)) {
        falhar('o menu MFe voltou HTTP 200 mas VAZIO (' + menu.corpo.length + ' bytes, sem <body>). ' +
            'Isso é sessão não estabelecida, não mudança de rota. ' +
            'Login terminou em: ' + (origem || '(desconhecido)') +
            (mensagemLogin ? ' | o portal disse: "' + mensagemLogin + '"' : '') +
            ' | Causas conhecidas: sessão já aberta noutro browser (o Ambiente Seguro é ' +
            'sessão única), senha expirada, ou termo/aviso pendente de aceite. ' +
            'Entre no portal pelo browser, resolva o que ele pedir, encerre a sessão lá e rode de novo.');
    }
    if (menu.corpo.indexOf('cweb1010.asp?sse=104&sts=448') === -1) {
        falhar('o menu sm=104 carregou (' + menu.corpo.length + ' bytes, com conteúdo) mas não ' +
            'contém o link "Acessar MFe" (cweb1010.asp?sse=104&sts=448). Aí sim o portal mudou, ' +
            'ou este CPF perdeu o acesso ao MFe. Rode --descobrir --dump=<pasta> e me mande o HTML.');
    }

    const acesso = await req(jar, URL_ACESSAR_MFE, { referer: URL_MENU_MFE });
    registrar(acesso, '3-acessar-mfe');
    let achado = extrairJwt(acesso.loc, cnpj) || extrairJwt(acesso.corpo, cnpj);
    if (achado) return { ...achado, trilha };
    if (!acesso.loc) {
        falhar('"Acessar MFe" respondeu HTTP ' + acesso.status + ' sem Location. ' +
            'Esperado 302 para EmpresasDoCPF/cweb2010.asp.');
    }
    if (/cwebErro/i.test(acesso.loc)) {
        falhar('"Acessar MFe" caiu em cwebErro: ' + acesso.loc +
            ' — em geral é Referer/sessão. Referer enviado: ' + URL_MENU_MFE);
    }

    const urlLista = absolutizar(URL_ACESSAR_MFE, acesso.loc);
    const lista = await req(jar, urlLista, { referer: URL_ACESSAR_MFE });
    registrar(lista, '4-lista-empresas');
    achado = extrairJwt(lista.corpo, cnpj);
    if (achado) return { ...achado, trilha };
    if (lista.status !== 200) falhar('lista de empresas respondeu HTTP ' + lista.status + ': ' + urlLista);

    const empresas = lerEmpresas(lista.corpo);
    if (!empresas.length) {
        falhar('a lista de empresas veio sem nenhuma linha submete(...) em ' + lista.corpo.length +
            ' bytes. O formato mudou: rode com --dump=<pasta> e me mande ' + urlLista);
    }
    if (!cnpj) {
        const e = new Error('a seleção de empresa exige CNPJ: a lista trouxe ' + empresas.length +
            ' empresas e escolher por conta própria significaria baixar cupom de outro ' +
            'contribuinte. Passe --cnpj=<14 dígitos> (CGFs de exemplo: ' +
            empresas.slice(0, 5).map((x) => x.cgf).join(', ') + ').');
        e.trilha = trilha;
        e.empresas = empresas.length;
        throw e;
    }
    const alvo = escolherEmpresa(empresas, cnpj);
    if (!alvo) {
        falhar('CNPJ/CGF ' + String(cnpj).replace(/\D/g, '') + ' não está entre as ' +
            empresas.length + ' empresas do CPF logado. CGFs de exemplo: ' +
            empresas.slice(0, 8).map((x) => x.cgf).join(', '));
    }

    // hidControle sai da PÁGINA, não é hardcoded: é o destino pós-seleção e muda por
    // sistema (aqui deve apontar para MFe/RedirJavaMFe.asp).
    const hidControle = valorHidden(lista.corpo, 'hidControle');
    if (hidControle === null) {
        falhar('a lista de empresas não tem o campo hidControle — o form mudou. Dump: ' + urlLista);
    }
    const corpoPost = new URLSearchParams({
        num: alvo.num,
        lstEmpresa: alvo.plst,
        hidControle: hidControle,
        destino: valorHidden(lista.corpo, 'destino') || '',
        SSE: valorHidden(lista.corpo, 'SSE') || '',
    }).toString();

    const urlAction = absolutizar(urlLista, 'cweb2010.asp');
    let r = await req(jar, urlAction, { method: 'POST', body: corpoPost, referer: urlLista });
    registrar(r, '4-post-empresa(CGF ' + alvo.cgf + ')');
    achado = extrairJwt(r.loc, cnpj) || extrairJwt(r.corpo, cnpj);
    if (achado) return { ...achado, trilha };

    // A seleção redireciona para RedirJavaMFe.asp. Seguir os saltos até lá — e só até lá:
    // o JWT NÃO está em salto nenhum, o que essa página faz é entregar key+auth ao SPA.
    let url = urlAction;
    let credenciais = extrairCredenciaisMfe(r.corpo);
    for (let i = 0; i < MAX_SALTOS_FINAIS && r.loc && !credenciais; i++) {
        const proximo = absolutizar(url, r.loc);
        const anterior = url;
        url = proximo;
        r = await req(jar, proximo, { referer: anterior });
        registrar(r, '5-salto-' + (i + 1));
        achado = extrairJwt(r.loc, cnpj) || extrairJwt(r.corpo, cnpj);
        if (achado) return { ...achado, trilha };
        credenciais = extrairCredenciaisMfe(r.corpo);
    }

    if (!credenciais) {
        falhar('seleção de empresa (CGF ' + alvo.cgf + ') aceita, mas a página de entrega não ' +
            'trouxe o window.open(.../mfe/portal#/login?...) com key+auth. Último: HTTP ' +
            r.status + ' ' + url + (r.loc ? ' -> ' + r.loc : '') + ', ' + r.corpo.length +
            ' bytes. Rode com --dump=<pasta> e me mande esse arquivo.');
    }

    // Passo 6: a troca. É XHR, não navegação — e é por isso que nenhum número de saltos
    // resolvia. Os nomes dos campos vão no log; os valores, nunca.
    registrar({ url: URL_API_MFE + ROTA_LOGIN_MFE, status: 0, corpo: '', loc: '' },
        '6-troca-key+auth (campos: ' + Object.keys(credenciais).join(',') + ')');
    const t = await trocarPorJwt(jar, credenciais, cnpj);
    return { ...t, trilha };
}

// --------------------------------- descoberta do caminho ---------------------------------

/**
 * Anda do menu MFe em diante seguindo redirects, links e forms, varrendo cada resposta
 * por um JWT válido. Devolve o token e a trilha percorrida.
 *
 * ponytail: busca em largura ingênua com teto de MAX_PASSOS. Quando as rotas dos passos 3
 * e 4 forem confirmadas, isto vira três requisições fixas e este andador sai.
 */
async function descobrirToken(jar, { cnpj = '', verboso = false, dump = '', origem = '' } = {}) {
    const trilha = [];
    // A fila carrega a PÁGINA DE ORIGEM junto da URL. Não é detalhe: na trilha de
    // 2026-09-10 todo `cweb1010java.asp?sis=...&sse=...` devolveu
    //   302 -> cwebErro.asp?de=Não é possível continuar a operação. Página de origem
    //          desconhecida00.
    // "Página de origem desconhecida" é a tradução literal de um teste de
    // `Request.ServerVariables("HTTP_REFERER")` — padrão de anti-deep-link em ASP clássico.
    // `login()` já mandava Referer no POST; o andador não mandava em lugar nenhum, e por
    // isso TODO acesso a sistema era recusado antes de executar.
    const fila = [{ url: URL_MENU_MFE, referer: origem || (BASE_SEGURO + '/cweb2002.asp') }];
    const visitados = new Set();
    // Inventário de sis/sse visto em qualquer página. É o objeto da investigação: falta
    // saber o par do MFe. Sai no relatório inteiro, não truncado em 6 como antes.
    const sistemas = new Map();

    while (fila.length && trilha.length < MAX_PASSOS) {
        const atual = fila.shift();
        if (!atual || !atual.url || visitados.has(atual.url)) continue;
        visitados.add(atual.url);
        const url = atual.url;

        let r;
        try { r = await req(jar, url, { referer: atual.referer || '' }); }
        catch (e) { trilha.push({ url, erro: (e && e.message) || String(e) }); continue; }

        const passo = { url, status: r.status, tipo: r.tipo.split(';')[0], bytes: r.corpo.length };
        if (atual.referer) passo.referer = atual.referer;
        if (r.loc) passo.loc = r.loc;
        if (dump) passo.arquivo = gravarDump(dump, trilha.length, r);

        // o token pode estar no Location do salto, ou no corpo
        const achado = extrairJwt(r.loc, cnpj) || extrairJwt(r.corpo, cnpj);
        if (achado) {
            passo.token = 'ACHADO (CNPJ ' + achado.cnpj + ')';
            trilha.push(passo);
            if (verboso) trilha.forEach((p) => console.log('  ' + JSON.stringify(p)));
            return { ...achado, trilha, sistemas: Array.from(sistemas.values()) };
        }
        trilha.push(passo);

        // Redirect: a origem do próximo salto é esta página, não a anterior.
        if (r.loc) { fila.push({ url: absolutizar(url, r.loc), referer: url }); continue; }

        const alvos = extrairAlvos(url, String(r.corpo));
        for (const u of alvos) {
            const par = parSistema(u);
            if (par && !sistemas.has(u)) sistemas.set(u, { ...par, visto_em: url });
        }
        passo.candidatos = alvos.slice(0, 8);   // na trilha, para diagnosticar quando falhar
        for (const u of alvos) if (!visitados.has(u)) fila.push({ url: u, referer: url });
    }

    const lista = Array.from(sistemas.values());
    const e = new Error('token não encontrado em ' + trilha.length + ' passo(s). ' +
        (lista.length
            ? ('Sistemas vistos: ' + lista.map((s) => s.sis + '/' + s.sse).join(', ') +
               ' — nenhum devolveu JWT. Se o MFe não está nessa lista, ele não aparece nas ' +
               'páginas percorridas: rode com --dump=<pasta> e procure no HTML salvo.')
            : 'Nenhum cweb1010java.asp?sis=&sse= foi visto — rode com --dump=<pasta>.'));
    e.trilha = trilha;
    e.sistemas = lista;
    throw e;
}

/**
 * Salva a resposta crua em disco. Existe porque `--descobrir` já rodou três vezes sem
 * fixar as rotas: a trilha diz o que foi pedido, não o que a página CONTÉM. Um HTML no
 * disco resolve em uma execução o que três rodadas de hipótese não resolveram.
 *
 * Grava em latin1->utf8: ASP clássico serve ISO-8859-1 e sem a conversão o arquivo abre
 * com acento quebrado, justo nos rótulos ("Acessar MFe") que são a pista.
 */
/**
 * Texto visível de uma página ASP, sem script/style/tags. Serve para pôr a mensagem
 * LITERAL do portal dentro do erro. O portal responde HTTP 200 a coisas que não são
 * sucesso (aviso, termo, sessão morta) — sem ler o texto, tudo isso vira "não achei",
 * que é a mensagem que já custou quatro rodadas neste projeto.
 */
function textoVisivel(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;?/gi, ' ')
        .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
        .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&ccedil;/gi, 'ç')
        .replace(/&atilde;/gi, 'ã').replace(/&otilde;/gi, 'õ').replace(/&ecirc;/gi, 'ê')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Uma resposta HTTP 200 que na verdade é uma casca. O menu do MFe tem ~17 KB e um `<body>`
 * com o link; sessão não estabelecida devolve 200 com só o `<head>` (medido 2026-09-11:
 * 3761 bytes, zero texto visível, nenhuma tag body). Distinguir isso de "o portal mudou"
 * importa: são consertos opostos.
 */
function pareceCasca(html) {
    return !/<body[\s>]/i.test(String(html || '')) || textoVisivel(html).length < 200;
}

function gravarDump(dir, indice, r, prefixo) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const nome = (prefixo || '') + String(indice).padStart(2, '0') + '-' +
            (r.url.split('/').pop() || 'resposta').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) +
            (/html/i.test(r.tipo) ? '.html' : '.txt');
        const alvo = path.join(dir, nome);
        fs.writeFileSync(alvo,
            '<!-- ' + r.url + ' | HTTP ' + r.status + (r.loc ? ' -> ' + r.loc : '') + ' -->\n' +
            Buffer.from(r.corpo, 'latin1').toString('utf8'));
        return alvo;
    } catch (e) {
        return '(falha ao gravar dump: ' + ((e && e.message) || e) + ')';
    }
}

// --------------------------------- cache ---------------------------------

let cache = null;   // { jwt, cnpj, exp }

/** Reaproveita o token até 5 min antes de expirar — evita um login por chamada. */
async function obterToken({ cnpj = '', forcar = false, encerrar = true } = {}) {
    const agora = Math.floor(Date.now() / 1000);
    if (!forcar && cache && cache.exp - 300 > agora && (!cnpj || cache.cnpj === cnpj)) return cache;
    const jar = new CookieJar();
    try {
        const l = await login(jar);
        // Produção usa o caminho FIXO. Não cai no andador se falhar: um crawler cego contra
        // portal de fisco, disparado por job de usuário, bate em dezenas de páginas por
        // tentativa. O andador é ferramenta de diagnóstico (`--descobrir`), não plano B
        // automático — se o caminho quebrar, o erro diz onde e alguém roda --descobrir.
        const t = await obterTokenPorCaminho(jar, { cnpj, origem: l.paginaFinal, mensagemLogin: l.mensagem });
        cache = { jwt: t.jwt, cnpj: t.cnpj, exp: t.exp };
        return cache;
    } finally {
        // FINALLY, não no caminho feliz. A versão anterior só encerrava quando dava certo, e
        // por isso CADA FALHA deixava uma sessão pendurada: a tentativa seguinte batia em
        // "O usuário já está logado no sistema... aguarde alguns minutos". Medido no teste
        // de tela de 2026-09-11 — a primeira tentativa falhou por outro motivo e trancou a
        // segunda, transformando um defeito em dois.
        //
        // `encerrar` agora é `true` por PADRÃO. A assimetria manda: sessão encerrada à toa
        // custa um login a mais; sessão deixada aberta tranca o usuário fora do próprio
        // portal por minutos. `encerrarSessao` falha em silêncio, então isto nunca mascara
        // o erro real que está subindo.
        if (encerrar) await encerrarSessao(jar);
    }
}

/**
 * Encerra a sessão no Ambiente Seguro.
 *
 * NÃO é higiene opcional. O Ambiente Seguro é de SESSÃO ÚNICA: enquanto a sessão do worker
 * estiver viva, um segundo login é recusado com "O usuário já está logado no sistema.
 * Verifique outro login, ou se o último foi encerrado corretamente e aguarde alguns
 * minutos". Medido em 2026-09-11 tentando obter token de dois CNPJs em seguida.
 *
 * Consequência que passa fácil: um worker que loga e nunca encerra TRANCA O USUÁRIO FORA
 * do próprio portal, e ele fica esperando "alguns minutos" sem saber por quê.
 *
 * Falha de propósito em silêncio — o token já está na mão e derrubar a obtenção por causa
 * do logout trocaria um incômodo por uma falha. Devolve booleano para quem quiser saber.
 *
 * Cuidado: `RE_PROIBIDO` barra esta URL no andador, e com razão — lá ela mataria a sessão
 * no meio da caminhada. Aqui é chamada de propósito, no fim.
 */
async function encerrarSessao(jar) {
    try {
        const r = await req(jar, URL_ENCERRAR, { referer: BASE_SEGURO + '/cweb2003.asp' });
        return r.status >= 200 && r.status < 400;
    } catch (e) {
        return false;
    }
}

module.exports = {
    obterToken, login, descobrirToken, extrairJwt, CookieJar, lerCredenciais, ARQUIVO_CRED,
    // Credenciais pela tela (máquina da empresa não tem o arquivo). Nada aqui devolve senha.
    statusCredenciais, gravarCredenciais, apagarCredenciais, TIPOS_USUARIO, mascararCpf,
    // Exportados para teste: a colheita de links é onde o andador falhou em silêncio por
    // três execuções, e falha silenciosa que não é testável volta.
    extrairAlvos, parSistema,
    // Passo 4: escolher a empresa errada baixa cupom de outro contribuinte. Testado.
    obterTokenPorCaminho, lerEmpresas, escolherEmpresa, valorHidden,
    // Separar "sessao nao estabelecida" de "portal mudou": consertos opostos.
    textoVisivel, pareceCasca,
    // Passo 6: a troca key+auth -> JWT. E XHR, nao navegacao.
    extrairCredenciaisMfe, trocarPorJwt, URL_API_MFE, ROTA_LOGIN_MFE,
    // Sessao unica: quem loga TEM que encerrar, ou tranca o usuario fora do portal.
    encerrarSessao, URL_ENCERRAR,
    URL_ACESSAR_MFE,
};

// --------------------------------- CLI ---------------------------------

if (require.main === module) {
    (async () => {
        const arg = (nome) => (process.argv.find((a) => a.indexOf('--' + nome + '=') === 0) || '').split('=').slice(1).join('=');
        const cnpj = arg('cnpj');
        // --dump=<pasta> grava o HTML de cada passo. Três execuções de --descobrir não
        // fixaram as rotas porque a trilha diz o que foi PEDIDO, não o que a página TEM.
        const dump = arg('dump');
        console.log('  arquivo de credenciais: ' + ARQUIVO_CRED);
        if (dump) console.log('  dump das páginas: ' + path.resolve(dump));
        const jar = new CookieJar();
        const relatarSistemas = (lista) => {
            if (!lista || !lista.length) return;
            console.error('  sistemas encontrados (sis/sse) — o do MFe tem que estar aqui:');
            lista.forEach((s) => console.error('    sis=' + s.sis + ' sse=' + s.sse + '   (em ' + s.visto_em + ')'));
        };
        try {
            const l = await login(jar, { dump });
            console.log('  login: HTTP ' + l.status + (l.loc ? ' -> ' + l.loc : '') + ' | cookies: ' + jar.cookies.size);
            // A pagina de recado do portal e informacao de primeira classe, nao ruido: foi
            // ela que explicou o menu vazio de 2026-09-11.
            if (l.mensagem) console.log('  portal disse: "' + l.mensagem + '"');
            // Padrao: caminho fixo. `--descobrir` so para quando o portal mudar e for
            // preciso remapear -- e um crawler, nao o modo de operacao.
            const andar = process.argv.indexOf('--descobrir') !== -1;
            console.log('  modo: ' + (andar ? 'andador (--descobrir)' : 'caminho fixo (passos 2-5)'));
            const t = andar
                ? await descobrirToken(jar, { cnpj, verboso: true, dump, origem: l.paginaFinal })
                : await obterTokenPorCaminho(jar, { cnpj, dump, origem: l.paginaFinal, mensagemLogin: l.mensagem });
            if (t.trilha && !andar) t.trilha.forEach((p) => console.log('  ' + JSON.stringify(p)));
            console.log('  TOKEN OBTIDO | CNPJ ' + t.cnpj + ' | expira ' +
                (t.exp ? new Date(t.exp * 1000).toLocaleString('pt-BR') : '(sem exp)'));
            console.log('  (o valor do token não é impresso de propósito)');
            relatarSistemas(t.sistemas);
        } catch (e) {
            console.error('  FALHOU: ' + ((e && e.message) || e));
            if (e && e.trilha) {
                console.error('  trilha percorrida:');
                e.trilha.forEach((p) => console.error('    ' + JSON.stringify(p)));
            }
            relatarSistemas(e && e.sistemas);
            if (!dump) {
                console.error('  PRÓXIMO PASSO: rode de novo com --dump=<pasta> e me mande os .html.');
                console.error('  A trilha diz o que foi pedido; o dump diz o que a página contém.');
            }
            process.exitCode = 1;
        }
    })();
}
