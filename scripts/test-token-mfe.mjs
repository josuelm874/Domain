/* Testa o nucleo puro de worker/lib/token-mfe.js sem tocar na rede nem em credencial.
 * Rodar: node scripts/test-token-mfe.mjs */
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extrairJwt, CookieJar, extrairAlvos, parSistema, lerEmpresas, escolherEmpresa, valorHidden, URL_ACESSAR_MFE } = require('../worker/lib/token-mfe.js');

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

// --- passo 3: o link "Acessar MFe" e cweb1010.asp, nao cweb1010java.asp ---
// Fixado pelo dump de 2026-09-11 (00-cweb2003.asp_sm_104.html:403). Tres execucoes do
// andador falharam porque RE_ACESSO_SISTEMA so casava `cweb1010java.asp`.
const MENU = 'https://servicos.sefaz.ce.gov.br/internet/acessoSeguro/ServicoSenha/LogarUsuario/cweb2003.asp?sm=104';
const HTML_MFE = '<li><a href="cweb1010.asp?sse=104&sts=448" class="off">Acessar MFe</a></li>';
const alvosMenu = extrairAlvos(MENU, HTML_MFE);
assert.ok(alvosMenu.some((u) => /cweb1010\.asp\?sse=104&sts=448/.test(u)), 'colhe o link Acessar MFe');
assert.ok(/cweb1010\.asp\?sse=104&sts=448$/.test(URL_ACESSAR_MFE), 'URL_ACESSAR_MFE fixada no que o dump mostrou');

// prioridade: acesso a sistema (inclusive o sem "java") antes de pagina institucional
const ordem2 = extrairAlvos(MENU, '<a href="default2.asp">info</a>' + HTML_MFE);
assert.ok(/cweb1010\.asp/.test(ordem2[0]), 'cweb1010.asp (sem java) conta como acesso a sistema');

// --- passo 4: linhas de empresa e escolha ---
// String real do dump (33-cweb2010.asp...), com o CPF/nome trocados.
const LINHA = (plst, num, cgf) =>
    '<td><a href="JavaScript:submete(\'' + plst + '\',\'' + num + '\');">' + cgf + '</a></td>';
const PLST_A = '0000429674621245100899104600012108.991.046 EMPRESA ALFA LTDA01';
const PLST_B = '0001038774702935894424469200019944.244.692 EMPRESA BETA ME01';
const PAGINA = '<script>function submete(plst, pNum){ document.form1.lstEmpresa.value = plst; }</script>' +
    '<form name="form1" method="post" action="cweb2010.asp">' +
    '<input type="hidden" name="num" id="num" value="">' +
    '<input type="hidden" name="hidControle" id="hidControle" value="../MFe/RedirJavaMFe.asp">' +
    '<input type="hidden" name="lstEmpresa" id="lstEmpresa">' +
    '<input type="hidden" name="destino" id="destino" value="">' +
    '<input type="hidden" name="SSE" id="SSE" value="">' +
    LINHA(PLST_A, '1', '62124510') + LINHA(PLST_A, '1', 'EMPRESA ALFA LTDA') +
    LINHA(PLST_B, '1', '70293589') + '</form>';

const emp = lerEmpresas(PAGINA);
assert.equal(emp.length, 2, 'duas empresas (a linha repetida por celula nao duplica)');
assert.equal(emp[0].cgf, '62124510', 'CGF vem do texto do link');
assert.ok(!emp.some((e) => e.plst === 'plst'), 'a declaracao da funcao submete nao vira empresa');

// escolha por digitos contidos no plst -- sem decodificar o layout de largura fixa
assert.equal(escolherEmpresa(emp, '62124510').plst, PLST_A, 'acha pelo CGF');
assert.equal(escolherEmpresa(emp, '70293589').plst, PLST_B, 'acha a segunda');
assert.equal(escolherEmpresa(emp, '99999999999999'), null, 'CNPJ ausente devolve null, nao a primeira');
assert.equal(escolherEmpresa(emp, ''), null, 'sem alvo nao escolhe nada');
// ambiguidade tem que EXPLODIR: escolher errado aqui baixa cupom de outro contribuinte
assert.throws(() => escolherEmpresa(emp, '0'), /casa com 2 empresas/, 'alvo ambiguo recusado');

// --- hidden: ausente e vazio sao coisas diferentes ---
assert.equal(valorHidden(PAGINA, 'hidControle'), '../MFe/RedirJavaMFe.asp', 'le o hidControle da pagina');
assert.equal(valorHidden(PAGINA, 'destino'), '', 'campo presente e vazio devolve string vazia');
assert.equal(valorHidden(PAGINA, 'naoExiste'), null, 'campo ausente devolve null');

console.log('OK test-token-mfe: todas as assercoes passaram');
