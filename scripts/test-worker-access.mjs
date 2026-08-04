/**
 * Teste do controle de acesso do worker (worker/lib/access.js).
 *
 * Cobre exatamente o que a auditoria apontou como P0: eco de origem, ausência de
 * token e travessia de diretório via `inboxPath`. Sem framework e sem dependência —
 * `access.js` não importa exceljs de propósito, então roda sem npm install no worker.
 *
 *   node scripts/test-worker-access.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const access = require('../worker/lib/access.js');

// ---------------------------------------------------- origens ----
{
    const allowed = access.parseOrigins('https://softtech-fiscal.vercel.app,http://localhost:5500');

    assert.equal(access.isOriginAllowed('https://softtech-fiscal.vercel.app', allowed), true);
    assert.equal(access.isOriginAllowed('http://localhost:5500', allowed), true);

    // O bug original: qualquer site conseguia falar com o worker.
    assert.equal(access.isOriginAllowed('https://site-malicioso.com', allowed), false);
    assert.equal(access.isOriginAllowed('null', allowed), false);
    // Prefixo parecido não pode passar por descuido de comparação.
    assert.equal(access.isOriginAllowed('https://softtech-fiscal.vercel.app.evil.com', allowed), false);

    // Sem Origin = cliente não-browser; passa aqui e é barrado pelo token.
    assert.equal(access.isOriginAllowed(undefined, allowed), true);
    assert.equal(access.isOriginAllowed('', allowed), true);

    // CSV vazio cai no default, nunca num conjunto vazio (que liberaria tudo).
    assert.ok(access.parseOrigins('').size >= 1);
    assert.ok(access.parseOrigins(undefined).has('https://softtech-fiscal.vercel.app'));
}

// ---------------------------------------------------- token ----
{
    const tok = 'a'.repeat(48);

    assert.equal(access.tokensMatch(tok, tok), true);
    assert.equal(access.tokensMatch('b'.repeat(48), tok), false);

    // Vazio/ausente nunca passa — é o caso de toda requisição não pareada.
    assert.equal(access.tokensMatch('', tok), false);
    assert.equal(access.tokensMatch(undefined, tok), false);
    assert.equal(access.tokensMatch(null, tok), false);

    // Comprimento diferente não pode explodir no timingSafeEqual.
    assert.equal(access.tokensMatch('curto', tok), false);
    assert.equal(access.tokensMatch(tok + 'x', tok), false);

    // Prefixo correto do token também não passa.
    assert.equal(access.tokensMatch(tok.slice(0, 47), tok), false);
}

// ---------------------------------------------------- caminho ----
{
    const root = path.resolve('/srv/inbox');

    assert.deepEqual(access.resolveUnder(root, undefined), { ok: true, dir: root });
    assert.deepEqual(access.resolveUnder(root, ''), { ok: true, dir: root });
    assert.deepEqual(access.resolveUnder(root, 'maio'), { ok: true, dir: path.join(root, 'maio') });
    assert.deepEqual(access.resolveUnder(root, 'a/b/c'), { ok: true, dir: path.join(root, 'a', 'b', 'c') });

    // O exploit da auditoria: varrer o disco do contador.
    assert.equal(access.resolveUnder(root, '../../etc').ok, false);
    assert.equal(access.resolveUnder(root, 'maio/../../..').ok, false);
    assert.equal(access.resolveUnder(root, path.resolve('/etc')).ok, false);
    // Prefixo parecido: /srv/inbox-outro não está sob /srv/inbox.
    assert.equal(access.resolveUnder(root, path.resolve('/srv/inbox-outro')).ok, false);

    // Voltar e entrar de novo na raiz é legítimo.
    assert.deepEqual(access.resolveUnder(root, 'maio/..'), { ok: true, dir: root });
}

// ---------------------------------------------------- job id ----
{
    const ids = new Set(Array.from({ length: 200 }, () => access.newJobId('nfce')));
    assert.equal(ids.size, 200, 'IDs de job devem ser únicos');
    for (const id of ids) {
        assert.match(id, /^nfce-[0-9a-f]{32}$/);
        // O bug original era `nfce-1`, `nfce-2`, ... — adivinhável.
        assert.doesNotMatch(id, /^nfce-\d+$/);
    }
}

console.log('✅ test-worker-access: todas as asserções passaram');
