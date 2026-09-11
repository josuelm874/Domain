/* Testa o nucleo puro de worker/lib/token-mfe.js sem tocar na rede nem em credencial.
 * Rodar: node scripts/test-token-mfe.mjs */
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extrairJwt, CookieJar, extrairAlvos, parSistema } = require('../worker/lib/token-mfe.js');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => 'eyJhbGciOiJIUzI1NiJ9.' + b64(payload) + '.' + 'x'.repeat(20);
const futuro = Math.floor(Date.now() / 1000) + 3600;
const passado = Math.floor(Date.now() / 1000) - 3600;

const CNPJ = '08701648000105';
const bom = jwt({ sub: CNPJ, exp: futuro });

// --- acha em HTML, em qualquer posicao ---
assert.equal(extrairJwt('<input type="hidden" name="token" value="' + bom + '">').jwt, bom, 'campo hidden');
assert.equal(extrairJwt('<script>var t="' + bom + '";</script>').jwt, bom, 'script inline');
assert.equal(extrairJwt('https://x/cb?token=' + bom).jwt, bom, 'header Location');
assert.equal(extrairJwt('{"token":"' + bom + '"}').jwt, bom, 'JSON');
assert.equal(extrairJwt(bom).cnpj, CNPJ, 'cnpj extraido do sub');

// --- recusa o que nao serve ---
assert.equal(extrairJwt(''), null, 'vazio');
assert.equal(extrairJwt('nada aqui'), null, 'sem jwt');
assert.equal(extrairJwt(jwt({ sub: CNPJ, exp: passado })), null, 'EXPIRADO recusado');
assert.equal(extrairJwt(jwt({ sub: 'usuario@x', exp: futuro })), null, 'sub que nao e CNPJ recusado');
assert.equal(extrairJwt(jwt({ exp: futuro })), null, 'sem sub recusado');
assert.equal(extrairJwt('eyJ' + 'a'.repeat(20)), null, 'eyJ sem tres segmentos');

// --- escolhe o CERTO quando a pagina tem varios ---
// o portal carrega outros JWTs (sessao do proprio site); aceitar o primeiro pegaria o errado
const sessao = jwt({ sub: 'sessao-do-portal', exp: futuro });
const html = '<script>var s="' + sessao + '";</script><input value="' + bom + '">';
assert.equal(extrairJwt(html).jwt, bom, 'pula o JWT de sessao e acha o do contribuinte');

// --- filtro por CNPJ esperado ---
const outraEmpresa = jwt({ sub: '11222333000144', exp: futuro });
assert.equal(extrairJwt(outraEmpresa, CNPJ), null, 'token de outra empresa recusado');
assert.equal(extrairJwt(outraEmpresa + ' ' + bom, CNPJ).jwt, bom, 'entre dois, pega o do CNPJ pedido');

// --- cookie jar ---
const jar = new CookieJar();
assert.equal(jar.vazio, true);
jar.absorver({ headers: { getSetCookie: () => ['ASPSESSIONIDABC=xyz; path=/', 'outro=1; HttpOnly'] } });
assert.equal(jar.vazio, false);
assert.equal(jar.header(), 'ASPSESSIONIDABC=xyz; outro=1', 'monta o header cookie');
jar.absorver({ headers: { getSetCookie: () => ['ASPSESSIONIDABC=novo'] } });
assert.ok(jar.header().includes('ASPSESSIONIDABC=novo'), 'cookie e sobrescrito, nao duplicado');

// --- colheita de links (extrairAlvos) ---
// O andador rodou tres vezes sem achar as rotas. A trilha explicou por que: 18 paginas
// `cweb2003.asp?sm=NNN` com BYTES DIFERENTES devolveram a MESMA lista de candidatos. Um
// extrator que so le `href=`/`action=` colhe a navegacao estatica e ignora o que o ASP
// classico dessa geracao usa de verdade -- window.open num onclick.
const BASE = 'https://servicos.sefaz.ce.gov.br/internet/acessoSeguro/ServicoSenha/LogarUsuario/cweb2003.asp?sm=104';
const ACESSO = (sis, sse) =>
    'https://servicos.sefaz.ce.gov.br/internet/acessoSeguro/ServicoSenha/LogarUsuario/cweb1010java.asp?sis=' + sis + '&sse=' + sse;

