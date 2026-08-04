// Self-check do harvest-server: decodeExp (parse do exp do JWT) + expiry do cache.
// Roda sem rede/Playwright: node harvest-server.test.js
'use strict';
const assert = require('assert');
const { decodeExp, cacheValid, _setCache } = require('./harvest-server');

// JWT sintético: header.payload.sig, payload = {exp: <epoch s>}. Sig irrelevante (não validamos).
function jwt(payloadObj) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payloadObj)}.sig`;
}

const now = Math.floor(Date.now() / 1000);

// decodeExp devolve exp em ms.
assert.strictEqual(decodeExp(jwt({ exp: now + 86400 })), (now + 86400) * 1000, 'exp em ms');
assert.strictEqual(decodeExp('lixo'), 0, 'jwt malformado → 0');
assert.strictEqual(decodeExp(jwt({ sub: 'x' })), 0, 'sem exp → 0');

// cacheValid: token no futuro além da margem 5min = válido; dentro da margem/passado = inválido.
_setCache(null);
assert.strictEqual(cacheValid(), false, 'sem cache → inválido');
_setCache({ token: 't', exp: Date.now() + 10 * 60 * 1000 });
assert.strictEqual(cacheValid(), true, 'exp +10min → válido');
_setCache({ token: 't', exp: Date.now() + 2 * 60 * 1000 });
assert.strictEqual(cacheValid(), false, 'exp +2min (dentro da margem 5min) → inválido');
_setCache({ token: 't', exp: Date.now() - 1000 });
assert.strictEqual(cacheValid(), false, 'exp passado → inválido');
_setCache({ token: '', exp: Date.now() + 10 * 60 * 1000 });
assert.strictEqual(cacheValid(), false, 'token vazio → inválido');

console.log('OK — decodeExp + cacheValid');
process.exit(0);
