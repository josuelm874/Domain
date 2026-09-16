/**
 * Arquivo de exemplo de configuração.
 * Copie para `assets/js/config.js` (gitignored) e preencha com valores reais.
 *
 * Setup inicial:
 *   1. Configurar SUPABASE_CONFIG (URL/key abaixo).
 *   2. Configurar APP_CONFIG.passwordSalt (gerar string aleatória ≥ 32 chars).
 *   3. Criar o primeiro admin no Supabase Auth (é o ÚNICO caminho de login —
 *      o fallback local saiu em 2026-09-16):
 *        - Supabase Dashboard → Authentication → Add user.
 *        - Email: admin@softtech-fiscal.local   (padrão: <username>@softtech-fiscal.local)
 *        - Password: a que a pessoa vai usar para entrar.
 *        - User metadata (JSON):
 *            { "username": "admin", "full_name": "Administrador", "control": "administrador" }
 *        - Auto Confirm User: ON.
 *        O trigger `handle_new_user` cria o registro em user_profiles automaticamente.
 *   5. Desabilitar email confirmation em Authentication → Providers → Email
 *      ("Confirm email" = OFF) para que signUp via UI funcione direto.
 */

// ----- Hash + admin local -----
window.APP_CONFIG = {
    // Salt do PBKDF2. Já NÃO vale para login (isso é Supabase Auth agora); sobrou
    // só para o hash do cadastro de contribuinte. Defina UMA VEZ.
    passwordSalt: 'TROQUE_PARA_UM_SALT_UNICO_DESTA_INSTANCIA_min_32_chars',

    // URL base da API Python de ICMS ST. Local: http://localhost:5000/api/icms.
    // Em produção, apontar para o serviço hospedado
    // (ex.: https://softtech-icms-api.onrender.com/api/icms).
    icmsApiUrl: 'http://localhost:5000/api/icms',
};

// ----- Supabase -----
window.SUPABASE_CONFIG = {
    // URL do projeto (Project Settings → API).
    url: 'https://utqsrzfuyfxkyjvedcwq.supabase.co',

    // Publishable key (Project Settings → API Keys → recomendado).
    publishableKey: 'sb_publishable_XSjDvi6_MWNQHeDxxo-4Wg_BDznHPXJ',

    // Fallback legacy anon key (compat). Pode deixar vazio se usar só publishableKey.
    anonKey: '',
};
