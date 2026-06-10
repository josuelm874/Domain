/**
 * Sistema de Sincronização + Auth com Supabase (softtech-fiscal).
 *
 * Mudanças nesta versão (Fase 2):
 *   - Suporta publishable key (`sb_publishable_...`) além do anon JWT legado.
 *   - Adiciona wrappers de auth: signIn / signUp / signOut / getUser / onAuthChange.
 *   - Adiciona gate `requireAuth(fn)` para operações que dependem de sessão.
 *   - `saveToCloud` / `loadFromCloud` agora aguardam sessão válida antes de tocar o banco
 *     (RLS phase 2 — leitura/escrita exigem autenticação após migration 003).
 *   - Email determinístico: `<username>@softtech-fiscal.local` (padrão single-tenant interno).
 */

// ==================== CONFIGURAÇÃO ====================
const SUPABASE_CONFIG = window.SUPABASE_CONFIG || { url: '', anonKey: '', publishableKey: '' };
const TABLE_NAME = 'system_data';
const PYTHON_LIBRARY_BUCKET = 'python-library';
const AUTH_EMAIL_DOMAIN = 'softtech-fiscal.local';

// ==================== ESTADO ====================
let supabaseClient = null;
let isSupabaseConfigured = false;
let supabaseReadyPromise = null;
let currentSession = null;
let currentProfile = null;

/** @returns {string} key a usar (publishable nova > anon legada) */
function _resolveApiKey() {
    return SUPABASE_CONFIG.publishableKey || SUPABASE_CONFIG.anonKey || '';
}

function _isConfigPresent() {
    const url = SUPABASE_CONFIG.url;
    const key = _resolveApiKey();
    if (!url || !key) return false;
    if (url === 'SUA_URL_DO_SUPABASE_AQUI') return false;
    if (key === 'SUA_ANON_KEY_AQUI' || key === 'SUA_PUBLISHABLE_KEY_AQUI') return false;
    return true;
}

// ==================== INICIALIZAÇÃO ====================
function initSupabase() {
    if (!_isConfigPresent()) {
        console.warn('⚠️ Supabase não configurado. Sistema rodará só com localStorage.');
        supabaseReadyPromise = Promise.resolve(false);
        return false;
    }

    if (supabaseReadyPromise) return true;

    supabaseReadyPromise = new Promise((resolve) => {
        const _bootClient = () => {
            try {
                supabaseClient = window.supabase.createClient(
                    SUPABASE_CONFIG.url,
                    _resolveApiKey(),
                    {
                        auth: {
                            autoRefreshToken: true,
                            persistSession: true,
                            detectSessionInUrl: false,
                            storage: window.localStorage,
                        },
                    }
                );
                isSupabaseConfigured = true;

                supabaseClient.auth.getSession().then(({ data }) => {
                    currentSession = data?.session || null;
                    if (currentSession?.user) {
                        _loadProfile(currentSession.user.id).catch(() => {});
                    }
                });

                supabaseClient.auth.onAuthStateChange((_event, session) => {
                    currentSession = session;
                    if (session?.user) {
                        _loadProfile(session.user.id).catch(() => {});
                    } else {
                        currentProfile = null;
                    }
                });

                console.log('✅ Supabase inicializado com sucesso.');
                resolve(true);
            } catch (error) {
                console.error('❌ Erro ao inicializar Supabase:', error);
                resolve(false);
            }
        };

        if (typeof window.supabase === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
            script.crossOrigin = 'anonymous';
            script.referrerPolicy = 'no-referrer';
            script.onload = _bootClient;
            script.onerror = () => {
                console.error('❌ Falha ao carregar SDK Supabase.');
                resolve(false);
            };
            document.head.appendChild(script);
        } else {
            _bootClient();
        }
    });

    return true;
}

async function _loadProfile(userId) {
    if (!supabaseClient || !userId) return null;
    const { data, error } = await supabaseClient
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();
    if (error) {
        console.warn('⚠️ Falha ao carregar user_profile:', error.message);
        return null;
    }
    currentProfile = data;
    return data;
}

// ==================== AUTH WRAPPERS ====================

