//------------------------------------ SISTEMA PRINCIPAL ----------------------------------------//
(function() {
    // No-op de debug (substituiu envio antigo para 127.0.0.1:7242 que ficou quebrado pós-refactor).
    // Mantido como stub para preservar todos os call-sites existentes sem refator agressivo.
    window.debugLog = (_location, _message, _data = {}) => { /* no-op */ };
    const debugLog = window.debugLog;

    // ==================== HASH DE SENHA — SEGURO (PBKDF2-SHA-256) ====================
    // Substitui o legacy `generateUltraSecureHash` (btoa+reverse, criptograficamente quebrado).
    // PBKDF2 com 100k iterações + SHA-256 é o mínimo defensável em 2025 para client-side hashing.
    // ATENÇÃO: client-side hash continua sendo medida-ponte. A migração final é Supabase Auth.
    const PASSWORD_SALT_FALLBACK = 'softtech_fiscal_v1_change_me_via_config';
    function _getPasswordSalt() {
        return (window.APP_CONFIG && window.APP_CONFIG.passwordSalt) || PASSWORD_SALT_FALLBACK;
    }
    /**
     * Hash seguro de senha via PBKDF2-SHA-256 (100k iter, 256 bits).
     * @param {string} password
     * @returns {Promise<string>} hash em base64 prefixado com "pbkdf2$"
     */
    window.generateSecureHash = async function generateSecureHash(password) {
        if (!password) return '';
        const enc = new TextEncoder();
        const salt = enc.encode(_getPasswordSalt());
        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
        );
        const bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            keyMaterial, 256
        );
        const b64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
        return 'pbkdf2$' + b64;
    };
    /**
     * Verifica password contra hash. Aceita o formato novo (pbkdf2$...) e o legacy.
     * Se a senha bater no legacy, retorna { ok: true, upgrade: novoHash } para o caller
     * persistir o upgrade silencioso no Supabase/localStorage.
     * @param {string} password
     * @param {string} storedHash
     * @returns {Promise<{ok: boolean, upgrade?: string}>}
     */
    window.verifyPassword = async function verifyPassword(password, storedHash) {
        if (!storedHash) return { ok: false };
        if (storedHash.startsWith('pbkdf2$')) {
            const candidate = await window.generateSecureHash(password);
            return { ok: candidate === storedHash };
        }
        // Legacy: aceita uma única vez e força upgrade.
        const legacy = window._legacyUnsafeHash(password);
        if (legacy === storedHash) {
            const upgraded = await window.generateSecureHash(password);
            return { ok: true, upgrade: upgraded };
        }
        return { ok: false };
    };
    /**
     * Hash legacy (btoa+reverse). MANTIDO APENAS para validar senhas antigas
     * no primeiro login após esta migração; novos cadastros usam PBKDF2.
     * NÃO usar em código novo.
     * @deprecated
     */
    window._legacyUnsafeHash = function _legacyUnsafeHash(input) {
        const s1 = "JosueProg2024!@#$%^&*()_+{}|:<>?[]\\;'\",./`~";
        const s2 = "DominiumBetaSystem!@#$%^&*()_+{}|:<>?[]\\;'\",./`~";
        const s3 = "AdminSecurity404!@#$%^&*()_+{}|:<>?[]\\;'\",./`~";
        let h = input;
        for (const salt of [s1, s2, s3, s1, s2, s3]) {
            h = btoa((h + salt).split('').reverse().join(''));
        }
        h = btoa((h + s1 + s2 + s3).split('').reverse().join(''));
        h = btoa((h + s1 + s2 + s3).split('').reverse().join(''));
        return h;
    };
    // Shim deprecated: cadastros antigos ainda chamam isto sincronamente.
    // Novos cadastros DEVEM usar generateSecureHash (async).
    window.generateUltraSecureHash = function(input) {
        console.warn('[DEPRECATED] generateUltraSecureHash síncrono. Use generateSecureHash (async).');
        return window._legacyUnsafeHash(input);
    };
    
    // Função auxiliar para garantir que elementos sejam encontrados
    const ensureElements = () => {
        const loginContainer = document.querySelector('.login-container');
        const dashboardContainer = document.querySelector('.dashboard-container');
        
        if (!loginContainer) {
            console.warn('⚠️ Login container não encontrado no DOM');
        }
        if (!dashboardContainer) {
            console.warn('⚠️ Dashboard container não encontrado no DOM');
        }
        
        return { loginContainer, dashboardContainer };
    };
    
    const { loginContainer, dashboardContainer } = ensureElements();
    const loginForm = document.querySelector('#login-form');
    const adminForm = document.querySelector('#admin-form');
    const loginUsername = document.querySelector('#login-username');
    const loginPassword = document.querySelector('#login-password');
    const adminUsername = document.querySelector('#admin-username');
    const adminPassword = document.querySelector('#admin-password');
    const rememberMeCheckbox = document.querySelector('#rememberMe');
    const signInLink = document.querySelector('.SignInLink');
    const allowedUsers = []; // Removido: usuários agora são gerenciados pela janela de cadastro
    let currentUser = null;
    let lastPage = 'dashboard';
    
    // Log inicial para debug
    console.log('🔍 Elementos encontrados:', {
        loginContainer: !!loginContainer,
        dashboardContainer: !!dashboardContainer,
        loginForm: !!loginForm,
        adminForm: !!adminForm
    });


    // Função de logout global
    async function logout() {
        try {
            console.log('🔄 Iniciando processo de logout...');

            // Encerrar sessão Supabase (best-effort — não bloqueia logout local em caso de erro).
            if (window.supabaseSync?.auth?.signOut) {
                try { await window.supabaseSync.auth.signOut(); }
                catch (e) { console.warn('Falha ao encerrar sessão Supabase:', e); }
            }

            // Desliga o auto-login: o próximo acesso volta a pedir senha. Mantém
            // savedUsername para pré-preencher o campo. Este é o único ponto que
            // reativa a tela de login — exatamente o comportamento pedido.
            localStorage.removeItem('autoLoginEnabled');

            currentUser = null;
            window.currentUser = null;
            
            // Voltar para a tela de login
            const loginContainer = document.querySelector('.login-container');
            const dashboardContainer = document.querySelector('.dashboard-container');
            
            console.log('🔍 Elementos encontrados:', {
                loginContainer: !!loginContainer,
                dashboardContainer: !!dashboardContainer
            });
            
            if (!loginContainer) {
                console.error('❌ loginContainer não encontrado!');
                // Tentar forçar a criação se necessário
                const body = document.body;
                if (body) {
                    const existingLogin = body.querySelector('.login-container');
                    if (!existingLogin) {
                        console.error('❌ Elemento .login-container não existe no DOM');
                    }
                }
            }
            
            if (!dashboardContainer) {
                console.error('❌ dashboardContainer não encontrado!');
            }
            
            if (loginContainer && dashboardContainer) {
                // Esconder dashboard primeiro (com múltiplas tentativas)
                dashboardContainer.style.display = 'none';
                dashboardContainer.style.visibility = 'hidden';
                dashboardContainer.classList.add('hidden');
                dashboardContainer.classList.remove('active');
                
                // Forçar remoção de qualquer classe que possa estar escondendo o login
                loginContainer.classList.remove('hidden');
                loginContainer.classList.remove('active');
                
                // Mostrar login (com múltiplas propriedades para garantir)
                loginContainer.style.display = 'flex';
                loginContainer.style.visibility = 'visible';
                loginContainer.style.opacity = '1';
                
                // Garantir que o login container está visível
                setTimeout(() => {
                    if (loginContainer.style.display === 'none' || loginContainer.style.visibility === 'hidden') {
                        console.warn('⚠️ Login container ainda não visível, forçando...');
                        loginContainer.style.display = 'flex';
                        loginContainer.style.visibility = 'visible';
                        loginContainer.style.opacity = '1';
                    }
                }, 100);
                
                const adminLoginContainer = document.querySelector('#admin-login-container');
                if (adminLoginContainer) {
                    adminLoginContainer.style.display = 'none';
                    adminLoginContainer.style.visibility = 'hidden';
                }
                
                // Limpar campos de login (mas manter username se "Lembrar de mim" estiver ativo).
                // SEGURANÇA: senha não é mais persistida em localStorage. "Lembrar" só pré-preenche
                // o username; o usuário sempre digita a senha.
                const savedUsername = localStorage.getItem('savedUsername');

                if (loginPassword) loginPassword.value = '';
                if (adminUsername) adminUsername.value = '';
                if (adminPassword) adminPassword.value = '';

                if (savedUsername && loginUsername) {
                    loginUsername.value = savedUsername;
                } else if (loginUsername) {
                    loginUsername.value = '';
                }

                if (rememberMeCheckbox) {
                    rememberMeCheckbox.checked = !!savedUsername;
                }
                
                // Restaurar background padrão
                document.documentElement.style.background = '#25252b';
                
                // Limpar qualquer estado pendente
                if (typeof safeUpdateTaxReminders === 'function') {
                    // Não atualizar reminders após logout
                }
                
                // Resetar lastPage
                lastPage = 'dashboard';
                
                console.log('✅ Logout realizado com sucesso');
                console.log('📊 Estado final:', {
                    loginDisplay: loginContainer.style.display,
                    loginVisibility: loginContainer.style.visibility,
                    dashboardDisplay: dashboardContainer.style.display,
                    dashboardVisibility: dashboardContainer.style.visibility
                });
            } else {
                console.error('❌ Elementos de login/dashboard não encontrados durante logout');
                // Tentar forçar a exibição do login mesmo sem encontrar o dashboard
                if (loginContainer) {
                    loginContainer.style.display = 'flex';
                    loginContainer.style.visibility = 'visible';
                }
            }
        } catch (error) {
            console.error('❌ Erro durante logout:', error);
            // Em caso de erro, tentar pelo menos mostrar o login
            try {
                const loginContainer = document.querySelector('.login-container');
                if (loginContainer) {
                    loginContainer.style.display = 'flex';
                    loginContainer.style.visibility = 'visible';
                }
            } catch (e) {
                console.error('❌ Erro crítico ao tentar mostrar login:', e);
            }
        }
    }

    // Tornar função de logout globalmente acessível
    window.logout = logout;
    
    // Tornar currentUser globalmente acessível
    window.currentUser = currentUser;

    // Perfil de imagem padrão (todos os usuários usarão o mesmo)
    const profileImages = {
        'default': 'assets/images/profile-1.png'
    };
	

    function formatDate(date) {
        return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    }
	
    function capitalizeName(name) {
        return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    }

    function getNextBusinessDay(year, month, day) {
        let date = new Date(year, month, day);
        let dayOfWeek = date.getDay();
        if (dayOfWeek === 6) {
            date.setDate(date.getDate() + 2);
        } else if (dayOfWeek === 0) {
            date.setDate(date.getDate() + 1);
        }
        return formatDate(date);
    }

    function getLastBusinessDayOfMonth() {
        const now = new Date();
        let date = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        let dayOfWeek = date.getDay();
        if (dayOfWeek === 6) {
            date.setDate(date.getDate() - 1);
        } else if (dayOfWeek === 0) {
            date.setDate(date.getDate() - 2);
        }
        return date; // Retornar Date, não string formatada
    }

    // Monta o estado de usuário autenticado e abre o dashboard. Compartilhado entre
    // o login manual (handleLogin) e o auto-login por sessão Supabase persistida —
    // evita duplicar a montagem de estado e mantém os dois fluxos idênticos.
    function applyAuthenticatedSession(username, profile) {
        profile = profile || {};
        currentUser = username;
        window.currentUser = username;
        loadUserPreferences();
        showDashboardAfterLogin();

        const userNameEl = document.querySelector('#current-user-name');
        const adminLabelEl = document.querySelector('#admin-label');
        const profileImageEl = document.querySelector('#profile-image');
        if (userNameEl) userNameEl.textContent = profile.full_name || username;
        if (adminLabelEl) adminLabelEl.style.display = (profile.control === 'administrador' || profile.role === 'admin') ? 'block' : 'none';
        if (profileImageEl) profileImageEl.src = profile.profile_image || profileImages['default'];

        // Espelha o profile do Supabase em registeredUsers (localStorage) para que as
        // checagens de admin reconheçam o usuário logado via Supabase Auth.
        try {
            const all = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
            const mirrored = {
                username,
                name: profile.full_name || username,
                control: profile.control || (profile.role === 'admin' ? 'administrador' : 'auxiliar'),
                profileImage: profile.profile_image || '',
            };
            const idx = all.findIndex(u => u.username === username);
            if (idx >= 0) all[idx] = { ...all[idx], ...mirrored };
            else all.push(mirrored);
            localStorage.setItem('registeredUsers', JSON.stringify(all));
        } catch (e) {
            console.warn('Falha ao espelhar profile Supabase em registeredUsers:', e);
        }
    }

    // "Lembrar de mim" / auto-login (2026-06-10): reusa a sessão Supabase já
    // persistida (refresh token em localStorage, com TTL e revogação server-side) —
    // NÃO persiste senha. Mantém a decisão de 2026-06-01 (senha nunca em localStorage)
    // e ainda entrega login automático no mesmo PC até o logout explícito.
    const loadSavedCredentialsAndAutoLogin = async () => {
        const usernameInput = document.querySelector('#login-username');
        const rememberCheckbox = document.querySelector('#rememberMe');

        // Limpar resíduo de migrações antigas para não confundir o estado do checkbox.
        if (localStorage.getItem('savedPassword') !== null) {
            localStorage.removeItem('savedPassword');
        }

        const savedUsername = localStorage.getItem('savedUsername');
        if (savedUsername && usernameInput) {
            usernameInput.value = savedUsername;
        }
        if (rememberCheckbox) {
            rememberCheckbox.checked = !!savedUsername;
        }

        // Auto-login: se habilitado, restaura a sessão Supabase e entra direto.
        if (localStorage.getItem('autoLoginEnabled') === '1' &&
            window.supabaseSync?.auth?.restoreSession) {
            try {
                const result = await window.supabaseSync.auth.restoreSession();
                if (result && result.ok) {
                    applyAuthenticatedSession(result.username || savedUsername, result.profile || {});
                    return;
                }
            } catch (e) {
                console.warn('Auto-login falhou, exibindo tela de login:', e);
            }
            // Sessão expirou/foi revogada: limpa o flag para não retentar em loop.
            localStorage.removeItem('autoLoginEnabled');
        }
    };
    
    // Aguardar DOM estar pronto e então carregar credenciais e tentar login automático
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Aguardar um frame para garantir que todos os scripts foram executados
            requestAnimationFrame(() => {
                loadSavedCredentialsAndAutoLogin();
            });
        });
    } else {
        // DOM já está pronto, aguardar um frame
        requestAnimationFrame(() => {
            loadSavedCredentialsAndAutoLogin();
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleLogin();
        });
    }

    if (loginUsername) {
        loginUsername.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                await handleLogin();
            }
        });
    }

    if (loginPassword) {
        loginPassword.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                await handleLogin();
            }
        });
    }

    // Admin form não é mais usado - login unificado no handleLogin
    // if (adminForm) {
    //     adminForm.addEventListener('submit', (e) => {
    //         e.preventDefault();
    //         handleAdminLogin();
    //     });
    // }

    // Admin password Enter key não é mais usado - login unificado no handleLogin
    // if (adminPassword) {
    //     adminPassword.addEventListener('keydown', (e) => {
    //         if (e.key === 'Enter') {
    //             handleAdminLogin();
    //         }
    //     });
    // }

    const adminLoginContainer = document.querySelector('#admin-login-container');
    
    if (signInLink) {
        signInLink.addEventListener('click', (e) => {
            e.preventDefault();
            // Mostrar login de auxiliar e ocultar login de admin
            if (loginContainer) loginContainer.style.display = 'flex';
            if (adminLoginContainer) adminLoginContainer.style.display = 'none';
        });
    }

    async function handleLogin() {
        if (!loginUsername || !loginPassword) return;

        const username = loginUsername.value.trim().toLowerCase();
        const password = loginPassword.value.trim();

        // ============== TENTATIVA 1: Supabase Auth (caminho moderno) ==============
        // Se o usuário já existe em auth.users, signIn cria sessão JWT.
        // Trigger handle_new_user já populou user_profiles (control=administrador/auxiliar).
        if (window.supabaseSync?.auth && window.supabaseSync.isConfigured()) {
            const result = await window.supabaseSync.auth.signIn(username, password);
            if (result.ok) {
                const profile = result.profile || {};
                applyAuthenticatedSession(username, profile);

                // "Lembrar de mim": persiste o username e habilita o auto-login pela
                // sessão Supabase já criada (refresh token), nunca a senha.
                const rememberMe = rememberMeCheckbox?.checked || false;
                if (rememberMe) {
                    localStorage.setItem('savedUsername', username);
                    localStorage.setItem('autoLoginEnabled', '1');
                } else {
                    localStorage.removeItem('savedUsername');
                    localStorage.removeItem('autoLoginEnabled');
                }
                localStorage.removeItem('savedPassword');
                return;
            }
            // Se a falha foi "Invalid login credentials" e o usuário NÃO existe em auth,
            // cai no fallback local. Outros erros (network, config) também caem.
            console.info('Supabase Auth falhou, tentando fallback local:', result.error);
        }

        // ============== TENTATIVA 2: PBKDF2 local (compat. com cadastros antigos) ==============
        let registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        
        // Se não há usuários no localStorage, tentar carregar do Supabase
        if (registeredUsers.length === 0 && window.supabaseSync && window.supabaseSync.isConfigured()) {
            console.log('📥 Nenhum usuário no localStorage, tentando carregar do Supabase...');
            
            // Mostrar indicador de carregamento
            const loginButton = loginForm?.querySelector('button[type="submit"]');
            const originalButtonText = loginButton?.textContent || '';
            if (loginButton) {
                loginButton.disabled = true;
                loginButton.textContent = 'Carregando usuários...';
            }
            
            try {
                // Tentar carregar dados do Supabase diretamente
                registeredUsers = await loadDataSync('registeredUsers', []);
                console.log(`✅ Carregados ${registeredUsers.length} usuários do Supabase`);
                
                // Se ainda estiver vazio, tentar sincronizar
                if (registeredUsers.length === 0) {
                    console.log('🔄 Tentando sincronizar dados do Supabase...');
                    if (loginButton) {
                        loginButton.textContent = 'Sincronizando...';
                    }
                    await window.supabaseSync.syncAll(['registeredUsers']);
                    registeredUsers = await loadDataSync('registeredUsers', []);
                    console.log(`✅ Após sincronização: ${registeredUsers.length} usuários carregados`);
                }
            } catch (error) {
                console.warn('⚠️ Erro ao carregar usuários do Supabase:', error);
                // Continuar com array vazio - admin sempre pode fazer login
            } finally {
                // Restaurar botão
                if (loginButton) {
                    loginButton.disabled = false;
                    loginButton.textContent = originalButtonText;
                }
            }
        }
        
        // Verificar usuários cadastrados dinamicamente
        const user = registeredUsers.find(u => u.username === username);

        // Verificar se é usuário cadastrado
        if (user) {
            const verification = await window.verifyPassword(password, user.password);
            if (verification.ok) {
                // Upgrade silencioso: se a senha foi validada via legacy hash, persistir o novo.
                if (verification.upgrade) {
                    try {
                        const all = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
                        const idx = all.findIndex(u => u.username === user.username);
                        if (idx >= 0) {
                            all[idx].password = verification.upgrade;
                            localStorage.setItem('registeredUsers', JSON.stringify(all));
                            if (typeof saveDataSync === 'function') {
                                saveDataSync('registeredUsers', all).catch(() => {});
                            }
                            console.log(`🔐 Hash da senha do usuário ${user.username} migrado para PBKDF2.`);
                        }
                    } catch (e) {
                        console.warn('Falha ao persistir upgrade de hash:', e);
                    }
                }
                // "Lembrar de mim" agora persiste APENAS o username.
                const rememberMe = rememberMeCheckbox?.checked || false;
                if (rememberMe) {
                    localStorage.setItem('savedUsername', username);
                } else {
                    localStorage.removeItem('savedUsername');
                }
                localStorage.removeItem('savedPassword'); // limpa resíduo antigo

                currentUser = user.username;
                window.currentUser = user.username;
                
                // #region agent log
                // #endregion
                // Usar função centralizada para mostrar dashboard
                loadUserPreferences();
                showDashboardAfterLogin();
                const userNameElement = document.querySelector('#current-user-name');
                const adminLabelElement = document.querySelector('#admin-label');
                const profileImageElement = document.querySelector('#profile-image');
                if (userNameElement) {
                    userNameElement.textContent = user.name;
                }
                if (adminLabelElement) {
                    adminLabelElement.style.display = (user.control === 'administrador') ? 'block' : 'none';
                }
                if (profileImageElement) {
                    profileImageElement.src = user.profileImage || profileImages['default'];
                    console.log(`Imagem de perfil atualizada para ${currentUser}: ${profileImageElement.src}`);
                }
            } else {
                if (loginForm) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-message';
                    errorDiv.textContent = 'Senha incorreta. Tente novamente.';
                    loginForm.appendChild(errorDiv);
                    setTimeout(() => errorDiv.remove(), 3000);
                }
            }
        } else if (username === 'adm') {
            // Login do super-admin: hash agora vem de window.APP_CONFIG.adminPasswordHash
            // (definido em assets/js/config.js, gitignored). Aceita formato novo "pbkdf2$..."
            // e legacy (com upgrade silencioso).
            const adminHash = (window.APP_CONFIG && window.APP_CONFIG.adminPasswordHash) || null;

            if (!adminHash) {
                console.error('❌ adminPasswordHash não configurado em window.APP_CONFIG. Veja config.example.js.');
                if (loginForm) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-message';
                    errorDiv.textContent = 'Admin não configurado. Contate o responsável.';
                    loginForm.appendChild(errorDiv);
                    setTimeout(() => errorDiv.remove(), 3000);
                }
                return;
            }

            const adminVerification = await window.verifyPassword(password, adminHash);
            if (adminVerification.ok) {
                currentUser = 'adm';
                window.currentUser = 'adm';

                if (adminVerification.upgrade) {
                    console.warn('🔐 Hash do admin ainda em formato legacy. Atualize window.APP_CONFIG.adminPasswordHash para:', adminVerification.upgrade);
                }

                // "Lembrar de mim" persiste apenas username.
                const rememberMe = rememberMeCheckbox?.checked || false;
                if (rememberMe) {
                    localStorage.setItem('savedUsername', username);
                } else {
                    localStorage.removeItem('savedUsername');
                }
                localStorage.removeItem('savedPassword');
                
                // Usar função centralizada para mostrar dashboard
                loadUserPreferences();
                showDashboardAfterLogin();
                
                // Configurar perfil de admin
                const userNameElement = document.querySelector('#current-user-name');
                const adminLabelElement = document.querySelector('#admin-label');
                const profileImageElement = document.querySelector('#profile-image');
                if (userNameElement) {
                    userNameElement.textContent = 'Administrador';
                }
                if (adminLabelElement) {
                    adminLabelElement.style.display = 'none';
                }
                if (profileImageElement) {
                    profileImageElement.src = profileImages['default'];
                    console.log(`Imagem de perfil atualizada para ${currentUser}: ${profileImageElement.src}`);
                }
            } else {
                // Verificar se é um usuário administrador cadastrado (via verifyPassword com upgrade).
                const allUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
                const adminCandidates = allUsers.filter(u => u.control === 'administrador');
                let adminUser = null;
                let adminUpgrade = null;
                for (const candidate of adminCandidates) {
                    const v = await window.verifyPassword(password, candidate.password);
                    if (v.ok) { adminUser = candidate; adminUpgrade = v.upgrade; break; }
                }

                if (adminUser) {
                    currentUser = adminUser.username;
                    window.currentUser = adminUser.username;

                    if (adminUpgrade) {
                        const idx = allUsers.findIndex(u => u.username === adminUser.username);
                        if (idx >= 0) {
                            allUsers[idx].password = adminUpgrade;
                            localStorage.setItem('registeredUsers', JSON.stringify(allUsers));
                            if (typeof saveDataSync === 'function') {
                                saveDataSync('registeredUsers', allUsers).catch(() => {});
                            }
                        }
                    }

                    const rememberMe = rememberMeCheckbox?.checked || false;
                    if (rememberMe) {
                        localStorage.setItem('savedUsername', adminUser.username);
                    } else {
                        localStorage.removeItem('savedUsername');
                    }
                    localStorage.removeItem('savedPassword');
                    
                    // Usar função centralizada para mostrar dashboard
                    loadUserPreferences();
                    showDashboardAfterLogin();
                    
                    // Configurar perfil de admin user
                    const userNameElement = document.querySelector('#current-user-name');
                    const adminLabelElement = document.querySelector('#admin-label');
                    const profileImageElement = document.querySelector('#profile-image');
                    if (userNameElement) {
                        userNameElement.textContent = adminUser.name;
                    }
                    if (adminLabelElement) {
                        adminLabelElement.style.display = 'block';
                    }
                    if (profileImageElement) {
                        profileImageElement.src = adminUser.profileImage || profileImages['default'];
                    }
                } else {
                    if (loginForm) {
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'error-message';
                        errorDiv.textContent = 'Senha incorreta. Tente novamente.';
                        loginForm.appendChild(errorDiv);
                        setTimeout(() => errorDiv.remove(), 3000);
                    }
                }
            }
        } else {
            if (loginForm) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-message';
                errorDiv.textContent = 'Usuário não encontrado. Verifique se está cadastrado.';
                loginForm.appendChild(errorDiv);
                setTimeout(() => errorDiv.remove(), 3000);
            }
        }
    }

    // NOTA: a função `window.generateUltraSecureHash` foi movida para o topo do IIFE
    // como shim deprecated que apenas chama `_legacyUnsafeHash` e emite warning.
    // A implementação real (PBKDF2) está em `window.generateSecureHash`. Veja início do arquivo.

    async function handleAdminLogin() {
        // Função legada (admin-form não está mais ativo no HTML — ver Dominium.html:379).
        // Mantida para compatibilidade caso seja reativada no futuro.
        if (!adminPassword) return;

        const password = adminPassword.value.trim();
        const adminHash = (window.APP_CONFIG && window.APP_CONFIG.adminPasswordHash) || null;

        if (!adminHash) {
            console.error('❌ adminPasswordHash não configurado em window.APP_CONFIG.');
            return;
        }

        const adminVerification = await window.verifyPassword(password, adminHash);
        const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');

        // Procurar admin cadastrado com verificação async.
        let adminUser = null;
        for (const u of registeredUsers.filter(u => u.control === 'administrador')) {
            const v = await window.verifyPassword(password, u.password);
            if (v.ok) { adminUser = u; break; }
        }

        if (adminVerification.ok) {
            // #region agent log
            // #endregion
            currentUser = 'adm';
            window.currentUser = 'adm';
            
            // Usar função centralizada para mostrar dashboard
            loadUserPreferences();
            showDashboardAfterLogin();
            // MODIFICAÇÃO: Definir nome como "Administrador", ocultar "Admin" e usar profile-1.png
            const userNameElement = document.querySelector('#current-user-name');
            const adminLabelElement = document.querySelector('#admin-label');
            const profileImageElement = document.querySelector('#profile-image');
            if (userNameElement) {
                userNameElement.textContent = 'Administrador'; // Nome fixo em vez de capitalizeName('adm')
            }
            if (adminLabelElement) {
                adminLabelElement.style.display = 'none'; // Sempre ocultar para adm
            }
            if (profileImageElement) {
                profileImageElement.src = profileImages['default'];
                console.log(`Imagem de perfil atualizada para ${currentUser}: ${profileImageElement.src}`);
            }
        } else if (adminUser) {
            currentUser = adminUser.username;
            window.currentUser = adminUser.username;
            
            // Usar função centralizada para mostrar dashboard
            loadUserPreferences();
            showDashboardAfterLogin();
            
            const userNameElement = document.querySelector('#current-user-name');
            const adminLabelElement = document.querySelector('#admin-label');
            const profileImageElement = document.querySelector('#profile-image');
            if (userNameElement) {
                userNameElement.textContent = adminUser.name;
            }
            if (adminLabelElement) {
                adminLabelElement.style.display = 'block';
            }
            if (profileImageElement) {
                profileImageElement.src = adminUser.profileImage || profileImages['default'];
                console.log(`Imagem de perfil atualizada para ${currentUser}: ${profileImageElement.src}`);
            }
        } else {
            if (adminForm) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-message';
                errorDiv.textContent = 'Senha incorreta. Tente novamente.';
                adminForm.appendChild(errorDiv);
                setTimeout(() => errorDiv.remove(), 3000);
            }
        }
    }


    function loadUserPreferences() {
        if (currentUser && darkMode) {
            const savedTheme = localStorage.getItem(`theme_${currentUser}`);
            const span1 = darkMode.querySelector('span:nth-child(1)');
            const span2 = darkMode.querySelector('span:nth-child(2)');
            
            if (savedTheme === 'dark' && span1 && span2) {
                document.body.classList.add('dark-mode-variables');
                span1.classList.remove('active');
                span2.classList.add('active');
                document.documentElement.style.background = '#181a1e';
            } else if (span1 && span2) {
                document.body.classList.remove('dark-mode-variables');
                span1.classList.add('active');
                span2.classList.remove('active');
                document.documentElement.style.background = '#f6f6f9';
            }
        }
    }

    // Função auxiliar para criar conteúdo do dashboard manualmente
    // Limita tentativas para evitar loop infinito se #main-content nunca aparecer
    function createDashboardContentManually(attempt = 0) {
        const MAX_ATTEMPTS = 10;
        console.log('🔧 Criando conteúdo do dashboard manualmente...');
        const mainContent = document.querySelector('#main-content');
        if (!mainContent) {
            if (attempt >= MAX_ATTEMPTS) {
                console.error('❌ #main-content não encontrado após ' + MAX_ATTEMPTS + ' tentativas. Abortando.');
                return;
            }
            console.warn('⚠️ #main-content não encontrado, tentativa ' + (attempt + 1) + '/' + MAX_ATTEMPTS);
            setTimeout(() => createDashboardContentManually(attempt + 1), 100);
            return;
        }
        
        try {
            mainContent.innerHTML = `
                <h1>Dashboard</h1>
                <div class="dashboard-grid">
                    <div class="box animate-section" style="animation-delay: 0s"></div>
                    <div class="box animate-section" style="animation-delay: 0.05s"></div>
                    <div class="box animate-section" style="animation-delay: 0.1s"></div>
                    <div class="box animate-section" style="animation-delay: 0.15s"></div>
                    <div class="box animate-section" style="animation-delay: 0.2s"></div>
                    <div class="box animate-section" style="animation-delay: 0.25s"></div>
                    <div class="box animate-section" style="animation-delay: 0.3s"></div>
                    <div class="box animate-section" style="animation-delay: 0.35s"></div>
                    <div class="box animate-section" style="animation-delay: 0.4s"></div>
                </div>
            `;
            // #region agent log
            // #endregion
            console.log('✅ Conteúdo do dashboard criado manualmente com sucesso!');
        } catch (e) {
            console.error('❌ Erro ao criar conteúdo manualmente:', e);
            // #region agent log
            // #endregion
        }
    }

    // FUNÇÃO CENTRALIZADA PARA MOSTRAR DASHBOARD APÓS LOGIN
    function showDashboardAfterLogin() {
        // #region agent log
        // #endregion
        console.log('🚀 ========== INICIANDO showDashboardAfterLogin ==========');
        
        // PASSO 1: Esconder completamente o login
        const loginContainer = document.querySelector('.login-container');
        const adminLoginContainer = document.querySelector('#admin-login-container');
        
        // #region agent log
        // #endregion
        
        if (loginContainer) {
            loginContainer.style.display = 'none';
            loginContainer.style.visibility = 'hidden';
            loginContainer.style.opacity = '0';
            loginContainer.style.position = 'fixed';
            loginContainer.style.zIndex = '-1';
            loginContainer.classList.add('hidden');
            console.log('✅ Login container escondido');
            // #region agent log
            // #endregion
        }
        
        if (adminLoginContainer) {
            adminLoginContainer.style.display = 'none';
            adminLoginContainer.style.visibility = 'hidden';
            adminLoginContainer.style.opacity = '0';
            adminLoginContainer.classList.add('hidden');
            console.log('✅ Admin login container escondido');
        }
        
        // PASSO 2: Mostrar dashboard FORÇADAMENTE
        const dashboardContainer = document.querySelector('.dashboard-container');
        // #region agent log
        // #endregion
        if (!dashboardContainer) {
            console.error('❌ Dashboard container não encontrado!');
            // #region agent log
            // #endregion
            setTimeout(() => showDashboardAfterLogin(), 100);
            return;
        }
        
        // Remover TODAS as classes que possam esconder
        dashboardContainer.classList.remove('hidden', 'active');
        
        // Forçar exibição com TODAS as propriedades possíveis
        dashboardContainer.style.display = 'block';
        dashboardContainer.style.visibility = 'visible';
        dashboardContainer.style.opacity = '1';
        dashboardContainer.style.position = 'relative';
        dashboardContainer.style.zIndex = '1';
        dashboardContainer.style.width = '100%';
        dashboardContainer.style.minHeight = '100vh';
        
        // #region agent log
        const computedStyle = window.getComputedStyle(dashboardContainer);
        // #endregion
        
        console.log('✅ Dashboard container configurado:', {
            display: dashboardContainer.style.display,
            visibility: dashboardContainer.style.visibility,
            opacity: dashboardContainer.style.opacity,
            position: dashboardContainer.style.position
        });
        
        // PASSO 3: Criar conteúdo IMEDIATAMENTE
        const mainContent = document.querySelector('#main-content');
        // #region agent log
        // #endregion
        if (mainContent) {
            if (!mainContent.innerHTML || mainContent.innerHTML.trim() === '' || mainContent.innerHTML.includes('<!-- Conteúdo será gerado')) {
                console.log('📝 Criando conteúdo do dashboard imediatamente...');
                // #region agent log
                // #endregion
                createDashboardContentManually();
            } else {
                console.log('✅ Conteúdo já existe no dashboard');
            }
        } else {
            console.warn('⚠️ #main-content não encontrado, tentando novamente...');
            // #region agent log
            // #endregion
            setTimeout(() => {
                createDashboardContentManually();
            }, 50);
        }
        
        // PASSO 4: Usar navigateTo se disponível (com retry)
        setTimeout(() => {
            let navFunc = null;
            if (typeof navigateTo === 'function') {
                navFunc = navigateTo;
            } else if (typeof window.navigateTo === 'function') {
                navFunc = window.navigateTo;
            }
            
            if (navFunc) {
                try {
                    console.log('🧭 Chamando navigateTo...');
                    navFunc('dashboard');
                } catch (e) {
                    console.error('❌ Erro ao chamar navigateTo:', e);
                }
            }
            
            // PASSO 5: Verificações finais
            setTimeout(() => {
                // Verificar se dashboard ainda está visível
                if (dashboardContainer && (dashboardContainer.style.display === 'none' || dashboardContainer.offsetParent === null)) {
                    console.warn('⚠️ Dashboard não está visível! Forçando novamente...');
                    dashboardContainer.style.display = 'block';
                    dashboardContainer.style.visibility = 'visible';
                    dashboardContainer.style.opacity = '1';
                }
                
                // Verificar se conteúdo foi criado
                const mainContentCheck = document.querySelector('#main-content');
                if (mainContentCheck && (!mainContentCheck.innerHTML || mainContentCheck.innerHTML.trim() === '')) {
                    console.warn('⚠️ Conteúdo não criado! Criando agora...');
                    createDashboardContentManually();
                }
                
                // Atualizar reminders
                if (typeof safeUpdateTaxReminders === 'function') {
                    safeUpdateTaxReminders();
                }
                
                console.log('✅ ========== showDashboardAfterLogin CONCLUÍDO ==========');
            }, 300);
        }, 100);
    }

    const sideMenu = document.querySelector('aside');
    const menuBtn = document.querySelector('#menu-btn');
    const closeBtn = document.querySelector('#close-btn');
    const darkMode = document.querySelector('.dark-mode');
    const sidebarLinks = document.querySelectorAll('.sidebar a:not(.logout)');

    if (menuBtn && sideMenu) {
        menuBtn.addEventListener('click', () => {
            sideMenu.style.display = 'block';
        });
    }

    if (closeBtn && sideMenu) {
        closeBtn.addEventListener('click', () => {
            sideMenu.style.display = 'none';
        });
    }

    if (darkMode) {
        darkMode.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode-variables');
            const span1 = darkMode.querySelector('span:nth-child(1)');
            const span2 = darkMode.querySelector('span:nth-child(2)');
            if (span1 && span2) {
                span1.classList.toggle('active');
                span2.classList.toggle('active');
            }
            document.documentElement.style.background = document.body.classList.contains('dark-mode-variables') ? '#181a1e' : '#f6f6f9';
            if (currentUser) {
                localStorage.setItem(`theme_${currentUser}`, document.body.classList.contains('dark-mode-variables') ? 'dark' : 'light');
            }
            // Atualizar logos da sidebar e user-profile conforme o tema
            const isDark = document.body.classList.contains('dark-mode-variables');
            document.querySelectorAll('.dashboard-container .logo-dark').forEach(el => { el.style.display = isDark ? 'block' : 'none'; });
            document.querySelectorAll('.dashboard-container .logo-light').forEach(el => { el.style.display = isDark ? 'none' : 'block'; });
        });
    }

    const logoutLink = document.querySelector('.logout');
    if (logoutLink) {
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            // Chamar a função de logout global que já tem todas as verificações
            if (typeof logout === 'function') {
                logout();
            } else {
                // Fallback caso a função não esteja disponível
                console.warn('⚠️ Função logout não encontrada, usando fallback');
                if (loginContainer) {
                    loginContainer.style.display = 'flex';
                    loginContainer.style.visibility = 'visible';
                    loginContainer.classList.remove('active');
                }
                if (dashboardContainer) {
                    dashboardContainer.style.display = 'none';
                    dashboardContainer.style.visibility = 'hidden';
                }
                const adminLoginContainer = document.querySelector('#admin-login-container');
                if (adminLoginContainer) {
                    adminLoginContainer.style.display = 'none';
                    adminLoginContainer.style.visibility = 'hidden';
                }
                if (loginUsername) loginUsername.value = '';
                if (loginPassword) loginPassword.value = '';
                if (adminPassword) adminPassword.value = '';
                document.documentElement.style.background = '#25252b';
                currentUser = null;
                window.currentUser = null;
                lastPage = 'dashboard';
            }
        });
    }

    function navigateTo(page) {
        // #region agent log
        // #endregion
        console.log('🧭 Navegando para:', page);
        
        // Verificar se o dashboard está visível
        const dashboardContainer = document.querySelector('.dashboard-container');
        // #region agent log
        // #endregion
        if (dashboardContainer && dashboardContainer.style.display === 'none') {
            console.warn('⚠️ Dashboard não está visível, forçando exibição...');
            dashboardContainer.style.display = 'block';
            dashboardContainer.style.visibility = 'visible';
            dashboardContainer.style.opacity = '1';
            dashboardContainer.classList.remove('hidden');
        }
        
        if (page !== 'analytics') {
            lastPage = page;
        }

        // Verificar se sidebarLinks existe
        if (typeof sidebarLinks !== 'undefined' && sidebarLinks) {
            sidebarLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('data-page') === page) {
                    link.classList.add('active');
                }
            });
        }

        const mainContent = document.querySelector('#main-content');
        if (!mainContent) {
            console.error('❌ Elemento #main-content não encontrado!');
            // Tentar aguardar um pouco e tentar novamente
            setTimeout(() => {
                const mainContentRetry = document.querySelector('#main-content');
                if (mainContentRetry) {
                    console.log('✅ Elemento #main-content encontrado após retry');
                    navigateTo(page);
                } else {
                    console.error('❌ Elemento #main-content ainda não encontrado após retry');
                }
            }, 100);
            return;
        }
        mainContent.innerHTML = '';

        const existingModal = document.querySelector('.protected-modal');
        if (existingModal) existingModal.remove();

        if (page === 'dashboard') {
            try {
                console.log('✅ Criando conteúdo do dashboard...');
                
                // Garantir que o mainContent existe antes de inserir conteúdo
                if (!mainContent) {
                    console.error('❌ mainContent não existe!');
                    return;
                }
                
                mainContent.innerHTML = `
                    <h1>Dashboard</h1>
                    <div class="dashboard-grid">
                        <div class="box animate-section baixar-nfce-box" style="animation-delay: 0s; cursor: pointer;">
                            <div class="box-content">
                                <div class="box-icon">
                                    <span class="material-icons-sharp">receipt_long</span>
                                </div>
                                <div class="box-info">
                                    <h3>Baixar NFCe</h3>
                                    <p>Baixar XMLs de cupons NFC-e da SEFAZ-CE em massa</p>
                                </div>
                            </div>
                        </div>
                        <div class="box animate-section" style="animation-delay: 0.05s"></div>
                        <div class="box animate-section" style="animation-delay: 0.1s"></div>
                        <div class="box animate-section" style="animation-delay: 0.15s"></div>
                        <div class="box animate-section" style="animation-delay: 0.2s"></div>
                        <div class="box animate-section" style="animation-delay: 0.25s"></div>
                        <div class="box animate-section" style="animation-delay: 0.3s"></div>
                        <div class="box animate-section" style="animation-delay: 0.35s"></div>
                        <div class="box animate-section" style="animation-delay: 0.4s"></div>
                    </div>
                `;
                
                console.log('✅ HTML do dashboard inserido:', mainContent.innerHTML.substring(0, 100) + '...');
                
                // Atualizar reminders de forma segura
                try {
                    const now = new Date();
                    const currentYear = now.getFullYear();
                    const currentMonth = now.getMonth();
                    const envioImpostosDueDate = `15/${(currentMonth + 1).toString().padStart(2, '0')}`;
                    
                    let icmsDueDate = `20/${(currentMonth + 1).toString().padStart(2, '0')}`;
                    let dirbiDueDate = `20/${(currentMonth + 1).toString().padStart(2, '0')}`;
                    let dctfwebDueDate = formatDate(new Date(currentYear, currentMonth + 1, 0));
                    
                    // Tentar calcular datas de forma segura
                    try {
                        if (typeof getNextBusinessDay === 'function') {
                            icmsDueDate = getNextBusinessDay(currentYear, currentMonth, 20);
                        }
                    } catch (e) {
                        console.warn('⚠️ Erro ao calcular ICMS due date:', e);
                    }
                    
                    try {
                        // Usar a função getLastBusinessDayOfMonth com parâmetros (year, month)
                        // que retorna um objeto Date
                        if (typeof getLastBusinessDayOfMonth === 'function') {
                            const lastDay = getLastBusinessDayOfMonth(currentYear, currentMonth);
                            // Verificar se lastDay é um Date válido
                            if (lastDay instanceof Date && !isNaN(lastDay.getTime())) {
                                dctfwebDueDate = formatDate(lastDay);
                            } else {
                                // Fallback: usar último dia do mês formatado
                                dctfwebDueDate = formatDate(new Date(currentYear, currentMonth + 1, 0));
                            }
                        } else {
                            // Fallback se a função não estiver disponível
                            dctfwebDueDate = formatDate(new Date(currentYear, currentMonth + 1, 0));
                        }
                    } catch (e) {
                        console.warn('⚠️ Erro ao calcular DCTFWeb due date:', e);
                        // Fallback em caso de erro
                        try {
                            dctfwebDueDate = formatDate(new Date(currentYear, currentMonth + 1, 0));
                        } catch (fallbackError) {
                            dctfwebDueDate = `Último dia útil/${(currentMonth + 1).toString().padStart(2, '0')}`;
                        }
                    }
                    
                    console.log('📅 Datas calculadas:', {
                        envioImpostos: envioImpostosDueDate,
                        icms: icmsDueDate,
                        dirbi: dirbiDueDate,
                        dctfweb: dctfwebDueDate
                    });
                    
                    // Aguardar um pouco para garantir que os elementos de reminder estejam no DOM
                    setTimeout(() => {
                        try {
                            const envioImpostosElement = document.querySelector('.notification-envio .info small');
                            const icmsElement = document.querySelector('.notification-icms .info small');
                            const dirbiElement = document.querySelector('.notification-dirbi .info small');
                            const dctfwebElement = document.querySelector('.notification-dctfweb .info small');
                            
                            console.log('🔍 Elementos de reminder encontrados:', {
                                envioImpostos: !!envioImpostosElement,
                                icms: !!icmsElement,
                                dirbi: !!dirbiElement,
                                dctfweb: !!dctfwebElement
                            });
                            
                            if (envioImpostosElement) envioImpostosElement.textContent = `Vencimento: ${envioImpostosDueDate}`;
                            if (icmsElement) icmsElement.textContent = `Vencimento: ${icmsDueDate}`;
                            if (dirbiElement) dirbiElement.textContent = `Vencimento: ${dirbiDueDate}`;
                            if (dctfwebElement) dctfwebElement.textContent = `Vencimento: ${dctfwebDueDate}`;
                        } catch (e) {
                            console.warn('⚠️ Erro ao atualizar elementos de reminder:', e);
                        }
                    }, 200);
                } catch (e) {
                    console.warn('⚠️ Erro ao calcular datas de reminders:', e);
                }
                
                console.log('✅ Dashboard criado com sucesso!');
            } catch (error) {
                console.error('❌ Erro ao criar dashboard:', error);
                // Tentar criar conteúdo mínimo mesmo em caso de erro
                if (mainContent) {
                    mainContent.innerHTML = `
                        <h1>Dashboard</h1>
                        <div class="dashboard-grid">
                            <div class="box animate-section" style="animation-delay: 0s"></div>
                            <div class="box animate-section" style="animation-delay: 0.05s"></div>
                            <div class="box animate-section" style="animation-delay: 0.1s"></div>
                            <div class="box animate-section" style="animation-delay: 0.15s"></div>
                            <div class="box animate-section" style="animation-delay: 0.2s"></div>
                            <div class="box animate-section" style="animation-delay: 0.25s"></div>
                            <div class="box animate-section" style="animation-delay: 0.3s"></div>
                            <div class="box animate-section" style="animation-delay: 0.35s"></div>
                            <div class="box animate-section" style="animation-delay: 0.4s"></div>
                        </div>
                    `;
                }
            }

            // Card "Baixar NFCe" → abre a página dedicada de download em massa
            const baixarNfceBox = document.querySelector('.baixar-nfce-box');
            if (baixarNfceBox) {
                baixarNfceBox.addEventListener('click', () => navigateTo('baixar-nfce'));
            }
        } else if (page === 'analytics') {
            // Verificar tipo de usuário
            const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
            const currentUserData = registeredUsers.find(u => u.username === currentUser);
            
            // Usuário 'adm' pode acessar diretamente
            if (currentUser === 'adm') {
                loadAnalyticsContent(mainContent);
            }
            // Usuário com privilégios de administrador deve digitar senha
            else if (currentUserData && currentUserData.control === 'administrador') {
                showAnalyticsPasswordModal(mainContent);
            }
            // Usuário auxiliar não tem permissão
            else {
                const modal = document.createElement('div');
                modal.className = 'protected-modal animate-section';
                modal.innerHTML = `
                    <div class="modal-content">
                        <span class="material-icons-sharp">lock</span>
                        <p>Você não tem os Requisitos de Administrador</p>
                    </div>
                `;
                document.body.appendChild(modal);

                modal.addEventListener('click', (e) => {
                    if (e.target.classList.contains('protected-modal')) {
                        modal.classList.add('fade-out');
                        setTimeout(() => {
                            modal.remove();
                            navigateTo(lastPage);
                        }, 400);
                    }
                });
            }
        } 
        else if (page === 'apuration') {
            mainContent.innerHTML = `
                <h1>Apuration</h1>
                <div class="apuration-box animate-section" style="animation-delay: 0s; width: 100%; max-width: 800px; height: 400px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding);">
                </div>
            `;
        }
        else if (page === 'fortes-correction') {
            createFortesCorrectionPage(mainContent);
        }
        else if (page === 'nfe-cfe-comparison') {
            createNfeCfeComparisonPage(mainContent);
        }
        else if (page === 'baixar-nfce') {
            createBaixarNfcePage(mainContent);
        }
        else if (page === 'icms-withholding') {
            createIcmsWithholdingPage(mainContent);
        }
        else if (page === 'dirbi') {
            createDirbiPage(mainContent);
        }
        else if (page === 'sped') {
            createSpedPage(mainContent);
        }
        else if (page === 'settings') {
            mainContent.innerHTML = `
                <h1>Settings</h1>
                <div class="dashboard-grid">
                    <div class="box animate-section contributor-registration-box" style="animation-delay: 0s; cursor: pointer;">
                        <div class="box-content">
                            <div class="box-icon">
                                <span class="material-icons-sharp">business</span>
                            </div>
                            <div class="box-info">
                                <h3>Cadastrar Contribuinte</h3>
                                <p>Criar novo contribuinte no sistema</p>
                            </div>
                        </div>
                    </div>
                    <div class="box animate-section user-registration-box" style="animation-delay: 0.05s; cursor: pointer;">
                        <div class="box-content">
                            <div class="box-icon">
                                <span class="material-icons-sharp">person_add</span>
                            </div>
                            <div class="box-info">
                                <h3>Cadastrar Usuário</h3>
                                <p>Criar novo usuário no sistema</p>
                            </div>
                        </div>
                    </div>
                    <div class="box animate-section cest-box" style="animation-delay: 0.1s; cursor: pointer;">
                        <div class="box-content">
                            <div class="box-icon">
                                <span class="material-icons-sharp">inventory_2</span>
                            </div>
                            <div class="box-info">
                                <h3>Lista de CEST</h3>
                                <p>Gerenciar CEST vencidos para substituição no SPED</p>
                            </div>
                        </div>
                    </div>
                    <div class="box animate-section python-library-box" style="animation-delay: 0.15s; cursor: pointer;">
                        <div class="box-content">
                            <div class="box-icon">
                                <span class="material-icons-sharp">code</span>
                            </div>
                            <div class="box-info">
                                <h3>Biblioteca Python</h3>
                                <p>Arquivos de automação Python</p>
                            </div>
                        </div>
                    </div>
                    <div class="box animate-section cfop-cst-box" style="animation-delay: 0.2s; cursor: pointer;">
                        <div class="box-content">
                            <div class="box-icon">
                                <span class="material-icons-sharp">rule</span>
                            </div>
                            <div class="box-info">
                                <h3>Padrões CFOP &rarr; CST</h3>
                                <p>Definir CST e CST PIS/COFINS por CFOP (correção .fs)</p>
                            </div>
                        </div>
                    </div>
                    <div class="box animate-section" style="animation-delay: 0.25s"></div>
                    <div class="box animate-section" style="animation-delay: 0.3s"></div>
                    <div class="box animate-section" style="animation-delay: 0.35s"></div>
                    <div class="box animate-section" style="animation-delay: 0.4s"></div>
                </div>
            `;
            
            // Adicionar evento de clique ao box CEST
            const cestBox = document.querySelector('.cest-box');
            if (cestBox) {
                cestBox.addEventListener('click', () => {
                    showCestModal();
                });
            }
            
            // Adicionar evento de clique ao box de cadastro de usuário
            const userRegistrationBox = document.querySelector('.user-registration-box');
            if (userRegistrationBox) {
                userRegistrationBox.addEventListener('click', () => {
                    showUserRegistrationModal();
                });
            }
            
            // Adicionar evento de clique ao box de cadastro de contribuinte
            const contributorRegistrationBox = document.querySelector('.contributor-registration-box');
            if (contributorRegistrationBox) {
                contributorRegistrationBox.addEventListener('click', () => {
                    showContributorRegistrationModal();
                });
            }
            
            // Adicionar evento de clique ao box de biblioteca Python
            const pythonLibraryBox = document.querySelector('.python-library-box');
            if (pythonLibraryBox) {
                pythonLibraryBox.addEventListener('click', () => {
                    showPythonLibraryModal();
                });
            }

            // Adicionar evento de clique ao box de padrões CFOP → CST (Feature B)
            const cfopCstBox = document.querySelector('.cfop-cst-box');
            if (cfopCstBox) {
                cfopCstBox.addEventListener('click', () => {
                    showCfopCstModal();
                });
            }
        }
    }

    function loadAnalyticsContent(mainContent) {
        mainContent.innerHTML = `
            <h1>Analytics</h1>
            <div class="analyse animate-section">
                <div class="apuracao">
                    <div class="status">
                        <div class="info">
                            <h3>Apuration</h3>
                            <h1>81%</h1>
                        </div>
                        <div class="progresss">
                            <svg>
                                <circle cx="38" cy="38" r="36"></circle>
                            </svg>
                            <div class="percentage">
                                <p>+1%</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="progress-card visits" id="progress-card">
                    <div class="status">
                        <div class="info">
                            <h3>Progress</h3>
                            <h1>0%</h1>
                            <div class="dropdown-list" id="progress-list"></div>
                        </div>
                        <div class="progresss">
                            <svg>
                                <circle cx="38" cy="38" r="36"></circle>
                            </svg>
                            <div class="percentage">
                                <p>0%</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="assistants searches" id="assistants-card">
                    <div class="status">
                        <div class="info">
                            <h3>Assistants</h3>
                            <h1>0%</h1>
                            <div class="dropdown-list" id="assistants-list"></div>
                        </div>
                        <div class="progresss">
                            <svg>
                                <circle cx="38" cy="38" r="36"></circle>
                            </svg>
                            <div class="percentage">
                                <p>0%</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="new-users animate-section">
                <div class="user-list">
                    <div class="user">
                        <img src="assets/images/profile-2.png">
                        <h2>Josué</h2>
                        <p>54 Min Ago</p>
                    </div>
                    <div class="user">
                        <img src="assets/images/profile-3.png">
                        <h2>Moises</h2>
                        <p>3 Hours Ago</p>
                    </div>
                    <div class="user">
                        <img src="assets/images/profile-4.png">
                        <h2>Yohana</h2>
                        <p>6 Hours Ago</p>
                    </div>
                    <div class="user">
                        <img src="assets/images/plus.png">
                        <h2>More</h2>
                        <p>New User</p>
                    </div>
                </div>
            </div>
            <div class="recent-orders animate-section">
                <h2>Monthly Archives</h2>
                <table id="archives-table">
                    <thead>
                        <tr>
                            <th>Files</th>
                            <th>Contributor</th>
                            <th>Date</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                <a href="#" id="show-all-btn">Show All</a>
            </div>
        `;
        createDropdownItems(progressItems, 'progress-list', 'progress-card', 'visits');
        createDropdownItems(assistantsItems, 'assistants-list', 'assistants-card', 'searches');
        waitForOrders(() => populateArchivesTable());

        // Registrar eventos para "Show All" e fechamento fora da tabela
        const showAllBtn = document.querySelector('#show-all-btn');
        const recentOrders = document.querySelector('.recent-orders');
        if (showAllBtn && recentOrders) {
            showAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const closeBtn = document.createElement('button');
                closeBtn.className = 'close-btn';
                closeBtn.innerHTML = 'X';
                closeBtn.addEventListener('click', () => {
                    waitForOrders(() => populateArchivesTable(false));
                    recentOrders.classList.remove('expanded');
                    closeBtn.remove();
                    document.removeEventListener('click', outsideClickHandler);
                });
                recentOrders.appendChild(closeBtn);
                waitForOrders(() => populateArchivesTable(true));
                setTimeout(() => recentOrders.classList.add('expanded'), 10);

                // Adicionar listener para cliques fora da tabela
                const outsideClickHandler = (e) => {
                    if (!recentOrders.contains(e.target) && e.target.id !== 'show-all-btn' && e.target.className !== 'close-btn') {
                        if (recentOrders.classList.contains('expanded')) {
                            waitForOrders(() => populateArchivesTable(false));
                            recentOrders.classList.remove('expanded');
                            const existingCloseBtn = recentOrders.querySelector('.close-btn');
                            if (existingCloseBtn) existingCloseBtn.remove();
                            document.removeEventListener('click', outsideClickHandler);
                        }
                    }
                };
                document.addEventListener('click', outsideClickHandler);
            });
        } else {
            console.error('Erro: showAllBtn ou recentOrders não encontrados após renderizar Analytics');
        }
    }

    // Função para mostrar modal de senha de administrador para Analytics
    function showAnalyticsPasswordModal(mainContent) {
        const modal = document.createElement('div');
        modal.className = 'protected-modal animate-section';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="material-icons-sharp">lock</span>
                <h3>Acesso Restrito</h3>
                <p>Digite a senha do Administrador para acessar Analytics</p>
                <input type="password" id="analytics-password" placeholder="Senha do Administrador" autofocus>
                <p class="error-message" id="analytics-error" style="display: none; color: var(--color-danger); margin-top: 1rem; font-size: 0.9rem;"></p>
            </div>
        `;
        document.body.appendChild(modal);

        const passwordInput = document.getElementById('analytics-password');
        const errorMsg = document.getElementById('analytics-error');

        // Verifica senha do admin contra window.APP_CONFIG.adminPasswordHash (async, PBKDF2).
        async function checkAnalyticsAdminPassword() {
            const password = passwordInput.value.trim();
            if (!password) {
                errorMsg.textContent = 'Por favor, digite a senha.';
                errorMsg.style.display = 'block';
                return;
            }
            const adminHash = (window.APP_CONFIG && window.APP_CONFIG.adminPasswordHash) || null;
            if (!adminHash) {
                errorMsg.textContent = 'Admin não configurado (APP_CONFIG.adminPasswordHash).';
                errorMsg.style.display = 'block';
                return;
            }
            const verification = await window.verifyPassword(password, adminHash);
            if (verification.ok) {
                if (verification.upgrade) {
                    console.warn('🔐 Atualize APP_CONFIG.adminPasswordHash para:', verification.upgrade);
                }
                modal.classList.add('fade-out');
                setTimeout(() => {
                    modal.remove();
                    loadAnalyticsContent(mainContent);
                }, 400);
            } else {
                errorMsg.textContent = 'Senha incorreta. Tente novamente.';
                errorMsg.style.display = 'block';
                passwordInput.value = '';
                passwordInput.focus();
            }
        }

        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                checkAnalyticsAdminPassword();
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target.classList.contains('protected-modal')) {
                modal.classList.add('fade-out');
                setTimeout(() => {
                    modal.remove();
                    navigateTo(lastPage);
                }, 400);
            }
        });
    }

    const progressItems = [
        { name: 'Sitram', percentage: 75 },
        { name: 'ISS', percentage: 62 },
        { name: 'Doc', percentage: 88 },
        { name: 'NF-e Entrada', percentage: 45 },
        { name: 'NF-e Saída', percentage: 93 },
        { name: 'CF-e | NFC-e', percentage: 70 },
        { name: 'ICMS ST 1104', percentage: 55 },
        { name: 'MIT', percentage: 80 },
        { name: 'DIRBI', percentage: 67 },
        { name: 'EFD Fiscal', percentage: 85 },
        { name: 'EFD Contribuições', percentage: 60 }
    ];
    const assistantsItems = [
        { name: 'Josué', percentage: 78 },
        { name: 'Moises', percentage: 65 },
        { name: 'Yohana', percentage: 90 }
    ];

    function createDropdownItems(items, listId, cardId, circleClass) {
        const list = document.getElementById(listId);
        if (!list) return;
        const ul = document.createElement('ul');
        const title = document.querySelector(`#${cardId} h3`);
        
        items.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item.name;
            li.addEventListener('click', () => {
                document.querySelector(`#${cardId} h3`).textContent = item.name;
                document.querySelector(`#${cardId} h1`).textContent = `${item.percentage}%`;
                document.querySelector(`#${cardId} .percentage p`).textContent = `${item.percentage}%`;
                const circle = document.querySelector(`#${cardId} svg circle`);
                circle.style.strokeDashoffset = `calc(226 - (226 * ${item.percentage} / 100))`;
                list.classList.remove('show');
            });
            ul.appendChild(li);
        });
        list.appendChild(ul);

        title.addEventListener('click', (e) => {
            list.classList.toggle('show');
            const rect = title.getBoundingClientRect();
            const cardRect = document.querySelector(`#${cardId}`).getBoundingClientRect();
            let top = rect.bottom - cardRect.top + 2;
            let left = rect.left - cardRect.left;
            const dropdownWidth = 120;
            if (left + dropdownWidth > cardRect.right - cardRect.left) {
                left = (cardRect.right - cardRect.left) - dropdownWidth - 5;
            }
            if (left < 0) {
                left = 5;
            }
            list.style.top = `${top}px`;
            list.style.left = `${left}px`;
        });

        document.addEventListener('click', (e) => {
            if (!list.contains(e.target) && !title.contains(e.target)) {
                list.classList.remove('show');
            }
        });
    }

    function waitForOrders(callback, maxAttempts = 10, interval = 100) {
        let attempts = 0;
        const checkOrders = setInterval(() => {
            if (window.Orders && Array.isArray(window.Orders)) {
                clearInterval(checkOrders);
                callback();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkOrders);
                console.error('Erro: window.Orders não foi definido após várias tentativas');
                const tbody = document.querySelector('#archives-table tbody');
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="4">Dados indisponíveis</td></tr>';
                }
            }
            attempts++;
        }, interval);
    }

    function populateArchivesTable(allItems = false) {
        const tbody = document.querySelector('#archives-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!window.Orders || !Array.isArray(window.Orders)) {
            console.error('Erro: window.Orders não está definido ou não é um array');
            tbody.innerHTML = '<tr><td colspan="4">Dados indisponíveis</td></tr>';
            return;
        }
        const ordersToShow = allItems ? window.Orders : window.Orders.slice(0, 3);
        ordersToShow.forEach(order => {
            const tr = document.createElement('tr');
            const trContent = `
                <td>${order.productName}</td>
                <td>${order.productNumber}</td>
                <td>${order.paymentStatus}</td>
                <td class="${order.status === 'Divergence' ? 'danger' : order.status === 'Completed' ? 'success' : 'primary'}">${order.status}</td>
            `;
            tr.innerHTML = trContent;
            tbody.appendChild(tr);
        });
    }

    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.getAttribute('data-page');
            navigateTo(page);
        });
    });

    // Função para mostrar modal de CEST
    function showCestModal() {
        // Verificar se o usuário atual é administrador
        const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        const currentUserData = registeredUsers.find(u => u.username === window.currentUser);
        const isAdmin = window.currentUser === 'adm' || (currentUserData && currentUserData.control === 'administrador');
        
        if (!isAdmin) {
            alert('Apenas administradores podem acessar a Lista de CEST.');
            return;
        }
        
        // Remover modal existente se houver
        const existingModal = document.querySelector('.cest-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Criar modal
        const modal = document.createElement('div');
        modal.className = 'cest-modal';
        
        // Verificar se está no modo escuro e adicionar classe ao modal
        if (document.body.classList.contains('dark-mode-variables')) {
            modal.classList.add('dark-mode-variables');
        }
        
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Lista de CEST</h2>
                    <button class="close-btn" onclick="closeCestModal()">
                        <span class="material-icons-sharp">close</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="cest-container">
                        <div class="cest-column expired-column" style="grid-column: 1 / -1;">
                            <div class="cest-section">
                                <h3 style="color: var(--color-danger, #c0392b);">CEST Vencidos (substituição automática no SPED)</h3>
                                <p style="font-size: 0.85rem; color: var(--color-info-dark, #666); margin-bottom: 0.5rem;">
                                    Códigos CEST listados aqui serão substituídos automaticamente durante o ajuste SPED:
                                    se a descrição do produto contiver "água" (qualquer grafia), vira <strong>0300300</strong>;
                                    caso contrário, vira <strong>2899900</strong>.
                                </p>
                                <div class="input-group">
                                    <input type="text" id="cest-vencidos-input" placeholder="Digite o código CEST vencido (ex: 0100100)" maxlength="20">
                                    <button onclick="addCestVencido()" class="add-btn">
                                        <span class="material-icons-sharp">add</span>
                                    </button>
                                </div>
                                <div class="product-list" id="cest-vencidos-list">
                                    <!-- CEST vencidos carregados aqui -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button onclick="exportCestBackup()" class="backup-btn export-backup-btn">
                        <span class="material-icons-sharp">download</span>
                        Exportar Backup
                    </button>
                    <button onclick="importCestBackup()" class="backup-btn import-backup-btn">
                        <span class="material-icons-sharp">upload</span>
                        Importar Backup
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Sincronizar CEST do Supabase e carregar dados (incluindo CEST vencidos).
        if (window.supabaseSync && window.supabaseSync.isConfigured()) {
            window.supabaseSync.syncAll(['cest_vencidos']).then(() => loadCestData()).catch(() => loadCestData());
        } else {
            loadCestData();
        }
        
        // Adicionar evento para fechar ao clicar fora
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                saveCestData(); // Salvar automaticamente antes de fechar
                closeCestModal();
            }
        });
        
        // Adicionar evento de Enter para o input de CEST vencidos
        const inputVencidos = modal.querySelector('#cest-vencidos-input');
        if (inputVencidos) {
            inputVencidos.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addCestVencido();
                }
            });
        }
    }


    document.addEventListener('DOMContentLoaded', () => {
        console.log('index.js carregado');
    });
    
    // Expor navigateTo globalmente ANTES de qualquer tentativa de sobrescrever
    window.navigateTo = navigateTo;
})();

//---------------------------------- FUNÇÕES CEST GLOBAIS --------------------------------------//

/**
 * Normaliza string removendo diacríticos e baixando caixa.
 * "Água Mineral" → "agua mineral", "AGÛA" → "agua".
 * @param {string} s
 * @returns {string}
 */
function normalizarTextoSemAcento(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Verifica se a descrição do produto contém a palavra "agua" (qualquer grafia).
 * Match por palavra inteira para evitar falsos positivos ("aguardente", "paraguai").
 * @param {string} descricao
 * @returns {boolean}
 */
function descricaoContemAgua(descricao) {
    const normalizado = normalizarTextoSemAcento(descricao);
    return /\bagua\b/.test(normalizado);
}

/**
 * Sanitiza um código CEST: só dígitos, máximo 20 chars.
 * @param {string} raw
 * @returns {string}
 */
function sanitizarCodigoCest(raw) {
    return String(raw || '').replace(/\D/g, '').slice(0, 20);
}

// Adiciona um novo CEST vencido na lista (UI + persistência).
function addCestVencido() {
    const input = document.getElementById('cest-vencidos-input');
    const list = document.getElementById('cest-vencidos-list');
    if (!input || !list) return;

    const codigo = sanitizarCodigoCest(input.value);
    if (!codigo) {
        alert('Informe um código CEST válido (apenas dígitos).');
        return;
    }

    // Evita duplicatas.
    const existentes = Array.from(list.querySelectorAll('.product-name')).map(el => el.textContent);
    if (existentes.includes(codigo)) {
        alert(`CEST ${codigo} já está na lista de vencidos.`);
        input.value = '';
        return;
    }

    const item = document.createElement('div');
    item.className = 'product-item';
    item.innerHTML = `
        <span class="product-name">${codigo}</span>
        <button onclick="removeCestVencido(this)" class="remove-btn">
            <span class="material-icons-sharp">delete</span>
        </button>
    `;
    list.appendChild(item);
    input.value = '';
    saveCestData();
}

function removeCestVencido(button) {
    const item = button.closest('.product-item');
    if (item) item.remove();
    saveCestData();
}

// Função para fechar modal
function closeCestModal() {
    const modal = document.querySelector('.cest-modal');
    if (modal) {
        saveCestData(); // Salvar automaticamente antes de fechar
        modal.remove();
    }
}

// Função para adicionar produto CEST
function addCestProduct(cestCode) {
    const inputId = `cest-${cestCode}-input`;
    const listId = `cest-${cestCode}-list`;
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    
    if (!input || !list) return;
    
    const inputValue = input.value.trim();
    if (!inputValue) {
        alert('Por favor, digite o nome do produto.');
        return;
    }
    
    // Separar produtos por ponto e vírgula (;) e limpar espaços
    const productNames = inputValue.split(';').map(name => name.trim()).filter(name => name.length > 0);
    
    if (productNames.length === 0) {
        alert('Por favor, digite pelo menos um produto válido.');
        return;
    }
    
    // Verificar produtos existentes
    const existingProducts = Array.from(list.querySelectorAll('.product-item')).map(item => 
        item.querySelector('.product-name').textContent
    );
    
    let addedCount = 0;
    let duplicateCount = 0;
    
    // Processar cada produto
    productNames.forEach(productName => {
        if (existingProducts.includes(productName)) {
            duplicateCount++;
            return; // Pular produtos duplicados
        }
        
        // Criar item do produto
        const productItem = document.createElement('div');
        productItem.className = 'product-item';
        productItem.innerHTML = `
            <span class="product-name">${productName}</span>
            <button onclick="removeCestProduct('${cestCode}', this)" class="remove-btn">
                <span class="material-icons-sharp">delete</span>
            </button>
        `;
        
        list.appendChild(productItem);
        addedCount++;
    });
    
    // Limpar input
    input.value = '';
    
    // Salvar automaticamente se houver produtos adicionados
    if (addedCount > 0) {
        saveCestData();
    }
}

// Função para remover produto CEST
function removeCestProduct(cestCode, button) {
    const productItem = button.closest('.product-item');
    if (productItem) {
        productItem.remove();
        saveCestData();
    }
}

// Função para carregar dados CEST
function loadCestData() {
    const cestVencidos = JSON.parse(localStorage.getItem('cest_vencidos') || '[]');

    const listVencidos = document.getElementById('cest-vencidos-list');
    if (listVencidos) {
        listVencidos.innerHTML = '';
        cestVencidos.forEach(codigo => {
            const item = document.createElement('div');
            item.className = 'product-item';
            item.innerHTML = `
                <span class="product-name">${codigo}</span>
                <button onclick="removeCestVencido(this)" class="remove-btn">
                    <span class="material-icons-sharp">delete</span>
                </button>
            `;
            listVencidos.appendChild(item);
        });
    }
}

// Função para salvar dados CEST (localStorage + Supabase)
async function saveCestData() {
    let cestVencidos = [];

    const listVencidos = document.getElementById('cest-vencidos-list');
    if (listVencidos) {
        cestVencidos = Array.from(listVencidos.querySelectorAll('.product-name'))
            .map(item => sanitizarCodigoCest(item.textContent))
            .filter(Boolean);
        localStorage.setItem('cest_vencidos', JSON.stringify(cestVencidos));
    }

    if (window.supabaseSync && window.supabaseSync.isConfigured() && listVencidos) {
        try {
            // Merge append-only (Fase 4): nunca sobrescreve cegamente o array da nuvem.
            if (window.supabaseSync.saveCestVencidos) {
                await window.supabaseSync.saveCestVencidos(cestVencidos);
                // localStorage agora reflete o merge (pode incluir itens de outras máquinas).
                loadCestData();
            } else {
                await saveDataSync('cest_vencidos', cestVencidos);
            }
        } catch (e) {
            console.warn('Erro ao sincronizar CEST com Supabase:', e);
        }
    }
    updateCestArrays();
}

// Função para atualizar arrays globais de CEST
function updateCestArrays() {
    const cestVencidos = JSON.parse(localStorage.getItem('cest_vencidos') || '[]');
    window.cestsVencidos = cestVencidos.map(c => sanitizarCodigoCest(c)).filter(Boolean);
}

//---------------------------------- CADASTRO CFOP → CST (Feature B) --------------------------------------//
//
// Mapa compartilhado CFOP → { cst, pis } armazenado no Supabase (KV em system_data, chave
// `cfop_cst_patterns`) via saveDataSync/loadDataSync — mesmo backend dos demais cadastros,
// sem tabela nem migration novas. Consumido pela correção do .fs (Feature A): por CFOP do
// produto, seta CST e os 2 campos CST-PIS/COFINS. Estratégia de escrita: last-write-wins
// (config pequena, editada raramente por admin — não precisa do merge append-only do CEST).

const CFOP_CST_KEY = 'cfop_cst_patterns';

/** Só dígitos, limitado a `max` chars. */
function _sanitizeDigits(v, max) {
    return String(v == null ? '' : v).replace(/\D/g, '').slice(0, max);
}

/** Lê o mapa do localStorage (cache local do KV). Retorna objeto {cfop:{cst,pis}}. */
function getCfopCstPatterns() {
    try {
        const obj = JSON.parse(localStorage.getItem(CFOP_CST_KEY) || '{}');
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch (e) {
        return {};
    }
}

function showCfopCstModal() {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUserData = registeredUsers.find(u => u.username === window.currentUser);
    const isAdmin = window.currentUser === 'adm' || (currentUserData && currentUserData.control === 'administrador');
    if (!isAdmin) {
        alert('Apenas administradores podem acessar o cadastro CFOP → CST.');
        return;
    }

    const existingModal = document.querySelector('.cfop-cst-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'cest-modal cfop-cst-modal'; // reusa o overlay/estilo do modal CEST
    if (document.body.classList.contains('dark-mode-variables')) {
        modal.classList.add('dark-mode-variables');
    }

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Padrões CFOP → CST</h2>
                <button class="close-btn" onclick="closeCfopCstModal()">
                    <span class="material-icons-sharp">close</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="cest-container">
                    <div class="cest-column" style="grid-column: 1 / -1;">
                        <div class="cest-section">
                            <p style="font-size: 0.85rem; color: var(--color-info-dark, #666); margin-bottom: 0.75rem;">
                                Por CFOP, define o <strong>CST</strong> e o <strong>CST PIS/COFINS</strong> aplicados
                                automaticamente na correção do arquivo .fs. Adicionar um CFOP já existente
                                <strong>sobrescreve</strong> (edição). Compartilhado entre todas as máquinas.
                            </p>
                            <div class="input-group" style="gap: 0.5rem; flex-wrap: wrap;">
                                <input type="text" id="cfop-cst-cfop" placeholder="CFOP (ex: 1403)" maxlength="4" inputmode="numeric" style="max-width: 140px;">
                                <input type="text" id="cfop-cst-cst" placeholder="CST (ex: 90)" maxlength="3" inputmode="numeric" style="max-width: 130px;">
                                <input type="text" id="cfop-cst-pis" placeholder="CST PIS/COFINS (ex: 73)" maxlength="2" inputmode="numeric" style="max-width: 200px;">
                                <button onclick="addCfopCstPattern()" class="add-btn">
                                    <span class="material-icons-sharp">add</span>
                                </button>
                            </div>
                            <div class="product-list" id="cfop-cst-list">
                                <!-- padrões carregados aqui -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    if (window.supabaseSync && window.supabaseSync.isConfigured()) {
        window.supabaseSync.syncAll([CFOP_CST_KEY]).then(() => loadCfopCstData()).catch(() => loadCfopCstData());
    } else {
        loadCfopCstData();
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCfopCstModal();
    });

    // Enter em qualquer um dos inputs adiciona.
    ['cfop-cst-cfop', 'cfop-cst-cst', 'cfop-cst-pis'].forEach(id => {
        const el = modal.querySelector('#' + id);
        if (el) el.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addCfopCstPattern(); }
        });
    });
}

function closeCfopCstModal() {
    const modal = document.querySelector('.cfop-cst-modal');
    if (modal) modal.remove();
}

/** Renderiza a lista a partir do mapa local e injeta nas linhas. */
function loadCfopCstData() {
    const list = document.getElementById('cfop-cst-list');
    if (!list) return;
    const map = getCfopCstPatterns();
    const cfops = Object.keys(map).sort();
    list.innerHTML = '';
    if (cfops.length === 0) {
        list.innerHTML = '<p style="color: var(--color-info-dark, #666); padding: 0.5rem;">Nenhum padrão cadastrado ainda.</p>';
        return;
    }
    cfops.forEach(cfop => {
        const entry = map[cfop] || {};
        const item = document.createElement('div');
        item.className = 'product-item';
        item.innerHTML = `
            <span class="product-name"><strong>${cfop}</strong> &rarr; CST ${entry.cst || '—'} &middot; PIS/COFINS ${entry.pis || '—'}</span>
            <button onclick="removeCfopCstPattern('${cfop}')" class="remove-btn">
                <span class="material-icons-sharp">delete</span>
            </button>
        `;
        list.appendChild(item);
    });
}

/** Upsert (adicionar/editar) um padrão e persistir. */
function addCfopCstPattern() {
    const cfopEl = document.getElementById('cfop-cst-cfop');
    const cstEl = document.getElementById('cfop-cst-cst');
    const pisEl = document.getElementById('cfop-cst-pis');
    if (!cfopEl || !cstEl || !pisEl) return;

    const cfop = _sanitizeDigits(cfopEl.value, 4);
    const cst = _sanitizeDigits(cstEl.value, 3);
    const pis = _sanitizeDigits(pisEl.value, 2);

    if (cfop.length !== 4) { alert('CFOP deve ter 4 dígitos (ex: 1403).'); return; }
    if (!cst) { alert('Informe o CST (ex: 90).'); return; }
    if (!pis) { alert('Informe o CST PIS/COFINS (ex: 73).'); return; }

    const map = getCfopCstPatterns();
    map[cfop] = { cst, pis };
    cfopEl.value = ''; cstEl.value = ''; pisEl.value = '';
    saveCfopCstData(map);
}

function removeCfopCstPattern(cfop) {
    const map = getCfopCstPatterns();
    delete map[cfop];
    saveCfopCstData(map);
}

/** Persiste o mapa (localStorage + Supabase KV, last-write-wins) e re-renderiza. */
async function saveCfopCstData(map) {
    localStorage.setItem(CFOP_CST_KEY, JSON.stringify(map));
    window.cfopCstPatterns = map;
    loadCfopCstData();
    if (typeof saveDataSync === 'function') {
        try { await saveDataSync(CFOP_CST_KEY, map); }
        catch (e) { console.warn('Erro ao sincronizar CFOP→CST com Supabase:', e); }
    }
}

// Função para exportar backup dos CEST
function exportCestBackup() {
    try {
        const cestVencidos = JSON.parse(localStorage.getItem('cest_vencidos') || '[]');

        const backupData = {
            version: '2.0',
            exportDate: new Date().toISOString(),
            cestVencidos: cestVencidos,
            totalProducts: cestVencidos.length
        };
        
        const dataStr = JSON.stringify(backupData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `cest_backup_${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        
        // Backup exportado silenciosamente
        
    } catch (error) {
        console.error('Erro ao exportar backup:', error);
        alert('Erro ao exportar backup. Verifique o console para mais detalhes.');
    }
}

// Função para importar backup dos CEST
function importCestBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    
    input.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const backupData = JSON.parse(e.target.result);
                
                // Validar estrutura do backup (aceita backups novos só com vencidos;
                // backups antigos também tinham o campo cestVencidos).
                if (!Array.isArray(backupData.cestVencidos)) {
                    alert('Arquivo de backup inválido. Estrutura de dados incorreta.');
                    return;
                }

                // Carregar códigos existentes.
                const existingCestVencidos = JSON.parse(localStorage.getItem('cest_vencidos') || '[]');

                // Merge sem duplicatas.
                const newCestVencidos = backupData.cestVencidos
                    .map(c => sanitizarCodigoCest(c))
                    .filter(c => c && !existingCestVencidos.includes(c));

                const finalCestVencidos = [...existingCestVencidos, ...newCestVencidos];

                localStorage.setItem('cest_vencidos', JSON.stringify(finalCestVencidos));
                if (window.supabaseSync && window.supabaseSync.isConfigured()) {
                    saveDataSync('cest_vencidos', finalCestVencidos).catch(() => {});
                }
                
                // Atualizar arrays globais
                updateCestArrays();
                
                // Recarregar dados no modal
                loadCestData();
                
                // Mostrar relatório de importação apenas se houver produtos novos
                const totalNew = newCest0300300.length + newCest2899900.length;
                if (totalNew > 0) {
                    showImportReport(newCest0300300, newCest2899900, backupData);
                }
                
            } catch (error) {
                console.error('Erro ao importar backup:', error);
                alert('Erro ao importar backup. Arquivo inválido ou corrompido.');
            }
        };
        
        reader.readAsText(file);
    };
    
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
}

// Função para mostrar relatório de importação
function showImportReport(newCest0300300, newCest2899900, backupData) {
    const totalNew = newCest0300300.length + newCest2899900.length;
    const totalExisting = (backupData.cest0300300.length - newCest0300300.length) + 
                         (backupData.cest2899900.length - newCest2899900.length);
    
    // Criar modal de relatório
    const reportModal = document.createElement('div');
    reportModal.className = 'import-report-modal';
    
    // Verificar se está no modo escuro
    if (document.body.classList.contains('dark-mode-variables')) {
        reportModal.classList.add('dark-mode-variables');
    }
    
    reportModal.innerHTML = `
        <div class="report-modal-content">
            <div class="report-header">
                <div class="report-icon">
                    <span class="material-icons-sharp">check_circle</span>
                </div>
                <h2>Backup Importado com Sucesso!</h2>
                <button class="close-report-btn" onclick="closeImportReport()">
                    <span class="material-icons-sharp">close</span>
                </button>
            </div>
            <div class="report-body">
                <div class="report-summary">
                    <div class="summary-item">
                        <span class="summary-number">${totalNew}</span>
                        <span class="summary-label">Produtos Novos Adicionados</span>
                    </div>
                </div>
                <div class="report-details">
                    <div class="detail-section">
                        <h3>CEST 0300300</h3>
                        <div class="detail-content">
                            <span class="detail-count">${newCest0300300.length}</span>
                            <span class="detail-text">produtos adicionados</span>
                        </div>
                        ${newCest0300300.length > 0 ? `
                            <div class="product-list">
                                ${newCest0300300.map(product => `<div class="product-item">• ${product}</div>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="detail-section">
                        <h3>CEST 2899900</h3>
                        <div class="detail-content">
                            <span class="detail-count">${newCest2899900.length}</span>
                            <span class="detail-text">produtos adicionados</span>
                        </div>
                        ${newCest2899900.length > 0 ? `
                            <div class="product-list">
                                ${newCest2899900.map(product => `<div class="product-item">• ${product}</div>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
                ${totalExisting > 0 ? `
                    <div class="report-footer">
                        <div class="existing-info">
                            <span class="material-icons-sharp">info</span>
                            <span>${totalExisting} produtos já existiam e foram ignorados</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
    
    document.body.appendChild(reportModal);
    
    // Fechar ao clicar fora
    reportModal.addEventListener('click', (e) => {
        if (e.target === reportModal) {
            closeImportReport();
        }
    });
}

// Função para fechar relatório de importação
function closeImportReport() {
    const reportModal = document.querySelector('.import-report-modal');
    if (reportModal) {
        reportModal.remove();
    }
}

//---------------------------------- FIM FUNÇÕES CEST GLOBAIS --------------------------------------//
//---------------------------------- FIM SISTEMA PRINCIPAL --------------------------------------//
//---------------------------------------- APURATION --------------------------------------------//
//---------------------------------------- FIM APURATION ----------------------------------------//
//--------------------------------------- FORTES CORRETION --------------------------------------//
//------------------------------------- FIM FORTES CORRETION ------------------------------------//

//--------------------------------------- ICMS Withholding --------------------------------------//

let icmsXmlFiles = [];
let icmsModeloWorkbook = null;
let icmsModeloExcelJS = null; // Workbook do ExcelJS para preservar formatações
let icmsModeloBuffer = null;      // ArrayBuffer cru do modelo (recarregado por empresa)
let icmsModeloSelecionado = null; // chave do ICMS_MODELOS atualmente carregado

// Modelos de retenção ICMS ST. Apenas 'mercadinho' tem a regra de classificação
// (CST/CSOSN → aba) implementada. Os demais podem ser selecionados na UI, mas exibem
// aviso de pendência de configuração e não processam até o contador fornecer as regras.
const ICMS_MODELOS = {
    mercadinho: { nome: 'Mercadinho', path: 'assets/js/ICMS ST - Mercadinho.xlsx', funcional: true },
    deposito: { nome: 'Depósito', path: 'assets/js/ICMS ST - Deposito.xlsx', funcional: false },
    deposito_regime_especial: { nome: 'Depósito Regime Especial', path: 'assets/js/ICMS ST - Deposito Regime Especial.xlsx', funcional: false },
    frigorifico: { nome: 'Frigorífico', path: 'assets/js/ICMS ST - Frigorifico.xlsx', funcional: false },
};

// ==================== SISTEMA DE SINCRONIZAÇÃO COMPARTILHADA ====================
/**
 * Funções helper para sincronização de dados entre múltiplos PCs
 * Usa Supabase quando configurado, localStorage como fallback
 */

// Função para salvar dados com sincronização automática
async function saveDataSync(key, data) {
    // Salvar localmente primeiro (cache rápido)
    try {
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem(`${key}_updated`, Date.now().toString());
    } catch (e) {
        console.error(`Erro ao salvar ${key} no localStorage:`, e);
    }

    // Sincronizar com nuvem se disponível
    if (window.supabaseSync && window.supabaseSync.isConfigured()) {
        try {
            await window.supabaseSync.save(key, data);
        } catch (e) {
            console.warn(`⚠️ Erro ao sincronizar ${key} com nuvem:`, e);
        }
    }
}

// Função para carregar dados com sincronização automática
async function loadDataSync(key, defaultValue = null) {
    // Tentar carregar da nuvem primeiro se disponível
    if (window.supabaseSync && window.supabaseSync.isConfigured()) {
        try {
            const cloudData = await window.supabaseSync.load(key, defaultValue);
            if (cloudData !== defaultValue) {
                return cloudData;
            }
        } catch (e) {
            console.warn(`⚠️ Erro ao carregar ${key} da nuvem:`, e);
        }
    }

    // Fallback: carregar do localStorage
    try {
        const localData = localStorage.getItem(key);
        if (localData) {
            return JSON.parse(localData);
        }
    } catch (e) {
        console.error(`Erro ao carregar ${key} do localStorage:`, e);
    }

    return defaultValue;
}

// Função para sincronizar dados no início da aplicação
async function initializeSync() {
    if (window.supabaseSync && window.supabaseSync.isConfigured()) {
        console.log('🔄 Iniciando sincronização de dados...');
        try {
            // CRÍTICO: Carregar dados do Supabase mesmo se localStorage estiver vazio
            // Isso garante que usuários cadastrados possam fazer login em nova máquina
            const registeredUsers = await loadDataSync('registeredUsers', []);
            console.log(`📥 Carregados ${registeredUsers.length} usuários na inicialização`);
            
            // Sincronizar dados principais (bidirecional)
            await window.supabaseSync.syncAll(['users', 'registeredUsers', 'contributorContacts', 'cest_vencidos', 'pythonFilesList']);
            console.log('✅ Sincronização inicial concluída!');
            
            // Verificar novamente após sincronização
            const registeredUsersAfterSync = await loadDataSync('registeredUsers', []);
            console.log(`📥 Após sincronização: ${registeredUsersAfterSync.length} usuários disponíveis`);
        } catch (e) {
            console.warn('⚠️ Erro na sincronização inicial:', e);
            // Continuar mesmo com erro - sistema pode funcionar offline
        }
    } else {
        console.log('ℹ️ Supabase não configurado, usando apenas localStorage');
    }
}

// Configurações
const ICMS_CONFIG = {
    NS: { nfe: "http://www.portalfiscal.inf.br/nfe" },
    GRUPOS: {
        "1,54%": { cst: new Set(["20"]), csosn: new Set() },
        "4%": { cst: new Set(["00"]), csosn: new Set() },
        "7%": { cst: new Set(), csosn: new Set(["101", "102"]) }
    },
    UF_VALIDO: "23",
    CFOP_VALIDOS: new Set(["5101", "5102", "5103", "5105", "5910"]),
    MAPEAMENTO_ABAS: {
        "1,54%": { nome: "Aliquota 1,54%", celula: "D2" },
        "4%": { nome: "Aliquota 4%", celula: "D2" },
        "7%": { nome: "Aliquota 7%", celula: "D2" }
    }
};

// Biblioteca de razões sociais (normalização)
const BIBLIOTECA_RAZOES = {
    "A & R COMERCIAL DE ALIMENTOS LTDA": "A & R COMERCIAL DE ALIMENTOS LTDA",
    "A SEVERIANO SUPERMERCADOS LTDA": "A SEVERIANO SUPERMERCADOS LTDA",
    "AGROVETERINARIA NOGUEIRA LTDA": "AGROVETERINARIA NOGUEIRA LTDA",
    "ALFREDO SUPERMERCADO LTDA": "ALFREDO SUPERMERCADO LTDA",
    "BML DISTRIBUIDORA DE CARNES E FRIOS LTDA": "BML DISTRIBUIDORA DE CARNES E FRIOS LTDA",
    "E L DE OLIVEIRA JUNIOR ME": "COMERCIAL VESG ATACAREJO LTDA",
    "E MOREIRA COMERCIO DE MATERIAL ELETRONICO LTDA": "E MOREIRA COMERCIO DE MATERIAL ELETRONICO LTDA",
    "M CLARA SUPERMERCADO LTDA": "E F DE LUNA SUPERMERCADO LTDA",
    "EDIVANIA SANTIAGO DA SILVA ME": "EDIVANIA SANTIAGO DA SILVA",
    "ELAINE KEILLY OLIVEIRA MOURA DA SILVA": "ELAINE KEILLY OLIVEIRA MOURA DA SILVA ME",
    "FRANCISCO HELIO CARNEIRO MERCEARIA EPP": "F H CARNEIRO & H LOBAO LTDA",
    "FRANCISCO MONTEIRO BARBOSA": "FRANCISCO MONTEIRO BARBOSA",
    "A M HOLANDA DIAS ME": "FRIGORIFICO PONTO DO CARNEIRO ATACADO E VAREJO LTDA MATRIZ",
    "G F DE LIMA ME": "G F DE LIMA",
    "JOISILANE DA SILVA OLIVEIRA ME": "JOISILANE DA SILVA OLIVEIRA",
    "JUMARIO RODRIGUES DOS SANTOS": "JUMARIO RODRIGUES DOS SANTOS",
    "K PRAXEDES LOPES MERC": "K PRAXEDES LOPES MERCEARIA",
    "LOJAO DAS VARIEDADES EIRELI": "LOJAO DAS VARIEDADES EIRELI",
    "M L CAVALCANTE COMERCIO VAREJISTA LTDA ME": "M L CAVALCANTE COMERCIO VAREJISTA LTDA",
    "MERCADINHO AMADOR LTDA": "MERCADINHO AMADOR LTDA",
    "IRACY QUEIROZ RAMOS": "MERCADINHO PAIXAO LTDA",
    "MERCANTIL IDEAL COMERCIO VAREJISTA LTDA": "MERCANTIL IDEAL COMERCIO VAREJISTA LTDA",
    "MILANI SOARES DE ALENCAR EPP": "SOARES & PEROBA COMERCIO VAREJISTA LTDA",
    "SUPER JOFI COMECIO E VAREJISTA LIMITADA": "SUPER JOFI COMECIO E VAREJISTA LIMITADA",
    "SUPER NORONHA LTDA": "SUPER NORONHA LTDA",
    "TAMIRIS DA SILVA MOURA ME": "TAMIRIS DA SILVA MOURA",
    "ZILMA PORTELA PARENTE DE ARAUJO ME": "ZILMA PORTELA PARENTE DE ARAUJO",
    "MERCADINHO ADAIRTON LTDA": "MERCADINHO ADAIRTON LTDA"
};

function createIcmsWithholdingPage(mainContent) {
    const icmsModeloOptions = Object.entries(ICMS_MODELOS)
        .map(([k, v]) => `<option value="${k}">${escapeHtml(v.nome)}${v.funcional ? '' : ' — em configuração'}</option>`)
        .join('');
    mainContent.innerHTML = `
        <h1>ICMS Withholding</h1>
        <div class="icms-withholding-container" style="display: flex; flex-direction: column; gap: 1.6rem; max-width: 1200px; margin: 0 auto; padding: 2rem;">
            <!-- Seleção do Modelo de Retenção -->
            <div class="box animate-section" style="animation-delay: 0s; width: 100%; max-width: 800px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding);">
                <label for="icms-modelo-select" style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--color-dark);">Modelo de Retenção ICMS ST:</label>
                <select id="icms-modelo-select" style="width: 100%; max-width: 400px; padding: 0.5rem 0.75rem; border: 1px solid var(--color-info-light, #ccc); border-radius: var(--border-radius-1); font-family: 'Poppins', sans-serif; font-size: 0.9rem; background: var(--color-white); color: var(--color-dark); cursor: pointer;">
                    <option value="">— Selecione o modelo —</option>
                    ${icmsModeloOptions}
                </select>
                <p id="icms-modelo-info" style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--color-dark-variant);">
                    <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem;">info</span>
                    Selecione um modelo para começar.
                </p>
            </div>
            
            <!-- Box de Upload de XMLs -->
            <div class="box animate-section icms-xml-box" style="animation-delay: 0s; width: 100%; max-width: 800px; height: 300px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center;" id="icms-xml-box">
                <span class="material-icons-sharp" style="font-size: 3rem; color: var(--color-primary); margin-bottom: 1rem;">cloud_upload</span>
                <span class="box-label" id="icms-xml-label" style="font-size: 1.2rem; font-weight: 600; color: var(--color-dark); margin-bottom: 0.5rem;">Arraste e solte os XML (ou .zip) aqui</span>
                <span style="font-size: 0.9rem; color: var(--color-dark-variant);">múltiplas empresas são separadas por CNPJ — uma planilha por empresa (zip se houver mais de uma)</span>
                <input type="file" id="icms-xml-input" accept=".xml,.zip" multiple style="display: none;">
                <div id="icms-xml-info" style="display: none; margin-top: 1rem; text-align: center; max-width: 100%; overflow-x: auto;">
                    <span class="material-icons-sharp" style="font-size: 2rem; color: var(--color-success);">check_circle</span>
                    <p id="icms-xml-count" style="margin-top: 0.5rem; color: var(--color-success); font-weight: 500;"></p>
                    <div id="icms-xml-list" style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--color-dark-variant); max-height: 100px; overflow-y: auto;"></div>
                </div>
            </div>
            
            <!-- Botão de Processar -->
            <div style="width: 100%; max-width: 800px; margin: 0 auto; display: flex; justify-content: center;">
                <button id="icms-process-btn" class="btn-process" style="padding: 0.75rem 2rem; background: var(--color-primary); color: var(--color-white); border: none; border-radius: var(--border-radius-1); cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 1rem; transition: all 0.3s ease; display: flex; align-items: center; gap: 0.5rem;" disabled>
                    <span class="material-icons-sharp">build</span>
                    Processar XMLs e Gerar Planilha
                </button>
            </div>
            
            <!-- Status/Progress -->
            <div id="icms-status" style="display: none; width: 100%; max-width: 800px; margin: 0 auto; padding: 1rem; background: var(--color-background); border-radius: var(--border-radius-1); text-align: center;">
                <p id="icms-status-text" style="color: var(--color-dark);"></p>
            </div>
        </div>
    `;

    const icmsModeloInfo = document.getElementById('icms-modelo-info');
    const icmsModeloSelect = document.getElementById('icms-modelo-select');
    const icmsXmlBox = document.getElementById('icms-xml-box');
    const icmsXmlInput = document.getElementById('icms-xml-input');
    const icmsXmlLabel = document.getElementById('icms-xml-label');
    const icmsXmlInfo = document.getElementById('icms-xml-info');
    const icmsXmlCount = document.getElementById('icms-xml-count');
    const icmsXmlList = document.getElementById('icms-xml-list');
    const icmsProcessBtn = document.getElementById('icms-process-btn');
    const icmsStatus = document.getElementById('icms-status');
    const icmsStatusText = document.getElementById('icms-status-text');

    // Habilita o botão Processar só quando há modelo funcional carregado E XMLs escolhidos.
    function atualizarBotaoProcessar() {
        if (icmsProcessBtn) icmsProcessBtn.disabled = !(icmsModeloSelecionado && icmsXmlFiles.length > 0);
    }

    // Função para carregar modelo a partir de um ArrayBuffer
    async function loadModeloFromBuffer(arrayBuffer, fileName = 'ICMS ST.xlsx') {
        try {
            // Carregar com XLSX para leitura (compatibilidade)
            icmsModeloWorkbook = XLSX.read(arrayBuffer, { type: 'array' });
            
            // Carregar com ExcelJS para preservar formatações
            if (typeof ExcelJS !== 'undefined') {
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(arrayBuffer);
                icmsModeloExcelJS = workbook;
                console.log('✅ Modelo ExcelJS carregado:', fileName, 'Abas:', workbook.worksheets.map(ws => ws.name));
                
                // #region agent log - Verificar tabelas no modelo ao carregar (API e modelo interno)
                let tablesInfoOnLoad = [];
                let tablesInModel = [];
                workbook.worksheets.forEach(ws => {
                    // Verificar API worksheet.tables
                    if (ws.tables && ws.tables.length > 0) {
                        ws.tables.forEach(table => {
                            tablesInfoOnLoad.push({
                                sheet: ws.name,
                                tableName: table.name,
                                displayName: table.displayName,
                                ref: table.ref,
                                hasAutoFilter: table.autoFilter ? true : false
                            });
                        });
                    }
                    // Verificar modelo interno (worksheet.model.tables)
                    if (ws.model && ws.model.tables && Array.isArray(ws.model.tables) && ws.model.tables.length > 0) {
                        ws.model.tables.forEach((table, idx) => {
                            tablesInModel.push({
                                sheet: ws.name,
                                index: idx,
                                tableName: table.name || `Table${idx}`,
                                ref: table.ref || 'N/A',
                                displayName: table.displayName || 'N/A'
                            });
                        });
                    }
                });
                console.log(`📊 Tabelas encontradas (API: ${tablesInfoOnLoad.length}, Model: ${tablesInModel.length})`);
                // #endregion
            }
            
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem; color: var(--color-success);">check_circle</span>
                <span>✓ Modelo carregado: ${fileName}</span>
            `;
            icmsModeloInfo.style.color = 'var(--color-success)';
            console.log('✅ Modelo Excel carregado:', fileName, 'Abas:', icmsModeloWorkbook.SheetNames);
            
            return true;
        } catch (error) {
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem; color: var(--color-danger);">error</span>
                <span>Erro ao carregar modelo: ${error.message}</span>
            `;
            icmsModeloInfo.style.color = 'var(--color-danger)';
            console.error('❌ Erro ao carregar modelo Excel:', error);
            return false;
        }
    }
    
    // Seleção do modelo pelo usuário. Só o Mercadinho tem regra de classificação
    // (CST/CSOSN → aba); os demais carregam aviso de pendência e não processam.
    async function selecionarModeloIcms(chave) {
        icmsModeloWorkbook = null;
        icmsModeloExcelJS = null;
        icmsModeloBuffer = null;
        icmsModeloSelecionado = null;
        atualizarBotaoProcessar();

        if (!chave) {
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem;">info</span>
                Selecione um modelo para começar.`;
            icmsModeloInfo.style.color = 'var(--color-dark-variant)';
            return;
        }

        const modelo = ICMS_MODELOS[chave];
        if (!modelo) return;

        if (!modelo.funcional) {
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem; color: var(--color-warning, #d68910);">warning</span>
                <span><strong>${escapeHtml(modelo.nome)}</strong> está em pendência de configuração.
                As regras de classificação deste modelo ainda não foram definidas — apenas o
                modelo <strong>Mercadinho</strong> está funcional no momento.</span>`;
            icmsModeloInfo.style.color = 'var(--color-warning, #d68910)';
            return;
        }

        try {
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem;">hourglass_empty</span>
                Carregando modelo ${escapeHtml(modelo.nome)}...`;
            icmsModeloInfo.style.color = 'var(--color-dark-variant)';

            const response = await fetch(modelo.path);
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            icmsModeloBuffer = await response.arrayBuffer();
            const ok = await loadModeloFromBuffer(icmsModeloBuffer, modelo.path.split('/').pop());
            if (ok) {
                icmsModeloSelecionado = chave;
                atualizarBotaoProcessar();
            }
        } catch (error) {
            icmsModeloBuffer = null;
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem; color: var(--color-danger);">error</span>
                <span>Erro ao carregar modelo: ${escapeHtml(error.message || String(error))}</span>`;
            icmsModeloInfo.style.color = 'var(--color-danger)';
            console.error('❌ Erro ao carregar modelo ICMS:', error);
        }
    }

    if (icmsModeloSelect) {
        icmsModeloSelect.addEventListener('change', (e) => selecionarModeloIcms(e.target.value));
    }

    // Configurar drag & drop
    icmsXmlBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        icmsXmlBox.classList.add('dragover');
    });

    icmsXmlBox.addEventListener('dragleave', () => {
        icmsXmlBox.classList.remove('dragover');
    });

    icmsXmlBox.addEventListener('drop', (e) => {
        e.preventDefault();
        icmsXmlBox.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files).filter(f => {
            const n = f.name.toLowerCase();
            return n.endsWith('.xml') || n.endsWith('.zip');
        });
        if (files.length > 0) {
            handleIcmsXmlFiles(files);
        } else {
            alert('Por favor, selecione arquivos XML ou .zip');
        }
    });

    icmsXmlBox.addEventListener('click', () => {
        icmsXmlInput.click();
    });

    icmsXmlInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleIcmsXmlFiles(Array.from(e.target.files));
        }
    });

    function handleIcmsXmlFiles(files) {
        icmsXmlFiles = files;
        icmsXmlLabel.textContent = `${files.length} arquivo(s) XML selecionado(s)`;
        icmsXmlLabel.style.color = 'var(--color-success)';
        icmsXmlInfo.style.display = 'block';
        icmsXmlCount.textContent = `${files.length} arquivo(s) carregado(s)`;
        
        // Listar arquivos
        const fileList = files.slice(0, 10).map(f => f.name).join('<br>');
        icmsXmlList.innerHTML = fileList + (files.length > 10 ? `<br>... e mais ${files.length - 10} arquivo(s)` : '');

        atualizarBotaoProcessar();
        console.log(`${files.length} arquivo(s) XML/ZIP selecionado(s)`);
    }

    icmsProcessBtn.addEventListener('click', async () => {
        if (icmsXmlFiles.length === 0) {
            alert('Por favor, selecione pelo menos um arquivo XML');
            return;
        }
        
        if (!icmsModeloSelecionado || !icmsModeloBuffer) {
            alert('Selecione um modelo funcional (Mercadinho) antes de processar.');
            return;
        }

        icmsProcessBtn.disabled = true;
        icmsStatus.style.display = 'block';
        icmsStatusText.textContent = 'Processando XMLs...';
        icmsStatusText.style.color = 'var(--color-primary)';

        try {
            await processIcmsXmls();
        } catch (error) {
            console.error('Erro ao processar XMLs:', error);
            icmsStatusText.textContent = `Erro: ${error.message}`;
            icmsStatusText.style.color = 'var(--color-danger)';
            atualizarBotaoProcessar();
        }
    });
}

// Processa XMLs/ZIP de NF-e, agrupa por CNPJ do destinatário (a empresa cuja retenção
// é apurada) e gera uma planilha ICMS ST por empresa direto no browser (ExcelJS),
// preservando as fórmulas do modelo. Com 1 empresa baixa o .xlsx; com várias, um .zip.
// Apenas o modelo Mercadinho tem a classificação por CST/CSOSN implementada.
async function processIcmsXmls() {
    const statusText = document.getElementById('icms-status-text');
    if (!icmsModeloBuffer || !icmsModeloSelecionado) {
        throw new Error('Selecione um modelo funcional (Mercadinho) antes de processar.');
    }
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip não carregou — não é possível gerar a planilha ICMS.');
    }

    if (statusText) statusText.textContent = 'Lendo arquivos (XML/ZIP)...';
    const xmls = await expandXmlInputs(icmsXmlFiles);
    if (!xmls.length) throw new Error('Nenhum XML encontrado (avulso ou dentro de .zip).');

    if (statusText) statusText.textContent = 'Extraindo dados dos XMLs...';
    // Agrupa por CNPJ do destinatário. cnpj -> { produtosPorGrupo, periodos[], razoes[] }
    const empresas = {};
    for (let i = 0; i < xmls.length; i++) {
        let dados;
        try { dados = extrairDadosFiltrados(xmls[i].text); }
        catch (e) { console.error('Erro ao processar', xmls[i].name, e); continue; }

        const cnpj = (dados && dados.cnpj) ? dados.cnpj : 'sem-cnpj';
        const emp = empresas[cnpj] || (empresas[cnpj] = {
            produtosPorGrupo: { "Aliquota 1,54%": [], "Aliquota 4%": [], "Aliquota 7%": [] },
            periodos: [], razoes: [],
        });
        if (dados.periodo) emp.periodos.push(dados.periodo);
        if (dados.razaoSocial) emp.razoes.push(dados.razaoSocial);
        for (const [grupo, produtos] of Object.entries(dados.resultados || {})) {
            if (produtos && produtos.length && emp.produtosPorGrupo[grupo]) {
                emp.produtosPorGrupo[grupo].push(...produtos);
            }
        }

        if (i % 100 === 0) {
            if (statusText) statusText.textContent = `Processando ${i + 1}/${xmls.length} XML...`;
            await new Promise((r) => requestAnimationFrame(r));
        }
    }

    const cnpjs = Object.keys(empresas);
    if (!cnpjs.length) throw new Error('nenhum XML válido de NF-e encontrado.');

    if (statusText) statusText.textContent = `Gerando ${cnpjs.length} planilha(s)...`;
    const arquivos = [];
    let periodoGlobal = '';
    let vazias = 0;
    for (const cnpj of cnpjs) {
        const emp = empresas[cnpj];
        const periodo = maisComum(emp.periodos);
        const razaoSocial = emp.razoes.length ? normalizarRazaoSocial(emp.razoes) : '';
        if (periodo && !periodoGlobal) periodoGlobal = periodo;

        const totalProdutos = Object.values(emp.produtosPorGrupo).reduce((s, a) => s + a.length, 0);
        if (!totalProdutos) { vazias++; continue; } // nenhum produto passou nos filtros UF/CFOP

        // Edição direta do .xlsx via JSZip — NÃO usa ExcelJS para escrever. O ExcelJS 4.x
        // corrompe a definição de tabela (ListObject) do modelo no round-trip: gera
        // headerRowCount="0" + autoFilter inconsistente, que o Excel/WPS recusam como
        // "arquivo corrompido". Como as fórmulas de ICMS dependem da tabela
        // (Tabela2[[#This Row],...]), removê-la não é opção. Editamos só as células de
        // dados; tabelas, fórmulas, estilos e drawings do modelo ficam intactos.
        const zip = await JSZip.loadAsync(icmsModeloBuffer);
        const abas = await resolverAbasIcms(zip);

        // O modelo tem <autoFilter> nas definições de tabela (xl/tables/*.xml) que o Excel
        // moderno rejeita ("Registros Removidos: AutoFiltro de parte de tableN.xml" → abre
        // só após reparo). Removemos o autoFilter — a tabela e suas fórmulas seguem válidas.
        await removerAutoFiltroTabelas(zip);

        // Cabeçalho na aba principal: C3 razão social, C5 período (texto "mmm-yy" em PT —
        // evita depender de estilo de data/locale; o valor exibido fica idêntico).
        const caminhoPrincipal = abas['ICMS ST 1104'];
        if (caminhoPrincipal && zip.file(caminhoPrincipal)) {
            const editsCab = [];
            if (razaoSocial) editsCab.push({ row: 3, col: 3, valor: razaoSocial, tipo: 'str' });
            if (periodo) editsCab.push({ row: 5, col: 3, valor: formatarPeriodoIcms(periodo), tipo: 'str' });
            if (editsCab.length) {
                const xml = await zip.file(caminhoPrincipal).async('string');
                zip.file(caminhoPrincipal, aplicarEditsIcms(xml, editsCab));
            }
        }

        // Produtos por aba de alíquota (a partir de D2), preservando fórmulas do modelo.
        for (const [nomeGrupo, produtos] of Object.entries(emp.produtosPorGrupo)) {
            if (!produtos.length) continue;
            const caminho = abas[nomeGrupo];
            if (!caminho || !zip.file(caminho)) continue;
            const xml = await zip.file(caminho).async('string');
            zip.file(caminho, escreverDadosIcmsXml(xml, produtos, 2));
        }

        // Força recálculo ao abrir: editar o XML direto deixa os valores cacheados das
        // fórmulas (ICMS ST, totais) desatualizados — mesmo motivo do fullCalcOnLoad do DIRBI.
        const wbXml = await zip.file('xl/workbook.xml').async('string');
        zip.file('xl/workbook.xml', forcarRecalculoIcms(wbXml));

        const buffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
        const nome = `ICMS ST ${periodo || 'sem-periodo'}_${(razaoSocial || cnpj).replace(/[\\/:*?"<>|]/g, '').slice(0, 60)}.xlsx`;
        arquivos.push({ nome, buffer });
    }

    if (!arquivos.length) throw new Error('Nenhum produto passou nos filtros (UF/CFOP) — nada a gerar.');

    const zipNome = `ICMS ST ${periodoGlobal || 'sem-periodo'}.zip`;
    await downloadXlsxOrZip(arquivos, zipNome);

    if (statusText) {
        statusText.innerHTML =
            `✅ <strong>Concluído.</strong> ${arquivos.length} planilha(s) gerada(s)` +
            `${vazias ? ` &middot; ${vazias} empresa(s) sem produtos nos filtros` : ''}.<br>` +
            (arquivos.length > 1
                ? `Arquivo <strong>${escapeHtml(zipNome)}</strong> (zip) baixado.`
                : `Planilha <strong>${escapeHtml(arquivos[0].nome)}</strong> baixada.`);
        statusText.style.color = 'var(--color-success)';
    }

    setTimeout(() => {
        icmsXmlFiles = [];
        const lbl = document.getElementById('icms-xml-label');
        if (lbl) { lbl.textContent = 'Arraste e solte os XML (ou .zip) aqui'; lbl.style.color = 'var(--color-dark)'; }
        const info = document.getElementById('icms-xml-info'); if (info) info.style.display = 'none';
        const st = document.getElementById('icms-status'); if (st) st.style.display = 'none';
        atualizarBotaoProcessarIcms();
    }, 3000);
}

// Item mais frequente de um array de strings (ou '' se vazio).
function maisComum(arr) {
    if (!arr || !arr.length) return '';
    const c = {};
    for (const v of arr) c[v] = (c[v] || 0) + 1;
    return Object.keys(c).reduce((a, b) => (c[a] >= c[b] ? a : b), arr[0]);
}

// Reseta o botão Processar fora do escopo do createIcmsWithholdingPage (após download).
function atualizarBotaoProcessarIcms() {
    const btn = document.getElementById('icms-process-btn');
    if (btn) btn.disabled = !(icmsModeloSelecionado && icmsXmlFiles.length > 0);
}

// ── Escrita ICMS por edição direta do XML do .xlsx (via JSZip) ──────────────────
// O ExcelJS corrompe a definição de tabela do modelo no round-trip (ver processIcmsXmls),
// então escrevemos as células manipulando o sheet XML e regeneramos o zip, preservando
// tabelas/fórmulas/estilos/drawings intactos.

// "D" -> 4 (índice de coluna 1-based).
function colLetraParaIndice(letra) {
    let n = 0;
    for (let i = 0; i < letra.length; i++) n = n * 26 + (letra.charCodeAt(i) - 64);
    return n;
}
// 4 -> "D".
function colIndiceParaLetra(idx) {
    let s = '';
    while (idx > 0) { const r = (idx - 1) % 26; s = String.fromCharCode(65 + r) + s; idx = Math.floor((idx - 1) / 26); }
    return s;
}
function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function decodeXmlEntities(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Mapeia nome da aba -> caminho do sheet XML, lendo workbook.xml + seus rels (não hardcoda
// a ordem dos sheets, que pode divergir do número do arquivo).
async function resolverAbasIcms(zip) {
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const rid2target = {};
    for (const tag of relsXml.match(/<Relationship\b[^>]*>/g) || []) {
        const id = (tag.match(/Id="([^"]+)"/) || [])[1];
        const target = (tag.match(/Target="([^"]+)"/) || [])[1];
        if (id && target) rid2target[id] = target;
    }
    const abas = {};
    for (const tag of wbXml.match(/<sheet\b[^>]*>/g) || []) {
        const nome = (tag.match(/name="([^"]+)"/) || [])[1];
        const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
        if (nome && rid && rid2target[rid]) abas[decodeXmlEntities(nome)] = 'xl/' + rid2target[rid].replace(/^\.?\//, '');
    }
    return abas;
}

// Monta uma célula <c>. Número vira <v>; texto vira inline string (não mexe em sharedStrings).
// Sem atributo s a célula herda o estilo da coluna (<col style>), que o modelo já define.
function construirCelulaIcms(ref, s, valor, tipo) {
    const sAttr = s ? ` s="${s}"` : '';
    if (tipo === 'num') return `<c r="${ref}"${sAttr}><v>${valor}</v></c>`;
    return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(valor)}</t></is></c>`;
}

// Aplica edições de célula a um sheet XML, preservando o resto byte-a-byte.
// edits: [{ row:Number, col:Number(1-based), valor, tipo:'str'|'num' }].
// Não sobrescreve células que contêm fórmula (<f>); reusa o estilo (s=) da célula existente.
function aplicarEditsIcms(sheetXml, edits) {
    const porRow = {};
    for (const e of edits) (porRow[e.row] = porRow[e.row] || []).push(e);
    return sheetXml.replace(/<row r="(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (full, rNum, attrs, inner) => {
        const lista = porRow[rNum];
        if (!lista) return full;
        const celulas = {};
        if (inner) {
            const re = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
            let m;
            while ((m = re.exec(inner)) !== null) celulas[colLetraParaIndice(m[1])] = { attrs: m[3] || '', body: m[4] || '', raw: m[0] };
        }
        for (const e of lista) {
            const exist = celulas[e.col];
            if (exist && /<f[ >/]/.test(exist.body)) continue; // nunca sobrescreve fórmula do modelo
            const sMatch = exist ? (exist.attrs.match(/\ss="(\d+)"/) || [])[1] : null;
            const ref = colIndiceParaLetra(e.col) + rNum;
            celulas[e.col] = { raw: construirCelulaIcms(ref, sMatch, e.valor, e.tipo) };
        }
        const idx = Object.keys(celulas).map(Number).sort((a, b) => a - b);
        const cleanAttrs = attrs.replace(/\/\s*$/, ''); // remove '/' se a row era self-closing
        return `<row r="${rNum}"${cleanAttrs}>${idx.map((ci) => celulas[ci].raw).join('')}</row>`;
    });
}

// Escreve as linhas de produtos numa aba a partir de D{rowBase}, preservando fórmulas.
// Colunas de valor (j=8..11) e UF/Nº/CFOP/CST (j=1,2,6,7) são numéricas; NCM (j=5) e o
// resto, texto. A formatação (R$, etc.) vem do estilo de coluna do modelo.
function escreverDadosIcmsXml(sheetXml, dados, rowBase) {
    const COL_BASE = 4;     // coluna D
    const MAX_ROW = 1000;   // a tabela do modelo cobre D1:S1000 (fórmulas até a linha 1000)
    const edits = [];
    let excedentes = 0;
    dados.forEach((linha, i) => {
        const row = rowBase + i;
        if (row > MAX_ROW) { excedentes++; return; }
        linha.forEach((valor, j) => {
            const col = COL_BASE + j;
            if (j >= 9 && j <= 12) {
                // M FRETE | N DESPESAS | O IPI | P Vl. Produto → numérico (R$ vem do estilo da coluna)
                const num = parseFloat(String(valor || '0').replace(',', '.'));
                edits.push(isNaN(num)
                    ? { row, col, valor: String(valor || ''), tipo: 'str' }
                    : { row, col, valor: num, tipo: 'num' });
            } else if (j === 1 || j === 2 || j === 7) {
                // E UF | F Nº NF-e | K CFOP → numérico
                edits.push({ row, col, valor: parseFloat(String(valor || '0').replace(/[^\d.-]/g, '')) || 0, tipo: 'num' });
            } else {
                // D Chave | G Fornecedor | H CNPJ | I Produto | J NCM | L CST → texto (preserva zeros à esquerda)
                edits.push({ row, col, valor: String(valor || ''), tipo: 'str' });
            }
        });
    });
    if (excedentes) console.warn(`ICMS: ${excedentes} linha(s) além da linha ${MAX_ROW} do modelo foram ignoradas.`);
    return aplicarEditsIcms(sheetXml, edits);
}

// Formata "MM-YYYY" como "mmm-yy" em PT (ex.: "06-2025" -> "jun-25").
function formatarPeriodoIcms(periodo) {
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const [mes, ano] = String(periodo).split('-');
    const mi = parseInt(mes, 10) - 1;
    return `${(mi >= 0 && mi < 12) ? meses[mi] : mes}-${String(ano).slice(-2)}`;
}

// Remove <autoFilter> das definições de tabela (xl/tables/*.xml). Esses autoFiltros vêm
// inválidos no modelo e o Excel os recusa ("Registros Removidos"), forçando reparo na
// abertura. Sem o autoFilter a tabela segue válida (perde só os dropdowns de filtro); as
// fórmulas estruturadas (calculatedColumnFormula / Tabela2[...]) ficam intactas.
async function removerAutoFiltroTabelas(zip) {
    const tabelas = zip.file(/^xl\/tables\/table\d+\.xml$/);
    for (const t of tabelas) {
        const xml = await t.async('string');
        const novo = xml
            .replace(/<autoFilter\b[^>]*\/>/g, '')
            .replace(/<autoFilter\b[^>]*>[\s\S]*?<\/autoFilter>/g, '');
        if (novo !== xml) zip.file(t.name, novo);
    }
}

// Garante fullCalcOnLoad="1" no <calcPr> do workbook.xml para o Excel/WPS recalcular ao abrir.
function forcarRecalculoIcms(wbXml) {
    if (/<calcPr\b/.test(wbXml)) {
        return wbXml.replace(/<calcPr\b([^>]*?)\/?>/, (full, attrs) => {
            const a = /fullCalcOnLoad=/.test(attrs)
                ? attrs.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"')
                : attrs + ' fullCalcOnLoad="1"';
            return `<calcPr${a}/>`;
        });
    }
    return wbXml.replace(/<\/sheets>/, '</sheets><calcPr fullCalcOnLoad="1"/>');
}

// Função para ler arquivo como texto
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file, 'UTF-8');
    });
}

// Função para ler arquivo como ArrayBuffer
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// Função para extrair dados filtrados de um XML
function extrairDadosFiltrados(xmlText) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Verificar erros de parsing
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            throw new Error('Erro ao fazer parse do XML');
        }

        const NS = ICMS_CONFIG.NS;
        
        // Detectar namespace do documento (pode variar)
        const rootElement = xmlDoc.documentElement || xmlDoc;
        let detectedNS = NS.nfe;
        if (rootElement && rootElement.namespaceURI) {
            detectedNS = rootElement.namespaceURI;
        }
        
        // Função auxiliar para buscar elemento por local name (ignora namespace)
        function findElementByLocalName(element, localName) {
            if (!element) return null;
            
            // Primeiro tentar com namespace detectado
            try {
                if (element.getElementsByTagNameNS && detectedNS) {
                    const withNS = element.getElementsByTagNameNS(detectedNS, localName);
                    if (withNS && withNS.length > 0) return withNS[0];
                }
            } catch (e) {
                // Ignorar erro
            }
            
            // Tentar com namespace padrão
            try {
                if (element.getElementsByTagNameNS && NS.nfe) {
                    const withNS = element.getElementsByTagNameNS(NS.nfe, localName);
                    if (withNS && withNS.length > 0) return withNS[0];
                }
            } catch (e) {
                // Ignorar erro
            }
            
            // Buscar manualmente pelo local name (busca recursiva em todos os elementos)
            try {
                const all = element.getElementsByTagName('*');
                for (let i = 0; i < all.length; i++) {
                    const el = all[i];
                    // Comparar localName (ignora namespace)
                    if (el.localName === localName || 
                        el.nodeName === localName || 
                        el.nodeName === `nfe:${localName}` ||
                        el.nodeName.endsWith(`:${localName}`)) {
                        return el;
                    }
                }
            } catch (e) {
                // Ignorar erro
            }
            
            return null;
        }
        
        // Função auxiliar para buscar com namespace
        function findWithNS(element, tagName) {
            if (!element) return null;
            
            // Primeiro tentar com namespace detectado
            try {
                if (element.getElementsByTagNameNS && detectedNS) {
                    const withNS = element.getElementsByTagNameNS(detectedNS, tagName);
                    if (withNS && withNS.length > 0) return withNS[0];
                }
            } catch (e) {
                // Ignorar erro
            }
            
            // Tentar com namespace padrão
            try {
                if (element.getElementsByTagNameNS && NS.nfe) {
                    const withNS = element.getElementsByTagNameNS(NS.nfe, tagName);
                    if (withNS && withNS.length > 0) return withNS[0];
                }
            } catch (e) {
                // Ignorar erro
            }
            
            // Tentar sem namespace (busca por local name - ignora namespace)
            try {
                const all = element.getElementsByTagName('*');
                for (let i = 0; i < all.length; i++) {
                    const el = all[i];
                    if (el.localName === tagName || 
                        el.nodeName === tagName ||
                        el.nodeName.endsWith(`:${tagName}`)) {
                        return el;
                    }
                }
            } catch (e) {
                // Ignorar erro
            }
            
            return null;
        }
        
        function findAllWithNS(element, tagName) {
            if (!element) return [];
            
            // Primeiro tentar com namespace detectado
            try {
                if (element.getElementsByTagNameNS && detectedNS) {
                    const nsElements = element.getElementsByTagNameNS(detectedNS, tagName);
                    if (nsElements && nsElements.length > 0) return Array.from(nsElements);
                }
            } catch (e) {
                // Ignorar erro
            }
            
            // Tentar com namespace padrão
            try {
                if (element.getElementsByTagNameNS && NS.nfe) {
                    const nsElements = element.getElementsByTagNameNS(NS.nfe, tagName);
                    if (nsElements && nsElements.length > 0) return Array.from(nsElements);
                }
            } catch (e) {
                // Ignorar erro
            }
            
            // Buscar pelo local name (ignora namespace)
            try {
                const all = element.getElementsByTagName('*');
                const results = [];
                for (let i = 0; i < all.length; i++) {
                    const el = all[i];
                    if ((el.localName === tagName || 
                         el.nodeName === tagName ||
                         el.nodeName.endsWith(`:${tagName}`)) &&
                        element.contains(el)) {
                        results.push(el);
                    }
                }
                if (results.length > 0) return results;
            } catch (e) {
                // Ignorar erro
            }
            
            return [];
        }

        // Buscar infNFe - pode estar em diferentes estruturas:
        // 1. nfeProc > NFe > infNFe
        // 2. NFe > infNFe (direto)
        // 3. procEventoNFe > evento > infEvento (não é NF-e, é evento)
        // 4. Outras estruturas
        
        let infNFe = null;
        
        // Primeiro, verificar se é um XML de evento (procEventoNFe) - esses não têm infNFe
        // Verificação mais precisa: eventos têm procEventoNFe ou evento como root, mas NÃO têm infNFe
        const rootName = rootElement?.localName || rootElement?.nodeName || '';
        const rootNameLower = rootName.toLowerCase().trim();
        
        // Verificar se é especificamente um XML de evento conhecido
        // Apenas considerar como evento se for EXATAMENTE um dos elementos raiz de evento conhecidos
        // Isso evita falsos positivos com XMLs que têm "evento" em algum lugar do nome mas são NF-e válidas
        const isEventoXML = (rootNameLower === 'proceventonfe' || 
                            rootNameLower === 'evento' || 
                            rootNameLower === 'procevento' ||
                            rootNameLower === 'eventoinfe');
        
        // Se for evento, verificar se realmente não tem infNFe antes de descartar
        // IMPORTANTE: Mesmo que seja um evento, se tiver infNFe, é uma NF-e válida que deve ser processada
        if (isEventoXML) {
            // Tentar buscar infNFe para confirmar que não é uma NF-e
            // Se tiver infNFe, mesmo que o root seja "evento", ainda é uma NF-e válida
            const hasInfNFe = findElementByLocalName(rootElement, 'infNFe');
            if (!hasInfNFe) {
                // Verificar também se tem infEvento (elemento típico de eventos)
                const hasInfEvento = findElementByLocalName(rootElement, 'infEvento');
                if (hasInfEvento) {
                    console.warn('XML é um evento, não uma NF-e. Pulando...');
                    return { cnpj: "", periodo: "", razaoSocial: "", resultados: {} };
                }
                // Se não tem nem infNFe nem infEvento, pode ser uma estrutura desconhecida - tentar processar
            }
            // Se tem infNFe, não é evento puro, continuar processamento
        }
        
        // Tentar buscar infNFe diretamente (busca recursiva em toda a árvore)
        infNFe = findElementByLocalName(rootElement, 'infNFe');
        
        if (!infNFe) {
            // Tentar estrutura específica: nfeProc > NFe > infNFe
            const nfeProc = findElementByLocalName(rootElement, 'nfeProc');
            if (nfeProc) {
                const nfe = findElementByLocalName(nfeProc, 'NFe');
                if (nfe) {
                    infNFe = findElementByLocalName(nfe, 'infNFe');
                }
            }
        }
        
        if (!infNFe) {
            // Tentar buscar NFe diretamente e depois infNFe
            const nfe = findElementByLocalName(rootElement, 'NFe');
            if (nfe) {
                infNFe = findElementByLocalName(nfe, 'infNFe');
            }
        }
        
        if (!infNFe) {
            // Última tentativa: buscar por qualquer elemento que tenha 'infNFe' no nome
            try {
                const allElements = rootElement.getElementsByTagName('*');
                for (let i = 0; i < allElements.length; i++) {
                    const el = allElements[i];
                    if (el.localName === 'infNFe' || 
                        el.nodeName === 'infNFe' || 
                        el.nodeName.includes('infNFe') ||
                        (el.nodeName.includes('inf') && el.nodeName.includes('NFe'))) {
                        infNFe = el;
                        break;
                    }
                }
            } catch (e) {
                console.warn('Erro ao buscar elementos:', e);
            }
        }
        
        if (!infNFe) {
            // Se ainda não encontrou, pode ser que o XML não seja uma NF-e válida
            console.warn('infNFe não encontrado no XML. Estrutura raiz:', rootName);
            console.warn('Isso pode ser um XML de evento ou outro tipo de documento.');
            return { cnpj: "", periodo: "", resultados: { todos: [] } };
        }

        // Buscar elementos dentro de infNFe - tentar múltiplas formas
        let ide = findWithNS(infNFe, 'ide');
        let emit = findWithNS(infNFe, 'emit');
        let dest = findWithNS(infNFe, 'dest');
        
        // Se não encontrou, tentar buscar diretamente pelo tagName
        if (!ide) ide = infNFe.querySelector('ide') || infNFe.querySelector('nfe:ide');
        if (!emit) emit = infNFe.querySelector('emit') || infNFe.querySelector('nfe:emit');
        if (!dest) dest = infNFe.querySelector('dest') || infNFe.querySelector('nfe:dest');

        if (!ide || !emit || !dest) {
            console.warn('Elementos ide, emit ou dest não encontrados no infNFe');
            console.warn('infNFe filhos:', Array.from(infNFe.children).map(c => c.nodeName).join(', '));
            return { cnpj: "", periodo: "", resultados: { todos: [] } };
        }

        // Buscar fornecedor (xFant do emit)
        let xFant = findWithNS(emit, 'xFant');
        if (!xFant) xFant = emit.querySelector('xFant');
        const fornecedor = xFant?.textContent || "";

        // CNPJ (ou CPF) do emitente = fornecedor, para a coluna H do modelo.
        let cnpjEmitEl = findWithNS(emit, 'CNPJ') || emit.querySelector('CNPJ') || emit.querySelector('nfe:CNPJ');
        if (!cnpjEmitEl) cnpjEmitEl = findWithNS(emit, 'CPF') || emit.querySelector('CPF') || emit.querySelector('nfe:CPF');
        const cnpjFornecedor = cnpjEmitEl?.textContent ? cnpjEmitEl.textContent.replace(/\D/g, '') : '';
        
        // Buscar CNPJ do destinatário - tentar múltiplas formas
        let cnpjDest = findWithNS(dest, 'CNPJ');
        if (!cnpjDest) cnpjDest = dest.querySelector('CNPJ') || dest.querySelector('nfe:CNPJ');
        let cnpj = cnpjDest?.textContent || "";
        
        // Se não encontrar CNPJ no destinatário, buscar no emitente
        if (!cnpj || cnpj.trim() === '') {
            let cnpjEmit = findWithNS(emit, 'CNPJ');
            if (!cnpjEmit) cnpjEmit = emit.querySelector('CNPJ') || emit.querySelector('nfe:CNPJ');
            cnpj = cnpjEmit?.textContent || "";
        }
        
        // Formatar CNPJ (remover espaços e caracteres especiais, manter apenas números)
        cnpj = cnpj ? cnpj.replace(/\D/g, '') : '';
        
        // Buscar razão social do destinatário (xNome do dest) - tentar múltiplas formas
        let xNome = findWithNS(dest, 'xNome');
        if (!xNome) xNome = dest.querySelector('xNome') || dest.querySelector('nfe:xNome');
        const razaoSocialRaw = xNome?.textContent || "";
        const razaoSocial = unescapeHtml(razaoSocialRaw.replace(/&amp;/g, '&').replace(/&amp;/g, '&'));
        
        // Buscar data de emissão - tentar múltiplas formas
        let dhEmi = findWithNS(ide, 'dhEmi');
        if (!dhEmi) dhEmi = ide.querySelector('dhEmi') || ide.querySelector('nfe:dhEmi');
        
        // Se não encontrar dhEmi, tentar dEmi (data sem hora)
        let dhEmiText = dhEmi?.textContent || "";
        if (!dhEmiText) {
            let dEmi = findWithNS(ide, 'dEmi');
            if (!dEmi) dEmi = ide.querySelector('dEmi') || ide.querySelector('nfe:dEmi');
            dhEmiText = dEmi?.textContent || "";
            // Formatar dEmi para formato completo (DDMMYYYY -> YYYY-MM-DD)
            if (dhEmiText && dhEmiText.length === 8) {
                const dia = dhEmiText.substring(0, 2);
                const mes = dhEmiText.substring(2, 4);
                const ano = dhEmiText.substring(4, 8);
                dhEmiText = `${ano}-${mes}-${dia}`;
            }
        }
        
        let periodo = "";
        if (dhEmiText) {
            try {
                // Tentar formatos diferentes de data
                let dataEmi = null;
                
                // Formato ISO (YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss)
                if (dhEmiText.match(/^\d{4}-\d{2}-\d{2}/)) {
                    dataEmi = new Date(dhEmiText.substring(0, 10));
                }
                // Formato brasileiro (DD/MM/YYYY)
                else if (dhEmiText.match(/^\d{2}\/\d{2}\/\d{4}/)) {
                    const [dia, mes, ano] = dhEmiText.split('/');
                    dataEmi = new Date(`${ano}-${mes}-${dia}`);
                }
                // Formato compacto (YYYYMMDD)
                else if (dhEmiText.match(/^\d{8}$/)) {
                    const ano = dhEmiText.substring(0, 4);
                    const mes = dhEmiText.substring(4, 6);
                    const dia = dhEmiText.substring(6, 8);
                    dataEmi = new Date(`${ano}-${mes}-${dia}`);
                }
                
                if (dataEmi && !isNaN(dataEmi.getTime())) {
                    periodo = `${String(dataEmi.getMonth() + 1).padStart(2, '0')}-${dataEmi.getFullYear()}`;
                } else {
                    console.warn('Data não pôde ser parseada:', dhEmiText);
                }
            } catch (e) {
                console.warn('Erro ao processar data:', e, 'Texto:', dhEmiText);
            }
        }

        // Buscar UF e número da NF
        const cUF = findWithNS(ide, 'cUF');
        const cNF = findWithNS(ide, 'cNF');
        const uf = cUF?.textContent || "";
        const numeroNf = cNF?.textContent || "";
        
        // Buscar protNFe e chave (está no mesmo nível de NFe, dentro de nfeProc)
        // Usar rootElement já declarado acima
        let protNFe = findElementByLocalName(rootElement, 'protNFe');
        
        const chaveEl = protNFe ? findWithNS(protNFe, 'chNFe') : null;
        let chave = chaveEl?.textContent || "";
        
        // Se não encontrar chave no protNFe, tentar no infNFe (atributo Id)
        if (!chave && infNFe && infNFe.hasAttribute && infNFe.hasAttribute('Id')) {
            const idAttr = infNFe.getAttribute('Id');
            if (idAttr) {
                chave = idAttr.replace(/^NFe/, '') || idAttr;
            }
        }
        
        // Extrair período da chave se não foi extraído da data
        // A chave tem 44 dígitos: posições 3-4 = últimos 2 dígitos do ano, posições 5-6 = mês
        if (!periodo && chave && chave.length >= 6) {
            try {
                const chaveLimpa = chave.replace(/\D/g, ''); // Remove caracteres não numéricos
                if (chaveLimpa.length >= 6) {
                    const ano2digitos = chaveLimpa.substring(2, 4); // Posições 3-4 (índices 2-3)
                    const mes = chaveLimpa.substring(4, 6); // Posições 5-6 (índices 4-5)
                    
                    // Converter ano de 2 dígitos para 4 dígitos (assumir 2000-2099)
                    const ano = parseInt(ano2digitos);
                    const anoCompleto = ano < 50 ? 2000 + ano : 1900 + ano; // Se < 50, assume 20XX, senão 19XX
                    
                    periodo = `${mes}-${anoCompleto}`;
                    console.log(`Período extraído da chave: ${periodo} (chave: ${chaveLimpa.substring(0, 6)})`);
                }
            } catch (e) {
                console.warn('Erro ao extrair período da chave:', e);
            }
        }

        // Debug: verificar se encontrou os dados básicos
        if (!cnpj || !periodo) {
            console.warn('⚠ Dados não encontrados - CNPJ:', cnpj || 'vazio', 'Período:', periodo || 'vazio');
            
            // Log mais detalhado para debug
            console.warn('Elementos encontrados:', {
                ide: !!ide,
                emit: !!emit,
                dest: !!dest,
                xNome: !!xNome,
                dhEmi: !!dhEmi,
                cnpjDest: !!cnpjDest
            });
            
            // Mostrar conteúdo dos elementos para debug
            if (dest) {
                console.warn('dest filhos:', Array.from(dest.children).map(c => `${c.nodeName}:${c.textContent?.substring(0, 20)}`).join(', '));
            }
            if (ide) {
                console.warn('ide filhos:', Array.from(ide.children).map(c => `${c.nodeName}:${c.textContent?.substring(0, 20)}`).join(', '));
            }
            if (emit) {
                console.warn('emit filhos:', Array.from(emit.children).map(c => `${c.nodeName}:${c.textContent?.substring(0, 20)}`).join(', '));
            }
        } else {
            console.log(`✓ XML processado - CNPJ: ${cnpj}, Período: ${periodo}, Razão Social: ${razaoSocial.substring(0, 50)}`);
        }

        const todosProdutos = [];

        const dets = findAllWithNS(infNFe, 'det');
        
        for (const det of dets) {
            const prod = findWithNS(det, 'prod') || det.querySelector('prod');
            const imposto = findWithNS(det, 'imposto') || det.querySelector('imposto');

            if (!prod || !imposto) continue;

            const xprod = (findWithNS(prod, 'xProd') || prod.querySelector('xProd'))?.textContent || "";
            const cfop = (findWithNS(prod, 'CFOP') || prod.querySelector('CFOP'))?.textContent || "";
            const vprod = (findWithNS(prod, 'vProd') || prod.querySelector('vProd'))?.textContent || "0";
            const ncm = (findWithNS(prod, 'NCM') || prod.querySelector('NCM'))?.textContent || "";

            // Frete | Outras Despesas | IPI
            const total = findWithNS(infNFe, 'total') || infNFe.querySelector('total');
            const icmsTot = total ? (findWithNS(total, 'ICMSTot') || total.querySelector('ICMSTot')) : null;

            let vFrete = icmsTot ? ((findWithNS(icmsTot, 'vFrete') || icmsTot.querySelector('vFrete'))?.textContent || "") : "";
            let vOutro = icmsTot ? ((findWithNS(icmsTot, 'vOutro') || icmsTot.querySelector('vOutro'))?.textContent || "") : "";
            let vIpi = (findWithNS(imposto, 'vIPI') || imposto.querySelector('vIPI'))?.textContent || "";

            vFrete = (!vFrete || parseFloat(vFrete) === 0) ? "0" : vFrete;
            vOutro = (!vOutro || parseFloat(vOutro) === 0) ? "0" : vOutro;
            vIpi = (!vIpi || parseFloat(vIpi) === 0) ? "0" : vIpi;

            // Buscar CST ou CSOSN
            let cst = "";
            let csosn = "";
            
            // Primeiro, buscar diretamente filhos do imposto que começam com ICMS (ICMS00, ICMS20, ICMS60, etc)
            const impostoChildren = Array.from(imposto.children || []);
            let icmsElement = null;
            
            for (const child of impostoChildren) {
                const localName = child.localName || child.nodeName;
                if (localName && (localName.startsWith('ICMS') || localName === 'ICMS')) {
                    icmsElement = child;
                    break;
                }
            }
            
            // Se não encontrou, tentar buscar com namespace
            if (!icmsElement) {
                const icmsElements = findAllWithNS(imposto, 'ICMS');
                if (icmsElements.length > 0) {
                    icmsElement = icmsElements[0];
                }
            }
            
            // Se encontrou elemento ICMS, buscar CST e CSOSN dentro dele
            if (icmsElement) {
                // Buscar filhos do ICMS (ICMS00, ICMS20, ICMS60, etc)
                const icmsChildren = Array.from(icmsElement.children || []);
                for (const icmsChild of icmsChildren) {
                    const childLocalName = icmsChild.localName || icmsChild.nodeName;
                    if (childLocalName && childLocalName.startsWith('ICMS')) {
                        // Este é o elemento específico (ICMS60, ICMS20, etc)
                        const cstEl = findWithNS(icmsChild, 'CST');
                        const csosnEl = findWithNS(icmsChild, 'CSOSN');
                        
                        if (cstEl) cst = cstEl.textContent || "";
                        if (csosnEl) csosn = csosnEl.textContent || "";
                        
                        if (cst || csosn) break;
                    }
                }
                
                // Se ainda não encontrou, buscar diretamente no elemento ICMS
                if (!cst && !csosn) {
                    const cstEl = findWithNS(icmsElement, 'CST');
                    const csosnEl = findWithNS(icmsElement, 'CSOSN');
                    
                    if (cstEl) cst = cstEl.textContent || "";
                    if (csosnEl) csosn = csosnEl.textContent || "";
                }
            }

            // FILTROS baseados no código Python
            const UF_VALIDO = "23";
            const CFOP_VALIDOS = new Set(["5101", "5102", "5103", "5105", "5910"]);
            
            // Aplicar filtros de UF e CFOP (igual ao código Python)
            if (uf !== UF_VALIDO || !CFOP_VALIDOS.has(cfop)) {
                continue; // Pular produtos que não passam nos filtros
            }
            
            // Criar linha do produto. Ordem casa com as colunas D:P do modelo:
            // D Chave | E UF | F Nº NF-e | G Fornecedor | H CNPJ | I Produto | J NCM |
            // K CFOP | L CST | M FRETE | N DESPESAS | O IPI | P Vl. Produto
            const linha = [chave, uf, numeroNf, fornecedor, cnpjFornecedor, xprod, ncm, cfop, cst || csosn, vFrete, vOutro, vIpi, vprod];
            
            // Agrupar produtos conforme GRUPOS do código Python
            // GRUPOS = {
            //     "1,54%.txt": {"cst": {"20"}, "csosn": set()},
            //     "4%.txt": {"cst": {"00"}, "csosn": set()},
            //     "7%.txt": {"cst": set(), "csosn": {"101", "102"}},
            // }
            
            // Verificar se o produto se encaixa em algum grupo
            let produtoAdicionado = false;
            
            // Grupo 1,54%: CST 20
            if (cst === "20") {
                todosProdutos.push({ grupo: "Aliquota 1,54%", linha: linha });
                produtoAdicionado = true;
            }
            
            // Grupo 4%: CST 00
            if (cst === "00") {
                todosProdutos.push({ grupo: "Aliquota 4%", linha: linha });
                produtoAdicionado = true;
            }
            
            // Grupo 7%: CSOSN 101 ou 102
            if (csosn === "101" || csosn === "102") {
                todosProdutos.push({ grupo: "Aliquota 7%", linha: linha });
                produtoAdicionado = true;
            }
            
            // Debug: log do primeiro produto
            if (todosProdutos.length === 1) {
                console.log('Primeiro produto extraído:', linha, 'Grupo:', todosProdutos[0].grupo);
            }
        }
        
        // Agrupar produtos por grupo para retornar
        const produtosPorGrupo = {
            "Aliquota 1,54%": [],
            "Aliquota 4%": [],
            "Aliquota 7%": []
        };
        
        todosProdutos.forEach(item => {
            if (produtosPorGrupo[item.grupo]) {
                produtosPorGrupo[item.grupo].push(item.linha);
            }
        });
        
        console.log(`Total de produtos extraídos deste XML: ${todosProdutos.length}`);
        console.log(`  - Aliquota 1,54%: ${produtosPorGrupo["Aliquota 1,54%"].length}`);
        console.log(`  - Aliquota 4%: ${produtosPorGrupo["Aliquota 4%"].length}`);
        console.log(`  - Aliquota 7%: ${produtosPorGrupo["Aliquota 7%"].length}`);

        return { cnpj, periodo, razaoSocial, resultados: produtosPorGrupo };
    } catch (error) {
        console.error('Erro ao processar XML:', error);
        return { cnpj: "", periodo: "", resultados: { todos: [] } };
    }
}

// Função para normalizar razão social
function normalizarRazaoSocial(razoes) {
    function normalizar(nome) {
        nome = nome.toUpperCase().trim();
        nome = nome.replace(/[-–—]\s*ME$/i, '');
        nome = nome.replace(/\s{2,}/g, ' ');
        return nome;
    }

    const razoesSubstituidas = razoes.map(razao => {
        const nomeNormalizado = normalizar(razao);
        return BIBLIOTECA_RAZOES[nomeNormalizado] || razao.trim();
    });

    // Contar ocorrências
    const contagem = {};
    razoesSubstituidas.forEach(razao => {
        contagem[razao] = (contagem[razao] || 0) + 1;
    });

    // Retornar a mais comum
    return Object.entries(contagem).sort((a, b) => b[1] - a[1])[0][0];
}

// Função para unescape HTML
function unescapeHtml(text) {
    const div = document.createElement('div');
    div.innerHTML = text;
    return div.textContent || div.innerText || text;
}

// Função para carregar modelo Excel
async function loadIcmsModelo() {
    // Criar modelo básico se não houver arquivo
    // Por enquanto, vamos criar um modelo simples
    const wb = XLSX.utils.book_new();
    
    // Aba principal
    const abaPrincipal = [
        ['ICMS ST 1104', '', ''],
        ['', '', ''],
        ['Razão Social:', '', ''],
        ['', '', ''],
        ['Período:', '', ''],
    ];
    const wsPrincipal = XLSX.utils.aoa_to_sheet(abaPrincipal);
    XLSX.utils.book_append_sheet(wb, wsPrincipal, 'ICMS ST 1104');
    
    // Abas de alíquotas
    for (const config of Object.values(ICMS_CONFIG.MAPEAMENTO_ABAS)) {
        const aba = [['Chave', 'UF', 'Número NF', 'Fornecedor', 'Produto', 'NCM', 'CFOP', 'CST/CSOSN', 'Frete', 'Outras', 'IPI', 'Valor Produto']];
        const ws = XLSX.utils.aoa_to_sheet(aba);
        XLSX.utils.book_append_sheet(wb, ws, config.nome);
    }
    
    icmsModeloWorkbook = wb;
    console.log('Modelo Excel criado');
}

//------------------------------------- FIM ICMS Withholding ------------------------------------//
//--------------------------------------------- DIRBI -------------------------------------------//

// Modelo DIRBI embutido. Linhas 4-21: col D = NCM(s) exigidos, col E = valor a somar,
// F/G = fórmulas Pis/Cofins (=E*1.65% / =E*7.6%) que NÃO devem ser tocadas. B2 = razão social.
const DIRBI_MODELO_PATH = 'assets/js/DIRBI MES-ANO.xlsx';

// ---- Helpers compartilhados DIRBI/ICMS (entrada .zip e saída zip/xlsx) ----
// São function declarations (hoisted), então a posição no arquivo não importa.

// Expande uma FileList em [{name, text}] de XMLs. Arquivos .zip são descompactados
// no browser (JSZip) e seus .xml internos extraídos; .xml avulsos passam direto;
// outros tipos são ignorados. XMLs ilegíveis são descartados silenciosamente.
async function expandXmlInputs(fileList) {
    const out = [];
    for (const file of Array.from(fileList)) {
        const lower = (file.name || '').toLowerCase();
        if (lower.endsWith('.xml')) {
            try { out.push({ name: file.name, text: await file.text() }); } catch (_) { /* ignora */ }
        } else if (lower.endsWith('.zip')) {
            if (typeof JSZip === 'undefined') throw new Error('JSZip não carregou — não é possível ler arquivos .zip.');
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const entries = Object.values(zip.files).filter(
                (e) => !e.dir && e.name.toLowerCase().endsWith('.xml'));
            for (const entry of entries) {
                try { out.push({ name: entry.name, text: await entry.async('string') }); } catch (_) { /* ignora */ }
            }
        }
    }
    return out;
}

// Dispara o download de um Blob com o nome dado.
function triggerDownload(blob, nome) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Com 1 arquivo, baixa o .xlsx direto; com vários, empacota num .zip. arquivos: [{nome, buffer}].
async function downloadXlsxOrZip(arquivos, zipNome) {
    if (!arquivos.length) return;
    if (arquivos.length === 1) {
        triggerDownload(new Blob([arquivos[0].buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }), arquivos[0].nome);
        return;
    }
    if (typeof JSZip === 'undefined') throw new Error('JSZip não carregou — não é possível gerar o .zip.');
    const zip = new JSZip();
    for (const a of arquivos) zip.file(a.nome, a.buffer);
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    triggerDownload(zipBlob, zipNome);
}

// Lê as regras de NCM do modelo (D4:D21). Cada célula pode conter um NCM ou vários
// separados por "-"/espaços, com formatos mistos (número, string com zero à esquerda).
// Retorna [{ row, prefixes: [string...] }] com os prefixos normalizados (só dígitos).
function parseDirbiNcmRules(ws) {
    const rules = [];
    for (let r = 4; r <= 21; r++) {
        const raw = ws.getCell('D' + r).value;
        if (raw === null || raw === undefined || raw === '') continue;
        const prefixes = String(raw)
            .split(/[^0-9]+/)        // separa por qualquer não-dígito (hífen, espaços)
            .map((s) => s.trim())
            .filter(Boolean);
        if (prefixes.length) rules.push({ row: r, prefixes });
    }
    return rules;
}

// Retorna a linha (4-21) da PRIMEIRA regra cujo prefixo casa o início do NCM, ou null.
// "Primeira que casa" evita dupla contagem quando categorias têm prefixos próximos.
function matchDirbiRow(ncm, rules) {
    for (const rule of rules) {
        for (const p of rule.prefixes) {
            if (ncm.startsWith(p)) return rule.row;
        }
    }
    return null;
}

// Cria a aba DIRBI: box de upload de múltiplos XML de NFC-e + status.
function createDirbiPage(mainContent) {
    mainContent.innerHTML = `
        <h1>DIRBI</h1>
        <div class="dirbi-container" style="display:flex; flex-direction:column; gap:1.6rem; max-width:1000px; margin:0 auto; padding:2rem;">
            <div id="dirbi-drop" class="dirbi-box animate-section" style="animation-delay:0s; width:100%; max-width:800px; min-height:300px; margin:0 auto; background-color:var(--color-white); border-radius:var(--card-border-radius); box-shadow:var(--box-shadow); padding:var(--card-padding); cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.75rem; text-align:center;">
                <span class="material-icons-sharp" style="font-size:3rem; color:var(--color-primary);">request_quote</span>
                <p id="dirbi-drop-label" style="font-weight:600;">Selecione os XML das NFC-e (ou arquivos .zip)</p>
                <small style="color:var(--color-dark-variant);">Aceita XML avulsos e .zip. Múltiplas empresas são separadas por CNPJ — uma planilha por empresa (zip quando houver mais de uma). As fórmulas de Pis/Cofins são preservadas.</small>
                <input type="file" id="dirbi-file-input" accept=".xml,.zip" multiple style="display:none;">
            </div>
            <div id="dirbi-status" style="max-width:800px; margin:0 auto; width:100%; color:var(--color-dark-variant);"></div>
        </div>
    `;

    const box = document.getElementById('dirbi-drop');
    const input = document.getElementById('dirbi-file-input');
    if (!box || !input) return;

    box.addEventListener('click', () => input.click());
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('dragover'); });
    box.addEventListener('dragleave', () => box.classList.remove('dragover'));
    box.addEventListener('drop', (e) => {
        e.preventDefault();
        box.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length) processDirbiXmls(e.dataTransfer.files);
    });
    input.addEventListener('change', () => {
        if (input.files && input.files.length) processDirbiXmls(input.files);
    });
}

// Processa o lote de XMLs (avulsos e/ou .zip), agrupa por CNPJ do emitente e gera
// uma planilha DIRBI por empresa. Com 1 empresa baixa o .xlsx direto; com várias,
// empacota tudo num DIRBI_{periodo}.zip. As fórmulas F/G do modelo são preservadas.
async function processDirbiXmls(fileList) {
    const status = document.getElementById('dirbi-status');
    const setStatus = (html) => { if (status) status.innerHTML = html; };

    let xmls;
    try {
        setStatus('Lendo arquivos (XML/ZIP)...');
        xmls = await expandXmlInputs(fileList);
    } catch (e) {
        setStatus(`<span style="color:var(--color-danger);">${escapeHtml(e.message || String(e))}</span>`);
        return;
    }
    if (!xmls.length) {
        setStatus('<span style="color:var(--color-danger);">Nenhum XML encontrado (avulso ou dentro de .zip).</span>');
        return;
    }

    try {
        setStatus('Carregando modelo DIRBI...');
        const resp = await fetch(DIRBI_MODELO_PATH);
        if (!resp.ok) throw new Error(`modelo não encontrado (${resp.status})`);
        const modelBuffer = await resp.arrayBuffer();

        // Regras de NCM lidas uma vez — iguais para todas as empresas (modelo único).
        const wbProbe = new ExcelJS.Workbook();
        await wbProbe.xlsx.load(modelBuffer);
        const wsProbe = wbProbe.getWorksheet('DIRBI') || wbProbe.worksheets[0];
        const rules = parseDirbiNcmRules(wsProbe);
        if (!rules.length) throw new Error('modelo sem regras de NCM (D4:D21 vazias)');

        // Agrupa por CNPJ do emitente. cnpj -> acumuladores da empresa.
        const empresas = {};
        let xmlInvalidos = 0;
        let periodoGlobal = '';
        const parser = new DOMParser();

        for (let i = 0; i < xmls.length; i++) {
            const doc = parser.parseFromString(xmls[i].text, 'application/xml');
            if (doc.getElementsByTagName('parsererror').length) { xmlInvalidos++; continue; }

            const dets = doc.getElementsByTagNameNS('*', 'det');
            if (!dets.length) { xmlInvalidos++; continue; }

            // Emitente: CNPJ (chave de agrupamento) e razão social (NFC-e não tem dest).
            const emit = doc.getElementsByTagNameNS('*', 'emit')[0];
            const cnpjEl = emit ? emit.getElementsByTagNameNS('*', 'CNPJ')[0] : null;
            const cnpj = cnpjEl && cnpjEl.textContent ? cnpjEl.textContent.replace(/\D/g, '') : 'sem-cnpj';
            const emp = empresas[cnpj] || (empresas[cnpj] = {
                somas: {}, razaoCount: {}, periodo: '', xmlLidos: 0, produtosCasados: 0, produtosSemRegra: 0,
            });

            const xNome = emit ? emit.getElementsByTagNameNS('*', 'xNome')[0] : null;
            if (xNome && xNome.textContent.trim()) {
                const nome = xNome.textContent.trim();
                emp.razaoCount[nome] = (emp.razaoCount[nome] || 0) + 1;
            }
            // Período (MM-YYYY) a partir do primeiro dhEmi válido da empresa.
            if (!emp.periodo) {
                const dh = doc.getElementsByTagNameNS('*', 'dhEmi')[0];
                const m = dh && dh.textContent ? dh.textContent.match(/^(\d{4})-(\d{2})/) : null;
                if (m) { emp.periodo = `${m[2]}-${m[1]}`; if (!periodoGlobal) periodoGlobal = emp.periodo; }
            }

            for (let d = 0; d < dets.length; d++) {
                const det = dets[d];
                const ncmEl = det.getElementsByTagNameNS('*', 'NCM')[0];
                const vEl = det.getElementsByTagNameNS('*', 'vProd')[0];
                if (!ncmEl || !vEl) continue;
                const ncm = (ncmEl.textContent || '').replace(/\D/g, '');
                if (!ncm) continue;
                const valor = parseFloat((vEl.textContent || '').replace(',', '.')) || 0;
                const row = matchDirbiRow(ncm, rules);
                if (row == null) { emp.produtosSemRegra++; continue; }
                emp.somas[row] = (emp.somas[row] || 0) + valor;
                emp.produtosCasados++;
            }
            emp.xmlLidos++;

            // Mantém a UI responsiva em lotes grandes.
            if (i % 100 === 0) {
                setStatus(`Processando ${i + 1}/${xmls.length} XML...`);
                await new Promise((r) => requestAnimationFrame(r));
            }
        }

        const cnpjs = Object.keys(empresas);
        if (!cnpjs.length) throw new Error('nenhum XML válido de NFC-e encontrado.');

        setStatus(`Gerando ${cnpjs.length} planilha(s)...`);
        const arquivos = [];
        const resumo = [];
        for (const cnpj of cnpjs) {
            const emp = empresas[cnpj];
            // Recarrega o modelo do buffer para cada empresa (workbook independente).
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(modelBuffer);
            const ws = wb.getWorksheet('DIRBI') || wb.worksheets[0];

            // Escreve as somas em E4:E21 (preserva F/G) e a razão social em B2.
            for (const rule of rules) {
                ws.getCell('E' + rule.row).value = Math.round((emp.somas[rule.row] || 0) * 100) / 100;
            }
            const razaoFinal = Object.keys(emp.razaoCount).reduce(
                (a, b) => (emp.razaoCount[a] >= emp.razaoCount[b] ? a : b), '');
            if (razaoFinal) ws.getCell('B2').value = razaoFinal;

            // As fórmulas F/G (Pis/Cofins = E*1,65% / E*7,6%) são shared formulas cujo
            // valor cacheado <v> o ExcelJS não recalcula ao reescrever: ele mantém o cache
            // do modelo (E vazio → 0). fullCalcOnLoad força o Excel/WPS a recalcular toda a
            // pasta ao abrir, descartando o cache stale e exibindo F/G corretos.
            wb.calcProperties = { fullCalcOnLoad: true };

            const buffer = await wb.xlsx.writeBuffer();
            const nomeArq = `DIRBI ${emp.periodo || 'sem-periodo'}_${(razaoFinal || cnpj || 'empresa').replace(/[\\/:*?"<>|]/g, '').slice(0, 60)}.xlsx`;
            arquivos.push({ nome: nomeArq, buffer });
            resumo.push(
                `&bull; ${escapeHtml(razaoFinal || cnpj)} — ${emp.xmlLidos} XML, ${emp.produtosCasados} produto(s)` +
                `${emp.produtosSemRegra ? `, ${emp.produtosSemRegra} sem NCM` : ''}`);
        }

        const zipNome = `DIRBI_${periodoGlobal || 'sem-periodo'}.zip`;
        await downloadXlsxOrZip(arquivos, zipNome);

        setStatus(
            `<div style="background:var(--color-white); border-radius:var(--card-border-radius); box-shadow:var(--box-shadow); padding:1rem;">` +
            `<strong>Concluído.</strong> ${cnpjs.length} empresa(s)` +
            `${xmlInvalidos ? ` &middot; ${xmlInvalidos} XML inválido(s) ignorado(s)` : ''}.<br>` +
            resumo.join('<br>') + `<br>` +
            (arquivos.length > 1
                ? `Arquivo <strong>${escapeHtml(zipNome)}</strong> (zip com ${arquivos.length} planilhas) baixado.`
                : `Planilha <strong>${escapeHtml(arquivos[0].nome)}</strong> baixada.`) +
            `</div>`
        );
    } catch (e) {
        console.error('Erro ao processar DIRBI:', e);
        setStatus(`<span style="color:var(--color-danger);">Erro ao gerar a DIRBI: ${escapeHtml(e.message || String(e))}</span>`);
    }
}

//------------------------------------------- FIM DIRBI -----------------------------------------//
//--------------------------------------------- SPED --------------------------------------------//

// Ler arquivo SPED com detecção automática de encoding
/**
 * Lê arquivo SPED detectando encoding (UTF-8 / Windows-1252 / ISO-8859-1).
 * Retorna { text, encoding } — o caller PRECISA do encoding para re-encodar
 * antes de salvar; senão caracteres acentuados viram mojibake.
 *
 * @param {File} file
 * @returns {Promise<{text: string, encoding: string}>}
 */
function readSpedFileWithEncoding(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const bytes = new Uint8Array(e.target.result);
            // SPED Fiscal/Contribuições é win-1252 na prática, mas alguns geradores
            // emitem UTF-8. UTF-8 é auto-validável: se os bytes decodificam sem erro
            // em modo estrito E há algum byte multibyte (>= 0x80), é UTF-8; caso
            // contrário, win-1252. Isso é determinístico e substitui a detecção
            // instável do jschardet — que classificava win-1252 como UTF-8 e fazia
            // 0xE7 (ç) virar U+FFFD (�) já na leitura, gravando mojibake permanente.
            let encoding = 'windows-1252';
            try {
                new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                if (bytes.some((b) => b >= 0x80)) encoding = 'utf-8';
            } catch (_) {
                encoding = 'windows-1252';
            }
            const decoder = new TextDecoder(encoding, { fatal: false });
            resolve({ text: decoder.decode(bytes), encoding });
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Codifica uma string JS de volta para bytes no encoding original do arquivo SPED.
 * O browser nativo só suporta TextEncoder('utf-8'); para windows-1252 usamos tabela
 * (caracteres acima de U+00FF caem para '?').
 *
 * @param {string} text
 * @param {string} encoding
 * @returns {Uint8Array}
 */
function encodeSpedText(text, encoding) {
    const enc = (encoding || '').toLowerCase();
    if (enc === 'utf-8' || enc === 'utf8') {
        return new TextEncoder().encode(text);
    }
    // Windows-1252 / ISO-8859-1: mapeia char → byte 0-255.
    // U+0080..U+009F especiais do windows-1252 (€, ƒ, …, ™, etc.) entram explicitamente.
    const win1252Map = {
        0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
        0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
        0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
        0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
        0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
        0x017E: 0x9E, 0x0178: 0x9F,
    };
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        const cp = text.charCodeAt(i);
        if (cp < 0x80 || (cp >= 0xA0 && cp <= 0xFF)) {
            bytes[i] = cp;
        } else if (win1252Map[cp] !== undefined) {
            bytes[i] = win1252Map[cp];
        } else {
            bytes[i] = 0x3F; // '?'
        }
    }
    return bytes;
}

/**
 * Codifica uma string JS de volta para bytes latin1 (ISO-8859-1) puro.
 * Par exato de `reader.readAsText(file, 'latin1')`: cada caractere foi lido como
 * 1 byte (code point 0..255), então re-emitimos o mesmo byte. Usado no download do
 * Fortes — NÃO usar encodeSpedText/win-1252 aqui, pois o range 0x80..0x9F (aspas/
 * travessões do Word) seria trocado por '?'. latin1 preserva o round-trip byte-a-byte.
 * @param {string} text
 * @returns {Uint8Array}
 */
function encodeLatin1(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i) & 0xFF;
    }
    return bytes;
}

// Função para abrir IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('SpedFileHandles', 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            db.createObjectStore('handles', { keyPath: 'name' });
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

// Função para salvar handle no IndexedDB
async function saveHandle(name, handle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['handles'], 'readwrite');
        const store = transaction.objectStore('handles');
        const request = store.put({ name, handle });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Função para recuperar handle do IndexedDB
async function getHandle(name) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['handles'], 'readonly');
        const store = transaction.objectStore('handles');
        const request = store.get(name);
        request.onsuccess = () => resolve(request.result ? request.result.handle : null);
        request.onerror = () => reject(request.error);
    });
}

function createSpedPage(mainContent) {
    console.log('createSpedPage chamado');
    
    // Garantir que CEST inicial esteja carregado (primeira execução)
    ensureCestInitialData();
    
    // Limpar dados salvos anteriores
    localStorage.removeItem('sped_paths');
    console.log('Dados SPED anteriores limpos');
    
    mainContent.innerHTML = `
        <h1>SPED</h1>
        <div class="sped-box animate-section" style="animation-delay: 0s; width: 100%; max-width: 800px; height: 400px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); cursor: pointer; display: flex; align-items: center; justify-content: center; pointer-events: auto !important; z-index: 1000;">
            <p>Arquivos SPED (.txt)</p>
        </div>
    `;

    const spedBox = document.querySelector('.sped-box');
    if (spedBox) {
        console.log('sped-box encontrado no DOM');
        spedBox.addEventListener('click', async (e) => {
            e.stopPropagation();
            console.log('Box clicado');

            // Limpar dados anteriores antes de nova seleção
            localStorage.removeItem('sped_paths');
            console.log('Dados SPED anteriores limpos antes da nova seleção');

            let files = [];
            // Sempre usar fallback (input de arquivo tradicional)
            const useApi = false;
            console.log('Usando fallback de input de arquivo (sempre)');
            
            // Sempre forçar nova seleção de arquivos
            console.log('Solicitando nova seleção de arquivos SPED');
            
                if (!useApi || !files.length) {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.accept = '.txt';
                    input.style.display = 'none';
                    document.body.appendChild(input);
                    console.log('Input de arquivo criado');
                    input.click();
                    console.log('input.click() disparado');

                    files = await new Promise((resolve) => {
                        input.addEventListener('change', (e) => {
                            resolve(Array.from(e.target.files).map(file => ({ file, handle: null })));
                            document.body.removeChild(input);
                        });
                    });
            }

            console.log('Arquivos selecionados:', files.map(({ file }) => file.name));

            mainContent.innerHTML = `
                <h1>SPED</h1>
                <div class="sped-container" style="width: 100%; max-width: 800px; margin: 0 auto;">
                    <div class="sped-box box animate-section" style="animation-delay: 0s; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding);">
                        <h2>Sped Fiscal | Contribuições</h2>
                        <div class="sped-drop-area" id="sped-drop" style="border: 2px dashed var(--color-primary); padding: 1rem; text-align: center; margin-bottom: 1rem;">
                            Arraste arquivos de texto (.txt) aqui
                        </div>
                        <div class="sped-results" id="sped-results" style="display: none;">
                            <ul id="sped-results-list" style="list-style: none; padding: 0;"></ul>
                        </div>
                    </div>
                </div>
                <div class="progress-container" id="progress-container" style="width: 100%; max-width: 800px; margin: 1rem auto;">
                    <div class="progress-bar" id="progress-bar" style="width: 100%; height: 20px; background-color: #e0e0e0; border-radius: 10px; overflow: hidden;">
                        <div class="progress-fill" id="progress-fill" style="width: 0%; height: 100%; background-color: var(--color-primary); transition: width 0.3s;"></div>
                    </div>
                    <span class="progress-percentage" id="progress-percentage" style="display: block; text-align: center; margin-top: 0.5rem;">0%</span>
                </div>
            `;

            const spedDrop = document.getElementById("sped-drop");
            const spedResultsList = document.getElementById("sped-results-list");
            const progressBar = document.getElementById("progress-fill");
            const progressPercentage = document.getElementById("progress-percentage");
            console.log('Configurando drop zone');
            setupSpedDropZone(spedDrop, spedResultsList, document.querySelector(".sped-box"), progressBar, progressPercentage);

            await processFiles(files, spedResultsList, progressBar, progressPercentage);
        });
    } else {
        console.error('Erro: sped-box não encontrado no DOM');
    }
}

async function processFiles(files, resultsList, progressBar, progressPercentage) {
    const totalFiles = files.length;
    let processedFiles = 0;
    let totalLines = 0;
    let processedLines = 0;
    
    // Calcular total de linhas de todos os arquivos primeiro
    console.log('Calculando total de linhas de todos os arquivos...');
    for (const { file } of files) {
        if (file.name.endsWith('.txt') || file.type === 'text/plain') {
            const lines = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const lines = e.target.result.split('\n');
                    resolve(lines.length);
                };
                reader.readAsText(file);
            });
            totalLines += lines;
            console.log(`${file.name}: ${lines} linhas`);
        }
    }
    console.log(`Total de linhas de todos os arquivos: ${totalLines}`);
    
    const resultsArea = document.querySelector('.sped-results');
    resultsArea.style.display = 'block';
    const box = document.querySelector('.sped-box');
    if (box) {
        box.classList.add('loaded');
    } else {
        console.error('Erro: box é null ao tentar adicionar classe loaded');
    }
    const dropArea = document.getElementById('sped-drop');
    dropArea.style.display = 'none';

    for (const { file, handle } of files) {
        try {
            // Usar apenas o handle fornecido na seleção atual
            const fileHandle = handle;

            if (file.name.endsWith('.txt') || file.type === 'text/plain') {
                const fileNameLower = file.name.toLowerCase();
                if (fileNameLower.includes('fiscal')) {
                    console.log(`Processando SPED Fiscal: ${file.name}`);
                    await processSpedFiscal(file, resultsList, progressBar, progressPercentage, totalLines, () => processedLines++, fileHandle);
                } else if (fileNameLower.includes('contribuicao') || fileNameLower.includes('contribuições') || fileNameLower.includes('contribuicoes')) {
                    console.log(`Processando SPED Contribuições: ${file.name}`);
                    await processSpedContribuicao(file, resultsList, progressBar, progressPercentage, totalLines, () => processedLines++, fileHandle);
                } else {
                    console.warn(`Arquivo ignorado (não contém 'FISCAL' ou 'CONTRIBUIÇÕES'): ${file.name}`);
                    const li = document.createElement('li');
                    li.textContent = `[ERRO] ${file.name}: Nome do arquivo não indica Fiscal ou Contribuições`;
                    resultsList.appendChild(li);
                }
            } else {
                console.warn(`Arquivo ignorado (não é .txt): ${file.name}`);
                const li = document.createElement('li');
                li.textContent = `[ERRO] ${file.name}: Formato inválido (apenas .txt é aceito)`;
                resultsList.appendChild(li);
            }
        } catch (error) {
            console.error(`Erro ao processar ${file.name}:`, error);
            const li = document.createElement('li');
            li.textContent = `[ERRO] ${file.name}: ${error.message}`;
            resultsList.appendChild(li);
        }
    }
    resultsArea.style.opacity = '1';
    console.log('Todos os arquivos processados');
}

function setupSpedDropZone(dropArea, resultsList, box, progressBar, progressPercentage) {
    console.log('setupSpedDropZone chamado');
    dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.classList.add('dragover');
        dropArea.style.borderColor = 'var(--color-success)';
        console.log('Dragover detectado');
    });

    dropArea.addEventListener('dragleave', () => {
        dropArea.classList.remove('dragover');
        dropArea.style.borderColor = 'var(--color-primary)';
        console.log('Dragleave detectado');
    });

    dropArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
        dropArea.style.borderColor = 'var(--color-primary)';
        resultsList.innerHTML = '';
        dropArea.style.display = 'none';
        const resultsArea = dropArea.parentElement.querySelector('.sped-results');
        resultsArea.style.display = 'block';
        if (box) {
            box.classList.add('loaded');
        } else {
            console.error('Erro: box é null ao tentar adicionar classe loaded');
        }
        console.log('Drop detectado, arquivos:', e.dataTransfer.files);

        const files = Array.from(e.dataTransfer.files).map(file => ({ file, handle: null }));
        await processFiles(files, resultsList, progressBar, progressPercentage);
    });
}

// Função para carregar produtos CEST (localStorage + Supabase)
async function getCestProducts() {
    const cestVencidos = await loadDataSync('cest_vencidos', []);
    const arr3 = Array.isArray(cestVencidos) ? cestVencidos : [];
    return {
        cestsVencidos: arr3.map(c => sanitizarCodigoCest(c)).filter(Boolean),
    };
}

// Carregar CEST inicial (sincronizar do Supabase + backup se vazio)
async function ensureCestInitialData() {
    if (window.supabaseSync && window.supabaseSync.isConfigured()) {
        try {
            await window.supabaseSync.syncAll(['cest_vencidos']);
        } catch (e) {
            console.warn('Erro ao sincronizar CEST do Supabase:', e);
        }
        // Realtime CEST (Fase 4): baseline + subscribe entre máquinas.
        try {
            const atual = JSON.parse(localStorage.getItem('cest_vencidos') || '[]');
            if (window.supabaseSync.primeCestBaseline) window.supabaseSync.primeCestBaseline(atual);
            if (window.supabaseSync.subscribeCestRealtime) {
                window.supabaseSync.subscribeCestRealtime(() => {
                    if (typeof updateCestArrays === 'function') updateCestArrays();
                    // Recarrega a lista só se a modal CEST estiver visível.
                    const lista = document.getElementById('cest-vencidos-list');
                    if (lista && lista.offsetParent !== null && typeof loadCestData === 'function') {
                        loadCestData();
                    }
                });
            }
        } catch (e) {
            console.warn('Realtime CEST indisponível:', e);
        }
    }
    if (typeof updateCestArrays === 'function') updateCestArrays();
}

async function processSpedFiscal(file, resultsList, progressBar, progressPercentage, totalLines, incrementProcessedLines, handle) {
    try {
        console.log(`Iniciando processamento de ${file.name}`);
        const { text: fileContent, encoding: srcEncoding } = await readSpedFileWithEncoding(file);
        const { cestsVencidos } = await getCestProducts();
        const vencidosSet = new Set((cestsVencidos || []).map(c => sanitizarCodigoCest(c)));
        // Preserva a quebra de linha original (SPED é \r\n; alguns geradores usam \n).
        const eol = fileContent.includes('\r\n') ? '\r\n' : '\n';
        const lines = fileContent.split(/\r?\n/);
                const hasEmptyLastLine = lines[lines.length - 1] === '';
                const fileLines = lines.length;
                const produtos = {};
                const newLines = [];

                for (const rawLine of lines) {
                    if (rawLine === '') {
                        newLines.push(rawLine);
                        const currentProcessed = incrementProcessedLines();
                        const progress = (currentProcessed / totalLines) * 100;
                        progressBar.style.width = `${progress}%`;
                        progressPercentage.textContent = `${Math.round(progress)}%`;
                        continue;
                    }
                    const fields = rawLine.split('|').map(f => f.trim());
                    const tag = fields[1] || '';

                    if (tag === '0150') {
                        if (fields.length > 4 && fields[4] !== '1058') fields[4] = '1058';
                        if (fields.length > 9 && ['0', '1'].includes(fields[9])) fields[9] = '';
                        if (fields.length > 11 && ['0', '1'].includes(fields[11])) fields[11] = '';
                    } else if (tag === '0190') {
                        if (fields.length > 3 && !fields[3]) {
                            fields[3] = fields[2] === 'KG' ? 'QUILO' : 'UNIDADE';
                        }
                    } else if (tag === '0200') {
                        if (fields.length > 6) produtos[fields[2]] = fields[6];
                        if (fields.length > 7 && !fields[7]) fields[7] = '00';
                        if (fields.length > 13) {
                            const produtoDescricao = (fields[3] || '').trim();
                            const cestAtual = sanitizarCodigoCest(fields[13]);

                            // Regra única: se o CEST atual está na lista de vencidos indicada
                            // pelo usuário, substituir por 0300300 (descrição contém "água") ou
                            // 2899900 (caso contrário).
                            if (cestAtual && vencidosSet.has(cestAtual)) {
                                fields[13] = descricaoContemAgua(produtoDescricao) ? '0300300' : '2899900';
                            }
                        }
                    } else if (tag === 'C170') {
                        if (fields.length > 6) {
                            const novaUn = produtos[fields[3]];
                            if (novaUn && fields[6] !== novaUn) fields[6] = novaUn;
                        }
                        if (fields.length > 37 && !fields[37]) fields[37] = '1011501010001';
                    } else if (tag === 'C100') {
                        if (fields.length > 7 && !fields[7]) fields[7] = '1';
                        if (fields.length > 2 && fields[2].includes('1')) {
                            fields[2] = fields[3] === '1' ? '0' : '1';
                        }
                    } else if (tag === 'C191') {
                        if (fields.length > 4) {
                            fields[2] = '0';
                            fields[3] = '0';
                            fields[4] = '0';
                        }
                    }

                    newLines.push(fields.join('|'));
                    const currentProcessed = incrementProcessedLines();
                    const progress = (currentProcessed / totalLines) * 100;
                    progressBar.style.width = `${progress}%`;
                    progressPercentage.textContent = `${Math.round(progress)}%`;
                }

                if (!hasEmptyLastLine) newLines.push('');

                // FIX ENCODING: re-codifica no encoding original do arquivo (evita mojibake).
                const blob = new Blob([encodeSpedText(newLines.join(eol), srcEncoding)], { type: 'text/plain' });
                if (handle) {
                    try {
                        const permission = await handle.queryPermission({ mode: 'readwrite' });
                        if (permission !== 'granted') {
                            await handle.requestPermission({ mode: 'readwrite' });
                        }
                        const writable = await handle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                        const li = document.createElement('li');
                        li.textContent = `[OK] ${file.name} corrigido e sobrescrito automaticamente`;
                        resultsList.appendChild(li);
                        console.log(`Processamento de ${file.name} concluído e sobrescrito automaticamente`);
                    } catch (error) {
                        console.error(`Erro ao sobrescrever ${file.name}:`, error);
                        const li = document.createElement('li');
                        li.textContent = `[ERRO] ${file.name}: Falha ao sobrescrever (${error.message})`;
                        resultsList.appendChild(li);
                    }
                } else {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = file.name;
                    a.click();
                    URL.revokeObjectURL(url);
                    const li = document.createElement('li');
                    li.textContent = `[OK] ${file.name} corrigido e baixado`;
                    resultsList.appendChild(li);
                    console.log(`Processamento de ${file.name} concluído com download`);
                }
    } catch (error) {
        console.warn(`Erro ao processar ${file.name}:`, error);
        const li = document.createElement('li');
        li.textContent = `[ERRO] ${file.name}: ${error.message}`;
        resultsList.appendChild(li);
    }
}

async function processSpedContribuicao(file, resultsList, progressBar, progressPercentage, totalLines, incrementProcessedLines, handle) {
    try {
        console.log(`Iniciando processamento de ${file.name}`);
        const { text: fileContent, encoding: srcEncoding } = await readSpedFileWithEncoding(file);
        // Preserva a quebra de linha original (SPED é \r\n; alguns geradores usam \n).
        const eol = fileContent.includes('\r\n') ? '\r\n' : '\n';
        const lines = fileContent.split(/\r?\n/);
                const hasEmptyLastLine = lines[lines.length - 1] === '';
                const fileLines = lines.length;
                const produtos = {};
                const newLines = [];

                for (const rawLine of lines) {
                    if (rawLine === '') {
                        newLines.push(rawLine);
                        const currentProcessed = incrementProcessedLines();
                        const progress = (currentProcessed / totalLines) * 100;
                        progressBar.style.width = `${progress}%`;
                        progressPercentage.textContent = `${Math.round(progress)}%`;
                        continue;
                    }
                    const fields = rawLine.split('|').map(f => f.trim());
                    const tag = fields[1] || '';

                    if (tag === '0150') {
                        if (fields.length > 4 && fields[4] !== '1058') fields[4] = '1058';
                        if (fields.length > 9 && ['0', '1'].includes(fields[9])) fields[9] = '';
                        if (fields.length > 11 && ['0', '1'].includes(fields[11])) fields[11] = '';
                    } else if (tag === '0190') {
                        if (fields.length > 3 && !fields[3]) {
                            fields[3] = fields[2] === 'KG' ? 'QUILO' : 'UNIDADE';
                        }
                    } else if (tag === '0200') {
                        if (fields.length > 6) produtos[fields[2]] = fields[6];
                        if (fields.length > 7 && !fields[7]) fields[7] = '00';
                    } else if (tag === 'C870') {
                        if (fields.length > 14 && !fields[14]) fields[14] = '1011501010001';
                    }

                    newLines.push(fields.join('|'));
                    const currentProcessed = incrementProcessedLines();
                    const progress = (currentProcessed / totalLines) * 100;
                    progressBar.style.width = `${progress}%`;
                    progressPercentage.textContent = `${Math.round(progress)}%`;
                }

                if (!hasEmptyLastLine) newLines.push('');

                // FIX ENCODING: re-codifica no encoding original do arquivo (evita mojibake).
                const blob = new Blob([encodeSpedText(newLines.join(eol), srcEncoding)], { type: 'text/plain' });
                if (handle) {
                    try {
                        const permission = await handle.queryPermission({ mode: 'readwrite' });
                        if (permission !== 'granted') {
                            await handle.requestPermission({ mode: 'readwrite' });
                        }
                        const writable = await handle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                        const li = document.createElement('li');
                        li.textContent = `[OK] ${file.name} corrigido e sobrescrito automaticamente`;
                        resultsList.appendChild(li);
                        console.log(`Processamento de ${file.name} concluído e sobrescrito automaticamente`);
                    } catch (error) {
                        console.error(`Erro ao sobrescrever ${file.name}:`, error);
                        const li = document.createElement('li');
                        li.textContent = `[ERRO] ${file.name}: Falha ao sobrescrever (${error.message})`;
                        resultsList.appendChild(li);
                    }
                } else {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = file.name;
                    a.click();
                    URL.revokeObjectURL(url);
                    const li = document.createElement('li');
                    li.textContent = `[OK] ${file.name} corrigido e baixado (salve manualmente no mesmo local)`;
                    resultsList.appendChild(li);
                    console.log(`Processamento de ${file.name} concluído com download`);
                }
    } catch (error) {
        console.warn(`Erro ao processar ${file.name}:`, error);
        const li = document.createElement('li');
        li.textContent = `[ERRO] ${file.name}: ${error.message}`;
        resultsList.appendChild(li);
    }
}

//------------------------------------------- FIM SPED ------------------------------------------
//------------------------------------ Fortes Correction ------------------------------------//

let fortesFileData = null;
let fortesAdjustmentsText = '';
let fortesReportMap = null; // Feature A: Map<chave44, valorTotal> do relatório (autoridade)

function createFortesCorrectionPage(mainContent) {
    console.log('createFortesCorrectionPage chamado');
    mainContent.innerHTML = `
        <h1>Fortes Correction</h1>
        <div class="fortes-correction-grid" style="display: flex; flex-direction: column; gap: 1.6rem; max-width: 1200px; margin: 0 auto; padding: 2rem;">
            <!-- Box Superior: Upload de Arquivo .fs -->
            <div class="box animate-section fortes-file-box" style="animation-delay: 0s; width: 100%; max-width: 800px; height: 250px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center;" id="fortes-file-box">
                <span class="material-icons-sharp" style="font-size: 3rem; color: var(--color-primary); margin-bottom: 1rem;">cloud_upload</span>
                <span class="box-label" id="fortes-file-label" style="font-size: 1.2rem; font-weight: 600; color: var(--color-dark); margin-bottom: 0.5rem;">Arraste e solte o arquivo .fs aqui</span>
                <span style="font-size: 0.9rem; color: var(--color-dark-variant);">ou clique para selecionar</span>
                <input type="file" id="fortes-file-input" accept=".fs" style="display: none;">
                <div id="fortes-file-info" style="display: none; margin-top: 1rem; text-align: center;">
                    <span class="material-icons-sharp" style="font-size: 2rem; color: var(--color-success);">check_circle</span>
                    <p id="fortes-file-name" style="margin-top: 0.5rem; color: var(--color-success); font-weight: 500;"></p>
                </div>
            </div>
            
            <!-- Stack: Relatório de Valores (frente) + Instruções de Ajuste (verso) -->
            <div class="fortes-stack" style="position: relative; width: 100%; max-width: 800px; margin: 0 auto;">
                <button id="fortes-toggle-cards" type="button" title="Alternar Relatório / Instruções" style="position: absolute; top: -0.6rem; right: -0.6rem; background: var(--color-primary); color: #fff; border: none; border-radius: 50%; width: 42px; height: 42px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: var(--box-shadow); z-index: 20;">
                    <span class="material-icons-sharp">swap_vert</span>
                </button>
                <!-- Card Relatório (frente) -->
                <div class="box fortes-report-box" id="fortes-report-box" style="width: 100%; height: 500px; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: transform 0.4s ease, opacity 0.4s ease; z-index: 2;">
                    <span class="material-icons-sharp" style="font-size: 3rem; color: var(--color-primary); margin-bottom: 1rem;">request_quote</span>
                    <span id="fortes-report-label" style="font-size: 1.2rem; font-weight: 600; color: var(--color-dark); margin-bottom: 0.5rem;">Solte o relatório de valores (CSV / XLSX)</span>
                    <span style="font-size: 0.9rem; color: var(--color-dark-variant); text-align: center; max-width: 90%;">SIGA — colunas "Chave NF-e" e "Valor R$". Fonte de verdade dos valores.</span>
                    <input type="file" id="fortes-report-input" accept=".csv,.xls,.xlsx,.txt" style="display: none;">
                    <div id="fortes-report-info" style="display: none; margin-top: 1rem; text-align: center;">
                        <span class="material-icons-sharp" style="font-size: 2rem; color: var(--color-success);">check_circle</span>
                        <p id="fortes-report-name" style="margin-top: 0.5rem; color: var(--color-success); font-weight: 500;"></p>
                    </div>
                </div>
                <!-- Card Instruções (verso) -->
                <div class="box animate-section fortes-instructions-box" id="fortes-instructions-box" style="position: absolute; top: 0; left: 0; width: 100%; height: 500px; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); display: flex; flex-direction: column; transition: transform 0.4s ease, opacity 0.4s ease; transform: translateY(18px) scale(0.96); opacity: 0; pointer-events: none; z-index: 1;">
                <label for="fortes-adjustments-textarea" style="font-size: 1.1rem; font-weight: 600; color: var(--color-dark); margin-bottom: 1rem;">
                    <span class="material-icons-sharp" style="vertical-align: middle; margin-right: 0.5rem;">edit_note</span>
                    Instruções de Ajuste
                </label>
                <textarea 
                    id="fortes-adjustments-textarea" 
                    placeholder="Cole aqui as linhas de erro do relatório de importação...&#10;&#10;Exemplo de erro de CEST:&#10;0000000885 Valor do campo &quot;Código Especificador da Substituição Tributária - CEST&quot; não é válido (0016214). Campo 41. Registro PRO.&#10;&#10;Exemplo de erro de Quantidade:&#10;0000001498 Valor do campo Quantidade equivalente padrão deve ser maior que zero (0.00). Campo 4. Registro OUM.&#10;&#10;Exemplo de erro de Inscrição Estadual:&#10;0000000051 Inscrição Estadual do participante inválida (63759837). Campo 6. Registro PAR.&#10;&#10;Exemplo de erro de CST:&#10;0000001579 Campo CST(PIS) em branco. Esse campo será necessário para a geração do SPED Fiscal. Campo 38. Registro PNM.&#10;&#10;Exemplo de erro de Duplicidade:&#10;0000001154 Código do Produto(10115) em duplicidade no arquivo. Registro PRO.&#10;&#10;Exemplo de erro de NF1:&#10;0000001795 AIDF não encontrada para o documento (Estab.: 0001; AIDF: ; Espécie: NF1; Série: 2; Subs.: ; Núm./Form.: 0000026).&#10;&#10;Exemplo de erro de Valor Total:&#10;0000007011 Documento:000848622; Data:04/06/2025: Valor Total difere da Base de Cálculo, Isentas e Outras.&#10;&#10;Exemplo de erro de Soma CFOP:&#10;0000012362 A soma dos valores do CFOP 1910 do registro INM (19,77) difere da soma do valor líquido do registro PNM (17,71).&#10;&#10;O sistema irá automaticamente:&#10;- Identificar o tipo de erro&#10;- Localizar a linha e o campo&#10;- Aplicar a correção apropriada&#10;- Atualizar o total de linhas no final do arquivo&#10;&#10;Você pode colar múltiplos erros, um por linha."
                    style="flex: 1; width: 100%; padding: 1rem; border: 2px solid var(--color-light); border-radius: var(--border-radius-1); font-family: 'Poppins', sans-serif; font-size: 0.95rem; color: var(--color-dark); background: var(--color-background); resize: none; outline: none; transition: border-color 0.3s ease;"
                ></textarea>
                </div><!-- /fortes-instructions-box -->
            </div><!-- /fortes-stack -->
            <div style="width: 100%; max-width: 800px; margin: 0.75rem auto 0; display: flex; gap: 1rem; justify-content: flex-end;">
                <button id="fortes-process-btn" class="btn-process" style="padding: 0.75rem 2rem; background: var(--color-primary); color: var(--color-white); border: none; border-radius: var(--border-radius-1); cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 1rem; transition: all 0.3s ease; display: flex; align-items: center; gap: 0.5rem;" disabled>
                    <span class="material-icons-sharp">build</span>
                    Processar
                </button>
                <button id="fortes-download-btn" class="btn-download" style="padding: 0.75rem 2rem; background: var(--color-success); color: var(--color-white); border: none; border-radius: var(--border-radius-1); cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 1rem; transition: all 0.3s ease; display: flex; align-items: center; gap: 0.5rem; display: none;">
                    <span class="material-icons-sharp">download</span>
                    Baixar Arquivo Corrigido
                </button>
            </div>
        </div>
    `;

    const fortesFileBox = document.getElementById('fortes-file-box');
    const fortesFileInput = document.getElementById('fortes-file-input');
    const fortesFileLabel = document.getElementById('fortes-file-label');
    const fortesFileInfo = document.getElementById('fortes-file-info');
    const fortesFileName = document.getElementById('fortes-file-name');
    const fortesAdjustmentsTextarea = document.getElementById('fortes-adjustments-textarea');
    const fortesProcessBtn = document.getElementById('fortes-process-btn');
    const fortesDownloadBtn = document.getElementById('fortes-download-btn');

    // Configurar drag & drop para o box de arquivo
    fortesFileBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        fortesFileBox.classList.add('dragover');
    });

    fortesFileBox.addEventListener('dragleave', () => {
        fortesFileBox.classList.remove('dragover');
    });

    fortesFileBox.addEventListener('drop', (e) => {
        e.preventDefault();
        fortesFileBox.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].name.toLowerCase().endsWith('.fs')) {
            handleFortesFile(files[0]);
        } else {
            alert('Por favor, selecione um arquivo .fs');
        }
    });

    fortesFileBox.addEventListener('click', () => {
        fortesFileInput.click();
    });

    fortesFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFortesFile(e.target.files[0]);
        }
    });

    // Função para processar o arquivo .fs
    function handleFortesFile(file) {
        console.log('Arquivo .fs selecionado:', file.name);
        fortesFileData = null;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                fortesFileData = e.target.result;
                fortesFileLabel.textContent = 'Arquivo carregado com sucesso!';
                fortesFileLabel.style.color = 'var(--color-success)';
                fortesFileInfo.style.display = 'block';
                fortesFileName.textContent = file.name;
                fortesProcessBtn.disabled = false;
                console.log('Arquivo .fs carregado. Tamanho:', fortesFileData.length, 'caracteres');
            } catch (error) {
                console.error('Erro ao ler arquivo:', error);
                alert('Erro ao ler o arquivo. Por favor, tente novamente.');
            }
        };
        reader.onerror = () => {
            console.error('Erro ao ler arquivo');
            alert('Erro ao ler o arquivo. Por favor, tente novamente.');
        };
        reader.readAsText(file, 'latin1'); // Usar latin1 para preservar caracteres especiais
    }

    // --- Feature A: dropzone do relatório de valores + alternância de cards ---
    const fortesReportBox = document.getElementById('fortes-report-box');
    const fortesReportInput = document.getElementById('fortes-report-input');
    const fortesReportLabel = document.getElementById('fortes-report-label');
    const fortesReportInfo = document.getElementById('fortes-report-info');
    const fortesReportName = document.getElementById('fortes-report-name');
    const fortesInstrBox = document.getElementById('fortes-instructions-box');
    const fortesToggle = document.getElementById('fortes-toggle-cards');

    function handleFortesReport(file) {
        if (!file) return;
        parseFortesReport(file).then((map) => {
            fortesReportMap = (map && map.size) ? map : null;
            if (fortesReportMap) {
                if (fortesReportLabel) { fortesReportLabel.textContent = 'Relatório carregado!'; fortesReportLabel.style.color = 'var(--color-success)'; }
                if (fortesReportInfo) fortesReportInfo.style.display = 'block';
                if (fortesReportName) fortesReportName.textContent = `${file.name} — ${fortesReportMap.size} nota(s)`;
                if (fortesFileData && fortesProcessBtn) fortesProcessBtn.disabled = false;
            } else {
                alert('Não encontrei colunas "Chave NF-e" e "Valor" no relatório.');
            }
        });
    }
    if (fortesReportBox && fortesReportInput) {
        fortesReportBox.addEventListener('click', (e) => { if (e.target.closest('#fortes-toggle-cards')) return; fortesReportInput.click(); });
        fortesReportBox.addEventListener('dragover', (e) => { e.preventDefault(); fortesReportBox.classList.add('dragover'); });
        fortesReportBox.addEventListener('dragleave', () => fortesReportBox.classList.remove('dragover'));
        fortesReportBox.addEventListener('drop', (e) => { e.preventDefault(); fortesReportBox.classList.remove('dragover'); if (e.dataTransfer.files.length) handleFortesReport(e.dataTransfer.files[0]); });
        fortesReportInput.addEventListener('change', (e) => { if (e.target.files.length) handleFortesReport(e.target.files[0]); });
    }

    // Stack: define qual card fica na frente (relativo, opaco) e qual no verso (absoluto, esmaecido).
    function setStackFront(front, back) {
        front.style.position = 'relative';
        front.style.transform = 'translateY(0) scale(1)';
        front.style.opacity = '1';
        front.style.pointerEvents = 'auto';
        front.style.zIndex = '2';
        back.style.position = 'absolute';
        back.style.top = '0'; back.style.left = '0';
        back.style.transform = 'translateY(18px) scale(0.96)';
        back.style.opacity = '0';
        back.style.pointerEvents = 'none';
        back.style.zIndex = '1';
    }
    let reportOnFront = true;
    if (fortesToggle && fortesReportBox && fortesInstrBox) {
        setStackFront(fortesReportBox, fortesInstrBox);
        fortesToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            reportOnFront = !reportOnFront;
            if (reportOnFront) setStackFront(fortesReportBox, fortesInstrBox);
            else setStackFront(fortesInstrBox, fortesReportBox);
        });
    }

    // Monitorar mudanças no textarea
    fortesAdjustmentsTextarea.addEventListener('input', () => {
        fortesAdjustmentsText = fortesAdjustmentsTextarea.value.trim();
        if (fortesFileData && fortesAdjustmentsText) {
            fortesProcessBtn.disabled = false;
        } else {
            fortesProcessBtn.disabled = true;
        }
    });

    // Botão de processar: relatório presente → pipeline completo (Feature A);
    // só instruções → fluxo de instruções legado.
    fortesProcessBtn.addEventListener('click', () => {
        if (!fortesFileData) {
            alert('Por favor, carregue um arquivo .fs primeiro.');
            return;
        }
        if (fortesReportMap && fortesReportMap.size) {
            processFortesFullCorrection();
        } else if (fortesAdjustmentsText) {
            processFortesAdjustments();
        } else {
            alert('Carregue o relatório de valores (CSV/XLSX) ou cole instruções de ajuste.');
        }
    });

    // Botão de download
    fortesDownloadBtn.addEventListener('click', () => {
        if (!fortesFileData) {
            alert('Nenhum arquivo processado para download.');
            return;
        }
        downloadCorrectedFortesFile();
    });
}

// Função para analisar a estrutura do arquivo .fs
function parseFortesFile(fileContent) {
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    const structure = {
        cab: null,           // Cabeçalho
        par: [],            // Parceiros/Fornecedores
        grp: [],            // Grupos
        und: [],            // Unidades
        nop: [],            // Natureza de Operação
        nfm: [],            // Notas Fiscais Mestre
        pnm: [],            // Produtos das Notas
        inm: [],            // Impostos das Notas
        dnm: [],            // Descontos de Nota
        tra: null           // Trailer
    };

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        const parts = trimmedLine.split('|');
        const recordType = parts[0];

        switch (recordType) {
            case 'CAB':
                structure.cab = { line: index + 1, data: parts };
                break;
            case 'PAR':
                structure.par.push({ line: index + 1, data: parts });
                break;
            case 'GRP':
                structure.grp.push({ line: index + 1, data: parts });
                break;
            case 'UND':
                structure.und.push({ line: index + 1, data: parts });
                break;
            case 'NOP':
                structure.nop.push({ line: index + 1, data: parts });
                break;
            case 'DNM':
                structure.dnm.push({ line: index + 1, data: parts });
                break;
            case 'NFM':
                structure.nfm.push({ line: index + 1, data: parts });
                break;
            case 'PNM':
                structure.pnm.push({ line: index + 1, data: parts });
                break;
            case 'INM':
                structure.inm.push({ line: index + 1, data: parts });
                break;
            case 'TRA':
                structure.tra = { line: index + 1, data: parts };
                break;
        }
    });

    return { structure, lines };
}

// Função para parsear uma linha de erro
function parseErrorLine(errorLine) {
    const trimmed = errorLine.trim();
    if (!trimmed) return null;

    // Extrair número da linha (primeiros números, removendo zeros à esquerda)
    const lineNumberMatch = trimmed.match(/^0*(\d+)/);
    if (!lineNumberMatch) return null;

    const lineNumber = parseInt(lineNumberMatch[1], 10);
    
    // Debug: log para verificar o que está sendo processado
    if (trimmed.includes('CFOP') && trimmed.includes('INM')) {
        console.log('Debug - Linha contém CFOP e INM:', trimmed.substring(0, 100));
    }
    if (trimmed.includes('Tributação') || trimmed.includes('Tributacao') || trimmed.includes('CST/CSOSN')) {
        console.log('Debug - Linha contém Tributação ou CST:', trimmed.substring(0, 100));
    }
    
    // IMPORTANTE: Verificar erro de NF1 ANTES de outros, pois "AIDF" pode aparecer em outros contextos
    // Verificar se é erro de NF1 (AIDF não encontrada) - múltiplas estratégias de detecção
    const hasAidfNotFound = /AIDF\s+não\s+encontrada/i.test(trimmed) ||
                            /AIDF.*não.*encontrada/i.test(trimmed) ||
                            trimmed.includes('AIDF não encontrada') ||
                            trimmed.includes('AIDF nao encontrada');
    
    const hasNf1InText = /Espécie:\s*NF1/i.test(trimmed) ||
                         (trimmed.includes('NF1') && trimmed.includes('Espécie'));
    
    const isNf1Error = hasAidfNotFound || 
                       (hasNf1InText && trimmed.includes('AIDF')) ||
                       (trimmed.includes('AIDF') && trimmed.includes('não encontrada para o documento'));
    
    if (isNf1Error) {
        console.log('✓ Erro de NF1 (AIDF não encontrada) detectado:', trimmed);
        // Extrair informações do documento (opcional, para log)
        const docMatch = trimmed.match(/Estab\.:\s*(\d+).*Espécie:\s*(\w+).*Série:\s*(\d+).*Núm\.\/Form\.:\s*(\d+)/i);
        const documentInfo = docMatch ? {
            estabelecimento: docMatch[1],
            especie: docMatch[2],
            serie: docMatch[3],
            numero: docMatch[4]
        } : null;
        
        return {
            type: 'NF1',
            lineNumber: lineNumber,
            documentInfo: documentInfo,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Tributação inválida (múltiplos erros na mesma linha PNM)
    // Este erro requer múltiplas correções na mesma linha
    // IMPORTANTE: Verificar ANTES de outros erros para garantir detecção
    const isTributacaoError = /Tributação\s+inválida/i.test(trimmed) ||
                              (trimmed.includes('Tributação') && trimmed.includes('inválida') && trimmed.includes('Campo 11') && trimmed.includes('Registro PNM')) ||
                              (trimmed.includes('Tributacao') && trimmed.includes('invalida') && trimmed.includes('Campo 11') && trimmed.includes('Registro PNM'));
    
    const isCst61Error = /CST\/CSOSN.*61/i.test(trimmed) ||
                        /CST.*CSOSN.*informado.*61/i.test(trimmed) ||
                        (trimmed.includes('CST/CSOSN informado:61') && trimmed.includes('Campo 85') && trimmed.includes('Registro PNM')) ||
                        (trimmed.includes('Base Cálc. FCP') && trimmed.includes('CST/CSOSN') && trimmed.includes('61'));
    
    const isBcMonoError = /BC\s+Mono\s+Ret.*em\s+branco/i.test(trimmed) ||
                          (trimmed.includes('BC Mono Ret. Ant. em branco') && trimmed.includes('Campo 135') && trimmed.includes('Registro PNM')) ||
                          (trimmed.includes('BC Mono Ret') && trimmed.includes('em branco') && trimmed.includes('Campo 135'));
    
    const isAliqError = /Aliq.*em\s+branco/i.test(trimmed) ||
                       (trimmed.includes('Aliq. (R$) em branco') && trimmed.includes('Campo 136') && trimmed.includes('Registro PNM')) ||
                       (trimmed.includes('Aliq') && trimmed.includes('em branco') && trimmed.includes('Campo 136'));
    
    const isVrIcmsError = /Vr\.\s*ICMS\s+Mono.*em\s+branco/i.test(trimmed) ||
                         (trimmed.includes('Vr. ICMS Mono Ret. Ant. em branco') && trimmed.includes('Campo 137') && trimmed.includes('Registro PNM')) ||
                         (trimmed.includes('Vr. ICMS Mono') && trimmed.includes('em branco') && trimmed.includes('Campo 137'));
    
    // Se for qualquer um desses erros relacionados, tratar como erro de Tributação
    if (isTributacaoError || isCst61Error || isBcMonoError || isAliqError || isVrIcmsError) {
        console.log('✓ Erro de Tributação inválida (PNM) detectado:', trimmed);
        
        return {
            type: 'TRIBUTACAO',
            lineNumber: lineNumber,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Soma CFOP (difere entre INM e PNM)
    // Múltiplas estratégias de detecção para garantir captura
    const hasCfopSumText = /soma\s+dos\s+valores\s+do\s+CFOP/i.test(trimmed) ||
                           /soma.*CFOP/i.test(trimmed) ||
                           trimmed.includes('soma dos valores do CFOP') ||
                           trimmed.includes('soma dos valores');
    
    const hasInmPnmDiff = /INM.*difere/i.test(trimmed) ||
                         /registro\s+INM.*difere/i.test(trimmed) ||
                         (trimmed.includes('INM') && trimmed.includes('PNM') && trimmed.includes('difere')) ||
                         (trimmed.includes('registro INM') && trimmed.includes('registro PNM')) ||
                         (trimmed.includes('registro INM') && trimmed.includes('difere'));
    
    const isCfopSumError = hasCfopSumText || 
                          (hasInmPnmDiff && trimmed.includes('CFOP')) ||
                          (trimmed.includes('CFOP') && trimmed.includes('INM') && trimmed.includes('difere')) ||
                          (trimmed.includes('CFOP') && trimmed.includes('registro INM') && trimmed.includes('registro PNM')) ||
                          (trimmed.includes('CFOP') && trimmed.includes('registro INM') && trimmed.includes('difere')) ||
                          (trimmed.includes('CFOP') && /registro\s+INM/i.test(trimmed) && trimmed.includes('difere'));
    
    if (isCfopSumError) {
        console.log('✓ Erro de Soma CFOP detectado:', trimmed);
        // Extrair valores: valor incorreto do INM e valor correto do PNM
        // Exemplo: "A soma dos valores do CFOP 1910 do registro INM (19,77) difere da soma do valor líquido do registro PNM (17,71)"
        // Tentar múltiplos padrões para capturar os valores
        const inmValueMatch = trimmed.match(/INM\s*\(([\d,]+)\)/i) || 
                             trimmed.match(/registro\s+INM\s*\(([\d,]+)\)/i) ||
                             trimmed.match(/INM.*?\(([\d,]+)\)/i);
        const pnmValueMatch = trimmed.match(/PNM\s*\(([\d,]+)\)/i) || 
                             trimmed.match(/registro\s+PNM\s*\(([\d,]+)\)/i) ||
                             trimmed.match(/PNM.*?\(([\d,]+)\)/i);
        
        // Converter vírgula para ponto (formato do arquivo)
        const incorrectValue = inmValueMatch ? inmValueMatch[1].replace(',', '.') : null;
        const correctValue = pnmValueMatch ? pnmValueMatch[1].replace(',', '.') : null;
        
        // Extrair CFOP (opcional, para log)
        const cfopMatch = trimmed.match(/CFOP\s+(\d+)/i);
        const cfop = cfopMatch ? cfopMatch[1] : null;
        
        console.log(`Valores extraídos - INM (incorreto): ${incorrectValue}, PNM (correto): ${correctValue}, CFOP: ${cfop}`);
        
        return {
            type: 'CFOP_SUM',
            lineNumber: lineNumber,
            incorrectValue: incorrectValue,
            correctValue: correctValue,
            cfop: cfop,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Valor Total
    const isTotalValueError = /Valor\s+Total\s+difere/i.test(trimmed) ||
                             /Valor\s+Total.*difere/i.test(trimmed) ||
                             (trimmed.includes('Valor Total') && trimmed.includes('difere')) ||
                             (trimmed.includes('Valor Total') && trimmed.includes('Base de Cálculo'));
    
    if (isTotalValueError) {
        console.log('✓ Erro de Valor Total detectado:', trimmed);
        // Extrair informações do documento (opcional, para log)
        const docMatch = trimmed.match(/Documento:\s*(\d+).*Data:\s*(\d{2}\/\d{2}\/\d{4})/i);
        const documentInfo = docMatch ? {
            documento: docMatch[1],
            data: docMatch[2]
        } : null;
        
        return {
            type: 'TOTAL_VALUE',
            lineNumber: lineNumber,
            documentInfo: documentInfo,
            originalError: trimmed
        };
    }
    
    // IMPORTANTE: Verificar erro de Quantidade ANTES de CEST, pois "CEST" pode aparecer em outros contextos
    // Verificar se é erro de Quantidade equivalente padrão usando múltiplas estratégias
    const hasQuantityText = /[Qq]uantidade\s+equivalente/i.test(trimmed);
    const hasGreaterThanZero = /maior\s+que\s+zero/i.test(trimmed) || /deve\s+ser\s+maior/i.test(trimmed);
    const hasOumAndZero = /OUM/i.test(trimmed) && /0\.00/i.test(trimmed) && /Campo/i.test(trimmed);
    
    const isQuantityError = hasQuantityText || 
                           (hasGreaterThanZero && /Quantidade/i.test(trimmed)) ||
                           hasOumAndZero ||
                           trimmed.includes('Quantidade equivalente padrão') ||
                           trimmed.includes('Quantidade equivalente padr') ||
                           trimmed.includes('Quantidade equivalente') ||
                           trimmed.includes('deve ser maior que zero') ||
                           trimmed.includes('maior que zero');
    
    if (isQuantityError) {
        console.log('✓ Erro de Quantidade detectado:', trimmed);
        // Extrair valor inválido entre parênteses (ex: (0.00))
        const invalidValueMatch = trimmed.match(/\(([\d.]+)\)/);
        const invalidValue = invalidValueMatch ? invalidValueMatch[1] : null;
        
        // Extrair número do campo (ex: "Campo 4")
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro (ex: "Registro OUM")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        // Valor de substituição padrão: 1.00 (conforme instrução)
        const replacementValue = '1.00';
        
        return {
            type: 'QUANTITY',
            lineNumber: lineNumber,
            invalidValue: invalidValue,
            replacementValue: replacementValue,
            fieldNumber: fieldNumber,
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Inscrição Estadual inválida
    const isIeError = /[Ii]ns[cç][ií][cç][ãa]o?\s+[Ee]stadual/i.test(trimmed) ||
                     /[Ii]ns[cç][ií][cç][ãa]o?\s+[Ee]stadual.*inv[áa]lida/i.test(trimmed) ||
                     (trimmed.includes('Inscrição') && trimmed.includes('Estadual') && trimmed.includes('inválida')) ||
                     (trimmed.includes('Inscricao') && trimmed.includes('Estadual') && trimmed.includes('invalida')) ||
                     (trimmed.includes('IE') && trimmed.includes('inválida') && trimmed.includes('Campo') && trimmed.includes('Registro PAR'));
    
    if (isIeError) {
        console.log('✓ Erro de Inscrição Estadual detectado:', trimmed);
        // Extrair valor inválido entre parênteses (ex: (63759837))
        const invalidValueMatch = trimmed.match(/\((\d+)\)/);
        const invalidIe = invalidValueMatch ? invalidValueMatch[1] : null;
        
        // Extrair número do campo (ex: "Campo 6")
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro (ex: "Registro PAR")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        return {
            type: 'IE',
            lineNumber: lineNumber,
            invalidIe: invalidIe,
            fieldNumber: fieldNumber,
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Duplicidade de código de produto
    const isDuplicityError = /[Cc]ódigo\s+do\s+[Pp]roduto.*em\s+duplicidade/i.test(trimmed) ||
                            /[Cc]ódigo.*duplicidade/i.test(trimmed) ||
                            (trimmed.includes('Código do Produto') && trimmed.includes('duplicidade') && trimmed.includes('Registro PRO')) ||
                            (trimmed.includes('Codigo do Produto') && trimmed.includes('duplicidade') && trimmed.includes('Registro PRO'));
    
    if (isDuplicityError) {
        console.log('✓ Erro de Duplicidade detectado:', trimmed);
        // Extrair código do produto entre parênteses (ex: (10115))
        const productCodeMatch = trimmed.match(/\((\d+)\)/);
        const productCode = productCodeMatch ? productCodeMatch[1] : null;
        
        // Extrair tipo de registro (ex: "Registro PRO")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        return {
            type: 'DUPLICITY',
            lineNumber: lineNumber,
            productCode: productCode,
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de CST em branco
    const isCstError = /CST.*em\s+branco/i.test(trimmed) ||
                      /CST\(PIS\).*em\s+branco/i.test(trimmed) ||
                      /CST.*será\s+necessário/i.test(trimmed) ||
                      (trimmed.includes('CST') && trimmed.includes('em branco') && trimmed.includes('Campo') && trimmed.includes('Registro PNM'));
    
    if (isCstError) {
        console.log('✓ Erro de CST em branco detectado:', trimmed);
        // Extrair número do campo (ex: "Campo 38")
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro (ex: "Registro PNM")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        return {
            type: 'CST',
            lineNumber: lineNumber,
            fieldNumber: fieldNumber, // Campo 38 (onde está o erro)
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de CEST (após verificar Quantidade, IE e CST)
    const isCestError = trimmed.includes('Código Especificador da Substituição Tributária - CEST') || 
                       (trimmed.includes('CEST') && trimmed.includes('Campo') && trimmed.includes('Registro PRO'));
    
    if (isCestError) {
        // Extrair valor inválido entre parênteses
        const invalidValueMatch = trimmed.match(/\((\d+)\)/);
        const invalidCest = invalidValueMatch ? invalidValueMatch[1] : null;
        
        // Extrair número do campo (ex: "Campo 41")
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro (ex: "Registro PRO" ou "Registro PNM")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        return {
            type: 'CEST',
            lineNumber: lineNumber,
            invalidCest: invalidCest,
            fieldNumber: fieldNumber,
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Logradouro (Número do logradouro inválido - S/N)
    const isLogradouroError = /Número\s+do\s+logradouro/i.test(trimmed) ||
                              (trimmed.includes('Número do logradouro') && trimmed.includes('valor inválido') && trimmed.includes('Registro PAR'));
    
    if (isLogradouroError) {
        console.log('✓ Erro de Logradouro detectado:', trimmed);
        // Extrair valor inválido entre parênteses (ex: (S/N))
        const invalidValueMatch = trimmed.match(/\(([^)]+)\)/);
        const invalidValue = invalidValueMatch ? invalidValueMatch[1] : null;
        
        // Extrair número do campo (ex: "Campo 8" ou "Campo 18")
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro (ex: "Registro PAR")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        return {
            type: 'LOGRADOURO',
            lineNumber: lineNumber,
            invalidValue: invalidValue,
            fieldNumber: fieldNumber || 8, // Campo 8 por padrão (usuário mencionou campo 8)
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Estabelecimento não encontrado
    const isEstabelecimentoError = /Estabelecimento\s+não\s+encontrado/i.test(trimmed) ||
                                   (trimmed.includes('Estabelecimento não encontrado') && trimmed.includes('Registro NFM'));
    
    if (isEstabelecimentoError) {
        console.log('✓ Erro de Estabelecimento detectado:', trimmed);
        // Extrair valor inválido entre parênteses (ex: (0000))
        const invalidValueMatch = trimmed.match(/\((\d+)\)/);
        const invalidValue = invalidValueMatch ? invalidValueMatch[1] : null;
        
        // Extrair número do campo (ex: "Campo 2")
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro (ex: "Registro NFM")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        return {
            type: 'ESTABELECIMENTO',
            lineNumber: lineNumber,
            invalidValue: invalidValue,
            fieldNumber: fieldNumber || 2,
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Tamanho Inválido (Descrição com tamanho inválido)
    const isTamanhoInvalidoError = /tamanho\s+inválido/i.test(trimmed) ||
                                   (trimmed.includes('tamanho inválido') && trimmed.includes('Esperado:') && trimmed.includes('Informado:'));
    
    if (isTamanhoInvalidoError) {
        console.log('✓ Erro de Tamanho Inválido detectado:', trimmed);
        // Extrair tamanho esperado e informado
        const esperadoMatch = trimmed.match(/Esperado:\s*(\d+)/i);
        const informadoMatch = trimmed.match(/Informado:\s*(\d+)/i);
        const tamanhoEsperado = esperadoMatch ? parseInt(esperadoMatch[1], 10) : null;
        const tamanhoInformado = informadoMatch ? parseInt(informadoMatch[1], 10) : null;
        
        // Extrair número do campo
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        // Extrair descrição do campo (para identificar qual campo)
        const campoDescMatch = trimmed.match(/Campo\s+"([^"]+)"/i) || trimmed.match(/Campo\s+([^.]+)/i);
        const campoDesc = campoDescMatch ? campoDescMatch[1].trim() : null;
        
        return {
            type: 'TAMANHO_INVALIDO',
            lineNumber: lineNumber,
            tamanhoEsperado: tamanhoEsperado,
            tamanhoInformado: tamanhoInformado,
            fieldNumber: fieldNumber,
            recordType: recordType,
            campoDesc: campoDesc,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Grupo do produto não encontrado
    const isGrupoError = /Grupo\s+do\s+produto\s+não\s+encontrado/i.test(trimmed) ||
                         (trimmed.includes('Grupo do produto não encontrado') && trimmed.includes('Registro PRO'));
    
    if (isGrupoError) {
        console.log('✓ Erro de Grupo detectado:', trimmed);
        // Extrair valor inválido entre parênteses (ex: (97))
        const invalidValueMatch = trimmed.match(/\((\d+)\)/);
        const invalidValue = invalidValueMatch ? invalidValueMatch[1] : null;
        
        // Extrair número do campo (ex: "Campo 10")
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro (ex: "Registro PRO")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        return {
            type: 'GRUPO',
            lineNumber: lineNumber,
            invalidValue: invalidValue,
            fieldNumber: fieldNumber || 10,
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    // Verificar se é erro de Unidade de Medida em branco
    const isUndBrancoError = /Unidade\s+de\s+Medida.*em\s+branco/i.test(trimmed) ||
                            (trimmed.includes('Unidade de Medida') && trimmed.includes('em branco') && trimmed.includes('Registro UND'));
    
    if (isUndBrancoError) {
        console.log('✓ Erro de Unidade de Medida em branco detectado:', trimmed);
        // Extrair número do campo (ex: "Campo 3")
        const fieldMatch = trimmed.match(/Campo\s+(\d+)/i);
        const fieldNumber = fieldMatch ? parseInt(fieldMatch[1], 10) : null;
        
        // Extrair tipo de registro (ex: "Registro UND")
        const recordMatch = trimmed.match(/Registro\s+(\w+)/i);
        const recordType = recordMatch ? recordMatch[1].toUpperCase() : null;
        
        return {
            type: 'UND_BRANCO',
            lineNumber: lineNumber,
            fieldNumber: fieldNumber || 3,
            recordType: recordType,
            originalError: trimmed
        };
    }
    
    
    // Outros tipos de erro podem ser adicionados aqui no futuro
    return {
        type: 'UNKNOWN',
        lineNumber: lineNumber,
        originalError: trimmed
    };
}

// Função para corrigir erro de Inscrição Estadual em uma linha
function fixIeError(line, fieldNumber, invalidIe) {
    if (!line || !line.trim()) return line;
    
    // Dividir a linha em campos (separados por |)
    const fields = line.split('|');
    
    // Verificar se o campo existe
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const fieldIndex = fieldNumber - 1;
    const currentFieldValue = fields[fieldIndex] || '';
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) antes: "${currentFieldValue}"`);
    console.log(`Corrigindo IE: ${invalidIe} → adicionando zeros à esquerda até 9 dígitos`);
    
    // Verificar se o valor atual corresponde ao IE inválido
    const currentValueNormalized = currentFieldValue.trim();
    const invalidIeNormalized = invalidIe.trim();
    
    // Remover zeros à esquerda para comparação
    const currentWithoutZeros = currentValueNormalized.replace(/^0+/, '') || '0';
    const invalidWithoutZeros = invalidIeNormalized.replace(/^0+/, '') || '0';
    
    // Se o valor atual corresponde ao IE inválido (com ou sem zeros à esquerda), corrigir
    if (currentValueNormalized === invalidIeNormalized || 
        currentWithoutZeros === invalidWithoutZeros) {
        
        // Adicionar zeros à esquerda até ter 9 dígitos
        // Usar o valor sem zeros à esquerda como base para garantir consistência
        const baseValue = invalidWithoutZeros;
        const correctedIe = baseValue.padStart(9, '0');
        
        console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) depois: "${correctedIe}"`);
        console.log(`Correção: ${invalidIeNormalized} (${invalidWithoutZeros} sem zeros) → ${correctedIe}`);
        
        // Atualizar o campo na array
        fields[fieldIndex] = correctedIe;
        
        // Reconstruir a linha
        return fields.join('|');
    } else {
        console.warn(`Valor no campo ${fieldNumber} (${currentValueNormalized} = ${currentWithoutZeros} sem zeros) não corresponde ao IE inválido (${invalidIeNormalized} = ${invalidWithoutZeros} sem zeros). Não será corrigido.`);
        return line; // Não alterar se o valor não corresponder
    }
}

// Função para corrigir erro de Tributação inválida em uma linha PNM
function fixTributacaoError(line) {
    if (!line || !line.trim()) return line;
    
    // Dividir a linha em campos (separados por |)
    const fields = line.split('|');
    
    // Verificar se é uma linha PNM (campo 1 deve ser "PNM")
    if (fields.length === 0 || !fields[0] || fields[0].trim() !== 'PNM') {
        console.warn(`Linha não é do tipo PNM. Primeiro campo: "${fields[0] || ''}"`);
        return line;
    }
    
    // Verificar se os campos necessários existem
    if (fields.length < 137) {
        console.warn(`Linha PNM não tem campos suficientes. Total de campos: ${fields.length}, necessário: 137`);
        return line;
    }
    
    const field6Index = 5; // Campo 6 (índice 5)
    const field11Index = 10; // Campo 11 (índice 10)
    const field85Index = 84; // Campo 85 (índice 84)
    
    console.log(`Campo 6 antes: "${fields[field6Index] || ''}"`);
    console.log(`Campo 11 antes: "${fields[field11Index] || ''}"`);
    console.log(`Campo 85 antes: "${fields[field85Index] || ''}"`);
    
    // Campo 11: digitar "3"
    fields[field11Index] = '3';
    
    // Campo 6: trocar "61" para "60"
    const field6Value = (fields[field6Index] || '').trim();
    if (field6Value === '61') {
        fields[field6Index] = '60';
        console.log(`Campo 6: ${field6Value} → 60`);
    } else {
        console.warn(`Campo 6 não contém "61" (valor atual: "${field6Value}"). Não será alterado.`);
    }
    
    // Campo 85: substituir conteúdo por "0.00"
    fields[field85Index] = '0.00';
    
    console.log(`Campo 11 depois: "${fields[field11Index]}"`);
    console.log(`Campo 6 depois: "${fields[field6Index]}"`);
    console.log(`Campo 85 depois: "${fields[field85Index]}"`);
    
    // Reconstruir a linha
    return fields.join('|');
}

// Função para corrigir erro de Soma CFOP em uma linha INM
function fixCfopSumError(line, correctValue) {
    if (!line || !line.trim()) return line;
    
    // Dividir a linha em campos (separados por |)
    const fields = line.split('|');
    
    // Verificar se é uma linha INM (campo 1 deve ser "INM")
    if (fields.length === 0 || !fields[0] || fields[0].trim() !== 'INM') {
        console.warn(`Linha não é do tipo INM. Primeiro campo: "${fields[0] || ''}"`);
        return line;
    }
    
    // Verificar se os campos necessários existem
    if (fields.length < 10) {
        console.warn(`Linha INM não tem campos suficientes. Total de campos: ${fields.length}, necessário: 10`);
        return line;
    }
    
    const field2ValueBefore = (fields[1] || '').trim(); // Campo 2 antes (índice 1)
    const field6Index = 5; // Campo 6 (índice 5)
    const field7Index = 6; // Campo 7 (índice 6)
    const field8Index = 7; // Campo 8 (índice 7)
    const field9Index = 8; // Campo 9 (índice 8)
    const field10Index = 9; // Campo 10 (índice 9)
    
    console.log(`Campo 2 antes: "${field2ValueBefore}"`);
    console.log(`Campo 6 antes: "${fields[field6Index] || ''}"`);
    console.log(`Campo 7 antes: "${fields[field7Index] || ''}"`);
    console.log(`Campo 8 antes: "${fields[field8Index] || ''}"`);
    console.log(`Campo 9 antes: "${fields[field9Index] || ''}"`);
    console.log(`Campo 10 antes: "${fields[field10Index] || ''}"`);
    
    // Substituir campo 2 pelo valor correto
    fields[1] = correctValue;
    
    // Copiar valor correto para o campo 10
    fields[field10Index] = correctValue;
    
    // Substituir campos 6, 7, 8 e 9 por "0.00"
    fields[field6Index] = '0.00';
    fields[field7Index] = '0.00';
    fields[field8Index] = '0.00';
    fields[field9Index] = '0.00';
    
    console.log(`Campo 2 depois: "${fields[1]}"`);
    console.log(`Campo 10 depois: "${fields[field10Index]}"`);
    console.log(`Campos 6, 7, 8, 9 depois: "0.00"`);
    
    // Reconstruir a linha
    return fields.join('|');
}

// Função para corrigir erro de Valor Total em uma linha INM
function fixTotalValueError(line) {
    if (!line || !line.trim()) return line;
    
    // Dividir a linha em campos (separados por |)
    const fields = line.split('|');
    
    // Verificar se é uma linha INM (campo 1 deve ser "INM")
    if (fields.length === 0 || !fields[0] || fields[0].trim() !== 'INM') {
        console.warn(`Linha não é do tipo INM. Primeiro campo: "${fields[0] || ''}"`);
        return line;
    }
    
    // Verificar se os campos necessários existem
    if (fields.length < 10) {
        console.warn(`Linha INM não tem campos suficientes. Total de campos: ${fields.length}, necessário: 10`);
        return line;
    }
    
    const field2Value = (fields[1] || '').trim(); // Campo 2 (índice 1)
    const field6Index = 5; // Campo 6 (índice 5)
    const field7Index = 6; // Campo 7 (índice 6)
    const field8Index = 7; // Campo 8 (índice 7)
    const field9Index = 8; // Campo 9 (índice 8)
    const field10Index = 9; // Campo 10 (índice 9)
    
    console.log(`Campo 2 antes: "${field2Value}"`);
    console.log(`Campo 6 antes: "${fields[field6Index] || ''}"`);
    console.log(`Campo 7 antes: "${fields[field7Index] || ''}"`);
    console.log(`Campo 8 antes: "${fields[field8Index] || ''}"`);
    console.log(`Campo 9 antes: "${fields[field9Index] || ''}"`);
    console.log(`Campo 10 antes: "${fields[field10Index] || ''}"`);
    
    // Copiar valor do campo 2 para o campo 10
    fields[field10Index] = field2Value;
    
    // Substituir campos 6, 7, 8 e 9 por "0.00"
    fields[field6Index] = '0.00';
    fields[field7Index] = '0.00';
    fields[field8Index] = '0.00';
    fields[field9Index] = '0.00';
    
    console.log(`Campo 10 depois: "${fields[field10Index]}"`);
    console.log(`Campos 6, 7, 8, 9 depois: "0.00"`);
    
    // Reconstruir a linha
    return fields.join('|');
}

// Função para corrigir erro de CST em branco em uma linha
function fixCstError(line, fieldNumber) {
    if (!line || !line.trim()) return line;
    
    // Dividir a linha em campos (separados por |)
    const fields = line.split('|');
    
    // Verificar se os campos existem
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    // Campo 37 é o campo anterior ao campo 38 (fieldNumber - 1)
    const field37Index = fieldNumber - 2; // Campo 37 (índice baseado em 0)
    const field38Index = fieldNumber - 1; // Campo 38 (índice baseado em 0)
    
    if (field37Index < 0 || field38Index < 0) {
        console.warn(`Campo 37 ou 38 não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const field37Value = (fields[field37Index] || '').trim();
    const field38Value = (fields[field38Index] || '').trim();
    
    console.log(`Campo 37 (índice ${field37Index}) antes: "${field37Value}"`);
    console.log(`Campo 38 (índice ${field38Index}) antes: "${field38Value}"`);
    
    let field37Corrected = field37Value;
    let field38Corrected = field38Value;
    let changed = false;
    
    // Se o campo 37 estiver vazio, preencher ambos com "73"
    if (!field37Value || field37Value === '' || field37Value === '0' || field37Value === '00') {
        field37Corrected = '73';
        field38Corrected = '73';
        changed = true;
        console.log(`Campo 37 estava vazio ou zero. Preenchendo campo 37 e 38 com "73"`);
    } else {
        // Se o campo 37 tiver um número, copiar para o campo 38 (mesmo que já tenha valor)
        field38Corrected = field37Value;
        changed = true;
        console.log(`Campo 37 tem valor "${field37Value}". Copiando para campo 38`);
    }
    
    if (changed) {
        // Atualizar os campos na array
        fields[field37Index] = field37Corrected;
        fields[field38Index] = field38Corrected;
        
        console.log(`Campo 37 (índice ${field37Index}) depois: "${field37Corrected}"`);
        console.log(`Campo 38 (índice ${field38Index}) depois: "${field38Corrected}"`);
        
        // Reconstruir a linha
        return fields.join('|');
    }
    
    return line;
}

// Função para corrigir erro de Quantidade em uma linha
function fixQuantityError(line, fieldNumber, invalidValue, replacementValue) {
    if (!line || !line.trim()) return line;
    
    // Dividir a linha em campos (separados por |)
    const fields = line.split('|');
    
    // Verificar se o campo existe
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const fieldIndex = fieldNumber - 1;
    const currentFieldValue = fields[fieldIndex] || '';
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) antes: "${currentFieldValue}"`);
    console.log(`Substituindo ${invalidValue} por ${replacementValue}`);
    
    // Verificar se o valor atual corresponde ao valor inválido
    const currentValueNormalized = currentFieldValue.trim();
    const invalidValueNormalized = invalidValue.trim();
    
    // Comparar valores (considerando diferentes formatos: 0.00, 0, 0.0, etc.)
    const currentAsNumber = parseFloat(currentValueNormalized);
    const invalidAsNumber = parseFloat(invalidValueNormalized);
    
    let newFieldValue = currentFieldValue;
    
    // Se o valor atual corresponde ao inválido (ou é zero), substituir
    if ((!isNaN(currentAsNumber) && !isNaN(invalidAsNumber) && currentAsNumber === invalidAsNumber) ||
        currentValueNormalized === invalidValueNormalized ||
        currentValueNormalized === invalidValue ||
        (currentAsNumber === 0 && invalidAsNumber === 0)) {
        newFieldValue = replacementValue;
        console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) depois: "${newFieldValue}"`);
    } else {
        console.warn(`Valor no campo ${fieldNumber} (${currentValueNormalized}) não corresponde ao valor inválido (${invalidValueNormalized}). Não será substituído.`);
        return line; // Não alterar se o valor não corresponder
    }
    
    // Atualizar o campo na array
    fields[fieldIndex] = newFieldValue;
    
    // Reconstruir a linha
    return fields.join('|');
}

// Função para corrigir erro de CEST em uma linha
function fixCestError(line, fieldNumber, invalidCest) {
    if (!line || !line.trim()) return line;
    
    // Dividir a linha em campos (separados por |)
    // IMPORTANTE: split('|') mantém campos vazios, então o índice corresponde ao campo
    const fields = line.split('|');
    
    // Verificar se o campo existe (fieldNumber é baseado em 1, então subtrair 1 para índice)
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const fieldIndex = fieldNumber - 1;
    const currentFieldValue = fields[fieldIndex] || '';
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) antes: "${currentFieldValue}"`);
    console.log(`Removendo CEST inválido: ${invalidCest}`);
    
    // Se o campo está vazio, não há nada para remover
    if (!currentFieldValue || currentFieldValue.trim() === '') {
        console.log(`Campo ${fieldNumber} está vazio, nada para remover`);
        return line;
    }
    
    // Remover o CEST inválido do campo
    // O campo pode conter apenas o CEST ou múltiplos CESTs
    // Tentar diferentes formatos: 0016214, 16214, etc.
    let newFieldValue = currentFieldValue;
    let cestRemoved = false;
    
    // Padrões possíveis do CEST
    const cestPatterns = [
        invalidCest, // Formato exato como está no erro
        invalidCest.replace(/^0+/, ''), // Sem zeros à esquerda
        invalidCest.padStart(7, '0'), // Com zeros à esquerda (7 dígitos)
        invalidCest.padStart(8, '0'), // Com zeros à esquerda (8 dígitos)
    ];
    
    // Remover duplicatas dos padrões
    const uniquePatterns = [...new Set(cestPatterns.filter(p => p))];
    
    uniquePatterns.forEach(pattern => {
        if (!pattern) return;
        
        // Se o campo é exatamente igual ao CEST, remover completamente
        if (currentFieldValue.trim() === pattern) {
            newFieldValue = '';
            cestRemoved = true;
            return;
        }
        
        // Tentar remover o CEST se estiver como parte de uma lista
        // Pode estar separado por espaço, vírgula, ponto e vírgula, ou outro caractere
        const separators = [' ', ',', ';', '|', '\t'];
        
        separators.forEach(sep => {
            // Dividir pelo separador
            const parts = newFieldValue.split(sep).map(p => p.trim()).filter(p => p !== '');
            
            // Remover o CEST da lista
            const filteredParts = parts.filter(part => {
                // Comparar com e sem zeros à esquerda
                const partNormalized = part.replace(/^0+/, '');
                const patternNormalized = pattern.replace(/^0+/, '');
                
                return part !== pattern && 
                       partNormalized !== patternNormalized &&
                       part !== pattern.padStart(part.length, '0') &&
                       part !== pattern.padStart(8, '0');
            });
            
            if (filteredParts.length < parts.length) {
                newFieldValue = filteredParts.join(sep);
                cestRemoved = true;
            }
        });
        
        // Também tentar remover usando regex (para casos onde o CEST está no meio de outros caracteres)
        const regex = new RegExp(`\\b${pattern.replace(/^0+/, '')}\\b|\\b${pattern}\\b`, 'g');
        const beforeReplace = newFieldValue;
        newFieldValue = newFieldValue.replace(regex, '').trim();
        
        if (beforeReplace !== newFieldValue) {
            cestRemoved = true;
        }
    });
    
    // Limpar separadores duplicados ou no início/fim
    newFieldValue = newFieldValue
        .replace(/^[,;\s|]+|[,;\s|]+$/g, '') // Remove separadores no início/fim
        .replace(/[,;\s|]{2,}/g, ' ') // Remove separadores duplicados, substitui por espaço
        .trim();
    
    // Se o campo ficou vazio após remover o CEST, deixar vazio
    if (newFieldValue === '' || newFieldValue === invalidCest) {
        newFieldValue = '';
        cestRemoved = true;
    }
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) depois: "${newFieldValue}"`);
    console.log(`CEST removido: ${cestRemoved}`);
    
    // Atualizar o campo na array
    fields[fieldIndex] = newFieldValue;
    
    // Reconstruir a linha (mantendo a estrutura original com |)
    return fields.join('|');
}

// Função para corrigir erro de Logradouro (remover conteúdo entre parênteses)
function fixLogradouroError(line, fieldNumber) {
    if (!line || !line.trim()) return line;
    
    const fields = line.split('|');
    
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const fieldIndex = fieldNumber - 1;
    const currentFieldValue = fields[fieldIndex] || '';
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) antes: "${currentFieldValue}"`);
    
    // Remover conteúdo entre parênteses (ex: S/N)
    let newFieldValue = currentFieldValue.replace(/\([^)]*\)/g, '').trim();
    
    // Se o campo ficou vazio, deixar vazio (deve conter somente números)
    // Se ainda tiver conteúdo não numérico, remover tudo que não for número
    newFieldValue = newFieldValue.replace(/[^\d]/g, '');
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) depois: "${newFieldValue}"`);
    
    fields[fieldIndex] = newFieldValue;
    
    return fields.join('|');
}

// Função para corrigir erro de Estabelecimento (trocar 0000 por 0001)
function fixEstabelecimentoError(line, fieldNumber, invalidValue) {
    if (!line || !line.trim()) return line;
    
    const fields = line.split('|');
    
    // Verificar se é uma linha NFM (campo 1 deve ser "NFM")
    if (fields.length === 0 || !fields[0] || fields[0].trim() !== 'NFM') {
        console.warn(`Linha não é do tipo NFM. Primeiro campo: "${fields[0] || ''}"`);
        return line;
    }
    
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const fieldIndex = fieldNumber - 1;
    const currentFieldValue = fields[fieldIndex] || '';
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) antes: "${currentFieldValue}"`);
    
    // Trocar 0000 por 0001
    let newFieldValue = currentFieldValue;
    if (currentFieldValue.trim() === invalidValue || currentFieldValue.trim() === '0000') {
        newFieldValue = '0001';
        console.log(`Campo ${fieldNumber}: ${currentFieldValue} → 0001`);
    } else {
        console.warn(`Campo ${fieldNumber} não contém "${invalidValue}" (valor atual: "${currentFieldValue}"). Não será alterado.`);
        return line;
    }
    
    fields[fieldIndex] = newFieldValue;
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) depois: "${newFieldValue}"`);
    
    return fields.join('|');
}

// Função para corrigir erro de Tamanho Inválido (reduzir para tamanho esperado)
function fixTamanhoInvalidoError(line, fieldNumber, tamanhoEsperado) {
    if (!line || !line.trim()) return line;
    
    const fields = line.split('|');
    
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const fieldIndex = fieldNumber - 1;
    const currentFieldValue = fields[fieldIndex] || '';
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) antes: "${currentFieldValue}" (${currentFieldValue.length} caracteres)`);
    
    // Reduzir para o tamanho esperado
    let newFieldValue = currentFieldValue;
    if (currentFieldValue.length > tamanhoEsperado) {
        newFieldValue = currentFieldValue.substring(0, tamanhoEsperado);
        console.log(`Campo ${fieldNumber}: reduzido de ${currentFieldValue.length} para ${tamanhoEsperado} caracteres`);
    } else {
        console.log(`Campo ${fieldNumber} já tem tamanho correto (${currentFieldValue.length} caracteres)`);
        return line;
    }
    
    fields[fieldIndex] = newFieldValue;
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) depois: "${newFieldValue}" (${newFieldValue.length} caracteres)`);
    
    return fields.join('|');
}

// Função para corrigir erro de Grupo (trocar por 001)
function fixGrupoError(line, fieldNumber, invalidValue) {
    if (!line || !line.trim()) return line;
    
    const fields = line.split('|');
    
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const fieldIndex = fieldNumber - 1;
    const currentFieldValue = fields[fieldIndex] || '';
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) antes: "${currentFieldValue}"`);
    
    // O campo exige 3 números, então o erro menciona 97 mas no arquivo será 097
    // Trocar 097 por 001 (ou qualquer valor que contenha o número do erro)
    let newFieldValue = currentFieldValue;
    
    // Normalizar o valor inválido para 3 dígitos (097)
    const invalidValueNormalized = invalidValue.padStart(3, '0');
    
    // Verificar se o campo contém o valor inválido (pode estar como 97 ou 097)
    const currentNormalized = currentFieldValue.trim().padStart(3, '0');
    
    if (currentNormalized === invalidValueNormalized || currentFieldValue.trim() === invalidValue) {
        newFieldValue = '001';
        console.log(`Campo ${fieldNumber}: ${currentFieldValue} (${invalidValueNormalized}) → 001`);
    } else {
        console.warn(`Campo ${fieldNumber} não contém "${invalidValue}" ou "${invalidValueNormalized}" (valor atual: "${currentFieldValue}"). Não será alterado.`);
        return line;
    }
    
    fields[fieldIndex] = newFieldValue;
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) depois: "${newFieldValue}"`);
    
    return fields.join('|');
}

// Função para corrigir erro de Unidade de Medida em branco (adicionar "UNIDADE")
function fixUndBrancoError(line, fieldNumber) {
    if (!line || !line.trim()) return line;
    
    const fields = line.split('|');
    
    // Verificar se é uma linha UND (campo 1 deve ser "UND")
    if (fields.length === 0 || !fields[0] || fields[0].trim() !== 'UND') {
        console.warn(`Linha não é do tipo UND. Primeiro campo: "${fields[0] || ''}"`);
        return line;
    }
    
    if (fieldNumber < 1 || fieldNumber > fields.length) {
        console.warn(`Campo ${fieldNumber} não existe na linha. Total de campos: ${fields.length}`);
        return line;
    }
    
    const fieldIndex = fieldNumber - 1;
    const currentFieldValue = fields[fieldIndex] || '';
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) antes: "${currentFieldValue}"`);
    
    // Se o campo está vazio ou em branco, adicionar "UNIDADE"
    let newFieldValue = currentFieldValue.trim();
    if (!newFieldValue || newFieldValue === '') {
        newFieldValue = 'UNIDADE';
        console.log(`Campo ${fieldNumber}: vazio → "UNIDADE"`);
    } else {
        console.log(`Campo ${fieldNumber} já tem valor: "${newFieldValue}". Não será alterado.`);
        return line;
    }
    
    fields[fieldIndex] = newFieldValue;
    
    console.log(`Campo ${fieldNumber} (índice ${fieldIndex}) depois: "${newFieldValue}"`);
    
    return fields.join('|');
}

// Função para atualizar o campo TRA (última linha) com o total de linhas
function updateTraLine(lines) {
    if (lines.length === 0) return lines;
    
    // Encontrar a última linha (TRA)
    let traIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('TRA|')) {
            traIndex = i;
            break;
        }
    }
    
    if (traIndex === -1) {
        console.warn('Linha TRA não encontrada no arquivo');
        return lines;
    }
    
    // Remover linha vazia no final se existir (antes de contar)
    // A linha vazia não deve ser contabilizada no total
    let lastLineIsEmpty = false;
    if (lines.length > traIndex + 1) {
        const lastLine = lines[lines.length - 1];
        if (!lastLine || lastLine.trim() === '') {
            lastLineIsEmpty = true;
            lines.pop(); // Remover linha vazia temporariamente para contar corretamente
        }
    }
    
    // Atualizar o campo 2 da linha TRA com o total de linhas (formato: 10 dígitos)
    // IMPORTANTE: A linha vazia NÃO é contabilizada no total
    const traLine = lines[traIndex];
    const traFields = traLine.split('|');
    
    if (traFields.length >= 2) {
        const totalLines = lines.length; // Total sem contar a linha vazia
        const formattedTotal = totalLines.toString().padStart(10, '0');
        traFields[1] = formattedTotal;
        lines[traIndex] = traFields.join('|');
        console.log(`Linha TRA atualizada: total de linhas = ${totalLines} (${formattedTotal}) - linha vazia não contabilizada`);
    }
    
    // Adicionar linha vazia no final (após TRA) se não existir
    // Esta linha vazia é necessária para o sistema de importação, mas não é contabilizada
    if (!lastLineIsEmpty) {
        lines.push(''); // Adicionar linha vazia no final
        console.log('Linha vazia adicionada no final do arquivo (após TRA)');
    } else {
        // Se já existia, adicionar de volta
        lines.push('');
    }
    
    return lines;
}

// Função para processar os ajustes no arquivo .fs
function processFortesAdjustments() {
    console.log('Processando ajustes no arquivo .fs...');
    
    if (!fortesFileData || !fortesAdjustmentsText) {
        alert('Arquivo ou instruções não encontrados.');
        return;
    }

    // Analisar estrutura do arquivo
    const { structure, lines } = parseFortesFile(fortesFileData);
    console.log('Estrutura do arquivo analisada:', structure);
    console.log(`Total de registros: CAB: ${structure.cab ? 1 : 0}, PAR: ${structure.par.length}, NFM: ${structure.nfm.length}, PNM: ${structure.pnm.length}`);

    // Dividir instruções em linhas
    const instructions = fortesAdjustmentsText.split('\n').filter(line => line.trim() !== '');
    let adjustedLines = [...lines]; // Usar let para permitir modificação ao deletar linhas
    let adjustmentsApplied = 0;
    let errorsFixed = [];
    let errorsNotFixed = [];
    
    // Separar erros de duplicidade, NF1 e outros erros
    const duplicityErrors = [];
    const nf1Errors = [];
    const otherErrors = [];

    // Primeira passagem: classificar erros (duplicidade, NF1 vs outros)
    instructions.forEach((instruction, idx) => {
        const trimmedInstruction = instruction.trim();
        if (!trimmedInstruction || trimmedInstruction.startsWith('//') || trimmedInstruction.startsWith('#')) {
            return; // Ignorar linhas vazias e comentários
        }

        // Parsear a linha de erro
        const errorInfo = parseErrorLine(trimmedInstruction);
        
        if (!errorInfo) {
            console.warn(`Não foi possível parsear o erro na linha ${idx + 1}`);
            errorsNotFixed.push({ line: idx + 1, error: trimmedInstruction, reason: 'Formato não reconhecido' });
            return;
        }

        // Separar erros de duplicidade, NF1, Tributação e outros
        if (errorInfo.type === 'DUPLICITY') {
            duplicityErrors.push({ errorInfo, instruction: trimmedInstruction, originalIndex: idx });
        } else if (errorInfo.type === 'NF1') {
            nf1Errors.push({ errorInfo, instruction: trimmedInstruction, originalIndex: idx });
        } else if (errorInfo.type === 'TRIBUTACAO') {
            // Erros de Tributação são processados junto com outros erros, mas precisam ser agrupados por linha
            otherErrors.push({ errorInfo, instruction: trimmedInstruction, originalIndex: idx });
        } else {
            otherErrors.push({ errorInfo, instruction: trimmedInstruction, originalIndex: idx });
        }
    });

    // Segunda passagem: processar outros erros primeiro
    // Para erros de TRIBUTACAO, evitar processar a mesma linha múltiplas vezes
    const processedTributacaoLines = new Set();
    
    otherErrors.forEach(({ errorInfo, instruction: trimmedInstruction, originalIndex: idx }) => {
        console.log(`Processando erro ${idx + 1}: ${trimmedInstruction}`);
        
        // Se for erro de TRIBUTACAO e a linha já foi processada, pular
        if (errorInfo.type === 'TRIBUTACAO' && processedTributacaoLines.has(errorInfo.lineNumber)) {
            console.log(`Linha ${errorInfo.lineNumber} já foi corrigida por erro de Tributação anterior. Pulando este erro.`);
            return;
        }

        // Verificar se é erro de CST em branco
        if (errorInfo.type === 'CST') {
            const { lineNumber, fieldNumber } = errorInfo;
            
            // Verificar se a linha existe (lineNumber é baseado em 1)
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            // Obter a linha original (índice é baseado em 0)
            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            // Corrigir o erro de CST
            const correctedLine = fixCstError(originalLine, fieldNumber);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                
                // Extrair valores para o relatório
                const fields = originalLine.split('|');
                const field37Index = fieldNumber - 2;
                const field38Index = fieldNumber - 1;
                const field37Before = fields[field37Index] || '';
                const field38Before = fields[field38Index] || '';
                const fieldsAfter = correctedLine.split('|');
                const field37After = fieldsAfter[field37Index] || '';
                const field38After = fieldsAfter[field38Index] || '';
                
                errorsFixed.push({
                    line: lineNumber,
                    type: 'CST',
                    field: fieldNumber,
                    field37Before: field37Before,
                    field37After: field37After,
                    field38Before: field38Before,
                    field38After: field38After,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de CST corrigido na linha ${lineNumber}: campo 37="${field37After}", campo 38="${field38After}"`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Não foi possível aplicar a correção' 
                });
            }
        }
        // Verificar se é erro de Inscrição Estadual
        else if (errorInfo.type === 'IE') {
            const { lineNumber, invalidIe, fieldNumber } = errorInfo;
            
            // Verificar se a linha existe (lineNumber é baseado em 1)
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            // Obter a linha original (índice é baseado em 0)
            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            // Corrigir o erro de Inscrição Estadual
            const correctedLine = fixIeError(originalLine, fieldNumber, invalidIe);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                errorsFixed.push({
                    line: lineNumber,
                    type: 'IE',
                    invalidIe: invalidIe,
                    correctedIe: invalidIe.padStart(9, '0'),
                    field: fieldNumber,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Inscrição Estadual corrigido na linha ${lineNumber}: ${invalidIe} → ${invalidIe.padStart(9, '0')} no campo ${fieldNumber}`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}. IE ${invalidIe} não encontrado no campo ${fieldNumber}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `IE ${invalidIe} não encontrado no campo ${fieldNumber}` 
                });
            }
        }
        // Verificar se é erro de CEST
        else if (errorInfo.type === 'CEST') {
            const { lineNumber, invalidCest, fieldNumber } = errorInfo;
            
            // Verificar se a linha existe (lineNumber é baseado em 1)
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            // Obter a linha original (índice é baseado em 0)
            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            // Corrigir o erro de CEST
            const correctedLine = fixCestError(originalLine, fieldNumber, invalidCest);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                errorsFixed.push({
                    line: lineNumber,
                    type: 'CEST',
                    invalidCest: invalidCest,
                    field: fieldNumber,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de CEST corrigido na linha ${lineNumber}: removido ${invalidCest} do campo ${fieldNumber}`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}. CEST ${invalidCest} não encontrado no campo ${fieldNumber}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `CEST ${invalidCest} não encontrado no campo ${fieldNumber}` 
                });
            }
        }
        // Verificar se é erro de Tributação inválida
        else if (errorInfo.type === 'TRIBUTACAO') {
            const { lineNumber } = errorInfo;
            
            // Verificar se a linha existe (lineNumber é baseado em 1)
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            // Obter a linha original (índice é baseado em 0)
            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            // Corrigir o erro de Tributação
            const correctedLine = fixTributacaoError(originalLine);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                
                // Extrair valores para o relatório
                const fieldsAfter = correctedLine.split('|');
                const field11Value = fieldsAfter[10] || '';
                const field6Value = fieldsAfter[5] || '';
                const field85Value = fieldsAfter[84] || '';
                
                errorsFixed.push({
                    line: lineNumber,
                    type: 'TRIBUTACAO',
                    field11Value: field11Value,
                    field6Value: field6Value,
                    field85Value: field85Value,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Tributação corrigido na linha ${lineNumber}: campo 11="${field11Value}", campo 6="${field6Value}", campo 85="${field85Value}"`);
                // Marcar linha como processada para evitar processar novamente
                processedTributacaoLines.add(lineNumber);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}. Linha não é do tipo PNM ou não tem campos suficientes.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha não é do tipo PNM ou não tem campos suficientes' 
                });
            }
        }
        // Verificar se é erro de Soma CFOP
        else if (errorInfo.type === 'CFOP_SUM') {
            const { lineNumber, incorrectValue, correctValue, cfop } = errorInfo;
            
            // Verificar se a linha existe (lineNumber é baseado em 1)
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            // Obter a linha original (índice é baseado em 0)
            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            // Verificar se temos os valores necessários
            if (!correctValue) {
                console.warn(`Não foi possível extrair o valor correto do erro na linha ${lineNumber}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Valor correto não encontrado no erro' 
                });
                return;
            }

            // Corrigir o erro de Soma CFOP
            const correctedLine = fixCfopSumError(originalLine, correctValue);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                
                // Extrair valores para o relatório
                const fieldsAfter = correctedLine.split('|');
                const field2Value = fieldsAfter[1] || '';
                const field10Value = fieldsAfter[9] || '';
                
                errorsFixed.push({
                    line: lineNumber,
                    type: 'CFOP_SUM',
                    cfop: cfop,
                    incorrectValue: incorrectValue,
                    correctValue: correctValue,
                    field2Value: field2Value,
                    field10Value: field10Value,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Soma CFOP corrigido na linha ${lineNumber}: campo 2="${field2Value}" (era ${incorrectValue}), campo 10="${field10Value}", campos 6-9 zerados`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}. Linha não é do tipo INM ou não tem campos suficientes.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha não é do tipo INM ou não tem campos suficientes' 
                });
            }
        }
        // Verificar se é erro de Valor Total
        else if (errorInfo.type === 'TOTAL_VALUE') {
            const { lineNumber, documentInfo } = errorInfo;
            
            // Verificar se a linha existe (lineNumber é baseado em 1)
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            // Obter a linha original (índice é baseado em 0)
            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            // Corrigir o erro de Valor Total
            const correctedLine = fixTotalValueError(originalLine);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                
                // Extrair valores para o relatório
                const fieldsBefore = originalLine.split('|');
                const fieldsAfter = correctedLine.split('|');
                const field2Value = fieldsAfter[1] || '';
                const field10Value = fieldsAfter[9] || '';
                
                errorsFixed.push({
                    line: lineNumber,
                    type: 'TOTAL_VALUE',
                    documentInfo: documentInfo,
                    field2Value: field2Value,
                    field10Value: field10Value,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Valor Total corrigido na linha ${lineNumber}: campo 2="${field2Value}" copiado para campo 10, campos 6-9 zerados`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}. Linha não é do tipo INM ou não tem campos suficientes.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha não é do tipo INM ou não tem campos suficientes' 
                });
            }
        }
        // Verificar se é erro de Quantidade
        else if (errorInfo.type === 'QUANTITY') {
            const { lineNumber, invalidValue, replacementValue, fieldNumber } = errorInfo;
            
            // Verificar se a linha existe (lineNumber é baseado em 1)
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            // Obter a linha original (índice é baseado em 0)
            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            // Corrigir o erro de Quantidade
            const correctedLine = fixQuantityError(originalLine, fieldNumber, invalidValue, replacementValue);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                errorsFixed.push({
                    line: lineNumber,
                    type: 'QUANTITY',
                    invalidValue: invalidValue,
                    replacementValue: replacementValue,
                    field: fieldNumber,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Quantidade corrigido na linha ${lineNumber}: substituído ${invalidValue} por ${replacementValue} no campo ${fieldNumber}`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}. Valor ${invalidValue} não encontrado no campo ${fieldNumber}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Valor ${invalidValue} não encontrado no campo ${fieldNumber}` 
                });
            }
        }
        // Verificar se é erro de Logradouro
        else if (errorInfo.type === 'LOGRADOURO') {
            const { lineNumber, fieldNumber } = errorInfo;
            
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            const correctedLine = fixLogradouroError(originalLine, fieldNumber);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                errorsFixed.push({
                    line: lineNumber,
                    type: 'LOGRADOURO',
                    field: fieldNumber,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Logradouro corrigido na linha ${lineNumber}: campo ${fieldNumber} limpo`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Não foi possível aplicar a correção' 
                });
            }
        }
        // Verificar se é erro de Estabelecimento
        else if (errorInfo.type === 'ESTABELECIMENTO') {
            const { lineNumber, invalidValue, fieldNumber } = errorInfo;
            
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            const correctedLine = fixEstabelecimentoError(originalLine, fieldNumber, invalidValue);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                errorsFixed.push({
                    line: lineNumber,
                    type: 'ESTABELECIMENTO',
                    invalidValue: invalidValue,
                    correctedValue: '0001',
                    field: fieldNumber,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Estabelecimento corrigido na linha ${lineNumber}: ${invalidValue} → 0001 no campo ${fieldNumber}`);
                
                // Corrigir também erros relacionados de PNM na mesma linha ou próximas
                // Procurar por linhas PNM que referenciam o estabelecimento 0000
                for (let i = 0; i < adjustedLines.length; i++) {
                    const pnmLine = adjustedLines[i];
                    if (pnmLine && pnmLine.trim().startsWith('PNM|')) {
                        const pnmFields = pnmLine.split('|');
                        // Verificar se campo 2 (estabelecimento) é 0000
                        if (pnmFields.length > 2 && pnmFields[1] && pnmFields[1].trim() === '0000') {
                            pnmFields[1] = '0001';
                            adjustedLines[i] = pnmFields.join('|');
                            console.log(`✓ Linha PNM ${i + 1} corrigida: estabelecimento 0000 → 0001`);
                        }
                    }
                }
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Não foi possível aplicar a correção' 
                });
            }
        }
        // Verificar se é erro de Tamanho Inválido
        else if (errorInfo.type === 'TAMANHO_INVALIDO') {
            const { lineNumber, tamanhoEsperado, fieldNumber } = errorInfo;
            
            console.log(`🔍 Processando erro de Tamanho Inválido: linha ${lineNumber}, campo ${fieldNumber}, tamanho esperado: ${tamanhoEsperado}`);
            
            if (!tamanhoEsperado || !fieldNumber) {
                console.warn(`Erro de Tamanho Inválido incompleto: tamanhoEsperado=${tamanhoEsperado}, fieldNumber=${fieldNumber}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Dados incompletos: tamanhoEsperado=${tamanhoEsperado}, fieldNumber=${fieldNumber}` 
                });
                return;
            }
            
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            console.log(`Linha original (primeiros 200 chars): ${originalLine.substring(0, 200)}`);
            
            const correctedLine = fixTamanhoInvalidoError(originalLine, fieldNumber, tamanhoEsperado);
            
            console.log(`Linha corrigida (primeiros 200 chars): ${correctedLine.substring(0, 200)}`);
            console.log(`Linhas são diferentes? ${correctedLine !== originalLine}`);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                errorsFixed.push({
                    line: lineNumber,
                    type: 'TAMANHO_INVALIDO',
                    tamanhoEsperado: tamanhoEsperado,
                    field: fieldNumber,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Tamanho Inválido corrigido na linha ${lineNumber}: campo ${fieldNumber} reduzido para ${tamanhoEsperado} caracteres`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}. Verifique os logs acima para detalhes.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Não foi possível aplicar a correção - verifique se o campo existe e tem tamanho maior que o esperado' 
                });
            }
        }
        // Verificar se é erro de Grupo
        else if (errorInfo.type === 'GRUPO') {
            const { lineNumber, invalidValue, fieldNumber } = errorInfo;
            
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            const correctedLine = fixGrupoError(originalLine, fieldNumber, invalidValue);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                errorsFixed.push({
                    line: lineNumber,
                    type: 'GRUPO',
                    invalidValue: invalidValue,
                    correctedValue: '001',
                    field: fieldNumber,
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Grupo corrigido na linha ${lineNumber}: ${invalidValue} → 001 no campo ${fieldNumber}`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Não foi possível aplicar a correção' 
                });
            }
        }
        // Verificar se é erro de Unidade de Medida em branco
        else if (errorInfo.type === 'UND_BRANCO') {
            const { lineNumber, fieldNumber } = errorInfo;
            
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }

            const lineIndex = lineNumber - 1;
            const originalLine = adjustedLines[lineIndex];
            
            if (!originalLine || !originalLine.trim()) {
                console.warn(`Linha ${lineNumber} está vazia`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Linha vazia' 
                });
                return;
            }

            const correctedLine = fixUndBrancoError(originalLine, fieldNumber);
            
            if (correctedLine !== originalLine) {
                adjustedLines[lineIndex] = correctedLine;
                adjustmentsApplied++;
                errorsFixed.push({
                    line: lineNumber,
                    type: 'UND_BRANCO',
                    field: fieldNumber,
                    addedValue: 'UNIDADE',
                    originalLine: originalLine.substring(0, 100) + '...',
                    correctedLine: correctedLine.substring(0, 100) + '...'
                });
                console.log(`✓ Erro de Unidade de Medida em branco corrigido na linha ${lineNumber}: campo ${fieldNumber} preenchido com "UNIDADE"`);
            } else {
                console.warn(`Não foi possível corrigir o erro na linha ${lineNumber}.`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: 'Não foi possível aplicar a correção' 
                });
            }
        }
        else {
            console.warn(`Tipo de erro não suportado: ${errorInfo.type}`);
            errorsNotFixed.push({ 
                line: errorInfo.lineNumber, 
                error: trimmedInstruction, 
                reason: `Tipo de erro não suportado: ${errorInfo.type}` 
            });
        }
    });

    // Terceira passagem: processar erros de duplicidade na ORDEM INVERSA (do último para o primeiro)
    // Isso é importante porque ao deletar linhas, os números das linhas seguintes mudam
    if (duplicityErrors.length > 0) {
        console.log(`Processando ${duplicityErrors.length} erro(s) de duplicidade na ordem inversa...`);
        
        // Ordenar por número de linha em ordem decrescente (do maior para o menor)
        duplicityErrors.sort((a, b) => b.errorInfo.lineNumber - a.errorInfo.lineNumber);
        
        duplicityErrors.forEach(({ errorInfo, instruction: trimmedInstruction, originalIndex: idx }) => {
            const { lineNumber, productCode } = errorInfo;
            
            console.log(`Processando erro de duplicidade ${idx + 1}: ${trimmedInstruction}`);
            console.log(`Deletando linha ${lineNumber} e linha ${lineNumber + 1}`);
            
            // Verificar se as linhas existem
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }
            
            if (lineNumber + 1 > adjustedLines.length) {
                console.warn(`Linha ${lineNumber + 1} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber + 1} não existe no arquivo` 
                });
                return;
            }
            
            // Obter as linhas que serão deletadas (para o relatório)
            const line1Index = lineNumber - 1;
            const line2Index = lineNumber; // Linha seguinte
            const deletedLine1 = adjustedLines[line1Index] || '';
            const deletedLine2 = adjustedLines[line2Index] || '';
            
            // Deletar as duas linhas (linha do erro + linha seguinte)
            // IMPORTANTE: Deletar da linha maior para a menor para não afetar os índices
            adjustedLines.splice(line2Index, 1); // Deletar linha seguinte primeiro
            adjustedLines.splice(line1Index, 1); // Depois deletar linha do erro
            
            adjustmentsApplied++;
            errorsFixed.push({
                line: lineNumber,
                type: 'DUPLICITY',
                productCode: productCode,
                deletedLines: [lineNumber, lineNumber + 1],
                deletedLine1: deletedLine1.substring(0, 100) + '...',
                deletedLine2: deletedLine2.substring(0, 100) + '...'
            });
            
            console.log(`✓ Erro de duplicidade corrigido: linhas ${lineNumber} e ${lineNumber + 1} deletadas (código produto: ${productCode})`);
        });
    }

    // Quarta passagem: processar erros de NF1 na ORDEM INVERSA (do último para o primeiro)
    // Isso é importante porque ao deletar linhas, os números das linhas seguintes mudam
    if (nf1Errors.length > 0) {
        console.log(`Processando ${nf1Errors.length} erro(s) de NF1 na ordem inversa...`);
        
        // Ordenar por número de linha em ordem decrescente (do maior para o menor)
        nf1Errors.sort((a, b) => b.errorInfo.lineNumber - a.errorInfo.lineNumber);
        
        nf1Errors.forEach(({ errorInfo, instruction: trimmedInstruction, originalIndex: idx }) => {
            const { lineNumber, documentInfo } = errorInfo;
            
            console.log(`Processando erro de NF1 ${idx + 1}: ${trimmedInstruction}`);
            console.log(`Procurando bloco NFM a partir da linha ${lineNumber}`);
            
            // Verificar se a linha existe
            if (lineNumber < 1 || lineNumber > adjustedLines.length) {
                console.warn(`Linha ${lineNumber} não existe no arquivo. Total de linhas: ${adjustedLines.length}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha ${lineNumber} não existe no arquivo` 
                });
                return;
            }
            
            // Encontrar a linha NFM que contém o erro (pode ser a linha do erro ou uma anterior)
            let nfmStartIndex = -1;
            let currentIndex = lineNumber - 1; // Converter para índice baseado em 0
            
            // Procurar para trás até encontrar uma linha que começa com "NFM|"
            for (let i = currentIndex; i >= 0; i--) {
                const line = adjustedLines[i];
                if (line && line.trim().startsWith('NFM|')) {
                    nfmStartIndex = i;
                    break;
                }
            }
            
            if (nfmStartIndex === -1) {
                console.warn(`Não foi possível encontrar linha NFM antes ou na linha ${lineNumber}`);
                errorsNotFixed.push({ 
                    line: lineNumber, 
                    error: trimmedInstruction, 
                    reason: `Linha NFM não encontrada antes da linha ${lineNumber}` 
                });
                return;
            }
            
            // Encontrar a próxima linha NFM (que NÃO deve ser deletada)
            let nfmEndIndex = adjustedLines.length; // Se não encontrar, deletar até o final
            for (let i = nfmStartIndex + 1; i < adjustedLines.length; i++) {
                const line = adjustedLines[i];
                if (line && line.trim().startsWith('NFM|')) {
                    nfmEndIndex = i; // Linha anterior à próxima NFM
                    break;
                }
            }
            
            // Calcular quantas linhas serão deletadas
            const linesToDelete = nfmEndIndex - nfmStartIndex;
            const deletedLines = [];
            for (let i = nfmStartIndex; i < nfmEndIndex; i++) {
                deletedLines.push(adjustedLines[i]);
            }
            
            console.log(`Deletando bloco NFM: linhas ${nfmStartIndex + 1} até ${nfmEndIndex} (${linesToDelete} linhas)`);
            
            // Deletar o bloco (da última linha para a primeira para não afetar índices)
            for (let i = nfmEndIndex - 1; i >= nfmStartIndex; i--) {
                adjustedLines.splice(i, 1);
            }
            
            adjustmentsApplied++;
            errorsFixed.push({
                line: lineNumber,
                type: 'NF1',
                documentInfo: documentInfo,
                deletedLines: [nfmStartIndex + 1, nfmEndIndex], // Linhas deletadas (baseado em 1)
                linesCount: linesToDelete,
                deletedBlock: deletedLines.slice(0, 3).map(l => l.substring(0, 100) + '...') // Primeiras 3 linhas para relatório
            });
            
            console.log(`✓ Erro de NF1 corrigido: bloco deletado (${linesToDelete} linhas) - linhas ${nfmStartIndex + 1} até ${nfmEndIndex}`);
        });
    }

    // Atualizar linha TRA com o total de linhas após todas as correções
    adjustedLines = updateTraLine(adjustedLines);

    // Atualizar o arquivo com as correções
    fortesFileData = adjustedLines.join('\n');
    
    // Mostrar botão de download
    const downloadBtn = document.getElementById('fortes-download-btn');
    if (downloadBtn) {
        downloadBtn.style.display = 'flex';
    }
    
    // Mostrar resumo das correções
    const finalLineCount = adjustedLines.length;
    let summaryMessage = `Processamento concluído!\n\n`;
    summaryMessage += `Estrutura identificada:\n`;
    summaryMessage += `- ${structure.par.length} parceiros\n`;
    summaryMessage += `- ${structure.nfm.length} notas fiscais\n`;
    summaryMessage += `- ${structure.pnm.length} produtos\n\n`;
    summaryMessage += `Total de linhas no arquivo: ${finalLineCount}\n`;
    summaryMessage += `Correções aplicadas: ${adjustmentsApplied}\n`;
    summaryMessage += `Erros não corrigidos: ${errorsNotFixed.length}\n\n`;
    
    if (errorsFixed.length > 0) {
        summaryMessage += `Erros corrigidos:\n`;
        errorsFixed.slice(0, 5).forEach(err => {
            if (err.type === 'CEST') {
                summaryMessage += `- Linha ${err.line}: CEST ${err.invalidCest} removido do campo ${err.field}\n`;
            } else if (err.type === 'QUANTITY') {
                summaryMessage += `- Linha ${err.line}: Quantidade ${err.invalidValue} substituída por ${err.replacementValue} no campo ${err.field}\n`;
            } else if (err.type === 'IE') {
                summaryMessage += `- Linha ${err.line}: IE ${err.invalidIe} corrigido para ${err.correctedIe} no campo ${err.field}\n`;
            } else if (err.type === 'CST') {
                summaryMessage += `- Linha ${err.line}: CST corrigido - campo 37="${err.field37After}", campo 38="${err.field38After}"\n`;
            } else if (err.type === 'DUPLICITY') {
                summaryMessage += `- Linhas ${err.deletedLines[0]} e ${err.deletedLines[1]} deletadas (produto duplicado: ${err.productCode})\n`;
            } else if (err.type === 'NF1') {
                summaryMessage += `- Bloco NFM deletado: linhas ${err.deletedLines[0]} até ${err.deletedLines[1]} (${err.linesCount} linhas) - AIDF não encontrada\n`;
            } else if (err.type === 'TOTAL_VALUE') {
                summaryMessage += `- Linha ${err.line}: Valor Total corrigido - campo 2="${err.field2Value}" copiado para campo 10, campos 6-9 zerados\n`;
            } else if (err.type === 'CFOP_SUM') {
                summaryMessage += `- Linha ${err.line}: Soma CFOP ${err.cfop} corrigida - campo 2="${err.correctValue}" (era ${err.incorrectValue}), campo 10="${err.field10Value}", campos 6-9 zerados\n`;
            } else if (err.type === 'TRIBUTACAO') {
                summaryMessage += `- Linha ${err.line}: Tributação corrigida - campo 11="${err.field11Value}", campo 6="${err.field6Value}", campo 85="${err.field85Value}"\n`;
            } else {
                summaryMessage += `- Linha ${err.line}: Erro corrigido no campo ${err.field}\n`;
            }
        });
        if (errorsFixed.length > 5) {
            summaryMessage += `... e mais ${errorsFixed.length - 5} correção(ões)\n`;
        }
    }
    
    if (errorsNotFixed.length > 0) {
        summaryMessage += `\nErros não corrigidos:\n`;
        errorsNotFixed.slice(0, 3).forEach(err => {
            summaryMessage += `- Linha ${err.line}: ${err.reason}\n`;
        });
        if (errorsNotFixed.length > 3) {
            summaryMessage += `... e mais ${errorsNotFixed.length - 3} erro(s)\n`;
        }
    }
    
    summaryMessage += `\nVocê pode baixar o arquivo corrigido.`;
    
    alert(summaryMessage);
    
    // Log detalhado no console
    console.log('Resumo das correções:', {
        total: instructions.length,
        fixed: adjustmentsApplied,
        notFixed: errorsNotFixed.length,
        errorsFixed: errorsFixed,
        errorsNotFixed: errorsNotFixed
    });
}

// Função para download do arquivo corrigido
function downloadCorrectedFortesFile() {
    if (!fortesFileData) {
        alert('Nenhum arquivo processado para download.');
        return;
    }

    // FIX ENCODING: Blob de string JS é serializado como UTF-8 pelo browser (o
    // charset do MIME é ignorado), corrompendo acentos. O arquivo foi lido com
    // readAsText(file,'latin1'), então re-emitimos os bytes latin1 originais.
    const blob = new Blob([encodeLatin1(fortesFileData)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FORTES_CORRIGIDO_${new Date().toISOString().slice(0, 10)}.fs`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============ Feature A: correção de valores do .fs guiada por relatório ============
// Pipeline: (1) Grupo 2 — instruções coladas (in-place, ANTES do rebuild de INM para
//   não invalidar números de linha); (2) Grupo 1 — varredura proativa segura (OUM qtd=0
//   →1.00, PAR logradouro S/N); (3) correção de valores por bloco NFM (relatório = autoridade)
//   + CST/PIS via cadastro CFOP→CST + reconstrução das INM por (CFOP,CST); (4) re-checagem
//   final dos totais contra o relatório. Validado em harness (794,60 / líquido 791,60 / INM 794,60).

// Número tolerante a locale (BR "1.036,88" e US "1,036.88"). O .fs usa ponto decimal.
function parseFortesNumber(v) {
    let s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
    if (!s) return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc !== -1 || ld !== -1) {
        const d = lc > ld ? ',' : '.';
        const t = d === ',' ? '.' : ',';
        s = s.split(t).join('').replace(d, '.');
    }
    return parseFloat(s);
}

// Número → "xxxx.xx" (ponto decimal, sem milhar) — formato do .fs.
function fsNum2(n) { return (Math.round(n * 100) / 100).toFixed(2); }

// Distribui `diffCents` (com sinal) centavo a centavo, round-robin de cima p/ baixo.
function distributeCentsRR(diffCents, n) {
    const out = new Array(n).fill(0);
    if (!n || !diffCents) return out;
    const sign = diffCents > 0 ? 1 : -1;
    let rem = Math.abs(diffCents), i = 0;
    while (rem > 0) { out[i % n] += sign; rem--; i++; }
    return out;
}

// Garante que nenhum bruto (em centavos) fique abaixo de `minC` (mínimo 0,01 = 1 centavo),
// preservando EXATAMENTE a soma total (= líquido da nota). Produtos abaixo do piso são
// elevados ao piso; o déficit é retirado, centavo a centavo (round-robin), apenas dos
// produtos com folga (> minC) da MESMA nota. Retorna `null` se for impossível — quando o
// líquido é menor que nº de produtos × minC, caso em que dar o piso a todos exigiria bruto
// negativo em algum outro produto. Converge sempre que Σ ≥ n·minC: a folga liberada ao
// elevar os abaixo-do-piso é (Σ − n·minC) + déficit ≥ déficit.
function enforceMinBrutoCents(targets, minC) {
    const n = targets.length;
    const total = targets.reduce((a, c) => a + c, 0);
    if (total < n * minC) return null;
    const out = targets.slice();
    let deficit = 0;
    for (let k = 0; k < n; k++) {
        if (out[k] < minC) { deficit += minC - out[k]; out[k] = minC; }
    }
    while (deficit > 0) {
        let moved = false;
        for (let k = 0; k < n && deficit > 0; k++) {
            if (out[k] > minC) { out[k]--; deficit--; moved = true; }
        }
        if (!moved) break; // salvaguarda: não ocorre quando total >= n*minC
    }
    return deficit === 0 ? out : null;
}

// CSV com aspas (aceita vírgula OU ponto-e-vírgula como separador) → células.
function _fortesCsvSplit(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else { if (c === '"') q = true; else if (c === ',' || c === ';') { out.push(cur); cur = ''; } else cur += c; }
    }
    out.push(cur);
    return out.map(s => s.trim());
}

// Linhas de células → Map<chave44, valorNumber>. Detecta colunas por cabeçalho.
function _fortesRowsToReportMap(rows) {
    const map = new Map();
    if (!rows || !rows.length) return map;
    let hIdx = -1, iCh = -1, iVal = -1;
    const lim = Math.min(rows.length, 25);
    for (let h = 0; h < lim; h++) {
        const cells = (rows[h] || []).map(c => String(c == null ? '' : c).toLowerCase());
        const ic = cells.findIndex(c => c.includes('chave'));
        const iv = cells.findIndex(c => c.includes('valor'));
        if (ic !== -1 && iv !== -1) { hIdx = h; iCh = ic; iVal = iv; break; }
    }
    if (hIdx === -1) return map;
    for (let r = hIdx + 1; r < rows.length; r++) {
        const cols = rows[r] || [];
        const key = String(cols[iCh] == null ? '' : cols[iCh]).replace(/\D/g, '');
        if (!/^\d{44}$/.test(key)) continue;
        const val = parseFortesNumber(cols[iVal]);
        if (!isNaN(val)) map.set(key, val);
    }
    return map;
}

// Lê o relatório (CSV SIGA ou XLSX) → Promise<Map<chave44, valorNumber>>. XLSX via cell.w||cell.v.
function parseFortesReport(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        const name = (file.name || '').toLowerCase();
        const isText = /\.csv$|\.txt$/.test(name) || file.type === 'text/csv';
        reader.onload = (e) => {
            try {
                let rows;
                if (isText) {
                    rows = String(e.target.result).split(/\r?\n/).filter(l => l.trim() !== '').map(l => _fortesCsvSplit(l));
                } else {
                    const wb = XLSX.read(e.target.result, { type: 'array' });
                    rows = [];
                    for (const sn of wb.SheetNames) {
                        const sh = wb.Sheets[sn];
                        if (sh) rows = rows.concat(XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '' }));
                    }
                }
                resolve(_fortesRowsToReportMap(rows));
            } catch (err) {
                console.warn('Erro ao ler relatório de valores:', err);
                resolve(new Map());
            }
        };
        reader.onerror = () => resolve(new Map());
        if (isText) reader.readAsText(file, 'utf-8'); else reader.readAsArrayBuffer(file);
    });
}

// Grupo 2 (híbrido): aplica instruções coladas reusando parseErrorLine + fix* (in-place).
// DUPLICITY/NF1 (apagam linhas) e TOTAL_VALUE/CFOP_SUM (cobertos pela correção de valores)
// ficam fora deste passe — para esses, use o fluxo de instruções dedicado (botão sem relatório).
function applyInstructionsLean(lines, text, summary) {
    const out = lines.slice();
    String(text || '').split('\n').forEach((instr) => {
        const t = instr.trim();
        if (!t || t.startsWith('//') || t.startsWith('#')) return;
        const e = parseErrorLine(t);
        if (!e || !e.lineNumber) return;
        const idx = e.lineNumber - 1;
        if (idx < 0 || idx >= out.length) return;
        const L = out[idx];
        let nl = L;
        switch (e.type) {
            case 'CST': nl = fixCstError(L, e.fieldNumber); break;
            case 'IE': nl = fixIeError(L, e.fieldNumber, e.invalidIe); break;
            case 'CEST': nl = fixCestError(L, e.fieldNumber, e.invalidCest); break;
            case 'QUANTITY': nl = fixQuantityError(L, e.fieldNumber, e.invalidValue, e.replacementValue); break;
            case 'LOGRADOURO': nl = fixLogradouroError(L, e.fieldNumber); break;
            case 'GRUPO': nl = fixGrupoError(L, e.fieldNumber, e.invalidValue); break;
            case 'ESTABELECIMENTO': nl = fixEstabelecimentoError(L, e.fieldNumber, e.invalidValue); break;
            case 'TRIBUTACAO': nl = fixTributacaoError(L); break;
            default: return;
        }
        if (nl !== L) { out[idx] = nl; summary.grupo2++; }
    });
    return out;
}

// Grupo 1 (proativo seguro): só a correção determinística que pode ser detectada SEM
// ambiguidade pelo próprio arquivo — quantidade equivalente 0 em registro OUM → 1.00.
// O logradouro "S/N" NÃO entra aqui: o campo correto varia (8/18) e blindar pelo conteúdo
// gera falso positivo (testado: apagava campos PAR com valor "S"). Para logradouro, use o
// Grupo 2 (relatório de importação colado), que informa a linha/campo exatos.
function applyGrupo1Scan(lines, summary) {
    for (let k = 0; k < lines.length; k++) {
        const L = lines[k];
        if (L.indexOf('OUM|') === 0) {
            const f = L.split('|');
            if (f.length > 3 && parseFortesNumber(f[3]) === 0) {
                const nl = fixQuantityError(L, 4, f[3], '1.00');
                if (nl !== L) { lines[k] = nl; summary.grupo1++; }
            }
        }
    }
}

// Atualiza o contador de linhas da última linha TRA (campo 2 = total de linhas, incluindo a
// própria TRA, excluindo linha vazia final). Preserva o formato do arquivo: se o original
// vinha com zeros à esquerda, mantém a largura; senão, sem padding (ex.: "TRA|8546").
// Recomputa do array atual — qualquer linha adicionada/removida (rebuild de INM, etc.) reflete.
function fixTraCount(lines) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    let ti = -1;
    for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].indexOf('TRA|') === 0) { ti = i; break; } }
    if (ti === -1) return lines;
    // TRA deve ser a última linha: remove qualquer linha órfã após ele (ex.: INM mal
    // posicionada de uma execução anterior, antes do fix de posicionamento da INM).
    if (ti < lines.length - 1) lines = lines.slice(0, ti + 1);
    const f = lines[ti].split('|');
    const orig = f[1] || '';
    const count = lines.length;
    const cs = String(count);
    f[1] = (/^0\d/.test(orig) && orig.length > cs.length) ? cs.padStart(orig.length, '0') : cs;
    lines[ti] = f.join('|');
    return lines;
}

// Correção de valores por bloco NFM. Mapa de campos (0-based) confirmado por harness:
//   NFM: chave=66, somatórioDespesas=28, valorLíquido=25/51/52, valorTotal=35
//   PNM: CFOP=2, CST=5, valorBruto=8/38/39, CST-PIS/COFINS=36/37, bruto+despesa=43, despesa=61
//   INM: total=1/9, CFOP=3, CST=19, campos 6º–9º (idx5..8)=0.00
function applyValueCorrection(lines, reportMap, cadastro, summary) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const ln = lines[i];
        if (ln.indexOf('NFM|') !== 0) { out.push(ln); i++; continue; }
        let j = i + 1;
        while (j < lines.length && lines[j].indexOf('NFM|') !== 0 && lines[j].indexOf('TRA|') !== 0) j++;
        const nfm = ln.split('|');
        const chave = (nfm[66] || '').replace(/\D/g, '');
        const valorTotal = reportMap.get(chave);
        if (valorTotal == null || isNaN(valorTotal)) {
            summary.notasSemRelatorio.push(chave || '(sem chave)');
            for (let k = i; k < j; k++) out.push(lines[k]);
            i = j; continue;
        }
        const body = [];
        let tpl = null;
        for (let k = i + 1; k < j; k++) {
            const L = lines[k];
            if (L.indexOf('PNM|') === 0) body.push({ t: 'PNM', f: L.split('|') });
            else if (L.indexOf('INM|') === 0) { if (!tpl) tpl = L.split('|'); }
            else body.push({ t: 'O', raw: L });
        }
        const pnms = body.filter(b => b.t === 'PNM');
        if (!pnms.length) { for (let k = i; k < j; k++) out.push(lines[k]); i = j; continue; }
        // Despesa = campos do NFM ORIGINAL para TODA nota (mono ou multi-CFOP):
        // frete(26)+seguro(27)+outras(28)+IPI(31)+ST(32)+serviços(33) − desconto(34). ICMS
        // importação (29/30) não entra. Cada campo em centavos antes de somar (evita erro de
        // ponto flutuante). Desconto entra NEGATIVO → aumenta o líquido (relatório 300 +
        // desconto 50 → líquido 350: o Fortes abate o desconto na entrada).
        // COMPROVADO PELO RELATÓRIO REAL (A & R, 2026-06-18): em 63/63 notas multi-CFOP com
        // gabarito, despesa = relatório − Σbruto = despNFM. A hipótese Σidx61 batia em só 42/63
        // (perdia IPI/ST/desconto reais; idx61 é 0,00 no arquivo). Logo multi-CFOP NÃO muda a
        // despesa — usa a mesma fonte do mono.
        // Única especialização multi-CFOP: o produto 1910 (bonificação/doação) recebe VALOR
        // CHEIO — seu bruto original fica FORA do rateio do líquido; só os demais distribuem o
        // restante. (Não validável pelo relatório, que só dá o total da nota; testar no Fortes.)
        const cNfm = (idx) => Math.round((parseFortesNumber(nfm[idx]) || 0) * 100);
        const cfopOf = (b) => (b.f[2] || '').replace(/\D/g, '');
        const cfopsSet = new Set(pnms.map(cfopOf));
        const isMulti = cfopsSet.size >= 2;
        const fixo = pnms.map(b => isMulti && cfopOf(b) === '1910'); // 1910 multi-CFOP = valor cheio
        // Nota SÓ-1910 (bonificação/doação pura): sem despesa — valor cheio = total do relatório.
        // Zera TODOS os campos de despesa do NFM (frete/seguro/outras/IPI/ST/serviços/desconto)
        // e despC=0, de modo que líquido = total = relatório (decisão do Josué, 2026-06-18).
        const so1910 = cfopsSet.size === 1 && cfopsSet.has('1910');
        if (so1910) { [26, 27, 28, 31, 32, 33, 34].forEach(ix => { nfm[ix] = '0.00'; }); }
        const despC = so1910 ? 0 : (cNfm(26) + cNfm(27) + cNfm(28) + cNfm(31) + cNfm(32) + cNfm(33) - cNfm(34));
        const totC = Math.round(valorTotal * 100);
        // Desoneração entra SÓ no idx43 da linha do produto — nada de desoneração no NFM nem
        // no INM. Logo líquido = total - despesas (o bruto idx8/38/39 soma ao líquido).
        const liqC = totC - despC;
        const bru = pnms.map(b => Math.round((parseFortesNumber(b.f[8]) || 0) * 100));
        // Produtos 1910 (multi-CFOP) mantêm o bruto cheio; só os demais entram no rateio.
        const bruFixo = bru.reduce((a, c, x) => a + (fixo[x] ? c : 0), 0);
        const idxAjust = pnms.map((_, x) => x).filter(x => !fixo[x]);
        const alvoAjust = liqC - bruFixo; // Σ bruto ajustável = líquido − Σ bruto dos 1910 cheios
        const sbAjust = idxAjust.reduce((a, x) => a + bru[x], 0);
        const ddAjust = distributeCentsRR(alvoAjust - sbAjust, idxAjust.length);
        // Piso de 1 centavo por produto ajustável: o round-robin pode deixar um bruto <= 0
        // (inválido — o Fortes recusa a nota). Eleva os abaixo do piso e retira o déficit dos
        // ajustáveis com folga da MESMA nota, mantendo Σ bruto ajustável = alvo. Se inviável
        // (alvo < nº ajustáveis), não emite nota inválida: registra e deixa a nota INTOCADA.
        const ajustTargets = enforceMinBrutoCents(idxAjust.map((x, k) => bru[x] + ddAjust[k]), 1);
        if (!ajustTargets) {
            summary.brutoInviavel.push({ chave: chave || '(sem chave)', liquido: liqC / 100, produtos: pnms.length });
            for (let k = i; k < j; k++) out.push(lines[k]);
            i = j; continue;
        }
        const targets = bru.slice(); // fixos (1910) mantêm bruto; ajustáveis recebem o rateio
        idxAjust.forEach((x, k) => { targets[x] = ajustTargets[k]; });
        pnms.forEach((b, x) => {
            const nb = targets[x];
            const s = fsNum2(nb / 100);
            b.f[8] = s; b.f[38] = s; b.f[39] = s;
            const dc = Math.round((parseFortesNumber(b.f[61]) || 0) * 100);
            const dnc = Math.round((parseFortesNumber(b.f[42]) || 0) * 100); // desoneração (idx42), não muda
            b.f[43] = fsNum2((nb + dc - dnc) / 100);
            const cf = (b.f[2] || '').replace(/\D/g, '');
            const cad = cadastro[cf];
            if (cad) { if (cad.cst) b.f[5] = cad.cst; if (cad.pis) { b.f[36] = cad.pis; b.f[37] = cad.pis; } }
        });
        // idx28 (outras despesas) é PRESERVADO — agora é fonte de cálculo, não destino.
        nfm[35] = fsNum2(liqC / 100); // campo 36 = LÍQUIDO (era o total do documento)
        const lq = fsNum2(liqC / 100);
        nfm[25] = lq; nfm[51] = lq; nfm[52] = lq;
        const groups = []; const gm = new Map();
        pnms.forEach(b => {
            const cf = (b.f[2] || '').replace(/\D/g, ''), cs = b.f[5] || '';
            const key = cf + '|' + cs;
            let g = gm.get(key);
            if (!g) { g = { cf, cs, c: 0 }; gm.set(key, g); groups.push(g); }
            // INM = Σ bruto do grupo (SÓ idx8, sem idx61 nem desoneração). Como Σ bruto = líquido
            // por construção (distribuição acima), Σ INM = líquido = nfm[35].
            g.c += Math.round((parseFortesNumber(b.f[8]) || 0) * 100);
        });
        const tplArr = tpl || ['INM', '0.00', 'CE', '', '', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '', '', '', '', '0', '', '', '', '', '', '', 'N', ''];
        const newInm = groups.map(g => {
            const f = tplArr.slice();
            const tt = fsNum2(g.c / 100);
            f[1] = tt; f[9] = tt; f[3] = g.cf; f[19] = g.cs;
            f[5] = '0.00'; f[6] = '0.00'; f[7] = '0.00'; f[8] = '0.00';
            return f.join('|');
        });
        out.push(nfm.join('|'));
        body.forEach(b => out.push(b.t === 'PNM' ? b.f.join('|') : b.raw));
        newInm.forEach(s => out.push(s));
        const gsum = groups.reduce((a, g) => a + g.c, 0);
        if (Math.abs(gsum - liqC) > 1) summary.recheck.push({ chave, esperado: liqC / 100, obtido: gsum / 100 });
        summary.notasCorrigidas++;
        i = j;
    }
    return out;
}

// Orquestra o pipeline completo. Puro (sem DOM) — testável isoladamente.
function runFortesCorrection(fsText, reportMap, cadastro, instructionsText) {
    const parsed = parseFortesFile(fsText);
    let lines = parsed.lines.slice();
    const summary = { notasCorrigidas: 0, notasSemRelatorio: [], grupo1: 0, grupo2: 0, recheck: [], brutoInviavel: [] };
    if (instructionsText && instructionsText.trim()) lines = applyInstructionsLean(lines, instructionsText, summary);
    applyGrupo1Scan(lines, summary);
    lines = applyValueCorrection(lines, reportMap, cadastro || {}, summary);
    lines = fixTraCount(lines);
    return { text: lines.join('\n'), summary };
}

// Handler do botão Processar quando há relatório carregado.
function processFortesFullCorrection() {
    if (!fortesFileData) { alert('Carregue um arquivo .fs primeiro.'); return; }
    if (!fortesReportMap || !fortesReportMap.size) { alert('Carregue o relatório de valores.'); return; }
    const cadastro = (typeof getCfopCstPatterns === 'function') ? getCfopCstPatterns() : {};
    const { text, summary } = runFortesCorrection(fortesFileData, fortesReportMap, cadastro, fortesAdjustmentsText);
    fortesFileData = text;
    const dl = document.getElementById('fortes-download-btn');
    if (dl) dl.style.display = 'flex';
    let msg = 'Correção concluída!\n\n';
    msg += `Notas corrigidas (valores): ${summary.notasCorrigidas}\n`;
    msg += `Ajustes Grupo 1 (varredura proativa): ${summary.grupo1}\n`;
    msg += `Ajustes Grupo 2 (instruções coladas): ${summary.grupo2}\n`;
    if (summary.notasSemRelatorio.length) {
        msg += `\nNotas SEM valor no relatório (não tocadas): ${summary.notasSemRelatorio.length}\n`;
        summary.notasSemRelatorio.slice(0, 5).forEach(c => { msg += `  - ${c}\n`; });
        if (summary.notasSemRelatorio.length > 5) msg += `  ... e mais ${summary.notasSemRelatorio.length - 5}\n`;
    }
    if (summary.brutoInviavel && summary.brutoInviavel.length) {
        msg += `\n⚠ Notas NÃO corrigidas (líquido menor que 0,01 × nº de produtos — bruto mínimo impossível): ${summary.brutoInviavel.length}\n`;
        summary.brutoInviavel.slice(0, 5).forEach(d => { msg += `  - ${d.chave}: líquido ${d.liquido.toFixed(2)} para ${d.produtos} produto(s)\n`; });
        if (summary.brutoInviavel.length > 5) msg += `  ... e mais ${summary.brutoInviavel.length - 5}\n`;
    }
    if (summary.recheck.length) {
        msg += `\n⚠ Divergências na checagem final (${summary.recheck.length}):\n`;
        summary.recheck.slice(0, 5).forEach(d => { msg += `  - ${d.chave}: esperado ${d.esperado.toFixed(2)}, obtido ${d.obtido.toFixed(2)}\n`; });
    } else {
        msg += `\n✓ Checagem final: todos os totais batem com o relatório.\n`;
    }
    msg += '\nVocê pode baixar o arquivo corrigido.';
    alert(msg);
}

//------------------------------------ FIM Fortes Correction ------------------------------------//
//------------------------------------ NFe | NFCe Comparasion ------------------------------------//

let sigetData = [];
let fortesData = [];

function createNfeCfeComparisonPage(mainContent) {
    console.log('createNfeCfeComparisonPage chamado');
    mainContent.innerHTML = `
        <h1>NFe | NFCe Comparison</h1>
        <div class="nfe-cfe-grid" style="display: flex; flex-direction: column; gap: 1.6rem; max-width: 1200px; margin: 0 auto; padding: 2rem;">
            <div class="box animate-section" style="animation-delay: 0s; width: 100%; max-width: 800px; height: 300px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; align-items: center; justify-content: center;" id="siget-box">
                <span class="box-label" id="siget-label">SIGA</span>
                <svg id="siget-check" width="60" height="60" viewBox="0 0 24 24" fill="none" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
                    <path d="M20 6L9 17L4 12" stroke="#00ff00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30" stroke-dashoffset="30"/>
                </svg>
                <input type="file" id="siget-file-input" accept=".txt,.csv,.xls,.xlsx,.xml,.pdf,.html,.htm,.rtf" multiple style="display: none;">
            </div>
            <div class="box animate-section" style="animation-delay: 0.1s; width: 100%; max-width: 800px; height: 300px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; align-items: center; justify-content: center;" id="fortes-box">
                <span class="box-label" id="fortes-label">Fortes</span>
                <svg id="fortes-check" width="60" height="60" viewBox="0 0 24 24" fill="none" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
                    <path d="M20 6L9 17L4 12" stroke="#00ff00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30" stroke-dashoffset="30"/>
                </svg>
                <input type="file" id="fortes-file-input" accept=".txt,.csv,.xls,.xlsx,.xml,.pdf,.html,.htm,.rtf" multiple style="display: none;">
            </div>
        </div>
    `;

    const sigetBox = document.getElementById('siget-box');
    const sigetFileInput = document.getElementById('siget-file-input');
    const sigetLabel = document.getElementById('siget-label');
    const sigetCheck = document.getElementById('siget-check');
    const fortesBox = document.getElementById('fortes-box');
    const fortesFileInput = document.getElementById('fortes-file-input');
    const fortesLabel = document.getElementById('fortes-label');
    const fortesCheck = document.getElementById('fortes-check');

    let sigetLoaded = false;
    let fortesLoaded = false;

    const checkBothLoaded = () => {
        if (sigetLoaded && fortesLoaded) {
            // Abre o modal assim que ambos os lados terminam (sem espera artificial).
            showComparisonModal();
        }
    };

    // Configurar SIGA
    sigetBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        sigetBox.classList.add('dragover');
        console.log('Dragover em SIGA');
    });

    sigetBox.addEventListener('dragleave', () => {
        sigetBox.classList.remove('dragover');
        console.log('Dragleave em SIGA');
    });

    sigetBox.addEventListener('drop', (e) => {
        e.preventDefault();
        sigetBox.classList.remove('dragover');
        console.log('Drop em SIGA');
        const files = e.dataTransfer.files;
        processFiles(files, sigetLabel, sigetCheck, sigetData, () => {
            sigetLoaded = true;
            checkBothLoaded();
        });
    });

    sigetBox.addEventListener('click', () => {
        console.log('Clique em SIGA box');
        sigetFileInput.click();
    });

    sigetFileInput.addEventListener('change', () => {
        console.log('Arquivos selecionados via input em SIGA');
        processFiles(sigetFileInput.files, sigetLabel, sigetCheck, sigetData, () => {
            sigetLoaded = true;
            checkBothLoaded();
        });
    });

    // Configurar FORTES
    fortesBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        fortesBox.classList.add('dragover');
        console.log('Dragover em FORTES');
    });

    fortesBox.addEventListener('dragleave', () => {
        fortesBox.classList.remove('dragover');
        console.log('Dragleave em FORTES');
    });

    fortesBox.addEventListener('drop', (e) => {
        e.preventDefault();
        fortesBox.classList.remove('dragover');
        console.log('Drop em FORTES');
        const files = e.dataTransfer.files;
        processFiles(files, fortesLabel, fortesCheck, fortesData, () => {
            fortesLoaded = true;
            checkBothLoaded();
        });
    });

    fortesBox.addEventListener('click', () => {
        console.log('Clique em FORTES box');
        fortesFileInput.click();
    });

    fortesFileInput.addEventListener('change', () => {
        console.log('Arquivos selecionados via input em FORTES');
        processFiles(fortesFileInput.files, fortesLabel, fortesCheck, fortesData, () => {
            fortesLoaded = true;
            checkBothLoaded();
        });
    });

    function cleanKey(rawKey) {
        if (typeof rawKey !== 'string') {
            rawKey = String(rawKey);
        }
        return rawKey.replace(/[^0-9]/g, '');
    }

    function formatXMLValue(value) {
        if (!value) return null;
        const parsedValue = parseFloat(value);
        if (isNaN(parsedValue)) return null;
        return parsedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Parser numérico tolerante a locale. O separador DECIMAL é o último '.' ou ',' que
    // aparecer; o outro é tratado como separador de milhar e removido. Cobre tanto o BR
    // ("1.036,88") quanto o US ("1,036.88") — este último é o que o SheetJS gera no cell.w
    // ao renderizar o código de formato da planilha, e era a origem do bug "1.036,88 → 1,03"
    // (o replace ingênuo de uma única vírgula virava parseFloat("1.036.88") = 1.036).
    function parseLocaleNumber(value) {
        let s = String(value == null ? '' : value).replace(/[^\d.,-]/g, '');
        if (!s) return NaN;
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma !== -1 || lastDot !== -1) {
            const decSep = lastComma > lastDot ? ',' : '.';
            const thousSep = decSep === ',' ? '.' : ',';
            s = s.split(thousSep).join('').replace(decSep, '.');
        }
        return parseFloat(s);
    }

    function formatSpreadsheetOrTextValue(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsedValue = parseLocaleNumber(value);
        if (isNaN(parsedValue)) return null;
        return parsedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatFileDate(dateStr) {
        if (!dateStr) return '';
        const s = String(dateStr).trim();
        // DD/MM/AAAA (aceita hora após a data, ex.: "15/03/2024 10:30")
        const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (br) return `${br[3]}-${br[2]}-${br[1]}`;
        // AAAA-MM-DD (ISO) — já no formato alvo
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        // Formato desconhecido: não fabrica "undefined-undefined-..."
        return '';
    }

    function processTextFile(file, dataArray) {
        return new Promise((resolve) => {
            console.log(`Iniciando leitura do arquivo de texto: ${file.name}`);
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    console.log(`Arquivo de texto lido: ${file.name}`);
                    const lines = e.target.result.split('\n').filter(line => line.trim() !== '');
                    console.log(`Total de linhas no arquivo: ${lines.length}`);

                    let validLines = 0;
                    lines.forEach((line, index) => {
                        const trimmedLine = line.trim();
                        // Separar por espaços ou tabulações (múltiplos espaços ou tabs)
                        const parts = trimmedLine.split(/\s+/).filter(part => part.trim() !== '');

                        let key = '', value = '', numeroNf = '', dhEmi = '', cnpj = '', type = 'NFe';

                        parts.forEach((part, partIndex) => {
                            if (!part) return;

                            // Detectar Chave (44 dígitos)
                            const cleanedKey = cleanKey(part);
                            if (/^\d{44}$/.test(cleanedKey)) {
                                key = cleanedKey;
                                type = cleanedKey.startsWith('CFe') ? 'CFe' : 'NFe';
                                return;
                            }

                            // Detectar CNPJ (14 dígitos após limpeza)
                            const cleanedCnpj = cleanKey(part);
                            if (/^\d{14}$/.test(cleanedCnpj)) {
                                cnpj = cleanedCnpj;
                                return;
                            }

                            // Detectar Data de Emissão (DD/MM/YYYY)
                            const dateMatch = part.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                            if (dateMatch) {
                                dhEmi = formatFileDate(part);
                                return;
                            }

                            // Detectar Nº NF-e (número inteiro)
                            const numeroNfMatch = part.match(/^\d+$/);
                            if (numeroNfMatch && !isNaN(parseInt(part))) {
                                numeroNf = part;
                                return;
                            }

                            // Detectar Valor (com ou sem "R$")
                            const formattedValue = formatSpreadsheetOrTextValue(part);
                            if (formattedValue) {
                                value = formattedValue;
                            }
                        });

                        if (key) {
                            dataArray.push({ key, numeroNf, dhEmi, cnpj, value, type });
                            validLines++;
                            // Log apenas a cada 1000 linhas válidas ou nas primeiras 10
                            if (validLines <= 10 || validLines % 1000 === 0) {
                                console.log(`✅ Linha ${index + 1}: Chave ${key} encontrada (Total: ${validLines})`);
                            }
                        }
                    });
                    console.log(`✅ Arquivo de texto processado: ${validLines} chaves válidas de ${lines.length} linhas`);
                } catch (error) {
                    console.warn(`Erro ao processar arquivo de texto ${file.name}: ${error.message}`);
                }
                resolve();
            };
            reader.onerror = () => {
                console.warn(`Erro ao ler arquivo de texto: ${file.name}`);
                resolve();
            };
            reader.readAsText(file);
        });
    }

    function processFile(file, dataArray) {
        return new Promise((resolve) => {
            console.log(`Iniciando leitura do arquivo XML: ${file.name}`);
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    console.log(`Arquivo XML lido: ${file.name}`);
                    const parser = new DOMParser();
                    const xml = parser.parseFromString(e.target.result, "application/xml");
                    const errorNode = xml.querySelector("parsererror");
                    if (errorNode) {
                        console.warn(`Erro ao parsear XML: ${file.name}`);
                        resolve();
                        return;
                    }

                    let key, numeroNf, dhEmi, cnpj, value, type;
                    const nfeNamespace = "http://www.portalfiscal.inf.br/nfe";

                    let elem = xml.querySelector('nfeProc > protNFe > infProt > chNFe');
                    let valueElem = xml.querySelector('nfeProc > NFe > infNFe > total > ICMSTot > vNF');
                    let ide = xml.querySelector('nfeProc > NFe > infNFe > ide');
                    let emit = xml.querySelector('nfeProc > NFe > infNFe > emit');
                    if (elem && elem.textContent && valueElem && valueElem.textContent && ide && emit) {
                        key = elem.textContent.trim();
                        numeroNf = ide.getElementsByTagNameNS(nfeNamespace, 'nNF')[0]?.textContent.trim() || '';
                        dhEmi = ide.getElementsByTagNameNS(nfeNamespace, 'dhEmi')[0]?.textContent.trim().slice(0, 10) || '';
                        cnpj = emit.getElementsByTagNameNS(nfeNamespace, 'CNPJ')[0]?.textContent.trim() || '';
                        value = valueElem.textContent.trim();
                        type = 'NFe';
                        console.log(`NFe detectada - Chave: ${key}, Nº NFe: ${numeroNf}, Data: ${dhEmi}, CNPJ: ${cnpj}, Valor: ${value}`);
                    } else {
                        let infCFe = xml.querySelector('CFe > infCFe');
                        let valueCFe = xml.querySelector('CFe > infCFe > total > vCFe');
                        if (infCFe && infCFe.getAttribute('Id') && valueCFe && valueCFe.textContent) {
                            key = infCFe.getAttribute('Id').replace(/^CFe/, '').trim();
                            numeroNf = '';
                            dhEmi = '';
                            cnpj = '';
                            value = valueCFe.textContent.trim();
                            type = 'CFe';
                            console.log(`CFe detectada - Chave: ${key}, Valor: ${value}`);
                        }
                    }

                    const cleanedKey = cleanKey(key);
                    const formattedValue = formatXMLValue(value);
                    if (cleanedKey && /^\d{44}$/.test(cleanedKey)) {
                        dataArray.push({ key: cleanedKey, numeroNf, dhEmi, cnpj, value: formattedValue, type });
                        console.log(`Adicionado ao array - Chave: ${cleanedKey}, Valor: ${formattedValue || 'Ausente'}, Tipo: ${type}, Total de itens: ${dataArray.length}`);
                    } else {
                        console.warn(`Chave ou valor inválido no arquivo: ${file.name}`);
                    }
                } catch (error) {
                    console.warn(`Erro ao processar XML ${file.name}: ${error.message}`);
                }
                resolve();
            };
            reader.onerror = () => {
                console.warn(`Erro ao ler arquivo XML: ${file.name}`);
                resolve();
            };
            reader.readAsText(file);
        });
    }

    function processSpreadsheet(file, dataArray, label, checkSvg) {
        return new Promise((resolve) => {
            console.log(`📊 Iniciando leitura da planilha: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
            
            // Criar barra de progresso
            const progressContainer = document.createElement('div');
            progressContainer.className = 'progress-container';
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressText = document.createElement('div');
            progressText.className = 'progress-text';
            progressText.textContent = 'Carregando arquivo...';
            progressContainer.appendChild(progressBar);
            progressContainer.appendChild(progressText);
            
            // Adicionar progresso ao box
            const boxElement = label ? label.closest('.box') : null;
            if (boxElement) {
                boxElement.style.position = 'relative';
                boxElement.appendChild(progressContainer);
            }
            
            const reader = new FileReader();
            const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
            reader.onload = async (e) => {
                try {
                    progressText.textContent = isCsv ? 'Processando CSV...' : 'Processando planilha...';
                    progressBar.style.width = '20%';

                    console.log(`📖 ${isCsv ? 'CSV' : 'Planilha'} carregado: ${file.name}`);
                    const workbook = XLSX.read(e.target.result, {
                        type: isCsv ? 'string' : 'array',
                        cellDates: false,
                        cellNF: false,
                        cellStyles: false,
                        sheetStubs: false,
                        raw: false,
                    });
                    
                    progressBar.style.width = '30%';
                    let valueColumn = null;
                    let cnpjColumn = null;
                    let numeroNfColumn = null;
                    let dateColumn = null;
    
                    // Otimizar busca de colunas - procurar apenas nas primeiras 10 linhas
                    const findColumn = (sheet, pattern) => {
                        const range = XLSX.utils.decode_range(sheet['!ref']);
                        const maxSearchRows = Math.min(range.s.r + 10, range.e.r);
                        for (let row = range.s.r; row <= maxSearchRows; row++) {
                            for (let col = range.s.c; col <= range.e.c; col++) {
                                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                                const cell = sheet[cellAddress];
                                if (cell && typeof cell.v === 'string') {
                                    if (pattern.test(cell.v.toLowerCase())) {
                                        console.log(`✅ Coluna encontrada: ${pattern.source} na coluna ${col}`);
                                        return col;
                                    }
                                }
                            }
                        }
                        return -1;
                    };
    
                    progressBar.style.width = '40%';
                    
                    // Processar cada aba
                    for (const sheetName of workbook.SheetNames) {
                        console.log(`📋 Processando aba: ${sheetName}`);
                        const sheet = workbook.Sheets[sheetName];
                        if (!sheet['!ref']) {
                            console.warn(`⚠️ Aba ${sheetName} vazia ou inválida.`);
                            continue;
                        }
    
                        const range = XLSX.utils.decode_range(sheet['!ref']);
                        const totalRows = range.e.r - range.s.r;
                        console.log(`📊 Total de linhas na aba ${sheetName}: ${totalRows.toLocaleString('pt-BR')}`);
                        
                        // Detectar colunas apenas uma vez
                        if (valueColumn === null) valueColumn = findColumn(sheet, /valor|vlr|vltotal/i);
                        if (cnpjColumn === null) cnpjColumn = findColumn(sheet, /cnpj/i);
                        if (numeroNfColumn === null) numeroNfColumn = findColumn(sheet, /nº nf-e|numero nf-e|num|nfe/i);
                        if (dateColumn === null) dateColumn = findColumn(sheet, /data|emissão|dt/i);
    
                        // Fallback dinâmico
                        if (valueColumn === -1) valueColumn = range.e.c;
                        if (cnpjColumn === -1) cnpjColumn = range.e.c - 1;
                        if (numeroNfColumn === -1) numeroNfColumn = range.e.c - 2;
                        if (dateColumn === -1) dateColumn = range.e.c - 3;
    
                        console.log(`📍 Colunas detectadas - Valor: ${valueColumn}, CNPJ: ${cnpjColumn}, Nº NF-e: ${numeroNfColumn}, Data: ${dateColumn}`);
                        
                        progressBar.style.width = '50%';
                        progressText.textContent = `Processando ${totalRows.toLocaleString('pt-BR')} linhas...`;
                        
                        // Processar em chunks para não travar a UI
                        const CHUNK_SIZE = 1000; // Processar 1000 linhas por vez
                        const startRow = range.s.r + 1;
                        const endRow = range.e.r;
                        let processedRows = 0;
                        let foundKeys = 0;
                        
                        // Função para processar um chunk
                        const processChunk = (start, end) => {
                            return new Promise((chunkResolve) => {
                                setTimeout(() => {
                                    for (let row = start; row <= end && row <= endRow; row++) {
                                        let keyFound = false;
                                        
                                        // Buscar chave - otimizar: parar quando encontrar
                                        for (let col = range.s.c; col <= range.e.c && !keyFound; col++) {
                                            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                                            const cell = sheet[cellAddress];
                                            if (cell) {
                                                const rawKey = String(cell.w || cell.v).trim();
                                                const cleanedKey = cleanKey(rawKey);
                                                if (/^\d{44}$/.test(cleanedKey)) {
                                                    keyFound = true;
                                                    
                                                    // Buscar dados das outras colunas
                                                    const valueCell = sheet[XLSX.utils.encode_cell({ r: row, c: valueColumn })];
                                                    let value = valueCell ? String(valueCell.w || valueCell.v).trim() : null;
                                                    const formattedValue = formatSpreadsheetOrTextValue(value) || '0,00';
                                    
                                                    const cnpjCell = sheet[XLSX.utils.encode_cell({ r: row, c: cnpjColumn })];
                                                    let cnpj = cnpjCell ? cleanKey(String(cnpjCell.w || cnpjCell.v).trim()) : '';
                                    
                                                    const numeroNfCell = sheet[XLSX.utils.encode_cell({ r: row, c: numeroNfColumn })];
                                                    let numeroNf = numeroNfCell ? String(numeroNfCell.w || numeroNfCell.v).trim() : '';
                                    
                                                    const dateCell = sheet[XLSX.utils.encode_cell({ r: row, c: dateColumn })];
                                                    let dhEmi = dateCell ? formatFileDate(String(dateCell.w || dateCell.v).trim()) : '';
                                    
                                                    const type = cleanedKey.startsWith('CFe') ? 'CFe' : 'NFe';
                                                    dataArray.push({ key: cleanedKey, numeroNf, dhEmi, cnpj, value: formattedValue, type });
                                                    foundKeys++;
                                                }
                                            }
                                        }
                                        processedRows++;
                                    }
                                    chunkResolve();
                                }, 0); // Usar setTimeout para não travar
                            });
                        };
                        
                        // Processar todos os chunks sequencialmente
                        for (let chunkStart = startRow; chunkStart <= endRow; chunkStart += CHUNK_SIZE) {
                            const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, endRow);
                            await processChunk(chunkStart, chunkEnd);
                            
                            // Atualizar progresso
                            const progress = 50 + ((processedRows / totalRows) * 45);
                            progressBar.style.width = `${Math.min(progress, 95)}%`;
                            progressText.textContent = `Processadas ${processedRows.toLocaleString('pt-BR')} de ${totalRows.toLocaleString('pt-BR')} linhas (${foundKeys} chaves encontradas)`;
                            
                            // Log a cada 5000 linhas processadas
                            if (processedRows % 5000 === 0) {
                                console.log(`⏳ Progresso: ${processedRows.toLocaleString('pt-BR')}/${totalRows.toLocaleString('pt-BR')} linhas (${foundKeys} chaves)`);
                            }
                        }
                        
                        console.log(`✅ Aba ${sheetName} processada: ${foundKeys} chaves encontradas em ${processedRows.toLocaleString('pt-BR')} linhas`);
                    }
                    
                    progressBar.style.width = '100%';
                    progressText.textContent = `✅ Concluído! ${dataArray.length.toLocaleString('pt-BR')} registros processados`;
                    
                    // Remover barra de progresso após 1 segundo
                    setTimeout(() => {
                        if (progressContainer.parentNode) {
                            progressContainer.remove();
                        }
                    }, 1000);
                    
                    console.log(`✅ Processamento completo: ${dataArray.length.toLocaleString('pt-BR')} registros totais de ${file.name}`);
                } catch (error) {
                    console.error(`❌ Erro ao processar planilha ${file.name}:`, error);
                    if (progressContainer.parentNode) {
                        progressContainer.remove();
                    }
                }
                resolve();
            };
            reader.onerror = () => {
                console.error(`❌ Erro ao ler planilha: ${file.name}`);
                if (progressContainer.parentNode) {
                    progressContainer.remove();
                }
                resolve();
            };
            // CSV é texto, XLSX/XLS é binário. XLSX.read aceita 'string' ou 'array'.
            if (isCsv) {
                reader.readAsText(file, 'utf-8');
            } else {
                reader.readAsArrayBuffer(file);
            }
        });
    }

    // Parser de uma linha CSV respeitando campos entre aspas (vírgula como separador,
    // aspas duplicadas escapam aspas). Usado pelo relatório SIGA, que vem em CSV.
    function parseCsvLine(line) {
        const out = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuotes = false;
                } else cur += ch;
            } else {
                if (ch === '"') inQuotes = true;
                else if (ch === ',') { out.push(cur); cur = ''; }
                else cur += ch;
            }
        }
        out.push(cur);
        return out.map(s => s.trim());
    }

    // Parser dedicado do relatório SIGA (novo layout da SEFAZ, em CSV). Lê a chave como
    // TEXTO — evitando a notação científica que o SheetJS aplicaria a 44 dígitos. Mantém
    // o SIGET (formatos antigos) intacto: retorna false quando o cabeçalho não é do SIGA,
    // deixando o arquivo seguir para o parser genérico (processSpreadsheet).
    // Layout SIGA: CNPJ destinatário, Razão social, UF, Número da nota, Data de emissão,
    // Indicadores selecionados (AUTORIZADA/CANCELADA), Valor R$, Chave NF-e.
    function processSigaCsv(file, dataArray) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const lines = String(e.target.result).split(/\r?\n/).filter(l => l.trim() !== '');
                    if (lines.length < 2) { resolve(false); return; }

                    // O cabeçalho nem sempre está na 1ª linha. O layout SIGA novo (SEFAZ)
                    // tem header na linha 0, mas o layout SIGET (DEP PLANALTO/CONSTRULOPES)
                    // traz linhas de preâmbulo (empresa, CGF, ano) antes — o header real
                    // só aparece mais abaixo. Varremos as primeiras linhas atrás da que
                    // tenha colunas "Chave" E "Valor".
                    let headerIdx = -1, header = null, idxChave = -1, idxValor = -1;
                    const scanLimit = Math.min(lines.length, 25);
                    for (let h = 0; h < scanLimit; h++) {
                        const cells = parseCsvLine(lines[h]).map(c => c.toLowerCase());
                        const ic = cells.findIndex(c => c.includes('chave'));
                        const iv = cells.findIndex(c => c.includes('valor'));
                        if (ic !== -1 && iv !== -1) {
                            headerIdx = h; header = cells; idxChave = ic; idxValor = iv;
                            break;
                        }
                    }
                    // Assinatura do SIGA/SIGET: precisa ter colunas "Chave" e "Valor".
                    if (headerIdx === -1) { resolve(false); return; }

                    const idxCnpj = header.findIndex(h => h.includes('cnpj'));
                    const idxNum = header.findIndex(h => h.includes('número') || h.includes('numero'));
                    const idxData = header.findIndex(h => h.includes('data') || h.includes('emiss'));
                    const idxStatus = header.findIndex(h => h.includes('indicador') || h.includes('situa'));

                    let count = 0;
                    for (let i = headerIdx + 1; i < lines.length; i++) {
                        const cols = parseCsvLine(lines[i]);
                        const key = cleanKey(cols[idxChave] || '');
                        if (!/^\d{44}$/.test(key)) continue;
                        const value = formatSpreadsheetOrTextValue(cols[idxValor]) || '0,00';
                        const cnpj = idxCnpj !== -1 ? cleanKey(cols[idxCnpj] || '') : '';
                        const numeroNf = idxNum !== -1 ? (cols[idxNum] || '') : '';
                        const dhEmi = idxData !== -1 ? formatFileDate(cols[idxData] || '') : '';
                        const status = idxStatus !== -1 ? (cols[idxStatus] || '').toUpperCase() : '';
                        dataArray.push({ key, numeroNf, dhEmi, cnpj, value, type: 'NFe', status });
                        count++;
                    }
                    console.log(`✅ Relatório SIGA reconhecido: ${count} chaves de ${lines.length - 1} linhas (${file.name})`);
                    resolve(true);
                } catch (err) {
                    console.warn(`Erro ao processar CSV SIGA ${file.name}: ${err.message}`);
                    resolve(false);
                }
            };
            reader.onerror = () => resolve(false);
            reader.readAsText(file, 'utf-8');
        });
    }

    // Helper compartilhado por PDF/HTML/RTF: varre um texto livre, extrai cada
    // chave de 44 dígitos e busca o valor monetário mais próximo nos 200 chars
    // seguintes. Os formatos FORTES (pdf/html/rtf) não têm colunas estruturadas,
    // então a chave é a âncora e o valor é o R$ que aparece logo após.
    function extractKeysFromFreeText(text, dataArray) {
        if (!text) return 0;
        const moneyRegex = /R\$\s*([\d.]+,\d{2})|(\d{1,3}(?:\.\d{3})*,\d{2})/;
        // O FORTES imprime a chave formatada com separadores, ex.:
        //   23-2601-12.370.169/0001-12-65-801-000.020.500-155.219.544-9
        // Capturamos corridas de digitos+separadores (-, ., /) e validamos 44 digitos
        // apos a limpeza. Tambem casa a chave "crua" de 44 digitos seguidos.
        const candidateRegex = /\d[\d.\-\/]{38,}\d/g;
        let count = 0;
        let match;
        while ((match = candidateRegex.exec(text)) !== null) {
            const key = match[0].replace(/\D/g, '');
            if (key.length !== 44) continue;
            const afterStart = match.index + match[0].length;
            const after = text.slice(afterStart, afterStart + 200);
            const moneyMatch = after.match(moneyRegex);
            const rawValue = moneyMatch ? (moneyMatch[1] || moneyMatch[2]) : '';
            const value = formatSpreadsheetOrTextValue(rawValue) || '0,00';
            dataArray.push({ key, value, type: 'NFe', numeroNf: '', dhEmi: '', cnpj: '' });
            count++;
        }
        return count;
    }

    function processPdf(file, dataArray) {
        return new Promise((resolve) => {
            if (!window.pdfjsLib) {
                console.warn(`pdf.js não carregado; PDF ignorado: ${file.name}`);
                resolve(false);
                return;
            }
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
                    let fullText = '';
                    for (let p = 1; p <= pdf.numPages; p++) {
                        const page = await pdf.getPage(p);
                        const content = await page.getTextContent();
                        fullText += ' ' + content.items.map(i => i.str).join(' ');
                    }
                    const count = extractKeysFromFreeText(fullText, dataArray);
                    console.log(`✅ PDF processado: ${count} chaves (${file.name})`);
                    resolve(true);
                } catch (err) {
                    console.warn(`Erro ao processar PDF ${file.name}: ${err.message}`);
                    resolve(false);
                }
            };
            reader.onerror = () => resolve(false);
            reader.readAsArrayBuffer(file);
        });
    }

    function processHtml(file, dataArray) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const raw = e.target.result || '';
                    let text = raw;
                    try {
                        const doc = new DOMParser().parseFromString(raw, 'text/html');
                        text = (doc.body && (doc.body.innerText || doc.body.textContent)) || raw;
                    } catch (parseErr) {
                        // Fallback: DOMParser falhou, usa o texto bruto direto
                        text = raw;
                    }
                    const count = extractKeysFromFreeText(text, dataArray);
                    console.log(`✅ HTML processado: ${count} chaves (${file.name})`);
                    resolve(true);
                } catch (err) {
                    console.warn(`Erro ao processar HTML ${file.name}: ${err.message}`);
                    resolve(false);
                }
            };
            reader.onerror = () => resolve(false);
            reader.readAsText(file);
        });
    }

    function processRtf(file, dataArray) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const raw = e.target.result || '';
                    // Remove escapes \'XX e grupos de controle RTF, mantendo o texto.
                    const text = raw
                        .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
                        .replace(/\\\w+[-]?[\d]*/g, '')
                        .replace(/[{}]/g, '')
                        .replace(/\\\\/g, '\\');
                    const count = extractKeysFromFreeText(text, dataArray);
                    console.log(`✅ RTF processado: ${count} chaves (${file.name})`);
                    resolve(true);
                } catch (err) {
                    console.warn(`Erro ao processar RTF ${file.name}: ${err.message}`);
                    resolve(false);
                }
            };
            reader.onerror = () => resolve(false);
            reader.readAsText(file, 'windows-1252');
        });
    }

    function processFiles(files, label, checkSvg, dataArray, callback) {
        if (!files || files.length === 0) {
            console.warn('Nenhum arquivo selecionado');
            return;
        }
        const promises = [];
        for (const file of files) {
            if (file.name.endsWith('.xml') || file.type === 'text/xml') {
                console.log(`Processando arquivo XML: ${file.name}`);
                promises.push(processFile(file, dataArray));
            } else if (file.name.endsWith('.txt') || file.type === 'text/plain') {
                console.log(`Processando arquivo de texto: ${file.name}`);
                promises.push(processTextFile(file, dataArray));
            } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') ||
                       file.name.endsWith('.csv') ||
                       file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                       file.type === 'application/vnd.ms-excel' ||
                       file.type === 'text/csv') {
                console.log(`📊 Processando planilha/CSV: ${file.name}`);
                const ehCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
                if (ehCsv) {
                    // SIGA-first: se o CSV for o novo relatório SEFAZ (SIGA), usa o parser
                    // dedicado; senão, cai no parser genérico (SIGET antigo / planilhas).
                    promises.push(
                        processSigaCsv(file, dataArray).then((reconhecido) => {
                            if (!reconhecido) return processSpreadsheet(file, dataArray, label, checkSvg);
                        })
                    );
                } else {
                    promises.push(processSpreadsheet(file, dataArray, label, checkSvg));
                }
            } else if (file.name.match(/\.pdf$/i)) {
                console.log(`📄 Processando PDF: ${file.name}`);
                promises.push(processPdf(file, dataArray));
            } else if (file.name.match(/\.html?$/i)) {
                console.log(`🌐 Processando HTML: ${file.name}`);
                promises.push(processHtml(file, dataArray));
            } else if (file.name.match(/\.rtf$/i)) {
                console.log(`📝 Processando RTF: ${file.name}`);
                promises.push(processRtf(file, dataArray));
            } else {
                console.warn(`Arquivo ignorado (não é XML, TXT, CSV, planilha, PDF, HTML ou RTF): ${file.name}`);
            }
        }
        Promise.all(promises).then(() => {
            console.log(`Processamento concluído. Dados:`, dataArray);
            animateLabelToCheck(label, checkSvg);
            callback();
        }).catch((err) => {
            // Sem este catch, a falha de parse de um único arquivo abortava toda a
            // importação silenciosamente (animação e callback nunca disparavam).
            console.error('Falha ao processar arquivos:', err);
            animateLabelToCheck(label, checkSvg);
            callback();
        });
    }

    function animateLabelToCheck(label, checkSvg) {
        console.log('Iniciando animação do check. Estado inicial do SVG:', checkSvg.style.display);
        label.style.opacity = '0';
        label.style.transition = 'opacity 0.3s ease';
        setTimeout(() => {
            label.style.display = 'none';
            const path = checkSvg.querySelector('path');
            path.setAttribute('stroke-dasharray', '30'); // Garantir que o dasharray esteja definido
            path.setAttribute('stroke-dashoffset', '-30'); // Estado inicial para animação
            checkSvg.style.display = 'block';
            checkSvg.style.opacity = '1';
            checkSvg.style.visibility = 'visible';
            checkSvg.style.zIndex = '10';
            checkSvg.style.position = 'absolute';
            checkSvg.style.top = '50%';
            checkSvg.style.left = '50%';
            checkSvg.style.transform = 'translate(-50%, -50%)';
            console.log('SVG configurado para exibição:', {
                display: checkSvg.style.display,
                opacity: checkSvg.style.opacity,
                visibility: checkSvg.style.visibility,
                zIndex: checkSvg.style.zIndex,
                top: checkSvg.style.top,
                left: checkSvg.style.left,
                transform: checkSvg.style.transform,
                strokeDasharray: path.getAttribute('stroke-dasharray'),
                strokeDashoffset: path.getAttribute('stroke-dashoffset')
            });
            setTimeout(() => {
                path.style.transition = 'stroke-dashoffset 0.5s ease-in-out'; // Adicionar transição CSS
                path.setAttribute('stroke-dashoffset', '0'); // Iniciar animação
                console.log('Animação de check escrita iniciada via CSS transition');
            }, 50); // Pequeno atraso para garantir renderização
        }, 300);
    }

    function formatValue(value) {
        if (!value) return '0,00';
        const cleaned = value.replace(/[^\d,.]/g, '').replace(/\.(?=\d{3})/g, '');
        const parsed = parseFloat(cleaned.replace(',', '.'));
        return isNaN(parsed) ? '0,00' : parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function showComparisonModal() {
        console.log('Exibindo modal de comparação');
        const modal = document.createElement('div');
        modal.classList.add('modal-overlay');
        modal.innerHTML = `
            <div class="modal-content">
                <div class="tabs">
                    <div class="tab active" data-tab="quantidades">
                        Quantidade de NFe | NFCe
                    </div>
                    <div class="export-buttons">
                        <button class="export-btn pdf-btn" onclick="exportToPDF()" title="Exportar para PDF">
                            <img width="24" height="24" src="https://img.icons8.com/fluency/48/pdf--v1.png" alt="PDF"/>
                        </button>
                        <button class="export-btn xlsx-btn" onclick="exportToXLSX()" title="Exportar para XLSX">
                            <img width="24" height="24" src="https://img.icons8.com/color/48/microsoft-excel-2019--v1.png" alt="XLSX"/>
                        </button>
                    </div>
                    <div class="tab" data-tab="valores">
                        Valores de NFe | NFCe
                    </div>
                </div>
                <div id="quantidades-tab" class="tab-content">
                    <div class="column">
                        <h4 class="siget-title">
                            Notas presentes no SIGA e ausentes no Fortes
                            <span class="column-count" id="siget-count">(0)</span>
                        </h4>
                        <ul id="siget-only-list"></ul>
                    </div>
                    <div class="column">
                        <h4 class="fortes-title">
                            Notas presentes no Fortes e ausentes no SIGA
                            <span class="column-count" id="fortes-count">(0)</span>
                        </h4>
                        <ul id="fortes-only-list"></ul>
                    </div>
                </div>
                <div id="valores-tab" class="tab-content" style="display: none;">
                    <p>Aguardando comparação...</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const tabs = modal.querySelectorAll('.tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                showTab(tab.getAttribute('data-tab'), tab);
            });
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                console.log('Fechando modal ao clicar fora');
                document.body.removeChild(modal);
                sigetData = [];
                fortesData = [];
                sigetLoaded = false;
                fortesLoaded = false;
                const mainContent = document.querySelector('#main-content');
                mainContent.innerHTML = '';
                createNfeCfeComparisonPage(mainContent);
            }
        });
        compareLists();
    }

    function showTab(tabId, element) {
        console.log(`Exibindo aba: ${tabId}`);
        document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
        const targetTab = document.getElementById(tabId + '-tab');
        targetTab.style.display = 'block';
        document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
        element.classList.add('active');
        if (tabId === 'quantidades') {
            // O conteúdo já foi renderizado em compareLists() na abertura do modal;
            // trocar de aba só alterna o display. Recomputar/re-renderizar listas
            // enormes a cada clique era um custo desnecessário.
            targetTab.style.display = 'flex';
            targetTab.style.gap = '2rem';
        }
    }

    function compareLists() {
        console.log('Comparando listas...');
        // Índices key -> item (O(1) lookup). Mantém o PRIMEIRO item de cada chave,
        // preservando a semântica do .find() anterior, mas elimina o O(n²) que travava
        // a comparação com dezenas de milhares de notas.
        const sigetMap = new Map();
        for (const item of sigetData) if (!sigetMap.has(item.key)) sigetMap.set(item.key, item);
        const fortesMap = new Map();
        for (const item of fortesData) if (!fortesMap.has(item.key)) fortesMap.set(item.key, item);

        const sigetSet = sigetMap; // Map também responde .has() em O(1)
        const fortesSet = fortesMap;

        const sigetOnly = sigetData.filter(item => !fortesSet.has(item.key));
        const fortesOnly = fortesData.filter(item => !sigetSet.has(item.key));
    
        const quantidadesTab = document.getElementById('quantidades-tab');
        const sigetList = quantidadesTab.querySelector('#siget-only-list');
        const fortesList = quantidadesTab.querySelector('#fortes-only-list');
    
        // Garantir que a estrutura de colunas existe
        if (!quantidadesTab.querySelector('.column')) {
            console.warn('Estrutura de colunas ausente em #quantidades-tab. Recriando...');
            quantidadesTab.innerHTML = `
                <div class="column">
                    <h4 class="siget-title">
                        Notas presentes no SIGA e ausentes no Fortes
                        <span class="column-count" id="siget-count">(0)</span>
                    </h4>
                    <ul id="siget-only-list"></ul>
                </div>
                <div class="column">
                    <h4 class="fortes-title">
                        Notas presentes no Fortes e ausentes no SIGA
                        <span class="column-count" id="fortes-count">(0)</span>
                    </h4>
                    <ul id="fortes-only-list"></ul>
                </div>
            `;
        }
    
        sigetList.innerHTML = sigetOnly.length
            ? sigetOnly.map(item => `<li>Chave ${item.type}: ${item.key}${item.value ? ` - R$ ${item.value}` : ''}</li>`).join('')
            : '<li>Nenhuma chave exclusiva</li>';
        fortesList.innerHTML = fortesOnly.length
            ? fortesOnly.map(item => `<li>Chave ${item.type}: ${item.key}${item.value ? ` - R$ ${item.value}` : ''}</li>`).join('')
            : '<li>Nenhuma chave exclusiva</li>';
    
        // Atualizar contadores das colunas
        const sigetCount = document.getElementById('siget-count');
        const fortesCount = document.getElementById('fortes-count');
        if (sigetCount) {
            sigetCount.textContent = `(${sigetOnly.length})`;
        }
        if (fortesCount) {
            fortesCount.textContent = `(${fortesOnly.length})`;
        }

        // Chaves comuns: percorre o menor lado e consulta o maior em O(1) via Map.
        const commonKeys = [];
        for (const key of sigetMap.keys()) if (fortesMap.has(key)) commonKeys.push(key);
        const fortesHasNoValues = fortesData.every(item => !item.value || item.value === '0,00');
        const valoresTab = document.getElementById('valores-tab');

        if (commonKeys.length === 0 || fortesHasNoValues) {
            valoresTab.innerHTML = `<p class="error-message">Informações de Valores Ausentes</p>`;
            console.log('Nenhuma chave comum ou valores ausentes em Fortes. Exibindo mensagem de erro.');
        } else {
            const divergentValues = commonKeys.map(key => {
                const sigetItem = sigetMap.get(key);
                const fortesItem = fortesMap.get(key);
                if (!sigetItem.value || !fortesItem.value) {
                    return { key, fortesValue: fortesItem.value || 'Ausente', sigetValue: sigetItem.value || 'Ausente', difference: 'Informações para comparação incompletas' };
                }
                const sigetValue = parseFloat(sigetItem.value.replace(/\./g, '').replace(',', '.'));
                const fortesValue = parseFloat(fortesItem.value.replace(/\./g, '').replace(',', '.'));
                const difference = sigetValue - fortesValue;
                return Math.abs(difference) > 0.01 ? { key, fortesValue, sigetValue, difference } : null;
            }).filter(item => item);
    
            if (divergentValues.length === 0) {
                valoresTab.innerHTML = `<p class="success-message">Todos os Valores nos Conformes</p>`;
                console.log('Todos os valores correspondem. Exibindo mensagem de conformidade.');
            } else {
                valoresTab.innerHTML = `
                    <table>
                        <thead>
                            <tr>
                                <th>Chave</th>
                                <th>Valor do Fortes</th>
                                <th>Valor do SIGA</th>
                                <th>Diferença</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${divergentValues.map(item => `
                                <tr>
                                    <td>${item.key}</td>
                                    <td>${typeof item.fortesValue === 'number' ? 'R$ ' + item.fortesValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : item.fortesValue}</td>
                                    <td>${typeof item.sigetValue === 'number' ? 'R$ ' + item.sigetValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : item.sigetValue}</td>
                                    <td class="${typeof item.difference === 'number' ? (item.difference < 0 ? 'positivo' : 'dif') : 'dif'}">${typeof item.difference === 'number' ? 'R$ ' + item.difference.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : 'Valores Ausentes para Comparação'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
                console.log('Divergências encontradas. Tabela de valores renderizada.');
            }
        }
        console.log('Comparação concluída. Resultados renderizados.');
    }

}

//---------------------------------- FIM NFe | NFCe Comparasion ----------------------------------//

//---------------------------------- INÍCIO Baixar NFCe ----------------------------------//
// Baixa em massa os XMLs de cupons NFC-e direto da API do Ambiente Seguro da
// SEFAZ-CE. CORS está aberto -> fetch direto no browser, sem proxy/Python.
// Fluxo por chave: GET /coupons/extract/{chave} -> idNfe ; GET /fiscal-coupons/xml/{idNfe}.
function createBaixarNfcePage(mainContent) {
    console.log('createBaixarNfcePage chamado');

    const CONCURRENCY = 10; // requisições simultâneas de chave no worker (configurável)

    mainContent.innerHTML = `
        <h1>Baixar NFCe</h1>
        <style>
            .bn-shell { max-width: 920px; margin: 0 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.4rem; }
            .bn-dropzone { position: relative; min-height: 240px; border: 2px dashed var(--color-info-dark); border-radius: var(--card-border-radius); background: var(--color-white); box-shadow: var(--box-shadow); padding: 1.2rem; cursor: pointer; transition: border-color .2s ease, background .2s ease; display: flex; }
            .bn-dropzone:hover, .bn-dropzone.bn-dragover { border-color: var(--color-primary); background: rgba(115,128,243,0.05); }
            .bn-dropzone.has-reports { cursor: default; }
            .bn-dz-empty { margin: auto; text-align: center; color: var(--color-info-dark); display: flex; flex-direction: column; align-items: center; gap: 0.6rem; pointer-events: none; }
            .bn-dz-empty .material-icons-sharp { font-size: 3rem; opacity: 0.7; }
            .bn-report-grid { display: grid; gap: 0.9rem; width: 100%; grid-auto-rows: 1fr; }
            .bn-report-card { background: rgba(115,128,243,0.07); border: 1px solid rgba(115,128,243,0.35); border-radius: 0.8rem; padding: 1rem; display: flex; flex-direction: column; justify-content: center; gap: 0.45rem; min-height: 92px; animation: bnPop .28s cubic-bezier(0.16,1,0.3,1); transition: transform .35s cubic-bezier(0.16,1,0.3,1), opacity .35s ease; }
            .bn-report-card .bn-rc-name { font-weight: 600; color: var(--color-dark); font-size: 0.9rem; word-break: break-word; }
            .bn-report-card .bn-rc-count { font-size: 0.82rem; color: var(--color-primary); font-weight: 600; }
            .bn-report-card .bn-rc-emp { font-size: 0.74rem; color: var(--color-info-dark); }
            .bn-rc-token { width: 100%; margin-top: 0.4rem; padding: 0.45rem 0.5rem; border: 1px solid var(--color-info-dark); border-radius: 0.4rem; background: transparent; color: var(--color-dark); font-family: monospace; font-size: 0.7rem; resize: vertical; word-break: break-all; }
            .bn-rc-token.bn-bad { border-color: var(--color-danger); }
            .bn-rc-token.bn-good { border-color: var(--color-success); }
            .bn-rc-tokstatus { font-size: 0.68rem; margin-top: 0.2rem; min-height: 0.8rem; }
            .bn-mode-toggle { display: flex; align-items: center; gap: 0.5rem; font-size: 0.86rem; color: var(--color-dark); cursor: pointer; user-select: none; }
            .bn-report-card.bn-merge { transform: scale(0.6); opacity: 0; }
            @keyframes bnPop { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            .bn-token-row { display: flex; align-items: center; gap: 0.5rem; }
            .bn-token-row label { font-weight: 600; color: var(--color-dark); }
            .bn-info { width: 1.15rem; height: 1.15rem; border-radius: 50%; border: 1px solid var(--color-info-dark); color: var(--color-info-dark); font-size: 0.78rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; cursor: help; position: relative; }
            .bn-info::after { content: attr(data-tip); position: absolute; bottom: 140%; left: 50%; transform: translateX(-50%); background: #1f2330; color: #e7e9ee; font-size: 0.72rem; font-weight: 400; line-height: 1.3; padding: 0.45rem 0.6rem; border-radius: 0.45rem; border: 1px solid rgba(255,255,255,0.12); width: 220px; text-align: center; opacity: 0; pointer-events: none; transition: opacity .15s ease; z-index: 20; }
            .bn-info:hover::after { opacity: 1; }
            #bn-token { width: 100%; padding: 0.7rem 0.9rem; border: 1px solid var(--color-info-dark); border-radius: 0.5rem; background: transparent; color: var(--color-dark); font-family: monospace; font-size: 0.8rem; resize: vertical; word-break: break-all; }
            #bn-jwt-status { font-size: 0.85rem; min-height: 1.1rem; }
            .bn-start-btn { padding: 0.8rem 1.6rem; border: none; border-radius: 0.6rem; background: var(--color-success); color: #fff; cursor: pointer; font-weight: 700; font-size: 0.95rem; align-self: flex-start; transition: opacity .2s ease, transform .1s ease; }
            .bn-start-btn:disabled { opacity: 0.5; cursor: default; }
            .bn-start-btn:not(:disabled):active { transform: translateY(1px); }
            #bn-stage-download { animation: bnFadeIn .45s ease; }
            @keyframes bnFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
            .bn-unified { position: relative; background: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: 1.4rem 1.4rem 0.9rem; display: flex; flex-direction: column; gap: 1rem; min-height: 300px; }
            .bn-rings { display: grid; gap: 1.2rem 1.4rem; justify-items: center; align-items: start; flex: 1; padding-top: 0.4rem; }
            .bn-ring-item { display: flex; flex-direction: column; align-items: center; gap: 0.55rem; width: 100%; }
            .bn-ring { position: relative; width: 100%; max-width: 200px; aspect-ratio: 1 / 1; container-type: inline-size; }
            .bn-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
            .bn-ring circle { fill: none; stroke-width: 9; stroke-linecap: round; }
            .bn-ring .bn-track { stroke: rgba(125,141,161,0.20); }
            .bn-ring .bn-arc-blue { stroke: var(--color-primary); transition: stroke-dashoffset .1s linear; }
            .bn-ring .bn-arc-yellow { stroke: #f5b301; transition: stroke-dashoffset .1s linear; }
            .bn-ring-item.done .bn-arc-yellow { stroke: #2bb673; }
            .bn-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
            .bn-ring-pct { font-weight: 700; color: var(--color-dark); font-size: clamp(0.95rem, 18cqw, 1.7rem); }
            .bn-ring-label { font-size: 0.78rem; color: var(--color-dark); text-align: center; line-height: 1.25; max-width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
            .bn-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-top: 1px solid rgba(125,141,161,0.18); padding-top: 0.7rem; }
            .bn-footer-text { font-size: 0.85rem; color: var(--color-dark); font-weight: 600; }
            .bn-footer-text .bn-err { color: var(--color-danger); }
            .bn-mini-ring { position: relative; width: 34px; height: 34px; flex: 0 0 auto; }
            .bn-mini-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
            .bn-mini-ring circle { fill: none; stroke-width: 5; stroke-linecap: round; }
            .bn-add { position: absolute; left: -14px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%; border: none; background: var(--color-primary); color: #fff; font-size: 1.4rem; line-height: 1; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.18); z-index: 5; display: flex; align-items: center; justify-content: center; transition: transform .12s ease; }
            .bn-add:hover { transform: translateY(-50%) scale(1.1); }
            .bn-tooltip { position: absolute; bottom: 3.4rem; right: 0.9rem; background: #1f2330; color: #d7dae3; border: 1px solid rgba(255,255,255,0.12); border-radius: 0.5rem; padding: 0.55rem 0.7rem; font-size: 0.68rem; line-height: 1.45; max-width: 260px; opacity: 0; pointer-events: none; transition: opacity .15s ease; z-index: 15; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
            .bn-unified:hover .bn-tooltip { opacity: 1; }
            .bn-tooltip-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .bn-aux { display: flex; flex-direction: column; gap: 0.5rem; }
            .bn-aux textarea { width: 100%; padding: 0.6rem; border-radius: 0.5rem; background: transparent; color: var(--color-dark); font-family: monospace; font-size: 0.76rem; resize: vertical; }
        </style>
        <div class="bn-shell">
            <div id="bn-stage-select" style="display: flex; flex-direction: column; gap: 1.2rem;">
                <div id="bn-dropzone" class="bn-dropzone">
                    <div id="bn-dz-empty" class="bn-dz-empty">
                        <span class="material-icons-sharp">cloud_upload</span>
                        <div style="font-weight: 600; color: var(--color-dark);">Clique ou arraste os relatórios</div>
                        <div style="font-size: 0.82rem;">Um ou mais arquivos .xls / .xlsx (SIGA/SIGET) — uma empresa por relatório</div>
                    </div>
                    <div id="bn-report-grid" class="bn-report-grid" style="display: none;"></div>
                </div>
                <input type="file" id="bn-file" accept=".xls,.xlsx,.csv,.txt" multiple style="display: none;">

                <div id="bn-token-area" style="display: flex; flex-direction: column; gap: 0.6rem;">
                    <label class="bn-mode-toggle">
                        <input type="checkbox" id="bn-global-mode">
                        <span>Usar um único token para todas as empresas</span>
                        <span class="bn-info" data-tip="Por padrão, cada empresa usa seu próprio token (cole no relatório). Marque para usar um JWT só — útil se um token baixar de vários CNPJs.">!</span>
                    </label>
                    <div id="bn-global-token-wrap" style="display: none; flex-direction: column; gap: 0.4rem;">
                        <div class="bn-token-row">
                            <label for="bn-token">Token JWT (global)</label>
                        </div>
                        <textarea id="bn-token" rows="2" placeholder="Cole o token JWT (vale 24h), ou a URL completa do /xml/ contendo apiKey=…"></textarea>
                        <div id="bn-jwt-status"></div>
                    </div>
                    <div id="bn-percompany-hint" style="font-size: 0.82rem; color: var(--color-info-dark);">Cole o token JWT de cada empresa no respectivo relatório acima.</div>
                </div>

                <div id="bn-worker-status" style="font-size: 0.85rem; min-height: 1.1rem;"></div>

                <button id="bn-start" type="button" class="bn-start-btn" disabled>Iniciar Download NFCe</button>
            </div>

            <div id="bn-stage-download" style="display: none;">
                <div id="bn-unified" class="bn-unified">
                    <button id="bn-add" type="button" class="bn-add" title="Adicionar mais relatórios ao processo">+</button>
                    <div id="bn-tooltip" class="bn-tooltip"></div>
                    <div id="bn-rings" class="bn-rings"></div>
                    <div class="bn-footer">
                        <span id="bn-footer-text" class="bn-footer-text">0 erros | 0%</span>
                        <div id="bn-mini-ring" class="bn-mini-ring"></div>
                    </div>
                </div>
                <div id="bn-aux" class="bn-aux" style="margin-top: 1rem; display: none;"></div>
            </div>
        </div>
    `;

    // ---------- refs de DOM (estágio seleção + estágio download) ----------
    const tokenInput = document.getElementById('bn-token');
    const globalModeChk = document.getElementById('bn-global-mode');
    const globalTokenWrap = document.getElementById('bn-global-token-wrap');
    const perCompanyHint = document.getElementById('bn-percompany-hint');
    const fileInput = document.getElementById('bn-file');
    const dropzone = document.getElementById('bn-dropzone');
    const dzEmpty = document.getElementById('bn-dz-empty');
    const reportGrid = document.getElementById('bn-report-grid');
    const jwtStatus = document.getElementById('bn-jwt-status');
    const startBtn = document.getElementById('bn-start');
    const stageSelect = document.getElementById('bn-stage-select');
    const stageDownload = document.getElementById('bn-stage-download');
    const unifiedBox = document.getElementById('bn-unified');
    const ringsWrap = document.getElementById('bn-rings');
    const footerText = document.getElementById('bn-footer-text');
    const miniRingWrap = document.getElementById('bn-mini-ring');
    const addBtn = document.getElementById('bn-add');
    const tooltipEl = document.getElementById('bn-tooltip');
    const auxWrap = document.getElementById('bn-aux');

    // ---------- estado ----------
    // Relatórios lidos no estágio de seleção (1 card por arquivo).
    // { id, fileName, keys:[chave], meta:Map<chave,{nNF,dhEmi,vNF}> }
    let reports = [];
    let reportSeq = 0;
    // Empresas no estágio de download, agrupadas pelo CNPJ embutido na chave (pos 7-20).
    // cnpj14 -> { cnpj, nome, nomeResolved, keys:Set, total, downloaded, errors,
    //             phase:'download'|'zip'|'done', zipProgress, zip, failures:[], meta:Map,
    //             confChecked, confOk, confDiverg, confResults:[], ringEl, els:{...} }
    const companies = new Map();
    // Mapa CNPJ(14díg) -> Razão Social, dos contribuintes cadastrados (preenchido async).
    const contributorsByCnpj = new Map();

    // ---------- helpers ----------
    const cleanDigits = (s) => String(s || '').replace(/\D/g, '');
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    // Aceita: token JWT puro, ou uma URL de download (com apiKey={jwt}), ou texto
    // que contenha um JWT. Retorna só o token.
    function extractToken(input) {
        const s = String(input || '').trim();
        if (!s) return '';
        const m = s.match(/[?&]apiKey=([^&\s]+)/i);
        if (m) return decodeURIComponent(m[1]);
        const jwt = s.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
        if (jwt) return jwt[0];
        return s;
    }

    function parseKeys(text) {
        const out = [];
        const seen = new Set();
        if (!text) return out;
        // Mesma âncora usada em extractKeysFromFreeText: corrida de dígitos+separadores
        // (-, ., /) que vira 44 dígitos após limpeza, ou chave crua de 44 dígitos.
        const re = /\d[\d.\-\/]{38,}\d/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const k = m[0].replace(/\D/g, '');
            if (k.length !== 44) continue;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(k);
        }
        return out;
    }

    // ---------- relatório SIGA/SIGET (parser isolado — NÃO mexe na aba de comparação) ----------
    // Parser de uma linha CSV respeitando aspas. Réplica local de parseCsvLine.
    function parseCsvLineBN(line) {
        const out = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
                else cur += ch;
            } else {
                if (ch === '"') inQuotes = true;
                else if (ch === ',') { out.push(cur); cur = ''; }
                else cur += ch;
            }
        }
        out.push(cur);
        return out.map((s) => s.trim());
    }

    // Normaliza data para YYYY-MM-DD. Aceita ISO (2026-01-24T...), DD/MM/AAAA e DD-MM-AAAA.
    function normalizeDate(s) {
        const t = String(s || '').trim();
        let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return m[1] + '-' + m[2] + '-' + m[3];
        m = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) return m[3] + '-' + m[2] + '-' + m[1];
        m = t.match(/(\d{2})-(\d{2})-(\d{4})/);
        if (m) return m[3] + '-' + m[2] + '-' + m[1];
        return t.slice(0, 10);
    }

    // Valor BR ("1.234,56" / "46,30") → Number. Remove milhares e troca vírgula por ponto.
    function parseBrlValue(s) {
        let t = String(s || '').replace(/[^\d.,-]/g, '');
        if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
        return parseFloat(t);
    }

    // Núcleo: recebe linhas já divididas em células (array de arrays). Varre as primeiras
    // ~25 linhas atrás do header que contenha colunas "chave" E "valor" (SIGET tem preâmbulo
    // antes do header). Retorna Map<chave,{nNF,dhEmi,vNF}> ou null se não for relatório.
    const cellStr = (c) => String(c == null ? '' : c).trim();
    function parseReportRows(rows) {
        if (!rows || rows.length < 2) return null;
        let headerIdx = -1, header = null, idxChave = -1, idxValor = -1;
        const scanLimit = Math.min(rows.length, 25);
        for (let h = 0; h < scanLimit; h++) {
            const cells = (rows[h] || []).map((c) => cellStr(c).toLowerCase());
            const ic = cells.findIndex((c) => c.includes('chave'));
            const iv = cells.findIndex((c) => c.includes('valor'));
            if (ic !== -1 && iv !== -1) { headerIdx = h; header = cells; idxChave = ic; idxValor = iv; break; }
        }
        if (headerIdx === -1) return null;
        const idxNum = header.findIndex((h) => h.includes('número') || h.includes('numero'));
        const idxData = header.findIndex((h) => h.includes('data') || h.includes('emiss'));
        const map = new Map();
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const cols = rows[i] || [];
            const key = cleanDigits(cellStr(cols[idxChave]));
            if (!/^\d{44}$/.test(key)) continue;
            const vNF = cellStr(cols[idxValor]);
            const nNF = idxNum !== -1 ? cellStr(cols[idxNum]) : '';
            const dhEmi = idxData !== -1 ? normalizeDate(cellStr(cols[idxData])) : '';
            map.set(key, { nNF, dhEmi, vNF });
        }
        return map.size ? map : null;
    }

    // CSV/texto (SIGA) → linhas de células. Retorna Map ou null.
    function parseReportText(text) {
        const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
        return parseReportRows(lines.map((l) => parseCsvLineBN(l)));
    }

    // Planilha binária .xls/.xlsx (SIGET) → linhas via SheetJS. raw:false usa o texto
    // formatado (.w), preservando a chave de 44 díg como texto (evita notação científica).
    // Retorna { map, text } — text é o dump das células p/ fallback de extração de chaves.
    function parseReportWorkbook(arrayBuffer) {
        if (typeof XLSX === 'undefined') return { map: null, text: '' };
        let wb;
        try { wb = XLSX.read(arrayBuffer, { type: 'array' }); } catch (e) { return { map: null, text: '' }; }
        let bestMap = null;
        let dump = '';
        for (const name of wb.SheetNames) {
            const sheet = wb.Sheets[name];
            if (!sheet) continue;
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
            dump += rows.map((r) => (r || []).join('\t')).join('\n') + '\n';
            if (!bestMap) { const m = parseReportRows(rows); if (m) bestMap = m; }
        }
        return { map: bestMap, text: dump };
    }

    function base64UrlDecode(str) {
        let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        const bin = atob(s);
        try {
            return decodeURIComponent(bin.split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        } catch (e) {
            return bin;
        }
    }

    function validateJwt(token) {
        const parts = String(token || '').trim().split('.');
        if (parts.length < 2) return { ok: false, message: 'Token não parece um JWT (faltam segmentos).' };
        let payload;
        try {
            payload = JSON.parse(base64UrlDecode(parts[1]));
        } catch (e) {
            return { ok: false, message: 'Falha ao decodificar o payload do JWT.' };
        }
        const cnpj = payload.sub ? String(payload.sub) : '';
        if (!/^\d{14}$/.test(cnpj)) return { ok: false, message: 'Token sem CNPJ válido no campo sub.' };
        const now = Math.floor(Date.now() / 1000);
        let warning = '';
        let suffix = '';
        if (payload.exp) {
            if (payload.exp <= now) return { ok: false, message: 'Token EXPIRADO. Gere um novo no Ambiente Seguro.' };
            const minsLeft = Math.floor((payload.exp - now) / 60);
            if (minsLeft < 30) warning = 'expira em ~' + minsLeft + ' min';
            suffix = ' (expira ' + new Date(payload.exp * 1000).toLocaleString('pt-BR') + ')';
        }
        return { ok: true, cnpj, warning, message: 'Token válido • CNPJ ' + cnpj + (warning ? ' — ' + warning : '') + suffix };
    }

    function refreshJwtStatus() {
        const token = extractToken(tokenInput.value);
        if (!token) { jwtStatus.textContent = ''; updateStartButton(); return; }
        const v = validateJwt(token);
        jwtStatus.textContent = v.message;
        jwtStatus.style.color = v.ok ? (v.warning ? '#c47f00' : 'var(--color-success)') : 'var(--color-danger)';
        updateStartButton();
    }

    // Habilita "Iniciar" só com token válido + ao menos uma chave lida de relatório.
    function updateStartButton() {
        const totalKeys = reports.reduce((acc, r) => acc + r.keys.length, 0);
        if (!totalKeys) { startBtn.disabled = true; return; }
        let ok;
        if (globalModeChk.checked) {
            const token = extractToken(tokenInput.value);
            ok = !!(token && validateJwt(token).ok);
        } else {
            // Todo relatório com chaves precisa de um token válido (próprio, ou o
            // global como fallback se o usuário tiver preenchido o campo global).
            ok = reports.every((r) => {
                if (!r.keys.length) return true;
                const token = extractToken(r.token || '') || extractToken(tokenInput.value);
                return !!(token && validateJwt(token).ok);
            });
        }
        startBtn.disabled = !ok;
    }

    // Alterna entre token global e token por empresa.
    function onModeToggle() {
        const global = globalModeChk.checked;
        globalTokenWrap.style.display = global ? 'flex' : 'none';
        perCompanyHint.style.display = global ? 'none' : 'block';
        renderReportCards();
        updateStartButton();
    }

    // (Os fetches à SEFAZ-CE e a conferência de XML foram movidos para o worker
    //  Node — ver worker/lib/nfce.js. O browser não bate mais na SEFAZ em massa.)

    // ====================== orquestração multi-empresa ======================
    const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const RING_R = 52, RING_C = 2 * Math.PI * RING_R;
    const MINI_R = 14.5, MINI_C = 2 * Math.PI * MINI_R;
    let miniBlue = null, miniYellow = null;

    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const cnpjFromKey = (chave) => String(chave).substring(6, 20);          // pos 7-20 (1-based) = emissor
    function monthYearFromKey(chave) {
        const aa = String(chave).substring(2, 4);                            // pos 3-4 = AA
        const mm = parseInt(String(chave).substring(4, 6), 10);              // pos 5-6 = MM
        const mes = (mm >= 1 && mm <= 12) ? MESES_PT[mm - 1] : '???';
        return mes + '-20' + aa;
    }
    const sanitizeFileName = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'EMPRESA';
    const setArc = (circleEl, frac, circ) => { if (circleEl) circleEl.style.strokeDashoffset = String(circ * (1 - clamp01(frac))); };

    // ---------- leitura de relatórios (SIGA texto/CSV ou SIGET .xls/.xlsx) ----------
    // Retorna lista de { id, fileName, keys:[chave], meta:Map<chave,{nNF,dhEmi,vNF}> }.
    async function readFiles(files) {
        const out = [];
        for (const f of files) {
            try {
                const name = (f.name || '').toLowerCase();
                const isBinary = name.endsWith('.xls') || name.endsWith('.xlsx');
                let reportMap = null, fallbackText = '';
                if (isBinary) {
                    const parsed = parseReportWorkbook(await f.arrayBuffer());
                    reportMap = parsed.map; fallbackText = parsed.text;
                } else {
                    fallbackText = await f.text();
                    reportMap = parseReportText(fallbackText);
                }
                const meta = new Map();
                let keys = [];
                if (reportMap) { reportMap.forEach((m, k) => { meta.set(k, m); keys.push(k); }); }
                else { keys = parseKeys(fallbackText); }
                if (!keys.length) { console.warn('Nenhuma chave de 44 díg em ' + f.name); continue; }
                out.push({ id: ++reportSeq, fileName: f.name, keys, meta, token: '' });
            } catch (e) {
                console.warn('Falha ao ler ' + f.name + ': ' + (e && e.message));
            }
        }
        return out;
    }

    // ---------- estágio de seleção: cards de relatório ----------
    function renderReportCards() {
        if (!reports.length) {
            reportGrid.style.display = 'none';
            dzEmpty.style.display = 'flex';
            dropzone.classList.remove('has-reports');
            return;
        }
        dzEmpty.style.display = 'none';
        reportGrid.style.display = 'grid';
        dropzone.classList.add('has-reports');
        const n = reports.length;
        const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
        reportGrid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
        const perCompany = !globalModeChk.checked;
        reportGrid.innerHTML = reports.map((r) => {
            const cnpj = r.keys.length ? cnpjFromKey(r.keys[0]) : '';
            const emp = (cnpj && contributorsByCnpj.get(cnpj)) || (cnpj ? 'CNPJ ' + cnpj : '');
            const nKeys = r.keys.length;
            const tokBox = perCompany
                ? '<textarea class="bn-rc-token" data-rid="' + r.id + '" rows="2" placeholder="Token JWT desta empresa…">' + escapeHtml(r.token || '') + '</textarea>' +
                  '<div class="bn-rc-tokstatus" data-rid="' + r.id + '"></div>'
                : '';
            return '<div class="bn-report-card">' +
                '<div class="bn-rc-name">' + escapeHtml(r.fileName) + '</div>' +
                '<div class="bn-rc-count">' + nKeys + ' ' + (nKeys === 1 ? 'chave' : 'chaves') + '</div>' +
                (emp ? '<div class="bn-rc-emp">' + escapeHtml(emp) + '</div>' : '') +
                tokBox +
                '</div>';
        }).join('');
        if (perCompany) wireCardTokens();
    }

    // Liga os campos de token por empresa (modo padrão): valida JWT ao digitar e
    // guarda o valor em r.token (sobrevive ao re-render dos cards).
    function wireCardTokens() {
        reportGrid.querySelectorAll('.bn-rc-token').forEach((ta) => {
            ta.addEventListener('input', () => {
                const rid = parseInt(ta.getAttribute('data-rid'), 10);
                const r = reports.find((x) => x.id === rid);
                if (r) r.token = ta.value;
                const st = ta.parentElement.querySelector('.bn-rc-tokstatus');
                const tok = extractToken(ta.value);
                if (!tok) {
                    ta.classList.remove('bn-good', 'bn-bad');
                    if (st) st.textContent = '';
                } else {
                    const v = validateJwt(tok);
                    ta.classList.toggle('bn-good', v.ok);
                    ta.classList.toggle('bn-bad', !v.ok);
                    if (st) { st.textContent = v.message; st.style.color = v.ok ? 'var(--color-success)' : 'var(--color-danger)'; }
                }
                updateStartButton();
            });
        });
    }

    async function handleSelectStageFiles(files) {
        const novos = await readFiles(files);
        if (!novos.length) return;
        reports.push(...novos);
        renderReportCards();
        updateStartButton();
    }

    // ---------- empresas + anéis ----------
    function ringSvg() {
        return '<svg viewBox="0 0 120 120">' +
            '<circle class="bn-track" cx="60" cy="60" r="' + RING_R + '"></circle>' +
            '<circle class="bn-arc-blue" cx="60" cy="60" r="' + RING_R + '" stroke-dasharray="' + RING_C + '" stroke-dashoffset="' + RING_C + '"></circle>' +
            '<circle class="bn-arc-yellow" cx="60" cy="60" r="' + RING_R + '" stroke-dasharray="' + RING_C + '" stroke-dashoffset="' + RING_C + '"></circle>' +
            '</svg>';
    }

    function layoutRings() {
        const n = companies.size;
        const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4;
        ringsWrap.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    }

    const cnpjLabel = (cnpj) => 'CNPJ ' + (typeof formatCNPJ === 'function' ? formatCNPJ(cnpj) : cnpj);

    function createCompany(compKey, cnpj, sampleKey, total) {
        const nomeCad = contributorsByCnpj.get(cnpj) || '';
        const comp = {
            compKey, cnpj, nome: nomeCad, nomeResolved: !!nomeCad,
            monthLabel: monthYearFromKey(sampleKey),
            total: total || 0, downloaded: 0, errors: 0,
            phase: 'download', zipProgress: 0,
            zipReady: false, zipDownloaded: false,
            els: null,
        };
        companies.set(compKey, comp);
        const item = document.createElement('div');
        item.className = 'bn-ring-item';
        item.innerHTML =
            '<div class="bn-ring">' + ringSvg() + '<div class="bn-ring-center"><div class="bn-ring-pct">0%</div></div></div>' +
            '<div class="bn-ring-label"></div>';
        ringsWrap.appendChild(item);
        comp.els = {
            root: item,
            blue: item.querySelector('.bn-arc-blue'),
            yellow: item.querySelector('.bn-arc-yellow'),
            pct: item.querySelector('.bn-ring-pct'),
            name: item.querySelector('.bn-ring-label'),
        };
        comp.els.name.textContent = comp.nome || cnpjLabel(cnpj);
        layoutRings();
        return comp;
    }

    function updateRing(comp) {
        const els = comp.els; if (!els) return;
        const dlFrac = comp.total ? (comp.downloaded + comp.errors) / comp.total : 0;
        if (comp.phase === 'download') {
            setArc(els.blue, dlFrac, RING_C);
            setArc(els.yellow, 0, RING_C);
            els.pct.textContent = Math.round(dlFrac * 100) + '%';
            els.root.classList.remove('done');
        } else {
            setArc(els.blue, 1, RING_C);
            setArc(els.yellow, comp.zipProgress, RING_C);
            els.pct.textContent = Math.round(comp.zipProgress * 100) + '%';
            if (comp.phase === 'done') { els.root.classList.add('done'); els.pct.textContent = '100%'; }
        }
        if (comp.nome) els.name.textContent = comp.nome;
    }

    // ---------- rodapé + mini anel + tooltip ----------
    function buildMiniRing() {
        miniRingWrap.innerHTML = '<svg viewBox="0 0 40 40">' +
            '<circle cx="20" cy="20" r="' + MINI_R + '" style="stroke:rgba(125,141,161,0.20)"></circle>' +
            '<circle class="mb" cx="20" cy="20" r="' + MINI_R + '" style="stroke:var(--color-primary)" stroke-dasharray="' + MINI_C + '" stroke-dashoffset="' + MINI_C + '"></circle>' +
            '<circle class="my" cx="20" cy="20" r="' + MINI_R + '" style="stroke:#f5b301" stroke-dasharray="' + MINI_C + '" stroke-dashoffset="' + MINI_C + '"></circle>' +
            '</svg>';
        miniBlue = miniRingWrap.querySelector('.mb');
        miniYellow = miniRingWrap.querySelector('.my');
    }

    function updateFooter() {
        let totErr = 0, totKeys = 0, totDl = 0, zipSum = 0, allDownloaded = true;
        const n = companies.size;
        companies.forEach((c) => {
            totErr += c.errors;
            totKeys += c.total;
            totDl += (c.downloaded + c.errors);
            zipSum += c.zipProgress;
            if (c.phase === 'download') allDownloaded = false;
        });
        const dlFrac = totKeys ? totDl / totKeys : 0;
        const pct = Math.round(dlFrac * 100);
        footerText.innerHTML = '<span class="bn-err">' + totErr + ' ' + (totErr === 1 ? 'erro' : 'erros') + '</span> | ' + pct + '%';
        setArc(miniBlue, dlFrac, MINI_C);
        setArc(miniYellow, (allDownloaded && n) ? zipSum / n : 0, MINI_C);
    }

    function updateTooltip() {
        const rows = [];
        companies.forEach((c) => {
            const nm = c.nome || cnpjLabel(c.cnpj);
            rows.push('<div class="bn-tooltip-row">' + escapeHtml(nm) + ': ' + c.downloaded + ' | ' + c.total + '</div>');
        });
        tooltipEl.innerHTML = rows.join('') || '—';
    }

    // ---------- download dos ZIPs ----------
    // Espaça os downloads e adia o revokeObjectURL: o revoke imediato matava o blob grande
    // antes do navegador terminar de lê-lo (causa do "erro ao baixar o 2º ZIP").
    const downloadQueue = [];
    let downloadDraining = false;
    function enqueueDownload(blob, name) {
        downloadQueue.push({ blob, name });
        drainDownloads();
    }
    async function drainDownloads() {
        if (downloadDraining) return;
        downloadDraining = true;
        while (downloadQueue.length) {
            const { blob, name } = downloadQueue.shift();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name; a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            await delay(1200);                                  // espaça p/ não disparar throttle de múltiplos downloads
            if (a.parentNode) document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 60000);  // revoga tarde: deixa o browser ler o blob
        }
        downloadDraining = false;
    }

    // ---------- motor: dispara o worker local e acompanha por polling ----------
    // O processamento pesado (fetch SEFAZ + ZIP) roda no worker Node (sem CORS).
    // O browser só configura, dispara e mostra progresso.
    const WORKER_BASE = 'http://127.0.0.1:47620';
    const jobIds = [];
    let polling = false;

    // Agrupa as chaves dos relatórios por CNPJ, anexando o token correto
    // (global, ou o do próprio relatório com fallback no global). taxid = CNPJ
    // do token (sub do JWT). Retorna a lista p/ POST /nfce/start.
    function buildCompanies(reportsList) {
        const globalMode = globalModeChk.checked;
        const globalTok = extractToken(tokenInput.value);
        const byCnpj = new Map();
        for (const r of reportsList) {
            const tok = globalMode ? globalTok : (extractToken(r.token || '') || globalTok);
            if (!tok) continue;
            const taxid = validateJwt(tok).cnpj || '';
            for (const chave of r.keys) {
                const cnpj = cnpjFromKey(chave);
                let c = byCnpj.get(cnpj);
                if (!c) { c = { cnpj, token: tok, taxid, keys: [], meta: {} }; byCnpj.set(cnpj, c); }
                c.keys.push(chave);
                const m = r.meta && r.meta.get(chave);
                if (m) c.meta[chave] = m;
            }
        }
        return Array.from(byCnpj.values()).filter((c) => c.keys.length);
    }

    async function detectWorker() {
        try {
            const res = await fetch(WORKER_BASE + '/health', { method: 'GET' });
            if (!res.ok) return false;
            const j = await res.json();
            return !!(j && j.ok);
        } catch { return false; }
    }


    // Dispara um job no worker para os grupos (empresas) já montados e cria 1 anel por empresa.
    async function launchJob(companiesPayload) {
        if (!companiesPayload || !companiesPayload.length) return false;
        let resp;
        try {
            const res = await fetch(WORKER_BASE + '/nfce/start', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ concurrency: CONCURRENCY, companies: companiesPayload }),
            });
            resp = await res.json();
        } catch (e) { return false; }
        if (!resp || !resp.ok || !resp.jobId) {
            footerText.innerHTML = '<span class="bn-err">' + escapeHtml((resp && resp.error) || 'falha ao iniciar o worker') + '</span>';
            return false;
        }
        const jobId = resp.jobId;
        jobIds.push(jobId);
        for (const c of companiesPayload) {
            const compKey = jobId + '|' + c.cnpj;
            if (!companies.has(compKey)) createCompany(compKey, c.cnpj, c.keys[0], c.keys.length);
        }
        updateFooter();
        updateTooltip();
        startPolling();
        return true;
    }

    // Aplica o status de um job (vindo do worker) aos anéis. Quando uma empresa
    // fica com o ZIP pronto, dispara o download do ZIP uma única vez.
    function applyStatus(jobId, st) {
        for (const cs of st.companies) {
            const comp = companies.get(jobId + '|' + cs.cnpj);
            if (!comp) continue;
            comp.total = cs.total;
            comp.downloaded = cs.downloaded;
            comp.errors = cs.errors;
            if (cs.nome && cs.nome.indexOf('CNPJ ') !== 0) comp.nome = cs.nome;
            if (cs.phase === 'done') { comp.phase = 'done'; comp.zipProgress = 1; }
            else if (cs.phase === 'zip') { comp.phase = 'zip'; comp.zipProgress = 0.5; }
            else comp.phase = 'download';
            updateRing(comp);
            if (cs.zipReady && !comp.zipDownloaded) {
                comp.zipDownloaded = true;
                downloadCompanyZip(jobId, cs.cnpj, cs.zipName);
            }
        }
    }

    async function pollOnce() {
        let allDone = true;
        for (const jobId of jobIds) {
            try {
                const res = await fetch(WORKER_BASE + '/nfce/status/' + encodeURIComponent(jobId));
                if (!res.ok) { allDone = false; continue; }
                const st = await res.json();
                applyStatus(jobId, st);
                if (!st.done) allDone = false;
            } catch { allDone = false; }
        }
        updateFooter();
        updateTooltip();
        return allDone;
    }

    async function startPolling() {
        if (polling) return;
        polling = true;
        for (;;) {
            const done = await pollOnce();
            if (done) break;
            await delay(800);
        }
        polling = false;
    }

    // Baixa o ZIP de uma empresa do worker (blob) e entrega via fila de downloads.
    async function downloadCompanyZip(jobId, cnpj, zipName) {
        try {
            const res = await fetch(WORKER_BASE + '/nfce/zip/' + encodeURIComponent(jobId) + '/' + encodeURIComponent(cnpj));
            if (!res.ok) return;
            const blob = await res.blob();
            enqueueDownload(blob, zipName || ('NFCe_' + cnpj + '.zip'));
        } catch (e) {
            console.warn('Falha ao baixar ZIP de ' + cnpj + ': ' + (e && e.message));
        }
    }

    // ====================== fallback BROWSER (worker ausente) ======================
    // Se o worker Node não responder, o download roda no próprio navegador — o
    // caminho do "sucesso inicial". Mesma SEFAZ, mesmo ZIP por empresa (JSZip),
    // mas com token POR EMPRESA (paridade com o modo novo). Só usado quando
    // detectWorker() falha.
    const API_BASE = 'https://cfe.sefaz.ce.gov.br:8443/portalcfews/nfce';
    const MAX_RETRIES = 3;
    const backoff = (attempt) => 500 * Math.pow(2, attempt);
    const makeErr = (kind, message) => { const e = new Error(message); e.kind = kind; return e; };
    const browserPool = { active: 0, concurrency: CONCURRENCY };
    let brRr = 0;

    function jsonHeaders(token, taxid) {
        return { 'x-authentication-token': token, 'x-authentication-taxid': taxid, 'accept': 'application/json' };
    }
    function xmlHeaders(token, taxid) {
        return { 'x-authentication-token': token, 'x-authentication-taxid': taxid, 'accept': '*/*' };
    }
    async function fetchWithRetry(url, options, attempt) {
        attempt = attempt || 0;
        try {
            const res = await fetch(url, options);
            if (res.status === 401 || res.status === 403) throw makeErr('auth', 'Token expirado/inválido (HTTP ' + res.status + ')');
            if (res.status === 404) throw makeErr('notfound', 'Cupom não encontrado (404)');
            if (!res.ok) {
                if (attempt < MAX_RETRIES) { await delay(backoff(attempt)); return fetchWithRetry(url, options, attempt + 1); }
                throw makeErr('http', 'HTTP ' + res.status);
            }
            return res;
        } catch (err) {
            if (err && err.kind) {
                if (err.kind === 'http' && attempt < MAX_RETRIES) { await delay(backoff(attempt)); return fetchWithRetry(url, options, attempt + 1); }
                throw err;
            }
            if (attempt < MAX_RETRIES) { await delay(backoff(attempt)); return fetchWithRetry(url, options, attempt + 1); }
            throw makeErr('network', (err && err.message) ? err.message : 'Falha de rede');
        }
    }
    async function resolveIdNfe(chave, token, taxid) {
        const url = API_BASE + '/coupons/extract/' + encodeURIComponent(chave);
        const res = await fetchWithRetry(url, { headers: jsonHeaders(token, taxid) });
        const data = await res.json();
        const idNfe = data && (data.idNfe || (data.coupon && data.coupon.idNfe));
        if (!idNfe) throw makeErr('parse', 'Resposta sem idNfe');
        return String(idNfe);
    }
    function xmlUrl(idNfe, chave, token) {
        return API_BASE + '/fiscal-coupons/xml/' + encodeURIComponent(idNfe) +
            '?chaveAcesso=' + encodeURIComponent(chave) + '&apiKey=' + encodeURIComponent(token);
    }
    async function fetchXml(idNfe, chave, token, taxid) {
        const res = await fetchWithRetry(xmlUrl(idNfe, chave, token), { headers: xmlHeaders(token, taxid) });
        return await res.text();
    }
    // Conferência (divergência ≠ erro de download). Mesma lógica do worker.
    function conferirXmlBrowser(xml, exp) {
        const diffs = [];
        if (exp.nNF) {
            const mN = xml.match(/<nNF>(\d+)<\/nNF>/);
            const e = parseInt(String(exp.nNF).replace(/\D/g, ''), 10);
            const g = mN ? parseInt(mN[1], 10) : NaN;
            if (!Number.isNaN(e) && (Number.isNaN(g) || e !== g)) diffs.push({ campo: 'nNF', esperado: String(exp.nNF), obtido: mN ? mN[1] : '(ausente)' });
        }
        if (exp.dhEmi) {
            const mD = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/);
            const xmlD = mD ? normalizeDate(mD[1].slice(0, 10)) : '';
            if (!xmlD || xmlD !== normalizeDate(exp.dhEmi)) diffs.push({ campo: 'data', esperado: exp.dhEmi, obtido: xmlD || '(ausente)' });
        }
        if (exp.vNF) {
            const mV = xml.match(/<vNF>([\d.]+)<\/vNF>/);
            const e = parseBrlValue(exp.vNF);
            const g = mV ? parseFloat(mV[1]) : NaN;
            if (Number.isNaN(g) || Number.isNaN(e) || Math.abs(e - g) > 0.01) diffs.push({ campo: 'valor', esperado: exp.vNF, obtido: mV ? mV[1] : '(ausente)' });
        }
        return diffs;
    }

    // Cria/abastece as empresas para o pool do browser e dispara o pool.
    function runBrowser(groups) {
        if (typeof JSZip === 'undefined') {
            footerText.innerHTML = '<span class="bn-err">JSZip não carregou — não dá p/ baixar pelo navegador.</span>';
            return false;
        }
        for (const g of groups) {
            const compKey = 'browser|' + g.cnpj;
            let comp = companies.get(compKey);
            if (!comp) comp = createCompany(compKey, g.cnpj, g.keys[0], 0);
            comp.token = g.token;
            comp.taxid = g.taxid;
            if (!comp.pending) comp.pending = [];
            if (!comp.meta) comp.meta = new Map();
            if (!comp._seen) comp._seen = new Set();
            if (!comp.zip) comp.zip = new JSZip();
            comp.phase = 'download';
            for (const chave of g.keys) {
                if (comp._seen.has(chave)) continue;
                comp._seen.add(chave);
                comp.pending.push(chave);
                if (g.meta && g.meta[chave]) comp.meta.set(chave, g.meta[chave]);
            }
            comp.total = comp._seen.size;
            updateRing(comp);
        }
        updateFooter();
        updateTooltip();
        pumpBrowser();
        return true;
    }

    function nextBrowserJob() {
        const ativos = [];
        companies.forEach((c) => { if (c.pending && c.pending.length) ativos.push(c); });
        if (!ativos.length) return null;
        const comp = ativos[brRr % ativos.length];
        brRr++;
        return { comp, chave: comp.pending.shift() };
    }

    function pumpBrowser() {
        while (browserPool.active < browserPool.concurrency) {
            const job = nextBrowserJob();
            if (!job) break;
            browserPool.active++;
            processBrowserJob(job).then(() => { browserPool.active--; pumpBrowser(); });
        }
    }

    async function processBrowserJob(job) {
        const { comp, chave } = job;
        try {
            const idNfe = await resolveIdNfe(chave, comp.token, comp.taxid);
            const xml = await fetchXml(idNfe, chave, comp.token, comp.taxid);
            let innerKey = '';
            const mk = xml.match(/Id="NFe(\d{44})"/) || xml.match(/<chNFe>(\d{44})<\/chNFe>/);
            if (mk) innerKey = mk[1];
            if (innerKey && innerKey !== chave) throw makeErr('mismatch', 'XML retornou chave ' + innerKey + ', esperado ' + chave);
            comp.zip.file(chave + '.xml', xml);
            comp.downloaded++;
            if (!comp.nomeResolved) {
                const m = xml.match(/<emit>[\s\S]*?<xNome>([^<]+)<\/xNome>/) || xml.match(/<emit>[\s\S]*?<xFant>([^<]+)<\/xFant>/);
                if (m && m[1]) { comp.nome = m[1].trim(); comp.nomeResolved = true; if (comp.els) comp.els.name.textContent = comp.nome; }
            }
            if (comp.meta.has(chave)) conferirXmlBrowser(xml, comp.meta.get(chave));
        } catch (err) {
            comp.errors++;
            if (err && err.kind === 'auth') {
                // token morto desta empresa: o resto vira erro "não tentado"
                while (comp.pending.length) { comp.pending.shift(); comp.errors++; }
            }
        }
        updateRing(comp);
        updateFooter();
        updateTooltip();
        finalizeBrowser(comp);
    }

    function finalizeBrowser(comp) {
        if (comp.phase !== 'download') return;
        if (comp.pending && comp.pending.length) return;
        if (comp.downloaded + comp.errors < comp.total) return;
        if (comp.downloaded === 0) { comp.phase = 'done'; comp.zipProgress = 1; updateRing(comp); updateFooter(); return; }
        comp.phase = 'zip';
        updateRing(comp);
        comp.zip.generateAsync({ type: 'blob' }, (m) => {
            comp.zipProgress = (m.percent || 0) / 100;
            updateRing(comp); updateFooter();
        }).then((blob) => {
            comp.zipProgress = 1; comp.phase = 'done';
            updateRing(comp); updateFooter();
            const empNome = sanitizeFileName(comp.nome || ('CNPJ ' + comp.cnpj));
            enqueueDownload(blob, 'NFCe ' + comp.monthLabel + '_' + empNome + '.zip');
        }).catch((e) => {
            comp.phase = 'done'; comp.zipProgress = 1;
            updateRing(comp); updateFooter();
            console.error('Erro ao gerar ZIP de ' + comp.cnpj + ': ' + (e && e.message));
        });
    }

    // ---------- início do download (worker se houver; senão, browser) ----------
    let useWorker = null;

    // Dispara a lista de relatórios: worker se disponível, senão browser.
    async function routeAndRun(reportsList) {
        const groups = buildCompanies(reportsList);
        if (!groups.length) return false;
        if (useWorker === null) useWorker = await detectWorker();
        if (useWorker) {
            const ok = await launchJob(groups);
            if (ok) return true;
            useWorker = false; // worker detectado mas falhou → cai p/ browser
        }
        return runBrowser(groups);
    }

    async function startDownload() {
        if (!reports.length) return;
        startBtn.disabled = true;
        useWorker = await detectWorker();

        // anima os cards "fundindo" e troca de estágio
        Array.from(reportGrid.children).forEach((c) => c.classList.add('bn-merge'));
        await delay(360);
        stageSelect.style.display = 'none';
        stageDownload.style.display = 'block';
        buildMiniRing();

        const groups = buildCompanies(reports);
        let ok = false;
        if (useWorker) {
            ok = await launchJob(groups);
            if (!ok) { useWorker = false; ok = runBrowser(groups); }
        } else {
            ok = runBrowser(groups);
        }
        if (!ok && !companies.size) {
            // nada disparou: volta ao estágio de seleção
            stageDownload.style.display = 'none';
            stageSelect.style.display = 'flex';
            startBtn.disabled = false;
        }
    }

    // ---------- carga de contribuintes (CNPJ → razão social) ----------
    async function loadContributors() {
        try {
            const list = await loadDataSync('contributors', []);
            (list || []).forEach((c) => {
                const cnpj = String(c.cnpj || '').replace(/\D/g, '');
                if (cnpj.length === 14 && c.razaoSocial) contributorsByCnpj.set(cnpj, c.razaoSocial);
            });
        } catch (e) {
            console.warn('Não foi possível carregar contribuintes: ' + (e && e.message));
        }
    }

    // ====================== wiring ======================
    dropzone.addEventListener('click', () => {
        if (stageDownload.style.display === 'block') return;
        fileInput.click();
    });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('bn-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('bn-dragover'));
    dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('bn-dragover');
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) await handleSelectStageFiles(files);
    });

    fileInput.addEventListener('change', async () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = '';
        if (!files.length) return;
        if (stageDownload.style.display === 'block') {
            // botão + durante o processo: lê os novos relatórios e dispara um job adicional
            const novos = await readFiles(files);
            if (novos.length) { reports.push(...novos); routeAndRun(novos); }
        } else {
            await handleSelectStageFiles(files);
        }
    });

    addBtn.addEventListener('click', () => fileInput.click());
    startBtn.addEventListener('click', () => { startDownload(); });
    tokenInput.addEventListener('input', refreshJwtStatus);
    globalModeChk.addEventListener('change', onModeToggle);

    onModeToggle(); // estado inicial: token por empresa (padrão)
    loadContributors().then(() => { renderReportCards(); });
    renderReportCards();
    updateStartButton();
}
//---------------------------------- FIM Baixar NFCe ----------------------------------//

// Funções de exportação globais para NFe | NFCe Comparison
function exportToPDF() {
    console.log('Exportando para PDF...');
    
    // Verificar qual aba está ativa
    const activeTab = document.querySelector('.tab.active');
    if (!activeTab) {
        alert('Nenhuma aba ativa encontrada.');
        return;
    }
    
    const tabType = activeTab.getAttribute('data-tab');
    console.log('Aba ativa:', tabType);
    
    // Verificar se há dados para exportar
    const quantidadesTab = document.getElementById('quantidades-tab');
    const valoresTab = document.getElementById('valores-tab');
    
    if (!quantidadesTab && !valoresTab) {
        alert('Nenhum dado disponível para exportar.');
        return;
    }

    // Criar e baixar PDF usando jsPDF
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Configurar margens menores
        const margin = 10;
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        const contentWidth = pageWidth - (margin * 2);
        
        // Adicionar título baseado na aba ativa
        let reportTitle = '';
        if (tabType === 'quantidades') {
            reportTitle = 'Relatório de Quantidades - NFe | NFCe';
        } else if (tabType === 'valores') {
            reportTitle = 'Relatório de Valores - NFe | NFCe';
        } else {
            reportTitle = 'Relatório de Comparação NFe | NFCe';
        }
        
        doc.setFontSize(15);
        doc.text(reportTitle, margin, margin + 8);
        
        // Adicionar data
        doc.setFontSize(9);
        doc.text(`Data: ${new Date().toLocaleString('pt-BR')}`, margin, margin + 16);
        
        let yPosition = margin + 25;
        
        // Exportar apenas a aba ativa
        if (tabType === 'quantidades' && quantidadesTab) {
            // Adicionar seção de quantidades
            const sigetList = quantidadesTab.querySelector('#siget-only-list');
            const fortesList = quantidadesTab.querySelector('#fortes-only-list');
            
            if (sigetList && fortesList) {
                doc.setFontSize(13);
                doc.text('Chaves Exclusivas', margin, yPosition);
                yPosition += 8;
                
                // Configurar colunas com espaçamento otimizado
                const colWidth = (contentWidth - 20) / 2; // 20px de espaço entre colunas
                const sigetX = margin;
                const fortesX = margin + colWidth + 20;
                
                // Títulos das colunas
                doc.setFontSize(11);
                doc.setTextColor(0, 100, 0); // Verde para SIGA
                doc.text('SIGA:', sigetX, yPosition);
                doc.setTextColor(139, 0, 0); // Vermelho para FORTES
                doc.text('FORTES:', fortesX, yPosition);
                yPosition += 10;
                
                // Converter listas para arrays
                const sigetItems = Array.from(sigetList.querySelectorAll('li')).map(li => li.textContent);
                const fortesItems = Array.from(fortesList.querySelectorAll('li')).map(li => li.textContent);
                
                // Encontrar o maior array para controlar o loop
                const maxItems = Math.max(sigetItems.length, fortesItems.length);
                
                doc.setFontSize(8);
                doc.setTextColor(0, 0, 0); // Preto para o conteúdo
                
                for (let i = 0; i < maxItems; i++) {
                    // Verificar se precisa de nova página (com mais espaço)
                    if (yPosition > pageHeight - 30) {
                        doc.addPage();
                        yPosition = margin + 10;
                    }
                    
                    // SIGET
                    if (i < sigetItems.length) {
                        const text = sigetItems[i];
                        // Usar largura maior para evitar quebra de linha
                        const lines = doc.splitTextToSize(`• ${text}`, colWidth - 2);
                        doc.text(lines, sigetX, yPosition);
                    }
                    
                    // FORTES
                    if (i < fortesItems.length) {
                        const text = fortesItems[i];
                        // Usar largura maior para evitar quebra de linha
                        const lines = doc.splitTextToSize(`• ${text}`, colWidth - 2);
                        doc.text(lines, fortesX, yPosition);
                    }
                    
                    yPosition += 8; // Aumentar espaçamento entre linhas
                }
                
                yPosition += 10;
            }
        } else if (tabType === 'valores' && valoresTab) {
            // Adicionar seção de valores
            const valoresTable = valoresTab.querySelector('table');
            const successMessage = valoresTab.querySelector('.success-message');
            const errorMessage = valoresTab.querySelector('.error-message');
            
            if (yPosition > pageHeight - 50) {
                doc.addPage();
                yPosition = margin + 10;
            }
            
            doc.setFontSize(13);
            doc.text('Divergências de Valores', margin, yPosition);
            yPosition += 8;
            
            if (successMessage) {
                doc.setFontSize(12);
                doc.setTextColor(72, 209, 120); // Verde para sucesso
                doc.text(successMessage.textContent, margin, yPosition);
                doc.setTextColor(0, 0, 0); // Voltar ao preto
            } else if (errorMessage) {
                doc.setFontSize(12);
                doc.setTextColor(185, 28, 28); // Vermelho para erro
                doc.text(errorMessage.textContent, margin, yPosition);
                doc.setTextColor(0, 0, 0); // Voltar ao preto
            } else if (valoresTable) {
                // Configurar tabela com espaçamento otimizado
                const tableMargin = margin;
                const tableWidth = contentWidth;
                const colWidth = tableWidth / 4; // 4 colunas
                
                const rows = valoresTable.querySelectorAll('tr');
                rows.forEach((row, index) => {
                    // Verificar se precisa de nova página (com mais espaço)
                    if (yPosition > pageHeight - 40) {
                        doc.addPage();
                        yPosition = margin + 10;
                    }
                    
                    const cells = row.querySelectorAll('th, td');
                    let xPosition = tableMargin;
                    
                    // Cabeçalho da tabela
                    if (index === 0) {
                        doc.setFontSize(9);
                        doc.setFont(undefined, 'bold');
                        doc.setTextColor(255, 255, 255);
                        doc.setFillColor(139, 0, 0); // Fundo vermelho para cabeçalho
                        
                        cells.forEach((cell, cellIndex) => {
                            const cellText = cell.textContent;
                            // Usar largura maior para evitar quebra de linha
                            const lines = doc.splitTextToSize(cellText, colWidth - 4);
                            doc.rect(xPosition, yPosition - 5, colWidth, 10, 'F');
                            doc.text(lines, xPosition + 2, yPosition);
                            xPosition += colWidth;
                        });
                        
                        doc.setTextColor(0, 0, 0);
                        doc.setFont(undefined, 'normal');
                    } else {
                        // Linhas de dados
                        doc.setFontSize(7);
                        
                        cells.forEach((cell, cellIndex) => {
                            const cellText = cell.textContent;
                            // Usar largura maior para evitar quebra de linha
                            const lines = doc.splitTextToSize(cellText, colWidth - 4);
                            
                            // Destacar diferenças positivas/negativas
                            if (cell.classList.contains('dif') || cell.classList.contains('positivo')) {
                                if (cell.classList.contains('positivo')) {
                                    doc.setTextColor(0, 128, 0); // Verde
                                } else {
                                    doc.setTextColor(185, 28, 28); // Vermelho
                                }
                            } else {
                                doc.setTextColor(0, 0, 0); // Preto
                            }
                            
                            doc.text(lines, xPosition + 2, yPosition);
                            xPosition += colWidth;
                        });
                    }
                    
                    yPosition += 8; // Aumentar espaçamento entre linhas
                });
            }
        } else {
            // Nenhuma aba válida encontrada
            doc.setFontSize(12);
            doc.setTextColor(185, 28, 28); // Vermelho para erro
            doc.text('Nenhuma aba válida encontrada para exportação.', margin, yPosition);
        }
        
        // Salvar PDF com nome baseado na aba ativa
        let fileName = '';
        if (tabType === 'quantidades') {
            fileName = `relatorio_quantidades_nfe_cfe_${new Date().toISOString().slice(0, 10)}.pdf`;
        } else if (tabType === 'valores') {
            fileName = `relatorio_valores_nfe_cfe_${new Date().toISOString().slice(0, 10)}.pdf`;
        } else {
            fileName = `relatorio_comparacao_nfe_cfe_${new Date().toISOString().slice(0, 10)}.pdf`;
        }
        
        doc.save(fileName);
        
    } catch (error) {
        console.error('Erro ao gerar PDF:', error);
        alert('Erro ao gerar PDF. Verifique se a biblioteca jsPDF está carregada.');
    }
}

function exportToXLSX() {
    console.log('Exportando para XLSX...');
    
    // Verificar qual aba está ativa
    const activeTab = document.querySelector('.tab.active');
    if (!activeTab) {
        alert('Nenhuma aba ativa encontrada.');
        return;
    }
    
    const tabType = activeTab.getAttribute('data-tab');
    console.log('Aba ativa:', tabType);
    
    try {
        const workbook = XLSX.utils.book_new();
        
        if (tabType === 'quantidades') {
            // Criar planilha de quantidades
            const quantidadesData = [];
            const quantidadesTab = document.getElementById('quantidades-tab');
            
            if (quantidadesTab) {
                const sigetList = quantidadesTab.querySelector('#siget-only-list');
                const fortesList = quantidadesTab.querySelector('#fortes-only-list');
                
                quantidadesData.push(['SIGA - Chaves Exclusivas', 'FORTES - Chaves Exclusivas']);
                
                if (sigetList && fortesList) {
                    const sigetItems = Array.from(sigetList.querySelectorAll('li')).map(li => li.textContent);
                    const fortesItems = Array.from(fortesList.querySelectorAll('li')).map(li => li.textContent);
                    
                    const maxLength = Math.max(sigetItems.length, fortesItems.length);
                    
                    for (let i = 0; i < maxLength; i++) {
                        quantidadesData.push([
                            sigetItems[i] || '',
                            fortesItems[i] || ''
                        ]);
                    }
                }
            }
            
            const quantidadesSheet = XLSX.utils.aoa_to_sheet(quantidadesData);
            XLSX.utils.book_append_sheet(workbook, quantidadesSheet, 'Quantidades');
            
            // Configurar larguras das colunas
            quantidadesSheet['!cols'] = [{ wch: 50 }, { wch: 50 }];
            
            // Salvar arquivo
            XLSX.writeFile(workbook, `relatorio_quantidades_nfe_cfe_${new Date().toISOString().slice(0, 10)}.xlsx`);
            
        } else if (tabType === 'valores') {
            // Criar planilha de valores
            const valoresData = [];
            const valoresTab = document.getElementById('valores-tab');
            
            if (valoresTab) {
                const valoresTable = valoresTab.querySelector('table');
                const successMessage = valoresTab.querySelector('.success-message');
                const errorMessage = valoresTab.querySelector('.error-message');
                
                if (successMessage) {
                    valoresData.push(['Status', successMessage.textContent]);
                } else if (errorMessage) {
                    valoresData.push(['Status', errorMessage.textContent]);
                } else if (valoresTable) {
                    const rows = valoresTable.querySelectorAll('tr');
                    rows.forEach(row => {
                        const rowData = [];
                        const cells = row.querySelectorAll('th, td');
                        cells.forEach(cell => {
                            rowData.push(cell.textContent);
                        });
                        valoresData.push(rowData);
                    });
                }
            }
            
            const valoresSheet = XLSX.utils.aoa_to_sheet(valoresData);
            XLSX.utils.book_append_sheet(workbook, valoresSheet, 'Valores');
            
            // Configurar larguras das colunas
            valoresSheet['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
            
            // Salvar arquivo
            XLSX.writeFile(workbook, `relatorio_valores_nfe_cfe_${new Date().toISOString().slice(0, 10)}.xlsx`);
            
        } else {
            alert('Tipo de aba não reconhecido para exportação.');
            return;
        }
        
    } catch (error) {
        console.error('Erro ao gerar XLSX:', error);
        alert('Erro ao gerar XLSX. Verifique se a biblioteca XLSX está carregada.');
    }
}

//------------------------------------ Reminders ------------------------------------//

function getCurrentUser() {
    // Retorna o usuário atual do localStorage ou fallback para 'Unknown'
    return localStorage.getItem('currentUser') || 'Unknown';
}

let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();

function showRemindersModal() {
    console.log('Exibindo modal de Reminders');
    currentCalendarMonth = new Date().getMonth();
    currentCalendarYear = new Date().getFullYear();
    
    const modal = document.createElement('div');
    modal.classList.add('modal-overlay');
    modal.innerHTML = `
        <div class="reminders-modal-content" id="reminders-modal">
            <div class="reminders-grid">
                <div class="calendar-section" id="calendar-section">
                    ${generateCalendar(currentCalendarMonth, currentCalendarYear)}
                </div>
                <div class="events-section">
                    <div class="events-header">
                        <h3>Metas Concluídas</h3>
                        <p>Lista de metas completadas</p>
                    </div>
                    <div id="completed-goals" class="completed-goals-list"></div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Função para atualizar calendário com animação
    function updateCalendar() {
        const calendarSection = document.getElementById('calendar-section');
        if (calendarSection) {
            // Adicionar animação fade out
            calendarSection.style.opacity = '0';
            calendarSection.style.transform = 'translateX(20px)';
            
            setTimeout(() => {
                calendarSection.innerHTML = generateCalendar(currentCalendarMonth, currentCalendarYear);
                // Adicionar animação fade in
                calendarSection.style.transition = 'all 0.3s ease';
                calendarSection.style.opacity = '1';
                calendarSection.style.transform = 'translateX(0)';
                
                // Reconfigurar navegação após atualizar
                setupNavigation();
            }, 150);
        }
    }
    
    // Função para configurar navegação
    function setupNavigation() {
        const prevBtn = document.querySelector('.calendar-nav-left .nav-btn');
        const nextBtn = document.querySelector('.calendar-nav-right .nav-btn');
        
        if (prevBtn) {
            prevBtn.onclick = function() {
                currentCalendarMonth--;
                if (currentCalendarMonth < 0) {
                    currentCalendarMonth = 11;
                    currentCalendarYear--;
                }
                updateCalendar();
            };
        }
        
        if (nextBtn) {
            nextBtn.onclick = function() {
                currentCalendarMonth++;
                if (currentCalendarMonth > 11) {
                    currentCalendarMonth = 0;
                    currentCalendarYear++;
                }
                updateCalendar();
            };
        }
    }

    // Configurar navegação inicial
    setupNavigation();

    const completedGoals = JSON.parse(localStorage.getItem('completedGoals') || '[]');
    const userCompletedGoals = completedGoals.filter(goal => goal.user === currentUser);
    const completedGoalsContainer = modal.querySelector('#completed-goals');
    
    if (userCompletedGoals.length === 0) {
        completedGoalsContainer.innerHTML = '<div class="no-events">Nenhuma meta concluída ainda</div>';
    } else {
        userCompletedGoals.forEach(goal => {
            const goalElement = document.createElement('div');
            goalElement.classList.add('event-item');
            goalElement.innerHTML = `
                <div class="event-content">
                    <div class="event-name">${goal.name}</div>
                    <div class="event-time">
                        <span class="material-icons-sharp">schedule</span>
                        ${goal.time}
                    </div>
                </div>
                <div class="event-options">
                    <span class="material-icons-sharp">more_vert</span>
                </div>
            `;
            completedGoalsContainer.appendChild(goalElement);
        });
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            console.log('Fechando modal de Reminders ao clicar fora');
            document.body.removeChild(modal);
        }
    });

    console.log(`Metas completadas visíveis apenas para ${currentUser}: ${userCompletedGoals.map(g => g.name).join(', ')}`);
}

function generateCalendar(month = null, year = null) {
    const today = new Date();
    const currentDay = today.getDate();
    
    if (month === null) month = today.getMonth();
    if (year === null) year = today.getFullYear();

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let calendarHTML = `
        <div class="calendar-header-modern">
            <div class="calendar-nav-left">
                <button class="nav-btn">
                    <span class="material-icons-sharp">chevron_left</span>
                </button>
            </div>
            <div class="calendar-title">
                <h3>${monthNames[month]} ${year}</h3>
            </div>
            <div class="calendar-nav-right">
                <button class="nav-btn">
                    <span class="material-icons-sharp">chevron_right</span>
                </button>
            </div>
        </div>
        <div class="calendar-table-wrapper">
            <table class="calendar-table-modern">
                <thead>
                    <tr>
                        ${dayNames.map(day => `<th>${day}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

    let day = 1;
    let isFirstWeek = true;
    while (day <= daysInMonth) {
        calendarHTML += '<tr>';
        for (let i = 0; i < 7; i++) {
            if (isFirstWeek && i < adjustedFirstDay) {
                calendarHTML += '<td class="empty-day"></td>';
            } else if (day <= daysInMonth) {
                const isToday = day === currentDay && month === today.getMonth() && year === today.getFullYear() ? 'today' : '';
                const isWeekend = (i === 5 || i === 6) ? 'weekend' : '';
                calendarHTML += `<td class="calendar-day ${isToday} ${isWeekend}" data-day="${day}" data-month="${month}" data-year="${year}">
                    <span class="day-number">${day}</span>
                    <div class="day-markers"></div>
                </td>`;
                day++;
            } else {
                calendarHTML += '<td class="empty-day"></td>';
            }
        }
        calendarHTML += '</tr>';
        isFirstWeek = false;
    }

    calendarHTML += `
                </tbody>
            </table>
        </div>
    `;
    return calendarHTML;
}

function showGoalListModal() {
    console.log('Exibindo modal de lista de metas');
    const goalModal = document.createElement('div');
    goalModal.classList.add('goal-list-modal');
    const goals = [
        'Recolhimento de Relatórios - Siget',
        'ISS',
        'Sitram',
        'Recolhimento dos Arquivos de NF-e',
        'Download de CF-e',
        'Envio dos Impostos',
        'Ajuste de CFOP',
        'Ajuste de CST',
        'Comparação de Valores',
        'Transmissão de SPED Fiscal | Contribuições',
        'Add New Goal'
    ];

    // Carregar metas escolhidas do localStorage
    const selectedGoals = JSON.parse(localStorage.getItem('selectedGoals') || '[]');
    const currentUser = getCurrentUser();

    goalModal.innerHTML = `
        <div class="goal-list-modal-content">
            <div class="goal-list-content">
                <h3>Selecione uma Meta</h3>
                <ul class="goal-list">
                    ${goals.map(goal => {
                        const isSelected = selectedGoals.some(g => g.goal === goal && g.user !== currentUser);
                        return `<li data-goal="${goal}" class="${isSelected ? 'disabled' : ''}">${goal}</li>`;
                    }).join('')}
                </ul>
                <div class="custom-goal-input" style="display: none;">
                    <input type="text" class="custom-goal-name" placeholder="Digite o nome da meta" />
                    <button class="confirm-custom-goal">Confirmar</button>
                </div>
                <!-- MODIFICAÇÃO: Adiciona botão Start Over -->
                <button class="start-over-btn">Start Over</button>
            </div>
        </div>
    `;
    document.body.appendChild(goalModal);

    const goalItems = goalModal.querySelectorAll('.goal-list li');
    const customInputContainer = goalModal.querySelector('.custom-goal-input');
    const customInput = goalModal.querySelector('.custom-goal-name');
    const confirmButton = goalModal.querySelector('.confirm-custom-goal');
    // MODIFICAÇÃO: Selecionar o botão Start Over
    const startOverButton = goalModal.querySelector('.start-over-btn');

    goalItems.forEach(item => {
        item.addEventListener('click', () => {
            if (item.classList.contains('disabled')) {
                console.log(`Meta ${item.getAttribute('data-goal')} já escolhida por outro usuário`);
                return;
            }
            const goalName = item.getAttribute('data-goal');
            if (goalName === 'Add New Goal') {
                console.log('Opção Add New Goal selecionada');
                customInputContainer.style.display = 'block';
                customInput.focus();
            } else {
                console.log(`Meta selecionada: ${goalName}`);
                addGoalNotification(goalName);
                document.body.removeChild(goalModal);
            }
        });
    });

    confirmButton.addEventListener('click', () => {
        const customGoalName = customInput.value.trim();
        if (customGoalName) {
            console.log(`Meta personalizada adicionada: ${customGoalName}`);
            addGoalNotification(customGoalName);
            document.body.removeChild(goalModal);
        } else {
            console.warn('Nome da meta personalizada vazio');
            customInput.focus();
        }
    });

    customInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmButton.click();
        }
    });

    // MODIFICAÇÃO: Evento para o botão Start Over
    startOverButton.addEventListener('click', () => {
        console.log('Botão Start Over clicado - liberando todas as metas');
        localStorage.setItem('selectedGoals', JSON.stringify([])); // Limpa selectedGoals
        goalItems.forEach(item => {
            item.classList.remove('disabled'); // Remove a classe disabled de todas as metas
        });
        console.log('Todas as metas agora disponíveis para seleção');
        try { clearAllSelectedGoalsFirestore(); } catch (e) { /* noop */ }
    });

    goalModal.addEventListener('click', (e) => {
        if (e.target === goalModal) {
            console.log('Fechando modal de lista de metas ao clicar fora');
            document.body.removeChild(goalModal);
        }
    });
}

function addGoalNotification(goalName) {
    const remindersSection = document.querySelector('.dashboard-container .right-section .reminders');
    if (!remindersSection) {
        console.warn('Seção de reminders não encontrada');
        return;
    }

    const currentUser = getCurrentUser();
    const notificationId = `goal-${Date.now()}-${currentUser}`;
    const notification = document.createElement('div');
    notification.classList.add('notification');
    notification.setAttribute('data-id', notificationId);
    notification.setAttribute('data-user', currentUser); // Já associa ao usuário para filtro de visibilidade
    notification.innerHTML = `
        <div class="content">
            <div class="goal-info">
                <input type="text" class="goal-name" value="${goalName}" />
                <small class="timer">00:00:00</small>
            </div>
            <input type="checkbox" class="goal-checkbox">
        </div>
    `;
    remindersSection.insertBefore(notification, remindersSection.querySelector('.add-reminder') || null);

    // Associar meta ao usuário
    const selectedGoals = JSON.parse(localStorage.getItem('selectedGoals') || '[]');
    selectedGoals.push({ goal: goalName, user: currentUser });
    localStorage.setItem('selectedGoals', JSON.stringify(selectedGoals));
    try { addSelectedGoalFirestore(goalName, currentUser); } catch (e) { /* noop */ }

    const goalInput = notification.querySelector('.goal-name');
    goalInput.addEventListener('input', () => {
        console.log(`Nome da meta atualizado: ${goalInput.value}`);
        // Atualizar nome no selectedGoals
        const updatedGoals = JSON.parse(localStorage.getItem('selectedGoals') || '[]');
        const index = updatedGoals.findIndex(g => g.goal === goalName && g.user === currentUser);
        if (index !== -1) {
            updatedGoals[index].goal = goalInput.value.trim() || goalName;
            localStorage.setItem('selectedGoals', JSON.stringify(updatedGoals));
        }
    });

    const checkbox = notification.querySelector('.goal-checkbox');
    startTimer(notificationId, notification.querySelector('.timer'), checkbox, goalInput, goalName);

    // MELHORIA OPCIONAL: Adicione log para depuração de visibilidade
    console.log(`Meta '${goalName}' adicionada para usuário ${currentUser} - visível apenas para ele.`);
}

function showCompletionMessage(goalName) {
    const message = document.createElement('div');
    message.classList.add('completion-message');
    message.textContent = `Meta "${goalName}" concluída!`;
    document.body.appendChild(message);
    setTimeout(() => {
        message.remove();
    }, 2000);
}

function startTimer(notificationId, timerElement, checkbox, goalInput, goalName) {
    const storageKey = `timer-${notificationId}`;
    let elapsedTime = parseInt(localStorage.getItem(storageKey)) || 0;
    let isRunning = !checkbox.checked;

    function isWorkingHours() {
        const now = new Date();
        const day = now.getDay();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const timeInMinutes = hours * 60 + minutes;

        if (day >= 1 && day <= 4) {
            return timeInMinutes >= 8 * 60 && timeInMinutes < 18 * 60;
        } else if (day === 5) {
            return timeInMinutes >= 8 * 60 && timeInMinutes < 17 * 60;
        }
        return false;
    }

    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${hours}:${minutes}:${secs}`;
    }

    function updateTimer() {
        if (!isRunning || !isWorkingHours()) return;

        elapsedTime++;
        localStorage.setItem(storageKey, elapsedTime);
        timerElement.textContent = formatTime(elapsedTime);
    }

    checkbox.addEventListener('change', () => {
        isRunning = !checkbox.checked;
        if (!isRunning) {
            console.log(`Cronômetro pausado para meta ${notificationId}`);
            const notification = checkbox.closest('.notification');
            if (notification) {
                const currentUser = getCurrentUser();
                const updatedGoalName = goalInput.value.trim() || goalName;
                showCompletionMessage(updatedGoalName);
                notification.remove();
                console.log(`Meta ${updatedGoalName} movida para o modal de calendário`);
                const completedGoals = JSON.parse(localStorage.getItem('completedGoals') || '[]');
                completedGoals.push({ name: updatedGoalName, time: formatTime(elapsedTime), user: currentUser });  // Já associa ao usuário para filtro
                localStorage.setItem('completedGoals', JSON.stringify(completedGoals));
                try { addCompletedGoalFirestore(updatedGoalName, formatTime(elapsedTime), currentUser); } catch (e) { /* noop */ }

                // Remover meta do selectedGoals (já remove apenas a do usuário atual)
                let selectedGoals = JSON.parse(localStorage.getItem('selectedGoals') || '[]');
                selectedGoals = selectedGoals.filter(g => g.goal !== goalName || g.user !== currentUser);
                localStorage.setItem('selectedGoals', JSON.stringify(selectedGoals));
                try { removeSelectedGoalFirestore(goalName, currentUser); } catch (e) { /* noop */ }

                // Limpar o cronômetro do localStorage
                localStorage.removeItem(storageKey);
            }
        }
    });

    setInterval(updateTimer, 1000);
    updateTimer();

    // MELHORIA OPCIONAL: Adicione log para depuração ao completar
    console.log(`Timer iniciado para meta '${goalName}' do usuário ${getCurrentUser()} - visível apenas para ele.`);
}

// Função para mostrar modal de cadastro de usuários
function showUserRegistrationModal() {
    // Verificar se o usuário atual é administrador
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUserData = registeredUsers.find(u => u.username === window.currentUser);
    const isAdmin = window.currentUser === 'adm' || (currentUserData && currentUserData.control === 'administrador');
    
    if (!isAdmin) {
        alert('Apenas administradores podem cadastrar novos usuários.');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'user-registration-modal';
    
    // Adicionar classe de modo escuro se aplicável
    if (document.body.classList.contains('dark-mode-variables')) {
        modal.classList.add('dark-mode-variables');
    }
    
    modal.innerHTML = `
        <div class="user-registration-modal-content">
            <div class="modal-header">
                <h2>Gerenciamento de Usuários</h2>
                <button class="close-btn" onclick="closeUserRegistrationModal()">
                    <span class="material-icons-sharp">close</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-section">
                    <h3 id="form-title">Cadastrar Novo Usuário</h3>
                    <form id="user-registration-form">
                        <input type="hidden" id="user-edit-id" value="">
                        <div class="form-columns">
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="user-name" required>
                                    <label for="user-name">Nome Completo</label>
                                    <i class='bx bxs-user'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="user-username" required>
                                    <label for="user-username">Username</label>
                                    <i class='bx bxs-user-circle'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <select id="user-control" required>
                                        <option value=""></option>
                                        <option value="auxiliar">Auxiliar</option>
                                        <option value="administrador">Administrador</option>
                                    </select>
                                    <label for="user-control">Controle</label>
                                    <i class='bx bxs-shield'></i>
                                </div>
                            </div>
                        </div>
                        <div class="form-columns">
                            <div class="input-group full-width" id="password-fields">
                                <div class="input-box">
                                    <input type="password" id="user-password">
                                    <label for="user-password">Nova Senha <small style="font-size: 0.75rem; opacity: 0.7;">(deixe em branco para manter a atual)</small></label>
                                    <i class='bx bxs-lock-alt'></i>
                                </div>
                            </div>
                            <div class="input-group full-width" id="confirm-password-field">
                                <div class="input-box">
                                    <input type="password" id="user-confirm-password">
                                    <label for="user-confirm-password">Confirmar Nova Senha</label>
                                    <i class='bx bxs-lock-alt'></i>
                                </div>
                            </div>
                            <div class="input-group full-width">
                                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Imagem de Perfil</label>
                                <input type="file" id="user-profile-image" accept="image/*" style="display: none;">
                                <div style="display: flex; align-items: center; gap: 1rem;">
                                    <img id="profile-preview" src="assets/images/profile-1.png" alt="Preview" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; border: 2px solid var(--color-primary);">
                                    <button type="button" onclick="document.getElementById('user-profile-image').click()" class="btn-select-image" style="padding: 0.5rem 1rem; background: var(--color-primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                                        Selecionar Imagem
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn-cancel" onclick="cancelEditUser()">Cancelar</button>
                            <button type="submit" class="btn-save" id="submit-btn">Cadastrar Usuário</button>
                        </div>
                    </form>
                </div>
                <div class="users-section">
                    <h3>Usuários Cadastrados</h3>
                    <div id="users-list" class="users-list">
                        <!-- Usuários serão listados aqui -->
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Carregar lista de usuários (com sincronização)
    loadUsersList().catch(err => console.error('Erro ao carregar lista de usuários:', err));

    // Adicionar evento de preview da imagem
    const fileInput = document.getElementById('user-profile-image');
    const previewImg = document.getElementById('profile-preview');
    
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                previewImg.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    // Adicionar evento de submit do formulário
    const form = document.getElementById('user-registration-form');
    form.addEventListener('submit', handleUserRegistration);

    // Adicionar evento de clique fora do modal para fechar
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeUserRegistrationModal();
        }
    });
}

// Função para carregar e exibir lista de usuários
async function loadUsersList() {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;

    const users = await loadDataSync('registeredUsers', []);
    
    if (users.length === 0) {
        usersList.innerHTML = '<p class="no-users">Nenhum usuário cadastrado ainda.</p>';
        return;
    }

    usersList.innerHTML = users.map((user, index) => `
        <div class="user-item">
            <img src="${user.profileImage || 'assets/images/profile-1.png'}" alt="${user.name}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; margin-right: 1rem; border: 2px solid var(--color-primary);">
            <div class="user-info">
                <div class="user-detail">
                    <span class="user-label">Nome:</span>
                    <span class="user-value">${user.name}</span>
                </div>
                <div class="user-detail">
                    <span class="user-label">Username:</span>
                    <span class="user-value">${user.username}</span>
                </div>
                <div class="user-detail">
                    <span class="user-label">Controle:</span>
                    <span class="user-value user-control ${user.control}">${user.control}</span>
                </div>
                <div class="user-detail">
                    <span class="user-label">Cadastrado em:</span>
                    <span class="user-value">${new Date(user.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn-edit" onclick="editUser(${user.id})" title="Editar usuário (nome, controle, foto e senha)" aria-label="Editar usuário" style="padding: 0.5rem; background: var(--color-primary); color: white; border: none; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                    <span class="material-icons-sharp" style="font-size: 1.2rem;">edit</span>
                </button>
                <button class="btn-delete" onclick="deleteUser(${user.id})">
                    <span class="material-icons-sharp">delete</span>
                </button>
            </div>
        </div>
    `).join('');
}

// Função para editar usuário
async function editUser(userId) {
    const users = await loadDataSync('registeredUsers', []);
    const user = users.find(u => u.id === userId);
    
    if (!user) {
        alert('Usuário não encontrado.');
        return;
    }
    
    // Preencher formulário com dados do usuário
    document.getElementById('user-edit-id').value = user.id;
    document.getElementById('user-name').value = user.name;
    document.getElementById('user-username').value = user.username;
    document.getElementById('user-control').value = user.control;
    document.getElementById('user-password').value = '';
    document.getElementById('user-confirm-password').value = '';
    document.getElementById('user-profile-image').value = '';
    document.getElementById('profile-preview').src = user.profileImage || 'assets/images/profile-1.png';
    
    // Atualizar título e botão
    document.getElementById('form-title').textContent = 'Editar Usuário';
    document.getElementById('submit-btn').textContent = 'Salvar Alterações';
    
    // Tornar senha opcional (remover required)
    document.getElementById('user-password').removeAttribute('required');
    document.getElementById('user-confirm-password').removeAttribute('required');
    
    // Desabilitar campo username durante edição (para evitar conflitos)
    document.getElementById('user-username').setAttribute('readonly', 'readonly');
    document.getElementById('user-username').style.backgroundColor = 'var(--color-light)';
    document.getElementById('user-username').style.cursor = 'not-allowed';
    
    // Scroll para o formulário
    document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Função para cancelar edição e resetar formulário
function cancelEditUser() {
    // Limpar formulário
    document.getElementById('user-edit-id').value = '';
    document.getElementById('user-name').value = '';
    document.getElementById('user-username').value = '';
    document.getElementById('user-control').value = '';
    document.getElementById('user-password').value = '';
    document.getElementById('user-confirm-password').value = '';
    document.getElementById('user-profile-image').value = '';
    document.getElementById('profile-preview').src = 'assets/images/profile-1.png';
    
    // Restaurar título e botão
    document.getElementById('form-title').textContent = 'Cadastrar Novo Usuário';
    document.getElementById('submit-btn').textContent = 'Cadastrar Usuário';
    
    // Restaurar campos de senha como obrigatórios
    document.getElementById('user-password').setAttribute('required', 'required');
    document.getElementById('user-confirm-password').setAttribute('required', 'required');
    
    // Habilitar campo username
    document.getElementById('user-username').removeAttribute('readonly');
    document.getElementById('user-username').style.backgroundColor = '';
    document.getElementById('user-username').style.cursor = '';
}

// Função para deletar usuário (local + Supabase)
async function deleteUser(userId) {
    const users = await loadDataSync('registeredUsers', []);
    const target = users.find(user => user.id === userId);
    if (!target) {
        alert('Usuário não encontrado.');
        return;
    }

    if (!confirm(`Excluir DEFINITIVAMENTE o usuário "${target.name}" (${target.username})?\n\n` +
                 `A conta será removida do Supabase e do sistema. Esta ação não pode ser desfeita.`)) {
        return;
    }

    // 1) Exclusão definitiva no Supabase via Edge Function (hard-delete de auth.users
    //    → ON DELETE CASCADE remove user_profiles). Idempotente para órfãos só-locais.
    let supabaseAviso = '';
    if (window.supabaseSync?.auth?.deleteUser && window.supabaseSync.isConfigured()) {
        const del = await window.supabaseSync.auth.deleteUser({ username: target.username });
        if (!del.ok) {
            if (del.error === 'sem-sessao') {
                supabaseAviso = '\n\n(Removido apenas localmente — não há sessão Supabase ativa. ' +
                    'Para excluir a conta na nuvem, faça login no Supabase e exclua novamente, ou use o Dashboard.)';
            } else {
                console.warn('⚠️ Falha ao excluir no Supabase:', del.error);
                supabaseAviso = '\n\n(Atenção: removido localmente, mas a exclusão no Supabase falhou: ' + del.error + ')';
            }
        }
        // del.ok com status 'not-found' = órfão; segue com a remoção local normalmente.
    }

    // 2) Remove o espelho local (registeredUsers).
    const filteredUsers = users.filter(user => user.id !== userId);
    await saveDataSync('registeredUsers', filteredUsers);

    loadUsersList();
    alert('Usuário excluído.' + supabaseAviso);
}

// Função para fechar modal de cadastro de usuários
function closeUserRegistrationModal() {
    const modal = document.querySelector('.user-registration-modal');
    if (modal) {
        modal.remove();
    }
}

// Função para lidar com o cadastro de usuários
async function handleUserRegistration(e) {
    e.preventDefault();

    const editId = document.getElementById('user-edit-id').value;
    const isEditing = editId !== '';
    
    const name = document.getElementById('user-name').value.trim();
    const username = document.getElementById('user-username').value.trim().toLowerCase();
    const control = document.getElementById('user-control').value;
    const password = document.getElementById('user-password').value;
    const confirmPassword = document.getElementById('user-confirm-password').value;
    const profileImageInput = document.getElementById('user-profile-image');

    // Validações básicas
    if (!name || !username || !control) {
        alert('Nome, Username e Controle são obrigatórios.');
        return;
    }

    // Validações de senha
    if (!isEditing) {
        // Novo usuário: senha obrigatória
        if (!password || !confirmPassword) {
            alert('Senha e confirmação são obrigatórias para novos usuários.');
            return;
        }
        if (password !== confirmPassword) {
            alert('As senhas não coincidem.');
            return;
        }
        // Supabase Auth exige >= 6 caracteres. Falha aqui (antes de qualquer escrita)
        // evita criar usuário órfão (local sem conta na nuvem).
        if (password.length < 6) {
            alert('A senha deve ter pelo menos 6 caracteres.');
            return;
        }
    } else {
        // Editando: senha opcional, mas se informada, deve coincidir e respeitar o mínimo.
        if (password || confirmPassword) {
            if (password !== confirmPassword) {
                alert('As senhas não coincidem.');
                return;
            }
            if (password.length < 6) {
                alert('A senha deve ter pelo menos 6 caracteres.');
                return;
            }
        }
    }

    // Verificar se o username já existe (apenas para novos usuários)
    if (!isEditing) {
        const existingUsers = await loadDataSync('registeredUsers', []);
        if (existingUsers.find(user => user.username === username)) {
            alert('Este username já está em uso. Escolha outro.');
            return;
        }
    }

    // Processar imagem de perfil
    let profileImage = 'assets/images/profile-1.png'; // Imagem padrão
    
    if (profileImageInput.files.length > 0) {
        const file = profileImageInput.files[0];
        
        // Validar tipo de arquivo
        if (!file.type.startsWith('image/')) {
            alert('Por favor, selecione apenas arquivos de imagem.');
            return;
        }

        // Validar tamanho do arquivo (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('A imagem deve ter no máximo 5MB.');
            return;
        }

        // Converter para base64
        const reader = new FileReader();
        reader.onload = async function(event) {
            profileImage = event.target.result;
            
            // Continuar com o cadastro/edição após processar a imagem
            await completeUserRegistration(name, username, control, password, profileImage, isEditing, editId);
        };
        reader.onerror = function() {
            alert('Erro ao processar a imagem. Tente novamente.');
        };
        reader.readAsDataURL(file);
    } else {
        // Sem imagem selecionada, manter a atual se editando ou usar padrão
        if (isEditing) {
            const existingUsers = await loadDataSync('registeredUsers', []);
            const userToEdit = existingUsers.find(u => u.id === parseInt(editId));
            if (userToEdit && userToEdit.profileImage) {
                profileImage = userToEdit.profileImage;
            }
        }
        await completeUserRegistration(name, username, control, password, profileImage, isEditing, editId);
    }
}

// Função para completar o cadastro do usuário
async function completeUserRegistration(name, username, control, password, profileImage, isEditing = false, editId = null) {
    // Obter usuários existentes (com sincronização)
    const existingUsers = await loadDataSync('registeredUsers', []);

    if (isEditing) {
        // EDITAR USUÁRIO EXISTENTE
        const userIndex = existingUsers.findIndex(u => u.id === parseInt(editId));
        if (userIndex === -1) {
            alert('Usuário não encontrado para edição.');
            return;
        }
        
        const existingUser = existingUsers[userIndex];
        
        // Atualizar dados do usuário (hash com PBKDF2 quando nova senha é informada).
        const newPasswordHash = password ? await window.generateSecureHash(password) : existingUser.password;
        existingUsers[userIndex] = {
            ...existingUser,
            name: name,
            control: control,
            profileImage: profileImage,
            password: newPasswordHash,
            updatedAt: new Date().toISOString(),
            updatedBy: window.currentUser
        };

        await saveDataSync('registeredUsers', existingUsers);
        console.log('✅ Usuário atualizado e sincronizado:', existingUsers[userIndex]);

        // Propaga metadados para o Supabase (user_profiles), casando por username.
        // Best-effort: só funciona se houver sessão admin ativa (RLS). Não bloqueia o
        // fluxo local. LIMITAÇÕES: (1) mudar `control` aqui NÃO altera a permissão
        // efetiva no Supabase — current_user_is_admin() lê de auth.jwt().user_metadata,
        // que só muda via admin API; (2) troca de senha de outro usuário não propaga ao
        // auth.users (também exige admin API). Ambos ficam para a Edge Function admin.
        let supabaseAviso = '';
        if (window.supabaseSync?.auth?.updateProfile && window.supabaseSync.isConfigured()) {
            const upd = await window.supabaseSync.auth.updateProfile({
                username: existingUser.username,
                fullName: name,
                control: control,
                profileImage: profileImage,
            });
            if (!upd.ok && upd.error !== 'sem-sessao') {
                console.warn('⚠️ Falha ao propagar edição para user_profiles:', upd.error);
                supabaseAviso = '\n\n(Atenção: os dados foram salvos localmente, mas a sincronização do perfil no Supabase falhou.)';
            }
        }

        // Senha (e control) precisam ir ao auth.users via Edge Function admin —
        // updateProfile só toca user_profiles e não muda a senha de login. Só dispara
        // quando uma nova senha foi informada na edição.
        if (password && window.supabaseSync?.auth?.updateUser && window.supabaseSync.isConfigured()) {
            const updPwd = await window.supabaseSync.auth.updateUser({
                username: existingUser.username,
                password,
                control,
            });
            if (!updPwd.ok && updPwd.error !== 'sem-sessao') {
                console.warn('⚠️ Falha ao atualizar senha no Supabase:', updPwd.error);
                supabaseAviso += '\n\n(Atenção: a nova senha foi salva localmente, mas não foi aplicada no login da nuvem: ' + updPwd.error + ')';
            }
        }

        alert('Usuário atualizado com sucesso!' + supabaseAviso);
    } else {
        // CRIAR NOVO USUÁRIO — SUPABASE-FIRST.
        // Defesa: senha mínima do Supabase Auth (caso completeUserRegistration seja
        // chamado por um caminho que não passou por handleUserRegistration).
        if (!password || password.length < 6) {
            alert('A senha deve ter pelo menos 6 caracteres.');
            return;
        }

        const supabaseAtivo = !!(window.supabaseSync?.auth?.createUser && window.supabaseSync.isConfigured());

        // 1) Cria a conta no Supabase ANTES de qualquer escrita local, via Edge Function
        //    admin (create-user): a admin API aceita o domínio interno .local (o signUp
        //    público o rejeita como inválido) e não troca a sessão do admin. O trigger
        //    handle_new_user popula user_profiles. Se falhar, abortamos — nada é gravado
        //    localmente, evitando usuário órfão (local sem conta na nuvem).
        if (supabaseAtivo) {
            const createResult = await window.supabaseSync.auth.createUser({
                username, password, fullName: name, control,
            });
            if (!createResult.ok) {
                console.warn('⚠️ Falha ao criar conta Supabase — cadastro abortado:', createResult.error);
                const motivo = createResult.error === 'sem-sessao'
                    ? 'É preciso estar logado como administrador no Supabase para cadastrar usuários.'
                    : createResult.error;
                alert('Não foi possível criar a conta no Supabase: ' + motivo +
                      '\n\nO usuário NÃO foi cadastrado. Verifique os dados e tente novamente.');
                return; // aborta — nenhum espelho local é criado
            }
        }

        // 2) Só agora grava o espelho local (preserva fluxos legados que dependem de
        //    registeredUsers). Hash PBKDF2-SHA-256 da senha.
        const hashedPassword = await window.generateSecureHash(password);
        const newUser = {
            id: Date.now(),
            name: name,
            username: username,
            control: control,
            password: hashedPassword,
            profileImage: profileImage,
            createdAt: new Date().toISOString(),
            createdBy: window.currentUser
        };

        existingUsers.push(newUser);
        await saveDataSync('registeredUsers', existingUsers);

        if (supabaseAtivo) {
            console.log('✅ Usuário cadastrado em Supabase Auth + local:', newUser);
            alert('Usuário cadastrado com sucesso (Supabase + local)!');
        } else {
            console.log('✅ Usuário salvo (somente local — Supabase não configurado):', newUser);
            alert('Usuário cadastrado com sucesso (somente local — Supabase não configurado).');
        }
    }

    // Limpar formulário e resetar modo
    cancelEditUser();

    // Recarregar lista de usuários
    await loadUsersList();
}

// ==================== FUNÇÕES DE CADASTRO DE CONTRIBUINTES ====================

// Função auxiliar para escapar HTML e prevenir XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Função para mostrar modal de cadastro de contribuintes
function showContributorRegistrationModal() {
    // Verificar se o usuário atual é administrador
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUserData = registeredUsers.find(u => u.username === window.currentUser);
    const isAdmin = window.currentUser === 'adm' || (currentUserData && currentUserData.control === 'administrador');
    
    if (!isAdmin) {
        alert('Apenas administradores podem cadastrar novos contribuintes.');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'user-registration-modal';
    
    // Adicionar classe de modo escuro se aplicável
    if (document.body.classList.contains('dark-mode-variables')) {
        modal.classList.add('dark-mode-variables');
    }
    
    modal.innerHTML = `
        <div class="user-registration-modal-content">
            <div class="modal-header">
                <h2>Gerenciamento de Contribuintes</h2>
                <button class="close-btn contributor-close-btn">
                    <span class="material-icons-sharp">close</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-section">
                    <h3 id="contributor-form-title">Cadastrar Novo Contribuinte</h3>
                    <div class="contributor-bulk-actions" style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
                        <button type="button" id="contributor-download-template" class="btn-cancel" style="background:#3498db; color:#fff; padding:0.5rem 1rem; font-size:0.85rem; display:flex; align-items:center; gap:0.4rem;">
                            <span class="material-icons-sharp" style="font-size:1.1rem;">download</span> Baixar modelo
                        </button>
                        <button type="button" id="contributor-import-btn" class="btn-cancel" style="background:var(--color-success); color:#fff; padding:0.5rem 1rem; font-size:0.85rem; display:flex; align-items:center; gap:0.4rem;">
                            <span class="material-icons-sharp" style="font-size:1.1rem;">upload_file</span> Importar planilha
                        </button>
                        <input type="file" id="contributor-import-input" accept=".xlsx,.xls" style="display:none;">
                    </div>
                    <form id="contributor-registration-form">
                        <input type="hidden" id="contributor-edit-id" value="">
                        <div class="form-columns">
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="contributor-codigo" required>
                                    <label for="contributor-codigo">Código <span style="color: red;">*</span></label>
                                    <i class='bx bxs-hash'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="contributor-razao-social" required>
                                    <label for="contributor-razao-social">Razão Social <span style="color: red;">*</span></label>
                                    <i class='bx bxs-building'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="contributor-cnpj" required pattern="[0-9]{14}" maxlength="14">
                                    <label for="contributor-cnpj">CNPJ <span style="color: red;">*</span></label>
                                    <i class='bx bxs-id-card'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="contributor-atividade" required>
                                    <label for="contributor-atividade">Atividade <span style="color: red;">*</span></label>
                                    <i class='bx bxs-briefcase'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="contributor-regime" required>
                                    <label for="contributor-regime">Regime <span style="color: red;">*</span></label>
                                    <i class='bx bxs-book'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="contributor-municipio" required>
                                    <label for="contributor-municipio">Município <span style="color: red;">*</span></label>
                                    <i class='bx bxs-map'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="text" id="contributor-iss">
                                    <label for="contributor-iss">ISS</label>
                                    <i class='bx bxs-receipt'></i>
                                </div>
                            </div>
                            <div class="input-group">
                                <div class="input-box">
                                    <input type="password" id="contributor-password">
                                    <label for="contributor-password">Senha</label>
                                    <i class='bx bxs-lock-alt'></i>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn-cancel contributor-cancel-btn" onclick="cancelEditContributor()">Cancelar</button>
                            <button type="submit" class="btn-save" id="contributor-submit-btn">Cadastrar Contribuinte</button>
                        </div>
                    </form>
                </div>
                <div class="users-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <h3>Contribuintes Cadastrados</h3>
                        <button type="button" class="btn-cancel clear-all-contributors-btn" style="background: var(--color-danger); color: white; padding: 0.5rem 1rem; font-size: 0.85rem;">
                            Limpar Todos
                        </button>
                    </div>
                    <div id="contributors-list" class="users-list">
                        <!-- Contribuintes serão listados aqui -->
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Carregar lista de contribuintes (com sincronização)
    loadContributorsList().catch(err => console.error('Erro ao carregar lista de contribuintes:', err));

    // Adicionar máscara para CNPJ
    const cnpjInput = document.getElementById('contributor-cnpj');
    if (cnpjInput) {
        cnpjInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 14) value = value.slice(0, 14);
            e.target.value = value;
        });
    }

    // Adicionar evento de submit do formulário
    const form = document.getElementById('contributor-registration-form');
    if (form) {
        form.addEventListener('submit', handleContributorRegistration);
    }

    // Adicionar event listeners aos botões de fechar e limpar
    setTimeout(() => {
        const closeBtn = modal.querySelector('.contributor-close-btn');
        const cancelBtn = modal.querySelector('.contributor-cancel-btn');
        const clearAllBtn = modal.querySelector('.clear-all-contributors-btn');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', closeContributorRegistrationModal);
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeContributorRegistrationModal);
        }
        
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', clearAllContributors);
        }

        // Cadastro em massa: baixar modelo + importar planilha de contribuintes.
        const dlTemplateBtn = modal.querySelector('#contributor-download-template');
        if (dlTemplateBtn) dlTemplateBtn.addEventListener('click', downloadContributorTemplate);

        const importBtn = modal.querySelector('#contributor-import-btn');
        const importInput = modal.querySelector('#contributor-import-input');
        if (importBtn && importInput) {
            importBtn.addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', handleContributorImport);
        }
    }, 0);

    // Adicionar evento de clique fora do modal para fechar
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeContributorRegistrationModal();
        }
    });
}

// Função para carregar e exibir lista de contribuintes
async function loadContributorsList() {
    const contributorsList = document.getElementById('contributors-list');
    if (!contributorsList) return;

    const contributors = await loadDataSync('contributors', []);
    
    // Verificar origem dos dados
    const localData = localStorage.getItem('contributors');
    const localContributors = localData ? JSON.parse(localData) : [];
    const hasLocalData = localContributors.length > 0;
    const hasCloudData = contributors.length > localContributors.length;
    
    if (contributors.length === 0) {
        contributorsList.innerHTML = '<p class="no-users">Nenhum contribuinte cadastrado ainda.</p>';
        return;
    }
    
    // Adicionar informação sobre origem dos dados se houver diferença
    if (hasCloudData && contributors.length > 0) {
        console.log('ℹ️ Contribuintes carregados:', {
            total: contributors.length,
            local: localContributors.length,
            cloud: contributors.length,
            origem: 'Sincronização do Supabase (outro PC ou dados compartilhados)'
        });
    }

    contributorsList.innerHTML = contributors.map((contributor, index) => {
        // Escapar valores para prevenir XSS e erros de JavaScript
        const safeId = String(contributor.id || index).replace(/[^0-9]/g, '');
        return `
        <div class="user-item" data-contributor-id="${safeId}">
            <div class="user-info" style="flex: 1;">
                <div class="user-detail">
                    <span class="user-label">Código:</span>
                    <span class="user-value">${escapeHtml(contributor.codigo || 'N/A')}</span>
                </div>
                <div class="user-detail">
                    <span class="user-label">Razão Social:</span>
                    <span class="user-value">${escapeHtml(contributor.razaoSocial || 'N/A')}</span>
                </div>
                <div class="user-detail">
                    <span class="user-label">CNPJ:</span>
                    <span class="user-value">${formatCNPJ(contributor.cnpj || '')}</span>
                </div>
                <div class="user-detail">
                    <span class="user-label">Atividade:</span>
                    <span class="user-value">${escapeHtml(contributor.atividade || 'N/A')}</span>
                </div>
                <div class="user-detail">
                    <span class="user-label">Regime:</span>
                    <span class="user-value">${escapeHtml(contributor.regime || 'N/A')}</span>
                </div>
                <div class="user-detail">
                    <span class="user-label">Município:</span>
                    <span class="user-value">${escapeHtml(contributor.municipio || 'N/A')}</span>
                </div>
                ${contributor.iss ? `
                <div class="user-detail">
                    <span class="user-label">ISS:</span>
                    <span class="user-value">${escapeHtml(contributor.iss)}</span>
                </div>
                ` : ''}
                <div class="user-detail">
                    <span class="user-label">Cadastrado em:</span>
                    <span class="user-value">${new Date(contributor.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem; margin-left: 1rem;">
                <button class="btn-edit contributor-edit-btn" data-contributor-id="${safeId}" title="Editar contribuinte (razão social, regime, etc.)" aria-label="Editar contribuinte" style="padding: 0.5rem; background: var(--color-primary); color: white; border: none; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                    <span class="material-icons-sharp" style="font-size: 1.2rem;">edit</span>
                </button>
                <button class="btn-delete contributor-delete-btn" data-contributor-id="${safeId}">
                    <span class="material-icons-sharp">delete</span>
                </button>
            </div>
        </div>
    `;
    }).join('');
    
    // Adicionar event listeners aos botões de delete e edit
    contributorsList.querySelectorAll('.contributor-delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const contributorId = parseInt(this.getAttribute('data-contributor-id'));
            if (contributorId) {
                deleteContributor(contributorId);
            }
        });
    });
    
    contributorsList.querySelectorAll('.contributor-edit-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const contributorId = parseInt(this.getAttribute('data-contributor-id'));
            if (contributorId) {
                editContributor(contributorId);
            }
        });
    });
}

// Função para formatar CNPJ
function formatCNPJ(cnpj) {
    if (!cnpj) return '';
    const cleaned = cnpj.replace(/\D/g, '');
    if (cleaned.length !== 14) return cnpj;
    return cleaned.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// Função para editar contribuinte
async function editContributor(contributorId) {
    const contributors = await loadDataSync('contributors', []);
    const contributor = contributors.find(c => c.id === contributorId);
    
    if (!contributor) {
        alert('Contribuinte não encontrado.');
        return;
    }
    
    // Preencher formulário com dados do contribuinte
    document.getElementById('contributor-edit-id').value = contributor.id;
    document.getElementById('contributor-codigo').value = contributor.codigo || '';
    document.getElementById('contributor-razao-social').value = contributor.razaoSocial || '';
    document.getElementById('contributor-cnpj').value = contributor.cnpj || '';
    document.getElementById('contributor-atividade').value = contributor.atividade || '';
    document.getElementById('contributor-regime').value = contributor.regime || '';
    document.getElementById('contributor-municipio').value = contributor.municipio || '';
    document.getElementById('contributor-iss').value = contributor.iss || '';
    document.getElementById('contributor-password').value = '';
    
    // Atualizar título e botão
    document.getElementById('contributor-form-title').textContent = 'Editar Contribuinte';
    document.getElementById('contributor-submit-btn').textContent = 'Salvar Alterações';
    
    // Desabilitar campo CNPJ durante edição (para evitar conflitos)
    const cnpjInput = document.getElementById('contributor-cnpj');
    cnpjInput.setAttribute('readonly', 'readonly');
    cnpjInput.style.backgroundColor = 'var(--color-light)';
    cnpjInput.style.cursor = 'not-allowed';
    
    // Desabilitar campo código durante edição
    const codigoInput = document.getElementById('contributor-codigo');
    codigoInput.setAttribute('readonly', 'readonly');
    codigoInput.style.backgroundColor = 'var(--color-light)';
    codigoInput.style.cursor = 'not-allowed';
    
    // Scroll para o formulário
    document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Função para cancelar edição e resetar formulário de contribuinte
function cancelEditContributor() {
    // Limpar formulário
    document.getElementById('contributor-edit-id').value = '';
    document.getElementById('contributor-codigo').value = '';
    document.getElementById('contributor-razao-social').value = '';
    document.getElementById('contributor-cnpj').value = '';
    document.getElementById('contributor-atividade').value = '';
    document.getElementById('contributor-regime').value = '';
    document.getElementById('contributor-municipio').value = '';
    document.getElementById('contributor-iss').value = '';
    document.getElementById('contributor-password').value = '';
    
    // Restaurar título e botão
    document.getElementById('contributor-form-title').textContent = 'Cadastrar Novo Contribuinte';
    document.getElementById('contributor-submit-btn').textContent = 'Cadastrar Contribuinte';
    
    // Habilitar campos CNPJ e código
    const cnpjInput = document.getElementById('contributor-cnpj');
    cnpjInput.removeAttribute('readonly');
    cnpjInput.style.backgroundColor = '';
    cnpjInput.style.cursor = '';
    
    const codigoInput = document.getElementById('contributor-codigo');
    codigoInput.removeAttribute('readonly');
    codigoInput.style.backgroundColor = '';
    codigoInput.style.cursor = '';
}

// Função para deletar contribuinte
async function deleteContributor(contributorId) {
    if (!confirm('Tem certeza que deseja deletar este contribuinte?')) {
        return;
    }

    const contributors = await loadDataSync('contributors', []);
    const contributorToDelete = contributors.find(c => c.id === contributorId);
    
    if (!contributorToDelete) {
        alert('Contribuinte não encontrado.');
        return;
    }
    
    const filteredContributors = contributors.filter(contributor => contributor.id !== contributorId);
    await saveDataSync('contributors', filteredContributors);
    
    // Recarregar lista
    await loadContributorsList();
    
    alert(`Contribuinte "${contributorToDelete.razaoSocial || contributorToDelete.codigo}" deletado com sucesso!`);
}

// Função para limpar todos os contribuintes (útil para remover dados de teste ou sincronização indesejada)
async function clearAllContributors() {
    if (!confirm('⚠️ ATENÇÃO: Isso irá deletar TODOS os contribuintes cadastrados!\n\nTem certeza que deseja continuar?')) {
        return;
    }
    
    if (!confirm('Esta ação não pode ser desfeita. Confirme novamente para deletar todos os contribuintes.')) {
        return;
    }
    
    await saveDataSync('contributors', []);
    await loadContributorsList();
    
    alert('Todos os contribuintes foram deletados com sucesso!');
}

// Função para fechar modal de cadastro de contribuintes
function closeContributorRegistrationModal() {
    const modal = document.querySelector('.user-registration-modal');
    const contributorForm = document.getElementById('contributor-registration-form');
    if (modal && contributorForm) {
        modal.remove();
    }
}

// Função para lidar com o cadastro de contribuintes
async function handleContributorRegistration(e) {
    e.preventDefault();

    const editId = document.getElementById('contributor-edit-id').value;
    const isEditing = editId !== '';
    
    const codigo = document.getElementById('contributor-codigo').value.trim();
    const razaoSocial = document.getElementById('contributor-razao-social').value.trim();
    const cnpj = document.getElementById('contributor-cnpj').value.replace(/\D/g, '');
    const atividade = document.getElementById('contributor-atividade').value.trim();
    const regime = document.getElementById('contributor-regime').value.trim();
    const municipio = document.getElementById('contributor-municipio').value.trim();
    const iss = document.getElementById('contributor-iss').value.trim();
    const password = document.getElementById('contributor-password').value;

    // Validações de campos obrigatórios
    if (!codigo || !razaoSocial || !cnpj || !atividade || !regime || !municipio) {
        alert('Por favor, preencha todos os campos obrigatórios (marcados com *).');
        return;
    }

    // Validar CNPJ (deve ter 14 dígitos)
    if (cnpj.length !== 14) {
        alert('CNPJ deve conter 14 dígitos.');
        return;
    }

    // Verificar se o CNPJ já existe (apenas para novos contribuintes)
    if (!isEditing) {
        const existingContributors = await loadDataSync('contributors', []);
        if (existingContributors.find(c => c.cnpj === cnpj)) {
            alert('Este CNPJ já está cadastrado. Escolha outro.');
            return;
        }

        // Verificar se o código já existe
        if (existingContributors.find(c => c.codigo === codigo)) {
            alert('Este código já está em uso. Escolha outro.');
            return;
        }
    }

    // Processar senha se fornecida (hash PBKDF2-SHA-256).
    let passwordHash = null;
    if (password && password.trim()) {
        passwordHash = await window.generateSecureHash(password);
    }

    // Obter contribuintes existentes (com sincronização)
    const existingContributors = await loadDataSync('contributors', []);

    if (isEditing) {
        // EDITAR CONTRIBUINTE EXISTENTE
        const contributorIndex = existingContributors.findIndex(c => c.id === parseInt(editId));
        if (contributorIndex === -1) {
            alert('Contribuinte não encontrado para edição.');
            return;
        }
        
        const existingContributor = existingContributors[contributorIndex];
        
        // Atualizar dados do contribuinte
        existingContributors[contributorIndex] = {
            ...existingContributor,
            razaoSocial: razaoSocial,
            atividade: atividade,
            regime: regime,
            municipio: municipio,
            iss: iss || null,
            // Atualizar senha apenas se foi informada
            password: passwordHash || existingContributor.password,
            updatedAt: new Date().toISOString(),
            updatedBy: window.currentUser
        };
        
        await saveDataSync('contributors', existingContributors);
        console.log('✅ Contribuinte atualizado e sincronizado:', existingContributors[contributorIndex]);
        alert('Contribuinte atualizado com sucesso!');
        
        // Limpar formulário e resetar modo
        cancelEditContributor();
        
        // Recarregar lista
        await loadContributorsList();
        return;
    }

    // CRIAR NOVO CONTRIBUINTE
    // Criar objeto do contribuinte
    const newContributor = {
        id: Date.now(),
        codigo: codigo,
        razaoSocial: razaoSocial,
        cnpj: cnpj,
        atividade: atividade,
        regime: regime,
        municipio: municipio,
        iss: iss || null,
        passwordHash: passwordHash,
        createdAt: new Date().toISOString(),
        createdBy: window.currentUser
    };

    // Salvar contribuinte (com sincronização automática)
    existingContributors.push(newContributor);
    await saveDataSync('contributors', existingContributors);
    console.log('✅ Contribuinte salvo e sincronizado:', newContributor);

    // Limpar formulário
    document.getElementById('contributor-codigo').value = '';
    document.getElementById('contributor-razao-social').value = '';
    document.getElementById('contributor-cnpj').value = '';
    document.getElementById('contributor-atividade').value = '';
    document.getElementById('contributor-regime').value = '';
    document.getElementById('contributor-municipio').value = '';
    document.getElementById('contributor-iss').value = '';
    document.getElementById('contributor-password').value = '';

    // Recarregar lista de contribuintes
    await loadContributorsList();

    alert(`Contribuinte "${razaoSocial}" cadastrado com sucesso!`);
}

// Gera e baixa o modelo de cadastro em massa de contribuintes (cabeçalhos na linha 1,
// mesma ordem do arquivo "Cadastro de Contribuinte.xlsx"). Inclui uma linha de exemplo.
function downloadContributorTemplate() {
    try {
        const headers = ['Código', 'Razão Social', 'CNPJ', 'Atividade', 'Regime', 'Município', 'ISS', 'Senha'];
        const exemplo = ['001', 'EMPRESA EXEMPLO LTDA', '12345678000190', 'Comércio', 'Simples Nacional', 'Fortaleza', '', ''];
        const ws = XLSX.utils.aoa_to_sheet([headers, exemplo]);
        ws['!cols'] = headers.map(() => ({ wch: 20 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Cadastro');
        XLSX.writeFile(wb, 'Cadastro de Contribuinte.xlsx');
    } catch (e) {
        console.error('Erro ao gerar modelo de contribuintes:', e);
        alert('Não foi possível gerar o modelo. Tente novamente.');
    }
}

// Importa contribuintes em massa de uma planilha .xlsx. Mapeia colunas por nome de
// cabeçalho (tolerante à ordem), valida cada linha, ignora duplicatas (código/CNPJ) e
// grava tudo em uma única sincronização. Reporta um resumo ao final.
async function handleContributorImport(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) { alert('A planilha está vazia ou em formato inválido.'); return; }

        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        if (matrix.length < 2) { alert('A planilha não contém linhas de dados.'); return; }

        // Mapear índices de coluna pelo nome do cabeçalho (normalizado, sem acento) —
        // tolerante a reordenação das colunas.
        const norm = (s) => String(s || '').trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
        const header = matrix[0].map(norm);
        const col = (names) => {
            for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
            return -1;
        };
        const idx = {
            codigo: col(['codigo']),
            razaoSocial: col(['razao social', 'razaosocial', 'razao']),
            cnpj: col(['cnpj']),
            atividade: col(['atividade']),
            regime: col(['regime']),
            municipio: col(['municipio']),
            iss: col(['iss']),
            senha: col(['senha', 'password']),
        };
        if (idx.codigo < 0 || idx.razaoSocial < 0 || idx.cnpj < 0) {
            alert('Cabeçalho inválido. Use o modelo (colunas Código, Razão Social, CNPJ, Atividade, Regime, Município, ISS, Senha).');
            return;
        }

        const existing = await loadDataSync('contributors', []);
        const codigosUsados = new Set(existing.map(c => String(c.codigo)));
        const cnpjsUsados = new Set(existing.map(c => String(c.cnpj)));

        const novos = [];
        const erros = [];
        let ignoradosDup = 0;

        for (let r = 1; r < matrix.length; r++) {
            const row = matrix[r] || [];
            const get = (i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
            const codigo = get(idx.codigo);
            const razaoSocial = get(idx.razaoSocial);
            const cnpj = get(idx.cnpj).replace(/\D/g, '');
            const atividade = get(idx.atividade);
            const regime = get(idx.regime);
            const municipio = get(idx.municipio);
            const iss = get(idx.iss);
            const senha = get(idx.senha);

            // Linha totalmente em branco: ignora silenciosamente.
            if (!codigo && !razaoSocial && !cnpj) continue;

            if (!codigo || !razaoSocial || !cnpj || !atividade || !regime || !municipio) {
                erros.push(`Linha ${r + 1}: campos obrigatórios faltando`);
                continue;
            }
            if (cnpj.length !== 14) {
                erros.push(`Linha ${r + 1}: CNPJ inválido (${cnpj || 'vazio'})`);
                continue;
            }
            if (codigosUsados.has(codigo) || cnpjsUsados.has(cnpj)) {
                ignoradosDup++;
                continue;
            }

            const passwordHash = senha ? await window.generateSecureHash(senha) : null;
            novos.push({
                id: Date.now() + r,
                codigo, razaoSocial, cnpj, atividade, regime, municipio,
                iss: iss || null,
                passwordHash,
                createdAt: new Date().toISOString(),
                createdBy: window.currentUser,
            });
            codigosUsados.add(codigo);
            cnpjsUsados.add(cnpj);
        }

        if (novos.length > 0) {
            await saveDataSync('contributors', existing.concat(novos));
            await loadContributorsList();
        }

        let msg = `Importação concluída.\n\n${novos.length} contribuinte(s) cadastrado(s).`;
        if (ignoradosDup > 0) msg += `\n${ignoradosDup} ignorado(s) (código/CNPJ já existente).`;
        if (erros.length > 0) {
            msg += `\n${erros.length} com erro:\n` + erros.slice(0, 8).join('\n');
            if (erros.length > 8) msg += `\n... e mais ${erros.length - 8}.`;
        }
        alert(msg);
    } catch (e) {
        console.error('Erro ao importar contribuintes:', e);
        alert('Não foi possível ler a planilha. Verifique se é um .xlsx válido no formato do modelo.');
    } finally {
        input.value = ''; // permite reimportar o mesmo arquivo
    }
}

// ==================== BIBLIOTECA PYTHON ====================

let pythonFilesList = [];

async function loadPythonFilesList() {
    try {
        const data = await loadDataSync('pythonFilesList', []);
        pythonFilesList = Array.isArray(data) ? data : [];
        return pythonFilesList;
    } catch (e) {
        pythonFilesList = [];
        return [];
    }
}

async function savePythonFilesList() {
    try {
        localStorage.setItem('pythonFilesList', JSON.stringify(pythonFilesList));
        if (window.supabaseSync && window.supabaseSync.isConfigured()) {
            await saveDataSync('pythonFilesList', pythonFilesList);
        }
    } catch (e) {
        console.error('Erro ao salvar lista Python:', e);
    }
}

async function showPythonLibraryModal() {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUserData = registeredUsers.find(u => u.username === window.currentUser);
    const isAdmin = window.currentUser === 'adm' || (currentUserData && currentUserData.control === 'administrador');
    
    const modal = document.createElement('div');
    modal.className = 'python-library-modal';
    if (document.body.classList.contains('dark-mode-variables')) {
        modal.classList.add('dark-mode-variables');
    }
    
    modal.innerHTML = `
        <div class="python-library-modal-content">
            <div class="modal-header">
                <h2>Biblioteca Python - Automação</h2>
                <button class="close-btn python-library-close-btn">
                    <span class="material-icons-sharp">close</span>
                </button>
            </div>
            <div class="modal-body">
                ${isAdmin ? `
                    <div style="margin-bottom: 1.5rem; padding: 1rem; background: var(--color-light); border-radius: var(--border-radius-1);">
                        <h3 style="margin: 0 0 1rem 0; color: var(--color-dark); font-size: 1.1rem;">Upload de Arquivo</h3>
                        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                            <input type="file" id="python-upload-input" style="display: none;">
                            <button id="python-upload-btn" style="padding: 0.75rem 1.5rem; background: var(--color-primary); color: white; border: none; border-radius: var(--border-radius-1); cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                                <span class="material-icons-sharp">cloud_upload</span>
                                Selecionar e Enviar
                            </button>
                            <span id="python-upload-status" style="font-size: 0.9rem; color: var(--color-dark-variant);"></span>
                        </div>
                    </div>
                ` : ''}
                <div id="python-library-list" style="display: flex; flex-direction: column; gap: 1rem;">
                    <p style="text-align: center; color: var(--color-dark-variant);">Carregando...</p>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.python-library-close-btn')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    if (isAdmin) {
        const uploadBtn = modal.querySelector('#python-upload-btn');
        const uploadInput = modal.querySelector('#python-upload-input');
        const uploadStatus = modal.querySelector('#python-upload-status');
        uploadBtn?.addEventListener('click', () => uploadInput?.click());
        uploadInput?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) {
                alert('Selecione um arquivo.');
                return;
            }
            if (pythonFilesList.find(f => f.name.toLowerCase() === file.name.toLowerCase())) {
                alert('Já existe um arquivo com este nome.');
                return;
            }
            uploadBtn.disabled = true;
            uploadStatus.textContent = 'Enviando...';
            if (window.supabaseSync?.isConfigured()) {
                const result = await window.supabaseSync.uploadPythonFile(file);
                if (result.error) {
                    uploadStatus.textContent = 'Erro: ' + result.error;
                    alert('Erro ao enviar: ' + result.error + '. Verifique se o bucket python-library existe no Supabase.');
                } else {
                    pythonFilesList.push({ name: result.fileName || file.name, description: '' });
                    await savePythonFilesList();
                    renderPythonLibrary(modal, isAdmin);
                    uploadStatus.textContent = 'Enviado com sucesso!';
                }
            } else {
                uploadStatus.textContent = 'Supabase não configurado';
                alert('Configure o Supabase para usar upload.');
            }
            uploadInput.value = '';
            uploadBtn.disabled = false;
        });
    }
    
    try {
        if (window.supabaseSync?.isConfigured()) {
            await window.supabaseSync.syncAll(['pythonFilesList']);
        }
        await loadPythonFilesList();
        renderPythonLibrary(modal, isAdmin);
    } catch (e) {
        console.error('Erro ao carregar Biblioteca Python:', e);
        modal.querySelector('#python-library-list').innerHTML = '<p style="text-align: center; color: var(--color-danger); padding: 2rem;">Erro ao carregar. Tente novamente.</p>';
    }
}

function renderPythonLibrary(modal, isAdmin) {
    const listContainer = modal.querySelector('#python-library-list');
    if (!listContainer) return;
    
    if (pythonFilesList.length === 0) {
        listContainer.innerHTML = `
            <p style="text-align: center; color: var(--color-dark-variant); padding: 2rem;">
                Nenhum arquivo na biblioteca.
                ${isAdmin ? '<br><br>Use o botão "Selecionar e Enviar" acima para adicionar arquivos.' : ''}
            </p>
        `;
        return;
    }
    
    listContainer.innerHTML = pythonFilesList.map((file, index) => {
        const fileName = file.name || 'arquivo';
        const description = file.description || '';
        return `
            <div class="python-file-item" style="background: var(--color-white); border-radius: var(--card-border-radius); padding: 1.5rem; box-shadow: var(--box-shadow); display: flex; flex-direction: column; gap: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: start; gap: 1rem;">
                    <div style="flex: 1;">
                        <h3 style="margin: 0 0 0.5rem 0; color: var(--color-dark); display: flex; align-items: center; gap: 0.5rem;">
                            <span class="material-icons-sharp" style="color: var(--color-primary);">code</span>
                            ${escapeHtml(fileName)}
                        </h3>
                        <div class="python-file-description" style="color: var(--color-dark-variant); min-height: 2rem;">
                            ${description ? `<p style="margin: 0;">${escapeHtml(description)}</p>` : '<p style="margin: 0; font-style: italic; color: var(--color-info);">Sem descrição</p>'}
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: start;">
                        ${isAdmin ? `
                            <button class="edit-description-btn" data-index="${index}" style="padding: 0.5rem; background: var(--color-primary); color: white; border: none; border-radius: var(--border-radius-1); cursor: pointer;" title="Editar descrição">
                                <span class="material-icons-sharp" style="font-size: 1.2rem;">edit</span>
                            </button>
                            <button class="delete-python-btn" data-index="${index}" style="padding: 0.5rem; background: var(--color-danger); color: white; border: none; border-radius: var(--border-radius-1); cursor: pointer;" title="Remover">
                                <span class="material-icons-sharp" style="font-size: 1.2rem;">delete</span>
                            </button>
                        ` : ''}
                        <button class="download-python-btn" data-index="${index}" style="padding: 0.5rem; background: var(--color-success); color: white; border: none; border-radius: var(--border-radius-1); cursor: pointer; display: flex; align-items: center; gap: 0.25rem;" title="Baixar arquivo">
                            <span class="material-icons-sharp" style="font-size: 1.2rem;">download</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    listContainer.querySelectorAll('.edit-description-btn').forEach(btn => {
        btn.addEventListener('click', (e) => editPythonFileDescription(parseInt(e.currentTarget.getAttribute('data-index')), modal));
    });
    listContainer.querySelectorAll('.delete-python-btn').forEach(btn => {
        btn.addEventListener('click', (e) => deletePythonFile(parseInt(e.currentTarget.getAttribute('data-index')), modal));
    });
    listContainer.querySelectorAll('.download-python-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            const f = pythonFilesList[idx];
            if (f) doPythonFileDownload(f.name);
        });
    });
}

async function editPythonFileDescription(index, modal) {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUserData = registeredUsers.find(u => u.username === window.currentUser);
    const isAdmin = window.currentUser === 'adm' || (currentUserData && currentUserData.control === 'administrador');
    if (!isAdmin) return;
    const file = pythonFilesList[index];
    if (!file) return;
    const newDescription = prompt(`Editar descrição do arquivo "${file.name}":`, file.description || '');
    if (newDescription !== null) {
        file.description = newDescription.trim();
        await savePythonFilesList();
        renderPythonLibrary(modal, true);
    }
}

async function deletePythonFile(index, modal) {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUserData = registeredUsers.find(u => u.username === window.currentUser);
    const isAdmin = window.currentUser === 'adm' || (currentUserData && currentUserData.control === 'administrador');
    if (!isAdmin) return;
    const file = pythonFilesList[index];
    if (!file || !confirm(`Remover "${file.name}" da biblioteca?`)) return;
    if (window.supabaseSync?.isConfigured()) {
        const r = await window.supabaseSync.removePythonFile(file.name);
        if (r?.error) {
            alert('Erro ao remover do storage: ' + r.error);
            return;
        }
    }
    pythonFilesList.splice(index, 1);
    await savePythonFilesList();
    renderPythonLibrary(modal, true);
}

async function doPythonFileDownload(fileName) {
    if (!window.supabaseSync?.isConfigured()) {
        alert('Supabase não configurado. Não é possível baixar arquivos.');
        return;
    }
    const blob = await window.supabaseSync.downloadPythonFile(fileName);
    if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    } else {
        const url = window.supabaseSync.getPythonFileUrl(fileName);
        if (url) window.open(url, '_blank');
        else alert('Não foi possível baixar o arquivo.');
    }
}

// Tornar funções de contribuintes globalmente acessíveis
window.showContributorRegistrationModal = showContributorRegistrationModal;
window.deleteContributor = deleteContributor;
window.editContributor = editContributor;
window.cancelEditContributor = cancelEditContributor;
window.closeContributorRegistrationModal = closeContributorRegistrationModal;
window.clearAllContributors = clearAllContributors;

window.showPythonLibraryModal = showPythonLibraryModal;

// Configurar eventos
document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar sincronização compartilhada (Supabase)
    await initializeSync();
    
    const currentUser = getCurrentUser();
    const remindersSection = document.querySelector('.dashboard-container .right-section .reminders');
    if (remindersSection) {
        // Filtrar notificações existentes para o usuário atual (já garante visibilidade exclusiva)
        document.querySelectorAll('.notification[data-id]').forEach(notification => {
            const notificationUser = notification.getAttribute('data-user');
            if (notificationUser !== currentUser) {
                notification.remove();
                console.log(`Notificação removida para usuário ${notificationUser} (usuário atual: ${currentUser})`);
            } else {
                const notificationId = notification.getAttribute('data-id');
                const timerElement = notification.querySelector('.timer');
                const checkbox = notification.querySelector('.goal-checkbox');
                const goalInput = notification.querySelector('.goal-name');
                const goalName = goalInput.value;
                if (timerElement && checkbox && goalInput) {
                    startTimer(notificationId, timerElement, checkbox, goalInput, goalName);
                }
            }
        });
    } else {
        console.warn('Seção de reminders não encontrada no DOM');
    }

    const remindersIcon = document.querySelector('.dashboard-container .right-section .reminders .header span');
    if (remindersIcon) {
        remindersIcon.addEventListener('click', () => {
            console.log('Ícone de Reminders clicado');
            showRemindersModal();
        });
    } else {
        console.warn('Ícone de Reminders não encontrado no DOM');
    }

    const addReminderButton = document.querySelector('.dashboard-container .right-section .reminders .add-reminder');
    if (addReminderButton) {
        addReminderButton.addEventListener('click', () => {
            console.log('Botão Add Reminder clicado na página principal');
            showGoalListModal();
        });
    } else {
        console.warn('Botão Add Reminders não encontrado no DOM');
    }
    // Firebase removido - sistema usa sincronização compartilhada via Supabase
    // Inicializar sincronização quando a página carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSync);
    } else {
        initializeSync();
    }
});

//---------------------------------- FIM Reminders ----------------------------------//

// ==================== SISTEMA DE REMINDERS DO TAX AGENDA ====================
// Funções auxiliares para cálculos de dias úteis (copiadas do Chat-script.js)

/**
 * Retorna o próximo dia útil após a data fornecida
 */
function getNextBusinessDay(date) {
    const d = new Date(date);
    while (d.getDay() === 0 || d.getDay() === 6) { // 0 = Domingo, 6 = Sábado
        d.setDate(d.getDate() + 1);
    }
    return d;
}

/**
 * Retorna o n-ésimo dia útil do mês
 */
function getNthBusinessDay(year, month, n) {
    const date = new Date(year, month, 1);
    let businessDays = 0;
    while (businessDays < n) {
        if (date.getDay() !== 0 && date.getDay() !== 6) {
            businessDays++;
            if (businessDays === n) break;
        }
        date.setDate(date.getDate() + 1);
    }
    return date;
}

/**
 * Retorna o último dia útil do mês
 */
function getLastBusinessDayOfMonth(year, month) {
    const lastDay = new Date(year, month + 1, 0); // Último dia do mês
    let d = new Date(lastDay);
    while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() - 1);
    }
    return d;
}

/**
 * Atualiza os reminders do Dominium.html com os dados do Tax Agenda
 */
function updateTaxReminders() {
    try {
        // Verificar se o dashboard está visível
        const dashboardContainer = document.querySelector('.dashboard-container');
        if (!dashboardContainer || dashboardContainer.style.display === 'none') {
            console.log('⏭️ Dashboard não está visível, pulando atualização de reminders');
            return;
        }
        
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        const monthAbbr = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        
        const reminders = {};
        
        // 1. Envio de Impostos: Sempre dia 15, se cair em final de semana ou feriado, prorrogar para o próximo dia útil
        // Sem referência de apuração (apenas vencimento)
        const envioImpostosVencimento = new Date(currentYear, currentMonth, 15);
        const envioImpostosDate = getNextBusinessDay(envioImpostosVencimento);
        reminders.envio_impostos = {
            title: `Envio de Impostos`,
            dueDate: `${String(envioImpostosDate.getDate()).padStart(2, '0')}/${String(envioImpostosDate.getMonth() + 1).padStart(2, '0')}/${envioImpostosDate.getFullYear()}`,
            description: `Vencimento: ${String(envioImpostosDate.getDate()).padStart(2, '0')}/${String(envioImpostosDate.getMonth() + 1).padStart(2, '0')}/${envioImpostosDate.getFullYear()}`
        };
        
        // 2. ICMS ST: Sempre dia 20, se cair em final de semana ou feriado, prorrogar para o próximo dia útil
        // Referente à apuração do mês anterior
        const icmsVencimento = new Date(currentYear, currentMonth, 20);
        const icmsDate = getNextBusinessDay(icmsVencimento);
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        const apuracaoMonth = monthNames[prevMonth];
        const apuracaoMonthAbbr = monthAbbr[prevMonth];
        reminders.icms = {
            title: `ICMS ST - Apuração ${apuracaoMonthAbbr}/${prevYear}`,
            dueDate: `${String(icmsDate.getDate()).padStart(2, '0')}/${String(icmsDate.getMonth() + 1).padStart(2, '0')}/${icmsDate.getFullYear()}`,
            description: `Escrituração Fiscal Digital ICMS/IPI - Apuração: ${apuracaoMonth}/${prevYear} | Vencimento: ${String(icmsDate.getDate()).padStart(2, '0')}/${String(icmsDate.getMonth() + 1).padStart(2, '0')}/${icmsDate.getFullYear()}`
        };
        
        // 3. DIRBI: Sempre dia 20, independente de feriado ou final de semana
        // Referente à apuração do mês anterior
        const dirbiVencimento = new Date(currentYear, currentMonth, 20);
        reminders.dirbi = {
            title: `DIRBI - Apuração ${apuracaoMonthAbbr}/${prevYear}`,
            dueDate: `${String(dirbiVencimento.getDate()).padStart(2, '0')}/${String(dirbiVencimento.getMonth() + 1).padStart(2, '0')}/${dirbiVencimento.getFullYear()}`,
            description: `Declaração de Incentivos, Renúncias, Benefícios e Imunidades - Apuração: ${apuracaoMonth}/${prevYear} | Vencimento: ${String(dirbiVencimento.getDate()).padStart(2, '0')}/${String(dirbiVencimento.getMonth() + 1).padStart(2, '0')}/${dirbiVencimento.getFullYear()}`
        };
        
        // 4. DCTFWeb: Último dia útil do mês atual
        // Referente à apuração do mês anterior
        const dctfDate = getLastBusinessDayOfMonth(currentYear, currentMonth);
        reminders.dctfweb = {
            title: `DCTFWeb - Apuração ${apuracaoMonthAbbr}/${prevYear}`,
            dueDate: `${String(dctfDate.getDate()).padStart(2, '0')}/${String(dctfDate.getMonth() + 1).padStart(2, '0')}/${dctfDate.getFullYear()}`,
            description: `Declaração de Débitos e Créditos Tributários Federais - Apuração: ${apuracaoMonth}/${prevYear} | Vencimento: ${String(dctfDate.getDate()).padStart(2, '0')}/${String(dctfDate.getMonth() + 1).padStart(2, '0')}/${dctfDate.getFullYear()}`
        };
    
        // Atualizar os elementos HTML dos reminders
        const remindersContainer = document.querySelector('.reminders');
        if (!remindersContainer) {
            console.warn('⚠️ Container de reminders não encontrado');
            return;
        }
    
        // Atualizar ICMS ST
        const icmsNotification = remindersContainer.querySelector('.notification-icms');
        if (icmsNotification && reminders.icms) {
            const titleElement = icmsNotification.querySelector('h3');
            const dateElement = icmsNotification.querySelector('.text_muted');
            if (titleElement) titleElement.textContent = reminders.icms.title;
            if (dateElement) dateElement.textContent = `Vencimento: ${reminders.icms.dueDate}`;
            // Verificar se está vencido
            const dueDateParts = reminders.icms.dueDate.split('/');
            const dueDate = new Date(parseInt(dueDateParts[2]), parseInt(dueDateParts[1]) - 1, parseInt(dueDateParts[0]));
            if (dueDate < today) {
                icmsNotification.classList.remove('deactive');
            } else {
                icmsNotification.classList.add('deactive');
            }
        }
    
        // Atualizar Envio de Impostos
        const envioNotification = remindersContainer.querySelector('.notification-envio');
        if (envioNotification && reminders.envio_impostos) {
            const titleElement = envioNotification.querySelector('h3');
            const dateElement = envioNotification.querySelector('.text_muted');
            if (titleElement) titleElement.textContent = reminders.envio_impostos.title;
            if (dateElement) dateElement.textContent = `Vencimento: ${reminders.envio_impostos.dueDate}`;
            // Verificar se está vencido
            const dueDateParts = reminders.envio_impostos.dueDate.split('/');
            const dueDate = new Date(parseInt(dueDateParts[2]), parseInt(dueDateParts[1]) - 1, parseInt(dueDateParts[0]));
            if (dueDate < today) {
                envioNotification.classList.remove('deactive');
            } else {
                envioNotification.classList.add('deactive');
            }
        }
    
        // Atualizar DIRBI
        const dirbiNotification = remindersContainer.querySelector('.notification-dirbi');
        if (dirbiNotification && reminders.dirbi) {
            const titleElement = dirbiNotification.querySelector('h3');
            const dateElement = dirbiNotification.querySelector('.text_muted');
            if (titleElement) titleElement.textContent = reminders.dirbi.title;
            if (dateElement) dateElement.textContent = `Vencimento: ${reminders.dirbi.dueDate}`;
            // Verificar se está vencido
            const dueDateParts = reminders.dirbi.dueDate.split('/');
            const dueDate = new Date(parseInt(dueDateParts[2]), parseInt(dueDateParts[1]) - 1, parseInt(dueDateParts[0]));
            if (dueDate < today) {
                dirbiNotification.classList.remove('deactive');
            } else {
                dirbiNotification.classList.add('deactive');
            }
        }
    
        // Atualizar DCTFWeb
        const dctfwebNotification = remindersContainer.querySelector('.notification-dctfweb');
        if (dctfwebNotification && reminders.dctfweb) {
            const titleElement = dctfwebNotification.querySelector('h3');
            const dateElement = dctfwebNotification.querySelector('.text_muted');
            if (titleElement) titleElement.textContent = reminders.dctfweb.title;
            if (dateElement) dateElement.textContent = `Vencimento: ${reminders.dctfweb.dueDate}`;
            // Verificar se está vencido
            const dueDateParts = reminders.dctfweb.dueDate.split('/');
            const dueDate = new Date(parseInt(dueDateParts[2]), parseInt(dueDateParts[1]) - 1, parseInt(dueDateParts[0]));
            if (dueDate < today) {
                dctfwebNotification.classList.remove('deactive');
            } else {
                dctfwebNotification.classList.add('deactive');
            }
        }
    
        console.log('✅ Reminders atualizados com dados do Tax Agenda');
    } catch (error) {
        console.error('❌ Erro ao atualizar reminders:', error);
    }
}

// Função auxiliar para atualizar reminders com segurança (deve ser definida após updateTaxReminders)
function safeUpdateTaxReminders() {
    try {
        // Verificar se a função existe
        if (typeof updateTaxReminders !== 'function') {
            console.warn('⚠️ updateTaxReminders não está disponível ainda');
            return;
        }
        
        // Verificar se o dashboard está visível
        const dashboardContainer = document.querySelector('.dashboard-container');
        if (!dashboardContainer || dashboardContainer.style.display === 'none') {
            return;
        }
        
        // Verificar se o container de reminders existe
        const remindersContainer = document.querySelector('.reminders');
        if (!remindersContainer) {
            return;
        }
        
        updateTaxReminders();
    } catch (error) {
        console.error('❌ Erro em safeUpdateTaxReminders:', error);
    }
}

// Inicializar reminders quando o dashboard estiver visível
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Aguardar o dashboard estar visível
        setTimeout(() => {
            safeUpdateTaxReminders();
        }, 1000);
    });
} else {
    // Verificar se o dashboard já está visível
    setTimeout(() => {
        safeUpdateTaxReminders();
    }, 500);
}

// Atualizar reminders quando o dashboard for exibido (com proteção)
// Aguardar um pouco para garantir que navigateTo foi exposta
setTimeout(() => {
    const originalNavigateTo = window.navigateTo;
    if (originalNavigateTo && typeof originalNavigateTo === 'function') {
        window.navigateTo = function(page) {
            try {
                originalNavigateTo(page);
                // Atualizar reminders após navegação
                setTimeout(() => {
                    if (typeof safeUpdateTaxReminders === 'function') {
                        safeUpdateTaxReminders();
                    }
                }, 500);
            } catch (error) {
                console.error('❌ Erro em navigateTo:', error);
                // Em caso de erro, tentar chamar a função original sem atualizar reminders
                try {
                    originalNavigateTo(page);
                } catch (e) {
                    console.error('❌ Erro crítico em navigateTo:', e);
                }
            }
        };
    } else {
        console.warn('⚠️ navigateTo não está disponível para sobrescrever');
    }
}, 100);

// Expor funções globalmente
window.updateTaxReminders = updateTaxReminders;
window.safeUpdateTaxReminders = safeUpdateTaxReminders;

// ==================== FIM SISTEMA DE REMINDERS DO TAX AGENDA ====================