/**
 * Sistema de Sincronização com Supabase
 * Permite compartilhamento de dados entre múltiplos PCs
 */

// ==================== CONFIGURAÇÃO SUPABASE ====================
// Credenciais configuradas
const SUPABASE_CONFIG = {
    url: 'https://wbigfkxvrridtqpzvsil.supabase.co',
    anonKey: 'sb_publishable_diWTtWyA5ZM99butbHbyvA_QWFtr4tV'
};

// Nome da tabela onde os dados serão armazenados
const TABLE_NAME = 'system_data';

// ==================== INICIALIZAÇÃO ====================
let supabaseClient = null;
let isSupabaseConfigured = false;

// Verificar se Supabase está configurado
function initSupabase() {
    if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey || 
        SUPABASE_CONFIG.url === 'SUA_URL_DO_SUPABASE_AQUI' ||
        SUPABASE_CONFIG.anonKey === 'SUA_ANON_KEY_AQUI') {
        console.warn('⚠️ Supabase não configurado. Usando apenas localStorage.');
        return false;
    }

    try {
        // Carregar biblioteca Supabase via CDN
        if (typeof window.supabase === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
            script.onload = () => {
                if (window.supabase) {
                    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
                    isSupabaseConfigured = true;
                    console.log('✅ Supabase inicializado com sucesso!');
                    // Criar tabela automaticamente se não existir
                    ensureTableExists();
                }
            };
            script.onerror = () => {
                console.error('❌ Erro ao carregar biblioteca Supabase');
            };
            document.head.appendChild(script);
        } else {
            supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
            isSupabaseConfigured = true;
            console.log('✅ Supabase inicializado com sucesso!');
            ensureTableExists();
        }
        return true;
    } catch (error) {
        console.error('❌ Erro ao inicializar Supabase:', error);
        return false;
    }
}

// Criar tabela automaticamente (via REST API, já que não temos permissões SQL diretas)
async function ensureTableExists() {
    // A tabela deve ser criada manualmente no Supabase Dashboard
    // SQL para criar a tabela:
    // CREATE TABLE IF NOT EXISTS system_data (
    //     id SERIAL PRIMARY KEY,
    //     key TEXT UNIQUE NOT NULL,
    //     value JSONB NOT NULL,
    //     updated_at TIMESTAMP DEFAULT NOW()
    // );
    console.log('📝 Certifique-se de criar a tabela system_data no Supabase Dashboard');
}

// ==================== FUNÇÕES DE SINCRONIZAÇÃO ====================

/**
 * Salvar dados no Supabase (com fallback para localStorage)
 */
async function saveToCloud(key, data) {
    // Sempre salvar localmente primeiro (cache)
    try {
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem(`${key}_updated`, Date.now().toString());
    } catch (e) {
        console.error('Erro ao salvar no localStorage:', e);
    }

    // Tentar salvar na nuvem se Supabase estiver configurado
    if (!isSupabaseConfigured) {
        initSupabase();
    }

    if (!isSupabaseConfigured || !supabaseClient) {
        console.warn(`⚠️ Supabase não disponível. Dados salvos apenas localmente: ${key}`);
        return { success: true, local: true };
    }

    try {
        const { data: result, error } = await supabaseClient
            .from(TABLE_NAME)
            .upsert({
                key: key,
                value: data,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'key'
            });

        if (error) {
            console.error(`❌ Erro ao salvar ${key} no Supabase:`, error);
            return { success: false, error: error.message, local: true };
        }

        console.log(`✅ Dados sincronizados na nuvem: ${key}`);
        return { success: true, cloud: true, local: true };
    } catch (error) {
        console.error(`❌ Erro ao salvar ${key} no Supabase:`, error);
        return { success: false, error: error.message, local: true };
    }
}

/**
 * Carregar dados do Supabase (com fallback para localStorage)
 */
