/**
 * Arquivo de exemplo de configuração.
 * Copie para `assets/js/config.js` (gitignored) e preencha com valores reais.
 *
 * Setup inicial:
 *   1. Configurar SUPABASE_CONFIG (URL/key abaixo).
 *   2. Configurar APP_CONFIG.passwordSalt (gerar string aleatória ≥ 32 chars).
 *   3. Gerar `adminPasswordHash` para o fallback admin local:
 *        - Abra Dominium.html no navegador.
 *        - DevTools (F12) → Console:  await window.generateSecureHash('SUA_SENHA')
 *        - Copie o resultado (formato "pbkdf2$...").
 *   4. Criar primeiro admin no Supabase Auth:
 *        - Supabase Dashboard → Authentication → Add user.
 *        - Email: admin@softtech-fiscal.local   (padrão: <username>@softtech-fiscal.local)
 *        - Password: a mesma do passo 3.
 *        - User metadata (JSON):
 *            { "username": "admin", "full_name": "Administrador", "control": "administrador" }
 *        - Auto Confirm User: ON.
 *        O trigger `handle_new_user` cria o registro em user_profiles automaticamente.
 *   5. Desabilitar email confirmation em Authentication → Providers → Email
 *      ("Confirm email" = OFF) para que signUp via UI funcione direto.
 */

// ----- Hash + admin local -----
window.APP_CONFIG = {
    // Salt usado em PBKDF2. Defina UMA VEZ — trocar invalida hashes existentes.
    passwordSalt: 'TROQUE_PARA_UM_SALT_UNICO_DESTA_INSTANCIA_min_32_chars',

    // Hash do super-admin local (fallback). Necessário enquanto a UI ainda dá fallback
    // a auth local; após migração completa para Supabase Auth, pode ser removido.
    adminPasswordHash: 'pbkdf2$COLE_AQUI_O_HASH_GERADO',

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
