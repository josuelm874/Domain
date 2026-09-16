// Gera assets/js/config.js no build do Vercel a partir de env vars.
// Roda via "buildCommand" do vercel.json. config.js é gitignored (tem credenciais),
// então NÃO vai no repo — este script o recria no build, a partir das env vars do Vercel.
//
// Regra de segurança do deploy:
//   - Fora do Vercel (dev local): NÃO toca no config.js local — sai sem escrever.
//   - No Vercel com env var faltando: FALHA o build (exit 1). Deploy quebrado visível é
//     melhor que auth quebrada silenciosa (foi o incidente que motivou este fix).
//
// Env vars a configurar no Vercel (Project → Settings → Environment Variables),
// copiando os valores do seu assets/js/config.js local:
//   SUPABASE_URL              ← SUPABASE_CONFIG.url
//   SUPABASE_PUBLISHABLE_KEY  ← SUPABASE_CONFIG.publishableKey
//   SUPABASE_ANON_KEY         ← SUPABASE_CONFIG.anonKey        (opcional; vazio se não usar)
//   APP_PASSWORD_SALT         ← APP_CONFIG.passwordSalt
//   ICMS_API_URL              ← APP_CONFIG.icmsApiUrl          (opcional; usa default de prod)

const fs = require('fs');
const path = require('path');

const onVercel = process.env.VERCEL === '1';
if (!onVercel) {
    console.log('[gen-config] fora do Vercel — mantém assets/js/config.js local intacto.');
    process.exit(0);
}

// APP_ADMIN_PASSWORD_HASH saiu em 2026-09-16: o login virou Supabase-only e o
// super-admin `adm` deixou de existir. A variavel pode ser APAGADA da Vercel.
const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'APP_PASSWORD_SALT'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
    console.error('[gen-config] env vars obrigatórias faltando no Vercel: ' + missing.join(', '));
    console.error('[gen-config] configure em Project → Settings → Environment Variables e refaça o deploy.');
    process.exit(1);
}

// Tolera valores colados COM aspas do config.js (ex.: 'https://...') ou com espaço/newline:
// tira 1 par de aspas nas pontas (se ambas casam) + trim. Sem isso, createClient do Supabase
// rejeita a URL ("Invalid supabaseUrl") quando o valor foi copiado junto com as aspas.
const clean = (v) => (v == null ? '' : String(v).trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim());

// Presença não basta. Em 2026-09-16 o deploy subiu com APP_ADMIN_PASSWORD_HASH
// contendo a URL da API de ICMS — o mesmo valor de ICMS_API_URL, colado na
// variável errada. A checagem acima passou (a var existia), o build passou, e o
// login do super-admin `adm` ficou impossível em produção: `verifyPassword`
// comparava a senha digitada contra uma URL e sempre devolvia "Senha incorreta".
//
// Mesma regra que motivou este arquivo — deploy quebrado visível é melhor que
// auth quebrada silenciosa — agora aplicada ao FORMATO, não só à presença.
const formatos = [
    {
        nome: 'APP_PASSWORD_SALT',
        valor: clean(process.env.APP_PASSWORD_SALT),
        // `length >= 32` sozinho era frouxo demais: em 2026-09-16 o HASH (51 chars)
        // foi colado aqui e passou folgado. Salt que começa com "pbkdf2$" é hash.
        ok: (v) => v.length >= 32 && !v.startsWith('pbkdf2$') && !/^https?:\/\//.test(v),
        comoGerar: 'string aleatória de 32+ caracteres — NÃO é um hash nem uma URL '
            + '(trocar invalida TODOS os hashes de senha existentes)',
    },
    {
        nome: 'SUPABASE_URL',
        valor: clean(process.env.SUPABASE_URL),
        ok: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v),
        comoGerar: 'Project Settings → API → Project URL',
    },
];

// Duas env vars com o mesmo valor é sempre engano de cópia — foi assim duas
// vezes seguidas no mesmo dia: primeiro a URL da API no hash do admin, depois o
// hash do admin no salt. Nenhum par aqui tem motivo legítimo para coincidir.
const todas = [
    ['APP_PASSWORD_SALT', clean(process.env.APP_PASSWORD_SALT)],
    ['SUPABASE_URL', clean(process.env.SUPABASE_URL)],
    ['SUPABASE_PUBLISHABLE_KEY', clean(process.env.SUPABASE_PUBLISHABLE_KEY)],
    ['ICMS_API_URL', clean(process.env.ICMS_API_URL)],
].filter(([, v]) => v);

const duplicadas = [];
for (let i = 0; i < todas.length; i++) {
    for (let j = i + 1; j < todas.length; j++) {
        if (todas[i][1] === todas[j][1]) duplicadas.push(todas[i][0] + ' e ' + todas[j][0]);
    }
}
if (duplicadas.length) {
    console.error('[gen-config] env vars com o MESMO valor — uma delas recebeu o valor da outra:');
    for (const par of duplicadas) console.error('  - ' + par);
    console.error('[gen-config] corrija em Project → Settings → Environment Variables e refaça o deploy.');
    process.exit(1);
}

const invalidas = formatos.filter((f) => !f.ok(f.valor));
if (invalidas.length) {
    console.error('[gen-config] env var com FORMATO inválido (existe, mas o valor não serve):');
    for (const f of invalidas) {
        // Nunca imprime o valor — só o que dá para dizer sem vazá-lo.
        const pista = /^https?:\/\//.test(f.valor)
            ? 'parece uma URL; provavelmente o valor de outra variável foi colado aqui'
            : f.valor.length + ' caractere(s), fora do formato esperado';
        console.error('  - ' + f.nome + ': ' + pista);
        console.error('    ' + f.comoGerar);
    }
    console.error('[gen-config] corrija em Project → Settings → Environment Variables e refaça o deploy.');
    process.exit(1);
}

// JSON.stringify escapa cada valor como string-literal JS válida (evita quebra/injeção).
const cfg = `// GERADO no build do Vercel por scripts/gen-config.js — não editar à mão.
window.APP_CONFIG = {
    passwordSalt: ${JSON.stringify(clean(process.env.APP_PASSWORD_SALT))},
    icmsApiUrl: ${JSON.stringify(clean(process.env.ICMS_API_URL) || 'https://softtech-icms-api.onrender.com/api/icms')},
};
window.SUPABASE_CONFIG = {
    url: ${JSON.stringify(clean(process.env.SUPABASE_URL))},
    publishableKey: ${JSON.stringify(clean(process.env.SUPABASE_PUBLISHABLE_KEY))},
    anonKey: ${JSON.stringify(clean(process.env.SUPABASE_ANON_KEY))},
};
`;

const out = path.join(__dirname, '..', 'assets', 'js', 'config.js');
fs.writeFileSync(out, cfg, 'utf8');
console.log('[gen-config] assets/js/config.js gerado a partir das env vars.');