async function loadFromCloud(key, defaultValue = null) {
    // Primeiro, tentar carregar da nuvem
    if (!isSupabaseConfigured) {
        initSupabase();
    }

    if (isSupabaseConfigured && supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from(TABLE_NAME)
                .select('value, updated_at')
                .eq('key', key)
                .single();

            if (!error && data) {
                // Atualizar localStorage com dados da nuvem
                localStorage.setItem(key, JSON.stringify(data.value));
                localStorage.setItem(`${key}_updated`, new Date(data.updated_at).getTime().toString());
                console.log(`✅ Dados carregados da nuvem: ${key}`);
                return data.value;
            } else if (error) {
                // PGRST116 = não encontrado (é normal se for primeira vez)
                // 406 = Not Acceptable (pode ser problema de headers ou formato)
                if (error.code === 'PGRST116') {
                    // Não encontrado - usar defaultValue
                    console.log(`ℹ️ Chave ${key} não encontrada na nuvem (primeira vez)`);
                } else {
                    console.warn(`⚠️ Erro ao carregar ${key} do Supabase (${error.code || error.message}):`, error.message || error);
                }
            }
        } catch (error) {
            console.error(`❌ Erro ao carregar ${key} do Supabase:`, error);
        }
    }

    // Fallback: carregar do localStorage
    try {
        const localData = localStorage.getItem(key);
        if (localData) {
            console.log(`📦 Dados carregados do localStorage: ${key}`);
            return JSON.parse(localData);
        }
    } catch (e) {
        console.error(`Erro ao carregar ${key} do localStorage:`, e);
    }

    return defaultValue;
}

/**
 * Sincronizar dados locais com a nuvem (comparar timestamps)
 */
async function syncData(key) {
    if (!isSupabaseConfigured || !supabaseClient) {
        return { synced: false, reason: 'Supabase não configurado' };
    }

    try {
        // Buscar timestamp local
        const localUpdated = parseInt(localStorage.getItem(`${key}_updated`) || '0');
        
        // Buscar timestamp da nuvem
        const { data: cloudData, error } = await supabaseClient
            .from(TABLE_NAME)
            .select('value, updated_at')
            .eq('key', key)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error(`Erro ao sincronizar ${key}:`, error);
            return { synced: false, error: error.message };
        }

        if (!cloudData) {
            // Não existe na nuvem, enviar local
            const localData = localStorage.getItem(key);
            if (localData) {
                await saveToCloud(key, JSON.parse(localData));
                return { synced: true, action: 'uploaded' };
            }
            return { synced: false, reason: 'Sem dados locais' };
        }

        const cloudUpdated = new Date(cloudData.updated_at).getTime();
        
        if (cloudUpdated > localUpdated) {
            // Nuvem é mais recente, atualizar local
            localStorage.setItem(key, JSON.stringify(cloudData.value));
            localStorage.setItem(`${key}_updated`, cloudUpdated.toString());
            console.log(`⬇️ Dados atualizados do servidor: ${key}`);
            return { synced: true, action: 'downloaded', data: cloudData.value };
        } else if (localUpdated > cloudUpdated) {
            // Local é mais recente, atualizar nuvem
            const localData = localStorage.getItem(key);
            if (localData) {
                await saveToCloud(key, JSON.parse(localData));
                return { synced: true, action: 'uploaded' };
            }
        } else {
            // Já estão sincronizados
            return { synced: true, action: 'already_synced' };
        }
    } catch (error) {
        console.error(`Erro ao sincronizar ${key}:`, error);
        return { synced: false, error: error.message };
    }
}

/**
 * Sincronizar múltiplas chaves de uma vez
 */
async function syncAllData(keys = ['users', 'registeredUsers', 'contributorContacts', 'contributors']) {
    const results = {};
    for (const key of keys) {
        results[key] = await syncData(key);
    }
    return results;
}

/**
 * Limpar dados locais e recarregar da nuvem
 */
async function forceRefreshFromCloud(key) {
    if (!isSupabaseConfigured || !supabaseClient) {
        return null;
    }

    try {
        const { data, error } = await supabaseClient
            .from(TABLE_NAME)
            .select('value, updated_at')
            .eq('key', key)
            .single();

        if (error || !data) {
            console.error(`Erro ao forçar refresh de ${key}:`, error);
            return null;
        }

        localStorage.setItem(key, JSON.stringify(data.value));
        localStorage.setItem(`${key}_updated`, new Date(data.updated_at).getTime().toString());
        console.log(`🔄 Dados atualizados forçadamente da nuvem: ${key}`);
        return data.value;
    } catch (error) {
        console.error(`Erro ao forçar refresh de ${key}:`, error);
        return null;
    }
}

// ==================== EXPORTAR FUNÇÕES ====================
window.supabaseSync = {
    init: initSupabase,
    save: saveToCloud,
    load: loadFromCloud,
    sync: syncData,
    syncAll: syncAllData,
    refresh: forceRefreshFromCloud,
    isConfigured: () => isSupabaseConfigured
};

// Inicializar automaticamente quando o arquivo for carregado
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabase);
} else {
    initSupabase();
}
