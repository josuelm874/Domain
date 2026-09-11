/* Testa o nucleo puro de worker/lib/token-mfe.js sem tocar na rede nem em credencial.
 * Rodar: node scripts/test-token-mfe.mjs */
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extrairJwt, CookieJar } = require('../worker/lib/token-mfe.js');

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

console.log('OK test-token-mfe: todas as assercoes passaram');