const achou = (html, alvo) => extrairAlvos(BASE, html).indexOf(alvo) !== -1;

assert.ok(achou('<a href="cweb1010java.asp?sis=MFe&sse=200">MFe</a>', ACESSO('MFe', '200')), 'ancora comum');
assert.ok(achou('<td onclick="window.open(\'cweb1010java.asp?sis=MFe&sse=200\')">MFe</td>', ACESSO('MFe', '200')), 'window.open em onclick');
assert.ok(achou('<script>location.href="cweb1010java.asp?sis=MFe&sse=200";</script>', ACESSO('MFe', '200')), 'location.href');
assert.ok(achou('<script>window.location = "cweb1010java.asp?sis=MFe&sse=200";</script>', ACESSO('MFe', '200')), 'window.location');
assert.ok(achou('<script>function ir(){ var u="cweb1010java.asp?sis=MFe&sse=200"; }</script>', ACESSO('MFe', '200')), 'url solta dentro de JS');

// --- o que NAO pode ser colhido ---
// EncerrarSessao matou a propria sessao do andador na primeira execucao; o filtro por
// 'logout|sair' nao pegava esse nome.
assert.ok(!achou('<a href="cweb2004.asp?op=EncerrarSessao">Sair</a>', 'https://servicos.sefaz.ce.gov.br/internet/acessoSeguro/ServicoSenha/LogarUsuario/cweb2004.asp?op=EncerrarSessao'), 'EncerrarSessao continua barrado');
assert.equal(extrairAlvos(BASE, '<a href="https://google.com/x">fora</a>').length, 0, 'link fora da SEFAZ ignorado');
assert.equal(extrairAlvos(BASE, '<script src="app.js"></script><link href="e.css">').length, 0, 'estatico ignorado');
assert.equal(extrairAlvos(BASE, '<a href="javascript:void(0)">x</a>').length, 0, 'javascript: ignorado');

// duplicata em href e em window.open tem que virar UM alvo, nao dois passos gastos
assert.equal(extrairAlvos(BASE,
    '<a href="cweb1010java.asp?sis=MFe&sse=200">a</a><td onclick="window.open(\'cweb1010java.asp?sis=MFe&sse=200\')">b</td>').length,
    1, 'mesma URL colhida duas vezes vira um alvo');

// prioridade: acesso a sistema antes de pagina institucional
const ordem = extrairAlvos(BASE,
    '<a href="institucional.asp">inst</a><a href="cweb1010java.asp?sis=Sitram&sse=85">s</a>');
assert.ok(/cweb1010java/.test(ordem[0]), 'acesso a sistema vem antes de pagina generica');

// --- parSistema: e isto que falta descobrir (o par sis/sse do MFe) ---
assert.deepEqual(
    (({ sis, sse }) => ({ sis, sse }))(parSistema(ACESSO('MFe', '200'))),
    { sis: 'MFe', sse: '200' }, 'extrai sis e sse');
assert.equal(parSistema('https://servicos.sefaz.ce.gov.br/internet/x/cweb2003.asp?sm=104'), null, 'nao e acesso a sistema');

// --- cookie jar aceita o header cru do `http` nativo ---
// A producao trocou `fetch` por `https.request`: os cookies chegam como array no objeto
// cru, nao por getSetCookie(). Se so a forma antiga funcionasse, a sessao morreria em
// silencio no Node da empresa -- que nem tem getSetCookie.
const jarCru = new CookieJar();
jarCru.absorver({ headers: { 'set-cookie': ['ASPSESSIONIDXYZ=abc; path=/'] } });
assert.equal(jarCru.header(), 'ASPSESSIONIDXYZ=abc', 'absorve set-cookie do http nativo');

console.log('OK test-token-mfe: todas as assercoes passaram');
