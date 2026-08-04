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
//   APP_ADMIN_PASSWORD_HASH   ← APP_CONFIG.adminPasswordHash
//   ICMS_API_URL              ← APP_CONFIG.icmsApiUrl          (opcional; usa default de prod)

const fs = require('fs');
const path = require('path');

const onVercel = process.env.VERCEL === '1';
if (!onVercel) {
    console.log('[gen-config] fora do Vercel — mantém assets/js/config.js local intacto.');
    process.exit(0);
}

const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'APP_PASSWORD_SALT', 'APP_ADMIN_PASSWORD_HASH'];
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

// JSON.stringify escapa cada valor como string-literal JS válida (evita quebra/injeção).
const cfg = `// GERADO no build do Vercel por scripts/gen-config.js — não editar à mão.
window.APP_CONFIG = {
    passwordSalt: ${JSON.stringify(clean(process.env.APP_PASSWORD_SALT))},
    adminPasswordHash: ${JSON.stringify(clean(process.env.APP_ADMIN_PASSWORD_HASH))},
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