/** @param {string} username @returns {string} */
function _usernameToEmail(username) {
    return `${String(username).trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

/**
 * Login via Supabase Auth.
 * @returns {Promise<{ok: boolean, user?: object, profile?: object, error?: string}>}
 */
async function authSignIn(username, password) {
    if (!supabaseReadyPromise) initSupabase();
    const ready = await supabaseReadyPromise;
    if (!ready) return { ok: false, error: 'Supabase não configurado' };

    const email = _usernameToEmail(username);
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };

    const profile = await _loadProfile(data.user.id);
    // Audit log (best-effort).
    supabaseClient.rpc('registrar_acao', {
        p_action: 'login',
        p_target: 'web',
        p_details: { username },
    }).then(() => {}, () => {});

    return { ok: true, user: data.user, profile };
}

/**
 * Cria conta. Admin-only — proteção fica na UI.
 * Email Confirmation deve estar OFF em Authentication → Providers → Email para que
 * signIn funcione imediatamente após signUp.
 */
async function authSignUp({ username, password, fullName, control }) {
    if (!supabaseReadyPromise) initSupabase();
    const ready = await supabaseReadyPromise;
    if (!ready) return { ok: false, error: 'Supabase não configurado' };

    const email = _usernameToEmail(username);
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            data: { username, full_name: fullName, control },
        },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, user: data.user };
}

async function authSignOut() {
    if (!supabaseClient) return { ok: true };
    await supabaseClient.rpc('registrar_acao', {
        p_action: 'logout',
        p_target: 'web',
        p_details: null,
    }).catch(() => {});

    const { error } = await supabaseClient.auth.signOut();
    if (error) return { ok: false, error: error.message };
    currentSession = null;
    currentProfile = null;
    return { ok: true };
}

async function authGetUser() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getUser();
    return data?.user || null;
}

function authGetCurrentSession() { return currentSession; }
function authGetCurrentProfile() { return currentProfile; }

function authOnChange(callback) {
    if (!supabaseClient) return () => {};
    const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
    return () => data?.subscription?.unsubscribe?.();
}

/**
 * Atualiza metadados do perfil no Supabase (user_profiles), casando por username.
 * Best-effort: exige sessão admin (RLS UPDATE permite auth.uid()=id OR admin).
 * NÃO altera auth.users nem user_metadata — logo, mudar `control` aqui não muda a
 * permissão efetiva no Supabase (current_user_is_admin lê do JWT). Isso fica para a
 * Edge Function admin, fora do escopo deste wrapper.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function authUpdateProfile({ username, fullName, control, profileImage }) {
    if (!supabaseReadyPromise) initSupabase();
    const ready = await supabaseReadyPromise;
    if (!ready) return { ok: false, error: 'Supabase não configurado' };
    if (!currentSession) return { ok: false, error: 'sem-sessao' };

    const patch = { updated_at: new Date().toISOString() };
    if (fullName !== undefined) patch.full_name = fullName;
    if (control !== undefined) {
        patch.control = control;
        patch.role = control === 'administrador' ? 'admin' : 'operator';
    }
    if (profileImage !== undefined) patch.profile_image = profileImage;

    const { error } = await supabaseClient
        .from('user_profiles')
        .update(patch)
        .eq('username', String(username).trim().toLowerCase());
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

/**
 * Exclui um usuário DEFINITIVAMENTE via Edge Function `delete-user`, que usa
 * service_role no servidor (o front com publishable key não pode tocar auth.users).
 * A função valida que o chamador é admin pelo próprio JWT. Idempotente: se o usuário
 * não existir na nuvem (órfão só-local), retorna ok com status 'not-found'.
 * @returns {Promise<{ok:boolean, status?:string, error?:string}>}
 */
async function authDeleteUser({ username }) {
    if (!supabaseReadyPromise) initSupabase();
    const ready = await supabaseReadyPromise;
    if (!ready) return { ok: false, error: 'Supabase não configurado' };
    if (!currentSession) return { ok: false, error: 'sem-sessao' };

    const { data, error } = await supabaseClient.functions.invoke('delete-user', {
        body: { username: String(username).trim().toLowerCase() },
    });
    if (error) {
        let msg = error.message || 'Erro ao chamar delete-user';
        try {
            const ctx = await error.context?.json?.();
            if (ctx?.error) msg = ctx.error;
        } catch { /* corpo não-JSON */ }
        return { ok: false, error: msg };
    }
    return { ok: true, status: data?.status };
}

/**
 * Cria um usuário via Edge Function `create-user` (service_role no servidor). Usa a admin
 * API, que aceita o domínio interno `.local` — diferente do signUp público, que o rejeita
 * ("Email address is invalid"). Não troca a sessão do admin. Exige sessão admin (RLS/JWT).
 * @returns {Promise<{ok:boolean, userId?:string, error?:string}>}
 */
async function authCreateUser({ username, password, fullName, control }) {
    if (!supabaseReadyPromise) initSupabase();
    const ready = await supabaseReadyPromise;
    if (!ready) return { ok: false, error: 'Supabase não configurado' };
    if (!currentSession) return { ok: false, error: 'sem-sessao' };

    const { data, error } = await supabaseClient.functions.invoke('create-user', {
        body: { username: String(username).trim().toLowerCase(), password, fullName, control },
    });
    if (error) {
        let msg = error.message || 'Erro ao chamar create-user';
        try {
            const ctx = await error.context?.json?.();
            if (ctx?.error) msg = ctx.error;
        } catch { /* corpo não-JSON */ }
        return { ok: false, error: msg };
    }
    return { ok: true, userId: data?.userId };
}

/** Aguarda sessão antes de chamar fn. Retorna null se nunca houver. */
async function requireAuth(fn, { timeoutMs = 0 } = {}) {
    if (!supabaseReadyPromise) initSupabase();
    await supabaseReadyPromise;
    if (currentSession) return fn();
    if (timeoutMs === 0) return null;
    return new Promise((resolve) => {
        const timer = setTimeout(() => { unsub(); resolve(null); }, timeoutMs);
        const unsub = authOnChange((_event, session) => {
            if (session) { clearTimeout(timer); unsub(); resolve(fn()); }
        });
    });
}

// ==================== SYNC (KV em system_data) ====================

async function saveToCloud(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem(`${key}_updated`, Date.now().toString());
    } catch (e) {
        console.error('Erro ao salvar no localStorage:', e);
    }

    if (!supabaseReadyPromise) initSupabase();
    await supabaseReadyPromise;
    if (!isSupabaseConfigured || !supabaseClient) {
        return { success: true, local: true };
    }
    if (!currentSession) {
        return { success: true, local: true, queued: true };
    }

    try {
        const { error } = await supabaseClient
            .from(TABLE_NAME)
            .upsert(
                { key, value: data, updated_at: new Date().toISOString() },
                { onConflict: 'key' }
            );
        if (error) {
            console.error(`❌ Erro ao salvar ${key}:`, error);
            return { success: false, error: error.message, local: true };
        }
        return { success: true, cloud: true, local: true };
    } catch (error) {
        console.error(`❌ Erro ao salvar ${key}:`, error);
        return { success: false, error: error.message, local: true };
    }
}

async function loadFromCloud(key, defaultValue = null) {
    if (!supabaseReadyPromise) initSupabase();
    await supabaseReadyPromise;

    if (isSupabaseConfigured && supabaseClient && currentSession) {
        try {
            const { data, error } = await supabaseClient
                .from(TABLE_NAME)
                .select('value, updated_at')
                .eq('key', key)
                .single();

            if (!error && data) {
                localStorage.setItem(key, JSON.stringify(data.value));
                localStorage.setItem(`${key}_updated`, new Date(data.updated_at).getTime().toString());
                return data.value;
            }
            if (error && error.code !== 'PGRST116') {
                console.warn(`⚠️ Erro ao carregar ${key}:`, error.message || error);
            }
        } catch (error) {
            console.error(`❌ Erro ao carregar ${key}:`, error);
        }
    }

    try {
        const localData = localStorage.getItem(key);
        if (localData) return JSON.parse(localData);
    } catch (e) {
        console.error(`Erro ao carregar ${key} do localStorage:`, e);
    }
    return defaultValue;
}

async function syncData(key) {
    if (!isSupabaseConfigured || !supabaseClient || !currentSession) {
        return { synced: false, reason: 'Sem sessão' };
    }
    try {
        const localUpdated = parseInt(localStorage.getItem(`${key}_updated`) || '0', 10);
        const { data: cloudData, error } = await supabaseClient
            .from(TABLE_NAME)
            .select('value, updated_at')
            .eq('key', key)
            .single();
        if (error && error.code !== 'PGRST116') return { synced: false, error: error.message };

        if (!cloudData) {
            const localData = localStorage.getItem(key);
            if (localData) {
                await saveToCloud(key, JSON.parse(localData));
                return { synced: true, action: 'uploaded' };
            }
            return { synced: false, reason: 'Sem dados locais' };
        }

        const cloudUpdated = new Date(cloudData.updated_at).getTime();
        if (cloudUpdated > localUpdated) {
            localStorage.setItem(key, JSON.stringify(cloudData.value));
            localStorage.setItem(`${key}_updated`, cloudUpdated.toString());
            return { synced: true, action: 'downloaded', data: cloudData.value };
        }
        if (localUpdated > cloudUpdated) {
            const localData = localStorage.getItem(key);
            if (localData) {
                await saveToCloud(key, JSON.parse(localData));
                return { synced: true, action: 'uploaded' };
            }
        }
        return { synced: true, action: 'already_synced' };
    } catch (error) {
        return { synced: false, error: error.message };
    }
}

async function syncAllData(keys = ['users', 'registeredUsers', 'contributorContacts', 'contributors', 'cest_vencidos', 'pythonFilesList']) {
    const results = {};
    for (const key of keys) results[key] = await syncData(key);
    return results;
}

async function forceRefreshFromCloud(key) {
    if (!isSupabaseConfigured || !supabaseClient || !currentSession) return null;
    try {
        const { data, error } = await supabaseClient
            .from(TABLE_NAME)
            .select('value, updated_at')
            .eq('key', key)
            .single();
        if (error || !data) return null;
        localStorage.setItem(key, JSON.stringify(data.value));
        localStorage.setItem(`${key}_updated`, new Date(data.updated_at).getTime().toString());
        return data.value;
    } catch {
        return null;
    }
}

// ==================== STORAGE — BIBLIOTECA PYTHON ====================

async function uploadPythonFile(file) {
    if (!supabaseClient || !currentSession) return { error: 'Sem sessão autenticada' };
    try {
        const { error } = await supabaseClient.storage
            .from(PYTHON_LIBRARY_BUCKET)
            .upload(file.name, file, { upsert: true });
        if (error) return { error: error.message };
        return { success: true, fileName: file.name };
    } catch (e) {
        return { error: e.message || 'Erro no upload' };
    }
}

function getPythonFileUrl(fileName) {
    if (!supabaseClient) return null;
    const { data } = supabaseClient.storage.from(PYTHON_LIBRARY_BUCKET).getPublicUrl(fileName);
    return data?.publicUrl || null;
}

async function downloadPythonFile(fileName) {
    if (!supabaseClient) return null;
    try {
        const { data, error } = await supabaseClient.storage
            .from(PYTHON_LIBRARY_BUCKET)
            .download(fileName);
        if (error) return null;
        return data;
    } catch {
        return null;
    }
}

async function removePythonFile(fileName) {
    if (!supabaseClient || !currentSession) return { error: 'Sem sessão autenticada' };
    try {
        const { error } = await supabaseClient.storage
            .from(PYTHON_LIBRARY_BUCKET)
            .remove([fileName]);
        if (error) return { error: error.message };
        return { success: true };
    } catch (e) {
        return { error: e.message || 'Erro ao remover' };
    }
}

// ==================== REALTIME + MERGE — CEST VENCIDOS (Fase 4) ====================
//
// Sincronização em tempo real da chave `cest_vencidos` entre máquinas + merge
// append-only para evitar last-write-wins (dois usuários editando simultaneamente).
//
// Anti-loop: guardamos o JSON do último valor que NÓS gravamos (`_cestLastSavedJson`).
// Quando o postgres_changes ecoa nossa própria escrita, o payload bate com esse JSON
// e é ignorado — não reprocessamos a alteração que nós mesmos fizemos.

const CEST_KEY = 'cest_vencidos';
let _cestBaseline = null;        // último snapshot conhecido da nuvem (array)
let _cestLastSavedJson = null;   // JSON do último valor que gravamos (anti-eco)
let _cestRealtimeChannel = null;

/** Normaliza lista CEST: só dígitos, ≤20 chars, sem duplicatas, sem vazios. */
function _normCestList(arr) {
    const src = Array.isArray(arr) ? arr : [];
    const seen = new Set();
    const out = [];
    for (const raw of src) {
        const code = String(raw == null ? '' : raw).replace(/\D/g, '').slice(0, 20);
        if (code && !seen.has(code)) { seen.add(code); out.push(code); }
    }
    return out;
}

function _persistCestLocal(arr) {
    try {
        localStorage.setItem(CEST_KEY, JSON.stringify(arr));
        localStorage.setItem(`${CEST_KEY}_updated`, Date.now().toString());
    } catch (e) {
        console.error('Erro ao persistir cest_vencidos no localStorage:', e);
    }
}

/** Define o baseline (estado conhecido da nuvem) — chamar após o sync inicial. */
function primeCestBaseline(arr) {
    _cestBaseline = _normCestList(arr);
    _cestLastSavedJson = JSON.stringify(_cestBaseline);
}

async function _fetchCestCloud() {
    if (!supabaseClient) return null;
    const { data, error } = await supabaseClient
        .from(TABLE_NAME)
        .select('value')
        .eq('key', CEST_KEY)
        .single();
    if (error && error.code !== 'PGRST116') {
        console.warn('⚠️ Erro ao buscar cest_vencidos da nuvem:', error.message || error);
        return null;
    }
    return data ? _normCestList(data.value) : [];
}

/**
 * Salva cest_vencidos com merge append-only: nunca sobrescreve cegamente o array
 * da nuvem. Aplica só o DIFF do usuário (itens adicionados/removidos relativos ao
 * baseline carregado) sobre o valor ATUAL da nuvem:
 *     merged = (cloud ∪ added) \ removed
 * Assim, edição simultânea de duas máquinas não apaga o trabalho uma da outra.
 */
async function saveCestVencidosMerged(localArray) {
    const local = _normCestList(localArray);
    _persistCestLocal(local);

    if (!supabaseReadyPromise) initSupabase();
    await supabaseReadyPromise;
    if (!isSupabaseConfigured || !supabaseClient || !currentSession) {
        _cestBaseline = local;
        _cestLastSavedJson = JSON.stringify(local);
        return { success: true, local: true };
    }

    const baseline = _cestBaseline === null ? local : _normCestList(_cestBaseline);
    const added = local.filter(c => !baseline.includes(c));
    const removed = baseline.filter(c => !local.includes(c));

    const cloud = (await _fetchCestCloud()) || [];
    const removedSet = new Set(removed);
    const merged = _normCestList([...cloud, ...added]).filter(c => !removedSet.has(c));

    // Marca como nossa escrita ANTES do upsert para o eco do realtime ser ignorado.
    _cestLastSavedJson = JSON.stringify(merged);

    try {
        const { error } = await supabaseClient
            .from(TABLE_NAME)
            .upsert(
                { key: CEST_KEY, value: merged, updated_at: new Date().toISOString() },
                { onConflict: 'key' }
            );
        if (error) {
            console.error('❌ Erro ao salvar cest_vencidos:', error);
            return { success: false, error: error.message, local: true };
        }
    } catch (error) {
        console.error('❌ Erro ao salvar cest_vencidos:', error);
        return { success: false, error: error.message, local: true };
    }

    _cestBaseline = merged;
    _persistCestLocal(merged);
    return { success: true, cloud: true, merged };
}

/**
 * Subscreve realtime na chave cest_vencidos. `onRemoteUpdate(arr)` é chamado quando
 * OUTRA máquina altera o valor (escritas próprias são filtradas via _cestLastSavedJson).
 * Filtro por key é client-side (mais robusto que o filtro server-side do postgres_changes).
 */
function subscribeCestRealtime(onRemoteUpdate) {
    if (!supabaseClient || _cestRealtimeChannel) return _cestRealtimeChannel;
    _cestRealtimeChannel = supabaseClient
        .channel('cest-vencidos-rt')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: TABLE_NAME },
            (payload) => {
                const row = payload.new || {};
                if (row.key !== CEST_KEY) return;                 // filtro client-side
                const incoming = _normCestList(row.value);
                const incomingJson = JSON.stringify(incoming);
                if (incomingJson === _cestLastSavedJson) return;  // eco da nossa escrita
                _cestBaseline = incoming;
                _cestLastSavedJson = incomingJson;
                _persistCestLocal(incoming);
                if (typeof onRemoteUpdate === 'function') {
                    try { onRemoteUpdate(incoming); } catch (e) { console.warn('onRemoteUpdate erro:', e); }
                }
            })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') console.log('✅ Realtime cest_vencidos ativo.');
        });
    return _cestRealtimeChannel;
}

// ==================== EXPORT ====================
window.supabaseSync = {
    init: initSupabase,
    save: saveToCloud,
    load: loadFromCloud,
    sync: syncData,
    syncAll: syncAllData,
    refresh: forceRefreshFromCloud,
    saveCestVencidos: saveCestVencidosMerged,
    subscribeCestRealtime,
    primeCestBaseline,
    isConfigured: () => isSupabaseConfigured,
    requireAuth,
    uploadPythonFile,
    getPythonFileUrl,
    downloadPythonFile,
    removePythonFile,
    auth: {
        signIn: authSignIn,
        signUp: authSignUp,
        signOut: authSignOut,
        getUser: authGetUser,
        getSession: authGetCurrentSession,
        getProfile: authGetCurrentProfile,
        onChange: authOnChange,
        updateProfile: authUpdateProfile,
        createUser: authCreateUser,
        deleteUser: authDeleteUser,
        usernameToEmail: _usernameToEmail,
    },
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabase);
} else {
    initSupabase();
}
