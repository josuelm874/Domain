//------------------------------------ SISTEMA PRINCIPAL ----------------------------------------//
(function() {
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
    function logout() {
        try {
            console.log('🔄 Iniciando processo de logout...');
            
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
                
                // Limpar campos de login (mas manter credenciais se "Lembrar de mim" estiver ativo)
                const savedUsername = localStorage.getItem('savedUsername');
                const savedPassword = localStorage.getItem('savedPassword');
                
                if (loginPassword) loginPassword.value = '';
                if (adminUsername) adminUsername.value = '';
                if (adminPassword) adminPassword.value = '';
                
                // Recarregar credenciais salvas se existirem
                if (savedUsername && loginUsername) {
                    loginUsername.value = savedUsername;
                } else if (loginUsername) {
                    loginUsername.value = '';
                }
                
                // Se houver password salvo, marcar checkbox
                if (rememberMeCheckbox) {
                    rememberMeCheckbox.checked = !!(savedPassword);
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
        return formatDate(date);
    }

    // Função para tentar login automático com credenciais salvas
    const attemptAutoLogin = (username, password) => {
        if (!username || !password) return false;
        
        // Verificar usuários cadastrados dinamicamente
        const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        const user = registeredUsers.find(u => u.username === username.toLowerCase());
        
        if (!user) {
            // Verificar se é admin
            if (username.toLowerCase() === 'adm') {
                return false; // Admin precisa fazer login manual
            }
            return false;
        }
        
        // Verificar senha
        const hashedPassword = generateUltraSecureHash(password);
        if (user.password !== hashedPassword) {
            // Senha incorreta, remover credenciais salvas
            localStorage.removeItem('savedUsername');
            localStorage.removeItem('savedPassword');
            return false;
        }
        
        // Login bem-sucedido!
        currentUser = user.username;
        window.currentUser = user.username;
        
        // Esconder login container completamente
        if (loginContainer) {
            loginContainer.style.display = 'none';
            loginContainer.style.visibility = 'hidden';
            loginContainer.classList.add('hidden');
        }
        
        // Mostrar dashboard container
        if (dashboardContainer) {
            dashboardContainer.style.display = 'block';
            dashboardContainer.style.visibility = 'visible';
            console.log('✅ Dashboard container mostrado (auto-login)');
            // Atualizar reminders após auto-login (com segurança)
            setTimeout(() => {
                if (typeof safeUpdateTaxReminders === 'function') {
                    safeUpdateTaxReminders();
                }
            }, 1000);
        } else {
            console.error('❌ Dashboard container não encontrado! (auto-login)');
        }
        
        // Aguardar um frame para garantir que o DOM foi atualizado
        requestAnimationFrame(() => {
            loadUserPreferences();
            navigateTo('dashboard');
        });
        
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
        }
        
        console.log('✅ Login automático realizado com sucesso para:', username);
        return true;
    };

    // Carregar credenciais salvas e tentar login automático (igual ao Chat.html)
    const loadSavedCredentialsAndAutoLogin = () => {
        // Re-buscar elementos para garantir que estão disponíveis
        const usernameInput = document.querySelector('#login-username');
        const rememberCheckbox = document.querySelector('#rememberMe');
        
        const savedUsername = localStorage.getItem('savedUsername');
        const savedPassword = localStorage.getItem('savedPassword');
        const hasSavedCredentials = !!(savedUsername && savedPassword);
        
        if (hasSavedCredentials) {
            // Tentar login automático
            console.log('🔄 Tentando login automático com credenciais salvas...');
            const success = attemptAutoLogin(savedUsername, savedPassword);
            if (!success) {
                // Login automático falhou, preencher campos para login manual
                if (usernameInput) {
                    usernameInput.value = savedUsername;
                }
                if (rememberCheckbox) {
                    rememberCheckbox.checked = true;
                }
                console.log('⚠️ Login automático falhou, campos preenchidos para login manual');
            }
        } else {
            // Não há credenciais salvas, apenas preencher username se existir
            if (savedUsername && usernameInput) {
                usernameInput.value = savedUsername;
            }
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:380',message:'handleLogin called',data:{hasLoginUsername:!!loginUsername,hasLoginPassword:!!loginPassword},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        if (!loginUsername || !loginPassword) return;
        
        const username = loginUsername.value.trim().toLowerCase();
        const password = loginPassword.value.trim();
        
        // CRÍTICO: Se localStorage estiver vazio, tentar carregar do Supabase primeiro
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
            const hashedPassword = generateUltraSecureHash(password);
            if (user.password === hashedPassword) {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:393',message:'Login validated successfully',data:{username:username},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                // Salvar ou remover credenciais baseado no checkbox (igual ao Chat.html)
                const rememberMe = rememberMeCheckbox?.checked || false;
                if (rememberMe) {
                    localStorage.setItem('savedUsername', username);
                    localStorage.setItem('savedPassword', password);
                    console.log('Credenciais salvas para lembrar:', username);
                } else {
                    localStorage.removeItem('savedUsername');
                    localStorage.removeItem('savedPassword');
                }
                
                currentUser = user.username;
                window.currentUser = user.username;
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:410',message:'About to call showDashboardAfterLogin',data:{currentUser:currentUser,hasShowDashboardAfterLogin:typeof showDashboardAfterLogin==='function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
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
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:442',message:'Validating admin login directly',data:{username:username},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            // Validar login de administrador diretamente no mesmo handle
            const hashedPassword = generateUltraSecureHash(password);
            const adminHash = "fmAvLiwiJztcXVs/Pjw6fH17K18pKComXiUkI0AhNDA0eXRpcnVjZVNuaW1kQX5gLy4sIic7XF1bPz48Onx9eytfKSgqJl4lJCNAIW1ldHN5U2F0ZUJtdWluaW1vRH5gLy4sIic7XF1bPz48Onx9eytfKSgqJl4lJCNAITQyMDJnb3JQZXVzb0o9WVdiQlpIVHBkWGFLcEhkamhsVno5Q1VxZG5ObWhVTTNzVU00QTNTRDlXYllsV1ZybEVNQmhtVEVGRU1saGxVd05tYldwbVdXNVVkaGRWTXJGRlZ4b2xWeW8wUVh0R2FWTjJSU2xWV1ZSM2RUZGtVeEYyUjRkVlpxeEdSV2hsUnJKMmExUVhZR1psVE5OalRXUkZWU0pVVHg0VVJQWkZacGQxVjRobFZ1cDBjU1ZWTURGMlJ4VWxVWGQzZGFWRU40SlZNdmxIVnJSV2FSTkRhSWRGYnJGVFl5SVZWalpFWk9sbFZ3TkhWVlIzVE5aa1c1Rm1Sa2RWWXRKbGNXWkZjelpGYlpkbldFNWtWVFZFY1hsbE1vdG1VWFpWV1cxV01vTldNS0puVnN4V1lOZGtSd1JtUms5VVRGcEZkVngyWXhZbFZTWmpUSFIzVldabFN6WlZWTmhuVlZGRFVXcG1RVlpWTUtoVldXaDJhUzFtVmFkVmI0bDJVd1VUZFdabFdIVkdiRzltV0dabFRaZGxVelZsYmt0bVVXcFZXUnBtVFZWbE1TSlhWeFEyU1dGalNvRm1SYWRWWnRSR1NXRkRadkptUldsMFZzcDFVbFJFYTBaRk1rZFhUV0psY1I1R2NwNWtWd05YV1dSV1lpWmtWWWRWYjRkVlY2WkVTWkZEWmhaVmJLTlZZR2hHV090R2NYZDFWc2RsVlZGalNUcG1Sb1ZsTVJoM1ZZWjBWTmRsVVlwVlJXdDJVRnBGU1p0R2RURkdiYWgzVnRSWFZYeFdTNGxGVk9GV1RYWmtka1prVlZkRlJWZG5WVlZ6VlN4R2M2UlZieGMxVXlnMlZXTlRUeDBrUldWMVZ0UkhXWlpsV1hsbGJvSmxWc3BGTmlKRGVYWkZWV1JuVndnMlNTMW1Tb1ZsYUNwbFV4QTNjV0pEZWhKMVZLbGtZR3BsVGlOalUwWkZiYU5rVkhaRlZrZFVNWVJsZUZkWFZzcDBkaXhtV0hkRmJhcFZWeEEzY1dabFJQMUViSmhIVlVaa1ZrVjFiM2xWTXd0bVlHcFVVWDFHZVROMk1DVm5WWUoxVU5KalJ2UjJSeGdWWkdCM1ZVaEZaUGRsUlNkbFVySjFWWFJrVklsVk1rTmxVeDRVZGlWRWFYZDFSbmxuVnMxRWVpWlZXNE5WVmFkbFV5STFWWHRtVkxKbFZrZGxXRVprYU9aRWN6UlZWa2RrVUdwbGVqWmtXYUZHU29SblY2WjBjTlZWTUVSbGFHZDFVR2xGZWFaa1NYSm1SV0ZsVXNSMlVTMVdVNlpsVm9ObFlzcDFiWHRtV28xVVJ3aEVWVmxETk5aRWJHcFZSa3htVklGa2VYUmxVUDFrVktGMlVySlZZbFZsUlpaVlZ4OFVZc0pWV2FSa1JUUkZNS1YxVnVwMFFUZGtUeU4xYVNsR1ZzbFVlWlZGWlRKR2JrVlhUV0pWVVNSRmJZbGxiQkZqVnlVRWVOZFZNU0ptUktsMVZXSjFjTkpUVDNaRmJrbFdZRlYwZFRkRmRXRm1Wb1JuWXc0RVRqUjBaNE5sZWpoM1VIbGxNa0pEY1J4ME1PZDFWSDVFTWx0R2N3Um1NczFFWnJaRWRhZFdQOW8wYnpWWFpRSjNibkpETXlRVElBTkNKbDRsSnFnU0tmdHllOXhuTzg0elBiMUZYN2NpSXM0eUxnNUhSdjFXYXVsV2R0SlVaMEYyVTVOSGRsMVdJQU5DSmw0bEpxZ1NLZnR5ZTl4bk84NHpQYjFGWDdjaUlzNHlMZzVYUWsxV2F1TlZaalZuY3BSWGUwQUROaEEwSWtVaVhtb0NLcDgxSzcxSGY2d2pQL3NWWGN0ekppd2lMdkFtZg==";
            
            // Verificar se a senha é a senha de administrador
            if (hashedPassword === adminHash) {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:446',message:'Admin password validated - calling showDashboardAfterLogin',data:{currentUser:'adm'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                currentUser = 'adm';
                window.currentUser = 'adm';
                
                // Salvar ou remover credenciais baseado no checkbox
                const rememberMe = rememberMeCheckbox?.checked || false;
                if (rememberMe) {
                    localStorage.setItem('savedUsername', username);
                    localStorage.setItem('savedPassword', password);
                    console.log('Credenciais salvas para lembrar:', username);
                } else {
                    localStorage.removeItem('savedUsername');
                    localStorage.removeItem('savedPassword');
                }
                
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
                // Verificar se é um usuário administrador cadastrado
                const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
                const adminUser = registeredUsers.find(u => u.control === 'administrador' && u.password === hashedPassword);
                
                if (adminUser) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:476',message:'Admin user found and validated',data:{username:adminUser.username},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    currentUser = adminUser.username;
                    window.currentUser = adminUser.username;
                    
                    // Salvar ou remover credenciais baseado no checkbox
                    const rememberMe = rememberMeCheckbox?.checked || false;
                    if (rememberMe) {
                        localStorage.setItem('savedUsername', adminUser.username);
                        localStorage.setItem('savedPassword', password);
                    } else {
                        localStorage.removeItem('savedUsername');
                        localStorage.removeItem('savedPassword');
                    }
                    
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

    // Função de hash extremamente seguro para senha admin
    window.generateUltraSecureHash = function(input) {
        // Salt único e complexo (múltiplas camadas)
        const salt1 = "JosueProg2024!@#$%^&*()_+{}|:<>?[]\\;'\",./`~";
        const salt2 = "DominiumBetaSystem!@#$%^&*()_+{}|:<>?[]\\;'\",./`~";
        const salt3 = "AdminSecurity404!@#$%^&*()_+{}|:<>?[]\\;'\",./`~";
        
        // Múltiplas camadas de hash com salt
        let hash = input;
        
        // Primeira camada: Hash com salt1
        hash = hash + salt1;
        hash = hash.split('').reverse().join('');
        hash = btoa(hash);
        
        // Segunda camada: Hash com salt2
        hash = hash + salt2;
        hash = hash.split('').reverse().join('');
        hash = btoa(hash);
        
        // Terceira camada: Hash com salt3
        hash = hash + salt3;
        hash = hash.split('').reverse().join('');
        hash = btoa(hash);
        
        // Quarta camada: Hash com salt1 novamente
        hash = hash + salt1;
        hash = hash.split('').reverse().join('');
        hash = btoa(hash);
        
        // Quinta camada: Hash com salt2 novamente
        hash = hash + salt2;
        hash = hash.split('').reverse().join('');
        hash = btoa(hash);
        
        // Sexta camada: Hash com salt3 novamente
        hash = hash + salt3;
        hash = hash.split('').reverse().join('');
        hash = btoa(hash);
        
        // Sétima camada: Hash com todos os salts combinados
        hash = hash + salt1 + salt2 + salt3;
        hash = hash.split('').reverse().join('');
        hash = btoa(hash);
        
        // Oitava camada: Hash final com todos os salts combinados
        hash = hash + salt1 + salt2 + salt3;
        hash = hash.split('').reverse().join('');
        hash = btoa(hash);
        
        return hash;
    }

    function handleAdminLogin() {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:514',message:'handleAdminLogin called',data:{hasAdminPassword:!!adminPassword},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        if (!adminPassword) return;
        
        const password = adminPassword.value.trim();
        const hashedPassword = generateUltraSecureHash(password);
        const adminHash = "fmAvLiwiJztcXVs/Pjw6fH17K18pKComXiUkI0AhNDA0eXRpcnVjZVNuaW1kQX5gLy4sIic7XF1bPz48Onx9eytfKSgqJl4lJCNAIW1ldHN5U2F0ZUJtdWluaW1vRH5gLy4sIic7XF1bPz48Onx9eytfKSgqJl4lJCNAITQyMDJnb3JQZXVzb0o9WVdiQlpIVHBkWGFLcEhkamhsVno5Q1VxZG5ObWhVTTNzVU00QTNTRDlXYllsV1ZybEVNQmhtVEVGRU1saGxVd05tYldwbVdXNVVkaGRWTXJGRlZ4b2xWeW8wUVh0R2FWTjJSU2xWV1ZSM2RUZGtVeEYyUjRkVlpxeEdSV2hsUnJKMmExUVhZR1psVE5OalRXUkZWU0pVVHg0VVJQWkZacGQxVjRobFZ1cDBjU1ZWTURGMlJ4VWxVWGQzZGFWRU40SlZNdmxIVnJSV2FSTkRhSWRGYnJGVFl5SVZWalpFWk9sbFZ3TkhWVlIzVE5aa1c1Rm1Sa2RWWXRKbGNXWkZjelpGYlpkbldFNWtWVFZFY1hsbE1vdG1VWFpWV1cxV01vTldNS0puVnN4V1lOZGtSd1JtUms5VVRGcEZkVngyWXhZbFZTWmpUSFIzVldabFN6WlZWTmhuVlZGRFVXcG1RVlpWTUtoVldXaDJhUzFtVmFkVmI0bDJVd1VUZFdabFdIVkdiRzltV0dabFRaZGxVelZsYmt0bVVXcFZXUnBtVFZWbE1TSlhWeFEyU1dGalNvRm1SYWRWWnRSR1NXRkRadkptUldsMFZzcDFVbFJFYTBaRk1rZFhUV0psY1I1R2NwNWtWd05YV1dSV1lpWmtWWWRWYjRkVlY2WkVTWkZEWmhaVmJLTlZZR2hHV090R2NYZDFWc2RsVlZGalNUcG1Sb1ZsTVJoM1ZZWjBWTmRsVVlwVlJXdDJVRnBGU1p0R2RURkdiYWgzVnRSWFZYeFdTNGxGVk9GV1RYWmtka1prVlZkRlJWZG5WVlZ6VlN4R2M2UlZieGMxVXlnMlZXTlRUeDBrUldWMVZ0UkhXWlpsV1hsbGJvSmxWc3BGTmlKRGVYWkZWV1JuVndnMlNTMW1Tb1ZsYUNwbFV4QTNjV0pEZWhKMVZLbGtZR3BsVGlOalUwWkZiYU5rVkhaRlZrZFVNWVJsZUZkWFZzcDBkaXhtV0hkRmJhcFZWeEEzY1dabFJQMUViSmhIVlVaa1ZrVjFiM2xWTXd0bVlHcFVVWDFHZVROMk1DVm5WWUoxVU5KalJ2UjJSeGdWWkdCM1ZVaEZaUGRsUlNkbFVySjFWWFJrVklsVk1rTmxVeDRVZGlWRWFYZDFSbmxuVnMxRWVpWlZXNE5WVmFkbFV5STFWWHRtVkxKbFZrZGxXRVprYU9aRWN6UlZWa2RrVUdwbGVqWmtXYUZHU29SblY2WjBjTlZWTUVSbGFHZDFVR2xGZWFaa1NYSm1SV0ZsVXNSMlVTMVdVNlpsVm9ObFlzcDFiWHRtV28xVVJ3aEVWVmxETk5aRWJHcFZSa3htVklGa2VYUmxVUDFrVktGMlVySlZZbFZsUlpaVlZ4OFVZc0pWV2FSa1JUUkZNS1YxVnVwMFFUZGtUeU4xYVNsR1ZzbFVlWlZGWlRKR2JrVlhUV0pWVVNSRmJZbGxiQkZqVnlVRWVOZFZNU0ptUktsMVZXSjFjTkpUVDNaRmJrbFdZRlYwZFRkRmRXRm1Wb1JuWXc0RVRqUjBaNE5sZWpoM1VIbGxNa0pEY1J4ME1PZDFWSDVFTWx0R2N3Um1NczFFWnJaRWRhZFdQOW8wYnpWWFpRSjNibkpETXlRVElBTkNKbDRsSnFnU0tmdHllOXhuTzg0elBiMUZYN2NpSXM0eUxnNUhSdjFXYXVsV2R0SlVaMEYyVTVOSGRsMVdJQU5DSmw0bEpxZ1NLZnR5ZTl4bk84NHpQYjFGWDdjaUlzNHlMZzVYUWsxV2F1TlZaalZuY3BSWGUwQUROaEEwSWtVaVhtb0NLcDgxSzcxSGY2d2pQL3NWWGN0ekppd2lMdkFtZg==";
        
        // Verificar usuários cadastrados com privilégios de administrador
        const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        const adminUser = registeredUsers.find(u => u.control === 'administrador' && u.password === hashedPassword);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:522',message:'Admin password validation',data:{passwordLength:password.length,hashedMatchesAdminHash:hashedPassword===adminHash,hasAdminUser:!!adminUser},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        if (hashedPassword === adminHash) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:525',message:'Admin password validated - calling showDashboardAfterLogin',data:{currentUser:'adm'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
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
    function createDashboardContentManually() {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:821',message:'createDashboardContentManually ENTRY',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        console.log('🔧 Criando conteúdo do dashboard manualmente...');
        const mainContent = document.querySelector('#main-content');
        if (!mainContent) {
            console.error('❌ #main-content não encontrado para criação manual');
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:826',message:'Main content not found in createDashboardContentManually',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            setTimeout(() => createDashboardContentManually(), 100);
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
            fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:843',message:'Dashboard content created',data:{innerHTMLLength:mainContent.innerHTML.length,hasH1:mainContent.innerHTML.includes('<h1>'),hasGrid:mainContent.innerHTML.includes('dashboard-grid')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            console.log('✅ Conteúdo do dashboard criado manualmente com sucesso!');
        } catch (e) {
            console.error('❌ Erro ao criar conteúdo manualmente:', e);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:848',message:'ERROR creating dashboard content',data:{errorMessage:e.message,errorStack:e.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
        }
    }

    // FUNÇÃO CENTRALIZADA PARA MOSTRAR DASHBOARD APÓS LOGIN
    function showDashboardAfterLogin() {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:640',message:'showDashboardAfterLogin ENTRY',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        console.log('🚀 ========== INICIANDO showDashboardAfterLogin ==========');
        
        // PASSO 1: Esconder completamente o login
        const loginContainer = document.querySelector('.login-container');
        const adminLoginContainer = document.querySelector('#admin-login-container');
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:648',message:'Login containers found',data:{hasLoginContainer:!!loginContainer,hasAdminLoginContainer:!!adminLoginContainer,loginDisplay:loginContainer?loginContainer.style.display:'N/A',loginVisible:loginContainer?window.getComputedStyle(loginContainer).display:'N/A'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
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
            fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:658',message:'Login container hidden',data:{display:loginContainer.style.display,visibility:loginContainer.style.visibility,computedDisplay:window.getComputedStyle(loginContainer).display},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
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
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:672',message:'Dashboard container query',data:{found:!!dashboardContainer,display:dashboardContainer?dashboardContainer.style.display:'N/A',computedDisplay:dashboardContainer?window.getComputedStyle(dashboardContainer).display:'N/A',offsetParent:dashboardContainer?dashboardContainer.offsetParent:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        if (!dashboardContainer) {
            console.error('❌ Dashboard container não encontrado!');
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:675',message:'Dashboard container NOT FOUND - RETRY',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
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
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:685',message:'Dashboard styles set',data:{inlineDisplay:dashboardContainer.style.display,computedDisplay:computedStyle.display,inlineVisibility:dashboardContainer.style.visibility,computedVisibility:computedStyle.visibility,opacity:computedStyle.opacity,zIndex:computedStyle.zIndex,offsetParent:!!dashboardContainer.offsetParent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
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
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:697',message:'Main content query',data:{found:!!mainContent,innerHTMLLength:mainContent?mainContent.innerHTML.length:0,innerHTMLPreview:mainContent?mainContent.innerHTML.substring(0,50):'N/A'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        if (mainContent) {
            if (!mainContent.innerHTML || mainContent.innerHTML.trim() === '' || mainContent.innerHTML.includes('<!-- Conteúdo será gerado')) {
                console.log('📝 Criando conteúdo do dashboard imediatamente...');
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:702',message:'Creating dashboard content manually',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                // #endregion
                createDashboardContentManually();
            } else {
                console.log('✅ Conteúdo já existe no dashboard');
            }
        } else {
            console.warn('⚠️ #main-content não encontrado, tentando novamente...');
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:708',message:'Main content NOT FOUND - retry',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
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
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:801',message:'navigateTo called',data:{page:page},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        console.log('🧭 Navegando para:', page);
        
        // Verificar se o dashboard está visível
        const dashboardContainer = document.querySelector('.dashboard-container');
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a36192c5-06f5-4bd5-8eaf-728fb36035f1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app.js:806',message:'navigateTo dashboard check',data:{found:!!dashboardContainer,display:dashboardContainer?dashboardContainer.style.display:'N/A',computedDisplay:dashboardContainer?window.getComputedStyle(dashboardContainer).display:'N/A'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
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
                        if (typeof getLastBusinessDayOfMonth === 'function') {
                            const lastDay = getLastBusinessDayOfMonth();
                            dctfwebDueDate = formatDate(lastDay);
                        }
                    } catch (e) {
                        console.warn('⚠️ Erro ao calcular DCTFWeb due date:', e);
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
        else if (page === 'icms-withholding') {
            createIcmsWithholdingPage(mainContent);
        }
        else if (page === 'dae') {
            mainContent.innerHTML = `
                <h1>DAE</h1>
                <div class="dae-box animate-section" style="animation-delay: 0s; width: 100%; max-width: 800px; height: 400px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding);">
                </div>
            `;
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
                                <p>Gerenciar produtos CEST 0300300 e 2899900</p>
                            </div>
                        </div>
                    </div>
                    <div class="box animate-section" style="animation-delay: 0.15s"></div>
                    <div class="box animate-section" style="animation-delay: 0.2s"></div>
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

        // Função para verificar senha
        function verifyPassword() {
            const password = passwordInput.value.trim();
            if (!password) {
                errorMsg.textContent = 'Por favor, digite a senha.';
                errorMsg.style.display = 'block';
                return;
            }
            
            const hashedPassword = generateUltraSecureHash(password);
            const adminHash = "fmAvLiwiJztcXVs/Pjw6fH17K18pKComXiUkI0AhNDA0eXRpcnVjZVNuaW1kQX5gLy4sIic7XF1bPz48Onx9eytfKSgqJl4lJCNAIW1ldHN5U2F0ZUJtdWluaW1vRH5gLy4sIic7XF1bPz48Onx9eytfKSgqJl4lJCNAITQyMDJnb3JQZXVzb0o9WVdiQlpIVHBkWGFLcEhkamhsVno5Q1VxZG5ObWhVTTNzVU00QTNTRDlXYllsV1ZybEVNQmhtVEVGRU1saGxVd05tYldwbVdXNVVkaGRWTXJGRlZ4b2xWeW8wUVh0R2FWTjJSU2xWV1ZSM2RUZGtVeEYyUjRkVlpxeEdSV2hsUnJKMmExUVhZR1psVE5OalRXUkZWU0pVVHg0VVJQWkZacGQxVjRobFZ1cDBjU1ZWTURGMlJ4VWxVWGQzZGFWRU40SlZNdmxIVnJSV2FSTkRhSWRGYnJGVFl5SVZWalpFWk9sbFZ3TkhWVlIzVE5aa1c1Rm1Sa2RWWXRKbGNXWkZjelpGYlpkbldFNWtWVFZFY1hsbE1vdG1VWFpWV1cxV01vTldNS0puVnN4V1lOZGtSd1JtUms5VVRGcEZkVngyWXhZbFZTWmpUSFIzVldabFN6WlZWTmhuVlZGRFVXcG1RVlpWTUtoVldXaDJhUzFtVmFkVmI0bDJVd1VUZFdabFdIVkdiRzltV0dabFRaZGxVelZsYmt0bVVXcFZXUnBtVFZWbE1TSlhWeFEyU1dGalNvRm1SYWRWWnRSR1NXRkRadkptUldsMFZzcDFVbFJFYTBaRk1rZFhUV0psY1I1R2NwNWtWd05YV1dSV1lpWmtWWWRWYjRkVlY2WkVTWkZEWmhaVmJLTlZZR2hHV090R2NYZDFWc2RsVlZGalNUcG1Sb1ZsTVJoM1ZZWjBWTmRsVVlwVlJXdDJVRnBGU1p0R2RURkdiYWgzVnRSWFZYeFdTNGxGVk9GV1RYWmtka1prVlZkRlJWZG5WVlZ6VlN4R2M2UlZieGMxVXlnMlZXTlRUeDBrUldWMVZ0UkhXWlpsV1hsbGJvSmxWc3BGTmlKRGVYWkZWV1JuVndnMlNTMW1Tb1ZsYUNwbFV4QTNjV0pEZWhKMVZLbGtZR3BsVGlOalUwWkZiYU5rVkhaRlZrZFVNWVJsZUZkWFZzcDBkaXhtV0hkRmJhcFZWeEEzY1dabFJQMUViSmhIVlVaa1ZrVjFiM2xWTXd0bVlHcFVVWDFHZVROMk1DVm5WWUoxVU5KalJ2UjJSeGdWWkdCM1ZVaEZaUGRsUlNkbFVySjFWWFJrVklsVk1rTmxVeDRVZGlWRWFYZDFSbmxuVnMxRWVpWlZXNE5WVmFkbFV5STFWWHRtVkxKbFZrZGxXRVprYU9aRWN6UlZWa2RrVUdwbGVqWmtXYUZHU29SblY2WjBjTlZWTUVSbGFHZDFVR2xGZWFaa1NYSm1SV0ZsVXNSMlVTMVdVNlpsVm9ObFlzcDFiWHRtV28xVVJ3aEVWVmxETk5aRWJHcFZSa3htVklGa2VYUmxVUDFrVktGMlVySlZZbFZsUlpaVlZ4OFVZc0pWV2FSa1JUUkZNS1YxVnVwMFFUZGtUeU4xYVNsR1ZzbFVlWlZGWlRKR2JrVlhUV0pWVVNSRmJZbGxiQkZqVnlVRWVOZFZNU0ptUktsMVZXSjFjTkpUVDNaRmJrbFdZRlYwZFRkRmRXRm1Wb1JuWXc0RVRqUjBaNE5sZWpoM1VIbGxNa0pEY1J4ME1PZDFWSDVFTWx0R2N3Um1NczFFWnJaRWRhZFdQOW8wYnpWWFpRSjNibkpETXlRVElBTkNKbDRsSnFnU0tmdHllOXhuTzg0elBiMUZYN2NpSXM0eUxnNUhSdjFXYXVsV2R0SlVaMEYyVTVOSGRsMVdJQU5DSmw0bEpxZ1NLZnR5ZTl4bk84NHpQYjFGWDdjaUlzNHlMZzVYUWsxV2F1TlZaalZuY3BSWGUwQUROaEEwSWtVaVhtb0NLcDgxSzcxSGY2d2pQL3NWWGN0ekppd2lMdkFtZg==";
            
            if (hashedPassword === adminHash) {
                // Senha correta - carregar Analytics
                modal.classList.add('fade-out');
                setTimeout(() => {
                    modal.remove();
                    loadAnalyticsContent(mainContent);
                }, 400);
            } else {
                // Senha incorreta
                errorMsg.textContent = 'Senha incorreta. Tente novamente.';
                errorMsg.style.display = 'block';
                passwordInput.value = '';
                passwordInput.focus();
            }
        }

        // Event listener para ENTER
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                verifyPassword();
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
                        <div class="cest-column left-column">
                            <div class="cest-section">
                                <h3>CEST - 0300300</h3>
                                <div class="input-group">
                                    <input type="text" id="cest-0300300-input" placeholder="Digite o produto">
                                    <button onclick="addCestProduct('0300300')" class="add-btn">
                                        <span class="material-icons-sharp">add</span>
                                    </button>
                                </div>
                                <div class="product-list" id="cest-0300300-list">
                                    <!-- Produtos serão carregados aqui -->
                                </div>
                            </div>
                        </div>
                        
                        <div class="cest-column right-column">
                            <div class="cest-section">
                                <h3>CEST - 2899900</h3>
                                <div class="input-group">
                                    <input type="text" id="cest-2899900-input" placeholder="Digite o produto">
                                    <button onclick="addCestProduct('2899900')" class="add-btn">
                                        <span class="material-icons-sharp">add</span>
                                    </button>
                                </div>
                                <div class="product-list" id="cest-2899900-list">
                                    <!-- Produtos serão carregados aqui -->
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
        
        // Carregar dados salvos
        loadCestData();
        
        // Adicionar evento para fechar ao clicar fora
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                saveCestData(); // Salvar automaticamente antes de fechar
                closeCestModal();
            }
        });
        
        // Adicionar eventos de Enter para os inputs
        const input0300300 = modal.querySelector('#cest-0300300-input');
        const input2899900 = modal.querySelector('#cest-2899900-input');
        
        if (input0300300) {
            input0300300.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addCestProduct('0300300');
                }
            });
        }
        
        if (input2899900) {
            input2899900.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addCestProduct('2899900');
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
    
    // Separar produtos por vírgula e limpar espaços
    const productNames = inputValue.split(',').map(name => name.trim()).filter(name => name.length > 0);
    
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
    const cest0300300 = JSON.parse(localStorage.getItem('cest_0300300') || '[]');
    const cest2899900 = JSON.parse(localStorage.getItem('cest_2899900') || '[]');
    
    // Carregar CEST 0300300
    const list0300300 = document.getElementById('cest-0300300-list');
    if (list0300300) {
        list0300300.innerHTML = '';
        cest0300300.forEach(product => {
            const productItem = document.createElement('div');
            productItem.className = 'product-item';
            productItem.innerHTML = `
                <span class="product-name">${product}</span>
                <button onclick="removeCestProduct('0300300', this)" class="remove-btn">
                    <span class="material-icons-sharp">delete</span>
                </button>
            `;
            list0300300.appendChild(productItem);
        });
    }
    
    // Carregar CEST 2899900
    const list2899900 = document.getElementById('cest-2899900-list');
    if (list2899900) {
        list2899900.innerHTML = '';
        cest2899900.forEach(product => {
            const productItem = document.createElement('div');
            productItem.className = 'product-item';
            productItem.innerHTML = `
                <span class="product-name">${product}</span>
                <button onclick="removeCestProduct('2899900', this)" class="remove-btn">
                    <span class="material-icons-sharp">delete</span>
                </button>
            `;
            list2899900.appendChild(productItem);
        });
    }
}

// Função para salvar dados CEST
function saveCestData() {
    // Salvar CEST 0300300
    const list0300300 = document.getElementById('cest-0300300-list');
    if (list0300300) {
        const products0300300 = Array.from(list0300300.querySelectorAll('.product-name')).map(item => item.textContent);
        localStorage.setItem('cest_0300300', JSON.stringify(products0300300));
    }
    
    // Salvar CEST 2899900
    const list2899900 = document.getElementById('cest-2899900-list');
    if (list2899900) {
        const products2899900 = Array.from(list2899900.querySelectorAll('.product-name')).map(item => item.textContent);
        localStorage.setItem('cest_2899900', JSON.stringify(products2899900));
    }
    
    // Atualizar arrays globais para uso no SPED
    updateCestArrays();
}

// Função para atualizar arrays globais de CEST
function updateCestArrays() {
    const cest0300300 = JSON.parse(localStorage.getItem('cest_0300300') || '[]');
    const cest2899900 = JSON.parse(localStorage.getItem('cest_2899900') || '[]');
    
    // Atualizar arrays globais (se existirem)
    if (window.cests1) {
        window.cests1 = cest0300300.map(item => item.trim().toUpperCase());
    }
    if (window.cests2) {
        window.cests2 = cest2899900.map(item => item.trim().toUpperCase());
    }
}

// Função para exportar backup dos CEST
function exportCestBackup() {
    try {
        const cest0300300 = JSON.parse(localStorage.getItem('cest_0300300') || '[]');
        const cest2899900 = JSON.parse(localStorage.getItem('cest_2899900') || '[]');
        
        const backupData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            cest0300300: cest0300300,
            cest2899900: cest2899900,
            totalProducts: cest0300300.length + cest2899900.length
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
                
                // Validar estrutura do backup
                if (!backupData.cest0300300 || !backupData.cest2899900) {
                    alert('Arquivo de backup inválido. Estrutura de dados incorreta.');
                    return;
                }
                
                // Carregar produtos existentes
                const existingCest0300300 = JSON.parse(localStorage.getItem('cest_0300300') || '[]');
                const existingCest2899900 = JSON.parse(localStorage.getItem('cest_2899900') || '[]');
                
                // Filtrar produtos novos (que não existem)
                const newCest0300300 = backupData.cest0300300.filter(product => 
                    !existingCest0300300.includes(product)
                );
                const newCest2899900 = backupData.cest2899900.filter(product => 
                    !existingCest2899900.includes(product)
                );
                
                // Combinar produtos existentes com novos
                const finalCest0300300 = [...existingCest0300300, ...newCest0300300];
                const finalCest2899900 = [...existingCest2899900, ...newCest2899900];
                
                // Salvar no localStorage
                localStorage.setItem('cest_0300300', JSON.stringify(finalCest0300300));
                localStorage.setItem('cest_2899900', JSON.stringify(finalCest2899900));
                
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
let icmsModeloFile = null;

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
            await window.supabaseSync.syncAll(['users', 'registeredUsers', 'contributorContacts']);
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
    mainContent.innerHTML = `
        <h1>ICMS Withholding</h1>
        <div class="icms-withholding-container" style="display: flex; flex-direction: column; gap: 1.6rem; max-width: 1200px; margin: 0 auto; padding: 2rem;">
            <!-- Status do Modelo Excel (carregado automaticamente) -->
            <div class="box animate-section" style="animation-delay: 0s; width: 100%; max-width: 800px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding);">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--color-dark);">Arquivo Modelo Excel:</label>
                <p id="icms-modelo-info" style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--color-dark-variant);">
                    <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem;">hourglass_empty</span>
                    Carregando modelo Excel...
                </p>
            </div>
            
            <!-- Box de Upload de XMLs -->
            <div class="box animate-section icms-xml-box" style="animation-delay: 0s; width: 100%; max-width: 800px; height: 300px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center;" id="icms-xml-box">
                <span class="material-icons-sharp" style="font-size: 3rem; color: var(--color-primary); margin-bottom: 1rem;">cloud_upload</span>
                <span class="box-label" id="icms-xml-label" style="font-size: 1.2rem; font-weight: 600; color: var(--color-dark); margin-bottom: 0.5rem;">Arraste e solte os arquivos XML aqui</span>
                <span style="font-size: 0.9rem; color: var(--color-dark-variant);">ou clique para selecionar múltiplos arquivos</span>
                <input type="file" id="icms-xml-input" accept=".xml" multiple style="display: none;">
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
    const icmsXmlBox = document.getElementById('icms-xml-box');
    const icmsXmlInput = document.getElementById('icms-xml-input');
    const icmsXmlLabel = document.getElementById('icms-xml-label');
    const icmsXmlInfo = document.getElementById('icms-xml-info');
    const icmsXmlCount = document.getElementById('icms-xml-count');
    const icmsXmlList = document.getElementById('icms-xml-list');
    const icmsProcessBtn = document.getElementById('icms-process-btn');
    const icmsStatus = document.getElementById('icms-status');
    const icmsStatusText = document.getElementById('icms-status-text');
    
    // Carregar automaticamente a planilha modelo do caminho fixo
    async function carregarModeloExcel() {
        try {
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem;">hourglass_empty</span>
                Carregando modelo Excel...
            `;
            icmsModeloInfo.style.color = 'var(--color-dark-variant)';
            
            // Caminho fixo da planilha modelo
            const caminhoModelo = 'assets/js/ICMS ST.xlsx';
            
            console.log('Carregando modelo Excel de:', caminhoModelo);
            
            // Fazer fetch do arquivo
            const response = await fetch(caminhoModelo);
            if (!response.ok) {
                throw new Error(`Erro ao carregar modelo: ${response.status} ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            
            // Carregar com XLSX para leitura (compatibilidade)
            icmsModeloWorkbook = XLSX.read(arrayBuffer, { type: 'array' });
            
            // Carregar com ExcelJS para preservar formatações
            if (typeof ExcelJS !== 'undefined') {
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(arrayBuffer);
                icmsModeloExcelJS = workbook;
                console.log('✅ Modelo ExcelJS carregado automaticamente:', caminhoModelo, 'Abas:', workbook.worksheets.map(ws => ws.name));
            }
            
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem; color: var(--color-success);">check_circle</span>
                <span>✓ Modelo carregado automaticamente: ICMS ST.xlsx</span>
            `;
            icmsModeloInfo.style.color = 'var(--color-success)';
            console.log('✅ Modelo Excel carregado automaticamente:', caminhoModelo, 'Abas:', icmsModeloWorkbook.SheetNames);
            
        } catch (error) {
            icmsModeloInfo.innerHTML = `
                <span class="material-icons-sharp" style="font-size: 1rem; vertical-align: middle; margin-right: 0.25rem; color: var(--color-danger);">error</span>
                <span>Erro ao carregar modelo: ${error.message}</span>
            `;
            icmsModeloInfo.style.color = 'var(--color-danger)';
            console.error('❌ Erro ao carregar modelo Excel automaticamente:', error);
            console.error('   Verifique se o arquivo existe em: assets/js/ICMS ST.xlsx');
        }
    }
    
    // Carregar modelo automaticamente quando a página for criada
    carregarModeloExcel();

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
        const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.xml'));
        if (files.length > 0) {
            handleIcmsXmlFiles(files);
        } else {
            alert('Por favor, selecione arquivos XML');
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
        
        icmsProcessBtn.disabled = false;
        console.log(`${files.length} arquivo(s) XML selecionado(s)`);
    }

    icmsProcessBtn.addEventListener('click', async () => {
        if (icmsXmlFiles.length === 0) {
            alert('Por favor, selecione pelo menos um arquivo XML');
            return;
        }
        
        if (!icmsModeloWorkbook || !icmsModeloExcelJS) {
            alert('O modelo Excel ainda não foi carregado. Aguarde alguns instantes ou verifique se o arquivo "ICMS ST.xlsx" existe em assets/js/');
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
            icmsProcessBtn.disabled = false;
        }
    });
}

// Função para processar XMLs e gerar planilha
async function processIcmsXmls() {
    const statusText = document.getElementById('icms-status-text');
    
    // Verificar se o modelo já foi carregado
    if (!icmsModeloWorkbook || !icmsModeloExcelJS) {
        throw new Error('Modelo Excel não foi carregado. Por favor, selecione o arquivo modelo primeiro.');
    }
    
    const modeloWorkbook = icmsModeloWorkbook;
    const modeloExcelJS = icmsModeloExcelJS;
    
    statusText.textContent = 'Extraindo dados dos XMLs...';
    
    // Estrutura para agrupar produtos conforme código Python
    const produtosPorGrupo = {
        "Aliquota 1,54%": [],
        "Aliquota 4%": [],
        "Aliquota 7%": []
    };
    const cnpjs = [];
    const periodos = [];
    const razoesSociais = [];

    // Processar cada XML
    let xmlsProcessados = 0;
    let xmlsIgnorados = 0;
    
    for (let i = 0; i < icmsXmlFiles.length; i++) {
        const file = icmsXmlFiles[i];
        statusText.textContent = `Processando ${i + 1}/${icmsXmlFiles.length}: ${file.name}...`;
        
        try {
            const xmlText = await readFileAsText(file);
            const { cnpj, periodo, razaoSocial, resultados } = extrairDadosFiltrados(xmlText);
            
            console.log(`XML ${i + 1}: ${file.name}`);
            console.log(`  - CNPJ: ${cnpj || 'não encontrado'}`);
            console.log(`  - Período: ${periodo || 'não encontrado'}`);
            console.log(`  - Razão Social: ${razaoSocial || 'não encontrada'}`);
            
            // Agrupar produtos por grupo (conforme código Python)
            let produtosEncontrados = 0;
            for (const [grupo, produtos] of Object.entries(resultados || {})) {
                if (produtos && produtos.length > 0) {
                    produtosPorGrupo[grupo] = produtosPorGrupo[grupo] || [];
                    produtosPorGrupo[grupo].push(...produtos);
                    produtosEncontrados += produtos.length;
                    console.log(`  - ${grupo}: ${produtos.length} produtos`);
                }
            }
            
            if (produtosEncontrados > 0) {
                xmlsProcessados++;
            } else {
                console.warn(`  - ⚠️ Nenhum produto encontrado neste XML`);
                xmlsIgnorados++;
            }
            
            // Adicionar CNPJ, período e razão social (se encontrados)
            if (cnpj && cnpj.trim()) {
                cnpjs.push(cnpj.trim());
            }
            
            if (periodo && periodo.trim()) {
                periodos.push(periodo.trim());
            }
            
            if (razaoSocial && razaoSocial.trim()) {
                razoesSociais.push(razaoSocial.trim());
            }
        } catch (error) {
            console.error(`Erro ao processar ${file.name}:`, error);
            xmlsIgnorados++;
        }
    }
    
    console.log(`\n=== RESUMO DO PROCESSAMENTO ===`);
    console.log(`XMLs processados: ${xmlsProcessados}, ignorados: ${xmlsIgnorados}`);
    console.log(`CNPJs coletados: ${cnpjs.length}, Períodos coletados: ${periodos.length}, Razões Sociais: ${razoesSociais.length}`);
    console.log(`Produtos por grupo:`);
    for (const [grupo, produtos] of Object.entries(produtosPorGrupo)) {
        console.log(`  - ${grupo}: ${produtos.length} produtos`);
    }

    // Encontrar CNPJ mais comum
    let cnpjFinal = "";
    if (cnpjs.length > 0) {
        const cnpjCount = {};
        cnpjs.forEach(c => {
            cnpjCount[c] = (cnpjCount[c] || 0) + 1;
        });
        cnpjFinal = Object.keys(cnpjCount).reduce((a, b) => cnpjCount[a] > cnpjCount[b] ? a : b);
        console.log(`CNPJ selecionado: ${cnpjFinal} (apareceu ${cnpjCount[cnpjFinal]} vezes)`);
    }

    // Encontrar período mais comum
    let periodo = "";
    if (periodos.length > 0) {
        const periodoCount = {};
        periodos.forEach(p => {
            periodoCount[p] = (periodoCount[p] || 0) + 1;
        });
        periodo = Object.keys(periodoCount).reduce((a, b) => periodoCount[a] > periodoCount[b] ? a : b);
        console.log(`Período selecionado: ${periodo} (apareceu ${periodoCount[periodo]} vezes)`);
    }

    // Verificar se há produtos para processar
    const totalProdutos = produtosPorGrupo["Aliquota 1,54%"].length + 
                          produtosPorGrupo["Aliquota 4%"].length + 
                          produtosPorGrupo["Aliquota 7%"].length;
    
    if (totalProdutos === 0) {
        throw new Error('Nenhum produto foi encontrado nos XMLs processados após aplicar os filtros (UF=23, CFOP válidos, CST/CSOSN).');
    }

    // Normalizar razão social (conforme código Python)
    let razaoSocialFinal = "";
    if (razoesSociais.length > 0) {
        // Normalizar cada razão social
        function normalizar(nome) {
            nome = nome.toUpperCase().trim();
            nome = nome.replace(/[-–—]\s*ME$/i, '');
            nome = nome.replace(/\s{2,}/g, ' ');
            return nome;
        }
        
        // TODO: Usar biblioteca de razões sociais se disponível (BIBLIOTECA_RAZOES)
        const razoesNormalizadas = razoesSociais.map(razao => normalizar(razao));
        
        // Encontrar a mais comum
        const razaoCount = {};
        razoesNormalizadas.forEach(razao => {
            razaoCount[razao] = (razaoCount[razao] || 0) + 1;
        });
        razaoSocialFinal = Object.keys(razaoCount).reduce((a, b) => razaoCount[a] > razaoCount[b] ? a : b);
        console.log(`Razão social selecionada: ${razaoSocialFinal} (apareceu ${razaoCount[razaoSocialFinal]} vezes)`);
    }
    
    if (!razaoSocialFinal || !periodo) {
        throw new Error('Não foi possível extrair a razão social ou a data de apuração dos XMLs.');
    }

    // Formatar CNPJ (XX.XXX.XXX/XXXX-XX) - usar o mais comum ou "N/A" se não houver
    let cnpjFormatado = "N/A";
    if (cnpjFinal) {
        cnpjFormatado = cnpjFinal.replace(/\D/g, '');
        if (cnpjFormatado.length === 14) {
            cnpjFormatado = cnpjFormatado.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
        }
    }
    
    // Usar período mais comum ou data atual se não houver
    if (!periodo) {
        const hoje = new Date();
        periodo = `${String(hoje.getMonth() + 1).padStart(2, '0')}-${hoje.getFullYear()}`;
    }
    
    console.log(`\n=== DADOS FINAIS ===`);
    console.log(`CNPJ formatado: ${cnpjFormatado}`);
    console.log(`Período: ${periodo}`);
    console.log(`Razão Social: ${razaoSocialFinal}`);
    console.log(`Total de produtos: ${totalProdutos}`);

    statusText.textContent = 'Preenchendo planilha...';
    
    // CRÍTICO: Usar ExcelJS para preservar COMPLETAMENTE todas as formatações
    // A melhor forma é clonar o workbook inteiro usando writeBuffer e readBuffer
    // Isso preserva TUDO automaticamente
    const modelBuffer = await modeloExcelJS.xlsx.writeBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(modelBuffer);
    
    console.log('✅ Workbook ExcelJS clonado preservando todas as formatações, estilos, cores e fórmulas');
    
    // Manter código XLSX para compatibilidade (não será usado para escrita)
    const wb = XLSX.utils.book_new();
    
    // Encontrar primeiro a aba principal no modelo original
    let nomeAbaPrincipal = null;
    for (const sheetName of modeloWorkbook.SheetNames) {
        if (sheetName.includes('ICMS ST') || sheetName.includes('1104')) {
            nomeAbaPrincipal = sheetName;
            break;
        }
    }
    
    // Se não encontrou, usar a primeira aba
    if (!nomeAbaPrincipal && modeloWorkbook.SheetNames.length > 0) {
        nomeAbaPrincipal = modeloWorkbook.SheetNames[0];
    }
    
    if (!nomeAbaPrincipal) {
        throw new Error('Não foi possível encontrar a aba principal na planilha modelo.');
    }
    
    console.log(`Aba principal selecionada: "${nomeAbaPrincipal}"`);
    console.log('Todas as abas disponíveis:', modeloWorkbook.SheetNames);
    
    // Copiar todas as abas do modelo preservando COMPLETAMENTE toda a estrutura
    // Usar uma função auxiliar para clonar profundamente células preservando tudo
    function cloneCell(cell) {
        if (!cell) return null;
        const cloned = {};
        // Copiar TODAS as propriedades da célula (preservar propriedades especiais)
        for (const key in cell) {
            if (cell.hasOwnProperty(key)) {
                const value = cell[key];
                if (value !== null && value !== undefined) {
                    if (typeof value === 'object' && !Array.isArray(value)) {
                        // Objetos (como 's' para estilos) - clonar profundamente
                        try {
                            cloned[key] = JSON.parse(JSON.stringify(value));
                        } catch (e) {
                            cloned[key] = value; // Se falhar, manter referência
                        }
                    } else if (Array.isArray(value)) {
                        cloned[key] = JSON.parse(JSON.stringify(value));
                    } else {
                        cloned[key] = value;
                    }
                } else {
                    cloned[key] = value;
                }
            }
        }
        // Garantir propriedades padrão do XLSX.js (v, t, f, r, h, c, z, l, s, w)
        const propsPadrao = ['v', 't', 'f', 'r', 'h', 'c', 'z', 'l', 's', 'w'];
        propsPadrao.forEach(prop => {
            if (cell[prop] !== undefined && cloned[prop] === undefined) {
                if (typeof cell[prop] === 'object' && cell[prop] !== null) {
                    try {
                        cloned[prop] = JSON.parse(JSON.stringify(cell[prop]));
                    } catch (e) {
                        cloned[prop] = cell[prop];
                    }
                } else {
                    cloned[prop] = cell[prop];
                }
            }
        });
        return cloned;
    }
    
    // CRÍTICO: Usar método mais direto para copiar worksheets preservando TUDO
    // Usar XLSX.utils.sheet_to_json e XLSX.utils.aoa_to_sheet pode perder formatações
    // Vamos usar uma cópia direta célula por célula preservando todas as propriedades
    for (const sheetName of modeloWorkbook.SheetNames) {
        const originalSheet = modeloWorkbook.Sheets[sheetName];
        
        // Criar um novo worksheet copiando diretamente usando método que preserva melhor
        // Copiar todas as propriedades usando Object.assign e clonagem profunda
        const newSheet = {};
        
        // Passo 1: Copiar todas as propriedades do worksheet (!ref, !merges, !cols, !rows, etc)
        for (const key in originalSheet) {
            if (originalSheet.hasOwnProperty(key) && key.startsWith('!')) {
                const prop = originalSheet[key];
                if (prop !== null && prop !== undefined) {
                    if (Array.isArray(prop)) {
                        // Clonar arrays profundamente
                        newSheet[key] = prop.map(item => {
                            if (typeof item === 'object' && item !== null) {
                                return JSON.parse(JSON.stringify(item));
                            }
                            return item;
                        });
                    } else if (typeof prop === 'object') {
                        // Clonar objetos profundamente
                        newSheet[key] = JSON.parse(JSON.stringify(prop));
                    } else {
                        // Copiar valores primitivos diretamente
                        newSheet[key] = prop;
                    }
                } else {
                    newSheet[key] = prop;
                }
            }
        }
        
        // Passo 2: Copiar TODAS as células preservando COMPLETAMENTE cada uma
        // Usar um loop sobre todas as chaves (células e propriedades)
        for (const key in originalSheet) {
            if (originalSheet.hasOwnProperty(key) && !key.startsWith('!')) {
                // Esta é uma célula - clonar completamente
                const cell = originalSheet[key];
                if (cell && typeof cell === 'object') {
                    // Clonar profundamente a célula preservando TODAS as propriedades
                    newSheet[key] = cloneCell(cell);
                }
            }
        }
        
        XLSX.utils.book_append_sheet(wb, newSheet, sheetName);
    }
    
    console.log('✅ Estrutura da planilha modelo preservada (formatações, merges, colunas, linhas, fórmulas, estilos, cores)');
    
    // MAPEAMENTO DE ABAS conforme código Python
    // MAPEAMENTO_ABAS_CELULAS = {
    //     "1,54%.txt": ("Aliquota 1,54%", "D2"),
    //     "4%.txt": ("Aliquota 4%", "D2"),
    //     "7%.txt": ("Aliquota 7%", "D2"),
    // }
    const MAPEAMENTO_ABAS = {
        "Aliquota 1,54%": "D2",
        "Aliquota 4%": "D2",
        "Aliquota 7%": "D2"
    };
    
    console.log(`\n=== CONFIGURAÇÃO DE PREENCHIMENTO ===`);
    console.log(`Total de produtos por grupo:`);
    for (const [grupo, produtos] of Object.entries(produtosPorGrupo)) {
        console.log(`  - ${grupo}: ${produtos.length} produtos`);
    }
    
    // Preencher cabeçalho na aba "ICMS ST 1104" (conforme código Python)
    // aba_icms["C3"] = razao_social
    // aba_icms["C5"] = datetime.strptime(periodo, "%m-%Y")
    // aba_icms["C5"].number_format = "mmm-yy"
    const abaPrincipal = workbook.getWorksheet(nomeAbaPrincipal);
    if (abaPrincipal) {
        console.log(`\n=== PREENCHENDO CABEÇALHO NA ABA "${nomeAbaPrincipal}" ===`);
        
        // C3 = Razão Social
        const cellC3 = abaPrincipal.getCell('C3');
        if (!cellC3.formula) { // CRÍTICO: Não alterar se tiver fórmula
            // Preservar formatação original ANTES de alterar o valor
            let styleCloneC3 = null;
            if (cellC3.style) {
                try {
                    styleCloneC3 = JSON.parse(JSON.stringify(cellC3.style));
                } catch (e) {
                    styleCloneC3 = {
                        fill: cellC3.fill ? JSON.parse(JSON.stringify(cellC3.fill)) : undefined,
                        font: cellC3.font ? JSON.parse(JSON.stringify(cellC3.font)) : undefined,
                        border: cellC3.border ? JSON.parse(JSON.stringify(cellC3.border)) : undefined,
                        alignment: cellC3.alignment ? JSON.parse(JSON.stringify(cellC3.alignment)) : undefined
                    };
                }
            }
            
            cellC3.value = razaoSocialFinal;
            
            // Restaurar estilo original se existia
            if (styleCloneC3) {
                try {
                    if (styleCloneC3.fill) cellC3.fill = styleCloneC3.fill;
                    if (styleCloneC3.font) cellC3.font = styleCloneC3.font;
                    if (styleCloneC3.border) cellC3.border = styleCloneC3.border;
                    if (styleCloneC3.alignment) cellC3.alignment = styleCloneC3.alignment;
                } catch (e) {
                    console.warn(`⚠️ Erro ao restaurar estilo da célula C3:`, e);
                }
            }
            
            console.log(`  C3 = "${razaoSocialFinal}"`);
        } else {
            console.warn(`  ⚠️ C3 tem fórmula, não foi alterado`);
        }
        
        // C5 = Período (formato data)
        const cellC5 = abaPrincipal.getCell('C5');
        if (!cellC5.formula) { // CRÍTICO: Não alterar se tiver fórmula
            // Preservar formatação original ANTES de alterar o valor
            const numFmtOriginal = cellC5.numFmt;
            const styleOriginal = cellC5.style ? JSON.parse(JSON.stringify(cellC5.style)) : null;
            
            // Converter período (MM-YYYY) para data
            const [mes, ano] = periodo.split('-');
            const dataPeriodo = new Date(parseInt(ano), parseInt(mes) - 1, 1);
            cellC5.value = dataPeriodo;
            
            // Restaurar formatação original se existia (NÃO alterar se já tinha formatação)
            if (numFmtOriginal) {
                cellC5.numFmt = numFmtOriginal;
            }
            // NÃO definir numFmt se não existia - deixar como está no modelo
            
            // Restaurar estilo original se existia
            if (styleOriginal) {
                Object.assign(cellC5.style, styleOriginal);
            }
            
            console.log(`  C5 = ${periodo} (formato preservado: ${cellC5.numFmt || 'original'})`);
        } else {
            console.warn(`  ⚠️ C5 tem fórmula, não foi alterado`);
        }
    } else {
        console.warn(`⚠️ Aba principal "${nomeAbaPrincipal}" não encontrada para preencher cabeçalho`);
    }
    
    // Preencher produtos em cada aba específica (conforme código Python)
    console.log(`\n=== PREENCHENDO PRODUTOS NAS ABAS ===`);
    
    for (const [nomeGrupo, produtos] of Object.entries(produtosPorGrupo)) {
        if (!produtos || produtos.length === 0) {
            console.log(`  ⚠️ Nenhum produto para ${nomeGrupo}, pulando...`);
            continue;
        }
        
        // Buscar aba correspondente
        let worksheet = workbook.getWorksheet(nomeGrupo);
        if (!worksheet) {
            // Tentar encontrar aba com nome similar
            const allSheets = workbook.worksheets;
            for (const sheet of allSheets) {
                if (sheet.name.includes('1,54') || (nomeGrupo === "Aliquota 1,54%" && sheet.name.toLowerCase().includes('1'))) {
                    worksheet = sheet;
                    break;
                } else if (sheet.name.includes('4%') || (nomeGrupo === "Aliquota 4%" && sheet.name.toLowerCase().includes('4'))) {
                    worksheet = sheet;
                    break;
                } else if (sheet.name.includes('7%') || (nomeGrupo === "Aliquota 7%" && sheet.name.toLowerCase().includes('7'))) {
                    worksheet = sheet;
                    break;
                }
            }
        }
        
        if (!worksheet) {
            console.warn(`⚠️ Aba "${nomeGrupo}" não encontrada no workbook. Pulando...`);
            continue;
        }
        
        console.log(`\n=== PREENCHENDO ABA: "${worksheet.name}" (Grupo: ${nomeGrupo}) ===`);
        console.log(`Preenchendo ${produtos.length} produtos a partir de D2`);
        
        // Converter "D2" para linha e coluna (ExcelJS usa 1-based)
        const celulaInicial = MAPEAMENTO_ABAS[nomeGrupo] || "D2";
        const colunaLetra = celulaInicial.match(/[A-Z]+/)[0];
        const linhaBase = parseInt(celulaInicial.match(/\d+/)[0]);
        const colunaIndex = colunaLetra.charCodeAt(0) - 64; // A=1, B=2, C=3, D=4
        
        let produtosPreenchidos = 0;
        
        // Preencher produtos usando ExcelJS
        produtos.forEach((produto, indexProduto) => {
            if (!Array.isArray(produto)) {
                console.warn(`⚠️ Produto ${indexProduto} não é um array:`, produto);
                return;
            }
            
            produto.forEach((valor, indexColuna) => {
                const linha = linhaBase + indexProduto;
                const coluna = colunaIndex + indexColuna;
                
                const cell = worksheet.getCell(linha, coluna);
                
                // CRÍTICO: Se a célula tem fórmula, NÃO alterar - preservar fórmula
                if (cell.formula) {
                    // Célula tem fórmula - NÃO TOCAR, preservar completamente
                    return; // Pular células com fórmulas
                }
                
                // CRÍTICO: Preservar TODAS as formatações existentes ANTES de alterar o valor
                // Salvar todas as propriedades de formatação
                const numFmtOriginal = cell.numFmt;
                const typeOriginal = cell.type;
                
                // Salvar estilo completo (deep clone)
                let styleClone = null;
                if (cell.style) {
                    try {
                        styleClone = JSON.parse(JSON.stringify(cell.style));
                    } catch (e) {
                        // Se falhar, tentar copiar propriedades principais
                        styleClone = {
                            fill: cell.fill ? JSON.parse(JSON.stringify(cell.fill)) : undefined,
                            font: cell.font ? JSON.parse(JSON.stringify(cell.font)) : undefined,
                            border: cell.border ? JSON.parse(JSON.stringify(cell.border)) : undefined,
                            alignment: cell.alignment ? JSON.parse(JSON.stringify(cell.alignment)) : undefined,
                            numFmt: cell.numFmt,
                            protection: cell.protection ? JSON.parse(JSON.stringify(cell.protection)) : undefined
                        };
                    }
                }
                
                // Campos numéricos (Frete, Outras, IPI, Valor Produto) - índices 8, 9, 10, 11
                if (indexColuna >= 8 && indexColuna <= 11) {
                    const numVal = parseFloat(String(valor || '0').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
                    
                    // Apenas alterar o valor - ExcelJS preserva formatações automaticamente
                    cell.value = numVal;
                    
                    // CRÍTICO: Restaurar formatação numérica original se existia
                    // NÃO definir nova formatação se não existia
                    if (numFmtOriginal) {
                        cell.numFmt = numFmtOriginal;
                    }
                    
                    // Restaurar estilo completo se existia
                    if (styleClone) {
                        try {
                            // Restaurar propriedades individuais para garantir preservação
                            if (styleClone.fill) cell.fill = styleClone.fill;
                            if (styleClone.font) cell.font = styleClone.font;
                            if (styleClone.border) cell.border = styleClone.border;
                            if (styleClone.alignment) cell.alignment = styleClone.alignment;
                            if (styleClone.protection) cell.protection = styleClone.protection;
                        } catch (e) {
                            console.warn(`⚠️ Erro ao restaurar estilo da célula ${linha},${coluna}:`, e);
                        }
                    }
                } else {
                    // Campos de texto - apenas alterar o valor
                    cell.value = String(valor || '');
                    
                    // Restaurar estilo completo se existia
                    if (styleClone) {
                        try {
                            if (styleClone.fill) cell.fill = styleClone.fill;
                            if (styleClone.font) cell.font = styleClone.font;
                            if (styleClone.border) cell.border = styleClone.border;
                            if (styleClone.alignment) cell.alignment = styleClone.alignment;
                            if (styleClone.protection) cell.protection = styleClone.protection;
                        } catch (e) {
                            console.warn(`⚠️ Erro ao restaurar estilo da célula ${linha},${coluna}:`, e);
                        }
                    }
                }
            });
            produtosPreenchidos++;
            
            // Log a cada 100 produtos
            if ((indexProduto + 1) % 100 === 0) {
                console.log(`  Processados ${indexProduto + 1}/${produtos.length} produtos...`);
            }
        });
        
        console.log(`✅ Aba "${worksheet.name}": ${produtosPreenchidos} produtos preenchidos`);
        console.log(`   Formatações, estilos, cores e fórmulas preservadas automaticamente pelo ExcelJS`);
    }
    
    console.log(`\n✅ PREENCHIMENTO CONCLUÍDO`);
    console.log(`Total de produtos preenchidos por grupo:`);
    for (const [grupo, produtos] of Object.entries(produtosPorGrupo)) {
        console.log(`  - ${grupo}: ${produtos.length} produtos`);
    }

    statusText.textContent = 'Gerando arquivo...';
    
    // Gerar nome do arquivo (conforme código Python)
    // nome_planilha = f"ICMS ST {periodo}_{razao_social}.xlsx"
    const cnpjSemFormatacao = cnpjFinal ? cnpjFinal.replace(/\D/g, '') : 'N/A';
    const nomePlanilha = `ICMS ST ${periodo}_${razaoSocialFinal}.xlsx`;
    
    // CRÍTICO: Salvar usando ExcelJS para preservar todas as formatações
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomePlanilha;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    statusText.textContent = `✅ Planilha gerada com sucesso: ${nomePlanilha}`;
    statusText.style.color = 'var(--color-success)';
    
    // Resetar
    setTimeout(() => {
        icmsXmlFiles = [];
        document.getElementById('icms-xml-label').textContent = 'Arraste e solte os arquivos XML aqui';
        document.getElementById('icms-xml-label').style.color = 'var(--color-dark)';
        document.getElementById('icms-xml-info').style.display = 'none';
        document.getElementById('icms-process-btn').disabled = true;
        document.getElementById('icms-status').style.display = 'none';
    }, 3000);
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
        const rootName = rootElement?.localName || rootElement?.nodeName || '';
        if (rootName.includes('Evento') || rootName.includes('evento')) {
            console.warn('XML é um evento, não uma NF-e. Pulando...');
            return { cnpj: "", periodo: "", resultados: { todos: [] } };
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
            
            // Criar linha do produto
            const linha = [chave, uf, numeroNf, fornecedor, xprod, ncm, cfop, cst || csosn, vFrete, vOutro, vIpi, vprod];
            
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
//--------------------------------------------- DAE ---------------------------------------------//
//------------------------------------------- FIM DAE -------------------------------------------//
//--------------------------------------------- SPED --------------------------------------------//

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

// Função para carregar produtos CEST do localStorage
function getCestProducts() {
    const cest0300300 = JSON.parse(localStorage.getItem('cest_0300300') || '[]');
    const cest2899900 = JSON.parse(localStorage.getItem('cest_2899900') || '[]');
    
    return {
        cests1: cest0300300.map(item => item.trim().toUpperCase()),
        cests2: cest2899900.map(item => item.trim().toUpperCase())
    };
}

async function processSpedFiscal(file, resultsList, progressBar, progressPercentage, totalLines, incrementProcessedLines, handle) {
    return new Promise(async (resolve) => {
        console.log(`Iniciando processamento de ${file.name}`);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                // Carregar produtos CEST do localStorage
                const { cests1, cests2 } = getCestProducts();
                
                const lines = e.target.result.split('\n');
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
                    const fields = rawLine.split('|');
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
                            const normalizedProduct = fields[3].trim().toUpperCase();
                            if (cests1.includes(normalizedProduct)) {
                                fields[13] = '0300300';
                            } else if (cests2.includes(normalizedProduct)) {
                                fields[13] = '2899900';
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

                const blob = new Blob([newLines.join('\n')], { type: 'text/plain;charset=latin1' });
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

                resolve();
            } catch (error) {
                console.warn(`Erro ao processar ${file.name}: ${error.message}`);
                const li = document.createElement('li');
                li.textContent = `[ERRO] ${file.name}: ${error.message}`;
                resultsList.appendChild(li);
                resolve();
            }
        };
        reader.onerror = () => {
            console.warn(`Erro ao ler ${file.name}`);
            const li = document.createElement('li');
            li.textContent = `[ERRO] ${file.name}: Erro de leitura`;
            resultsList.appendChild(li);
            resolve();
        };
        reader.readAsText(file, 'latin1');
    });
}

async function processSpedContribuicao(file, resultsList, progressBar, progressPercentage, totalLines, incrementProcessedLines, handle) {
    return new Promise(async (resolve) => {
        console.log(`Iniciando processamento de ${file.name}`);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const lines = e.target.result.split('\n');
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
                    const fields = rawLine.split('|');
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

                const blob = new Blob([newLines.join('\n')], { type: 'text/plain;charset=latin1' });
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

                resolve();
            } catch (error) {
                console.warn(`Erro ao processar ${file.name}: ${error.message}`);
                const li = document.createElement('li');
                li.textContent = `[ERRO] ${file.name}: ${error.message}`;
                resultsList.appendChild(li);
                resolve();
            }
        };
        reader.onerror = () => {
            console.warn(`Erro ao ler ${file.name}`);
            const li = document.createElement('li');
            li.textContent = `[ERRO] ${file.name}: Erro de leitura`;
            resultsList.appendChild(li);
            resolve();
        };
        reader.readAsText(file, 'latin1');
    });
}

//------------------------------------------- FIM SPED ------------------------------------------
//------------------------------------ Fortes Correction ------------------------------------//

let fortesFileData = null;
let fortesAdjustmentsText = '';

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
            
            <!-- Box Inferior: Textarea para Instruções de Ajuste -->
            <div class="box animate-section fortes-instructions-box" style="animation-delay: 0.1s; width: 100%; max-width: 800px; height: 500px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); display: flex; flex-direction: column;">
                <label for="fortes-adjustments-textarea" style="font-size: 1.1rem; font-weight: 600; color: var(--color-dark); margin-bottom: 1rem;">
                    <span class="material-icons-sharp" style="vertical-align: middle; margin-right: 0.5rem;">edit_note</span>
                    Instruções de Ajuste
                </label>
                <textarea 
                    id="fortes-adjustments-textarea" 
                    placeholder="Cole aqui as linhas de erro do relatório de importação...&#10;&#10;Exemplo de erro de CEST:&#10;0000000885 Valor do campo &quot;Código Especificador da Substituição Tributária - CEST&quot; não é válido (0016214). Campo 41. Registro PRO.&#10;&#10;Exemplo de erro de Quantidade:&#10;0000001498 Valor do campo Quantidade equivalente padrão deve ser maior que zero (0.00). Campo 4. Registro OUM.&#10;&#10;Exemplo de erro de Inscrição Estadual:&#10;0000000051 Inscrição Estadual do participante inválida (63759837). Campo 6. Registro PAR.&#10;&#10;Exemplo de erro de CST:&#10;0000001579 Campo CST(PIS) em branco. Esse campo será necessário para a geração do SPED Fiscal. Campo 38. Registro PNM.&#10;&#10;Exemplo de erro de Duplicidade:&#10;0000001154 Código do Produto(10115) em duplicidade no arquivo. Registro PRO.&#10;&#10;Exemplo de erro de NF1:&#10;0000001795 AIDF não encontrada para o documento (Estab.: 0001; AIDF: ; Espécie: NF1; Série: 2; Subs.: ; Núm./Form.: 0000026).&#10;&#10;Exemplo de erro de Valor Total:&#10;0000007011 Documento:000848622; Data:04/06/2025: Valor Total difere da Base de Cálculo, Isentas e Outras.&#10;&#10;Exemplo de erro de Soma CFOP:&#10;0000012362 A soma dos valores do CFOP 1910 do registro INM (19,77) difere da soma do valor líquido do registro PNM (17,71).&#10;&#10;O sistema irá automaticamente:&#10;- Identificar o tipo de erro&#10;- Localizar a linha e o campo&#10;- Aplicar a correção apropriada&#10;- Atualizar o total de linhas no final do arquivo&#10;&#10;Você pode colar múltiplos erros, um por linha."
                    style="flex: 1; width: 100%; padding: 1rem; border: 2px solid var(--color-light); border-radius: var(--border-radius-1); font-family: 'Poppins', sans-serif; font-size: 0.95rem; color: var(--color-dark); background: var(--color-background); resize: none; outline: none; transition: border-color 0.3s ease;"
                ></textarea>
                <div style="margin-top: 1rem; display: flex; gap: 1rem; justify-content: flex-end;">
                    <button id="fortes-process-btn" class="btn-process" style="padding: 0.75rem 2rem; background: var(--color-primary); color: var(--color-white); border: none; border-radius: var(--border-radius-1); cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 1rem; transition: all 0.3s ease; display: flex; align-items: center; gap: 0.5rem;" disabled>
                        <span class="material-icons-sharp">build</span>
                        Processar Ajustes
                    </button>
                    <button id="fortes-download-btn" class="btn-download" style="padding: 0.75rem 2rem; background: var(--color-success); color: var(--color-white); border: none; border-radius: var(--border-radius-1); cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 1rem; transition: all 0.3s ease; display: flex; align-items: center; gap: 0.5rem; display: none;">
                        <span class="material-icons-sharp">download</span>
                        Baixar Arquivo Corrigido
                    </button>
                </div>
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

    // Monitorar mudanças no textarea
    fortesAdjustmentsTextarea.addEventListener('input', () => {
        fortesAdjustmentsText = fortesAdjustmentsTextarea.value.trim();
        if (fortesFileData && fortesAdjustmentsText) {
            fortesProcessBtn.disabled = false;
        } else {
            fortesProcessBtn.disabled = true;
        }
    });

    // Botão de processar ajustes
    fortesProcessBtn.addEventListener('click', () => {
        if (!fortesFileData) {
            alert('Por favor, carregue um arquivo .fs primeiro.');
            return;
        }
        if (!fortesAdjustmentsText) {
            alert('Por favor, insira as instruções de ajuste.');
            return;
        }
        processFortesAdjustments();
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
        } else {
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

    const blob = new Blob([fortesFileData], { type: 'text/plain;charset=latin1' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FORTES_CORRIGIDO_${new Date().toISOString().slice(0, 10)}.fs`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

//------------------------------------ FIM Fortes Correction ------------------------------------//
//------------------------------------ NFe | CFe Comparasion ------------------------------------//

let sigetData = [];
let fortesData = [];

function createNfeCfeComparisonPage(mainContent) {
    console.log('createNfeCfeComparisonPage chamado');
    mainContent.innerHTML = `
        <h1>NFe | CFe Comparison</h1>
        <div class="nfe-cfe-grid" style="display: flex; flex-direction: column; gap: 1.6rem; max-width: 1200px; margin: 0 auto; padding: 2rem;">
            <div class="box animate-section" style="animation-delay: 0s; width: 100%; max-width: 800px; height: 300px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; align-items: center; justify-content: center;" id="siget-box">
                <span class="box-label" id="siget-label">Siget</span>
                <svg id="siget-check" width="60" height="60" viewBox="0 0 24 24" fill="none" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
                    <path d="M20 6L9 17L4 12" stroke="#00ff00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30" stroke-dashoffset="30"/>
                </svg>
                <input type="file" id="siget-file-input" accept=".txt,.csv,.xls,.xlsx,.xml" multiple style="display: none;">
            </div>
            <div class="box animate-section" style="animation-delay: 0.1s; width: 100%; max-width: 800px; height: 300px; margin: 0 auto; background-color: var(--color-white); border-radius: var(--card-border-radius); box-shadow: var(--box-shadow); padding: var(--card-padding); position: relative; cursor: pointer; display: flex; align-items: center; justify-content: center;" id="fortes-box">
                <span class="box-label" id="fortes-label">Fortes</span>
                <svg id="fortes-check" width="60" height="60" viewBox="0 0 24 24" fill="none" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
                    <path d="M20 6L9 17L4 12" stroke="#00ff00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30" stroke-dashoffset="30"/>
                </svg>
                <input type="file" id="fortes-file-input" accept=".txt,.csv,.xls,.xlsx,.xml" multiple style="display: none;">
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
            console.log('Ambos os boxes processados. Aguardando 3 segundos para abrir modal...');
            setTimeout(() => {
                showComparisonModal();
            }, 3000);
        }
    };

    // Configurar SIGET
    sigetBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        sigetBox.classList.add('dragover');
        console.log('Dragover em SIGET');
    });

    sigetBox.addEventListener('dragleave', () => {
        sigetBox.classList.remove('dragover');
        console.log('Dragleave em SIGET');
    });

    sigetBox.addEventListener('drop', (e) => {
        e.preventDefault();
        sigetBox.classList.remove('dragover');
        console.log('Drop em SIGET');
        const files = e.dataTransfer.files;
        processFiles(files, sigetLabel, sigetCheck, sigetData, () => {
            sigetLoaded = true;
            checkBothLoaded();
        });
    });

    sigetBox.addEventListener('click', () => {
        console.log('Clique em SIGET box');
        sigetFileInput.click();
    });

    sigetFileInput.addEventListener('change', () => {
        console.log('Arquivos selecionados via input em SIGET');
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

    function formatSpreadsheetOrTextValue(value) {
        if (!value) return null;
        const stringValue = String(value).trim().replace(/^R\$\s*/, ''); // Remove "R$" e espaços iniciais
        if (!stringValue) return null;

        const ptBRRegex = /^(\d{1,3}(\.\d{3})*,\d{2})$/;
        if (ptBRRegex.test(stringValue)) {
            return stringValue;
        }

        const cleanedValue = stringValue.replace(',', '.');
        const parsedValue = parseFloat(cleanedValue);
        if (isNaN(parsedValue)) return null;

        return parsedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatFileDate(dateStr) {
        if (!dateStr) return '';
        const [day, month, year] = dateStr.split('/');
        return `${year}-${month}-${day}`;
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
                        numeroNf = ide.getElementsByTagNameNS(nfeNamespace, 'cNF')[0]?.textContent.trim() || '';
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
            reader.onload = async (e) => {
                try {
                    progressText.textContent = 'Processando planilha...';
                    progressBar.style.width = '20%';
                    
                    console.log(`📖 Planilha carregada: ${file.name}`);
                    const workbook = XLSX.read(e.target.result, { 
                        type: 'array',
                        cellDates: false,
                        cellNF: false,
                        cellStyles: false,
                        sheetStubs: false
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
                                                const rawKey = String(cell.v).trim();
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
            reader.readAsArrayBuffer(file);
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
                       file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                       file.type === 'application/vnd.ms-excel') {
                console.log(`📊 Processando planilha: ${file.name}`);
                promises.push(processSpreadsheet(file, dataArray, label, checkSvg));
            } else {
                console.warn(`Arquivo ignorado (não é XML, TXT ou planilha): ${file.name}`);
            }
        }
        Promise.all(promises).then(() => {
            console.log(`Processamento concluído. Dados:`, dataArray);
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
                        Quantidade de NFe | CFe
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
                        Valores de NFe | CFe
                    </div>
                </div>
                <div id="quantidades-tab" class="tab-content">
                    <div class="column">
                        <h4 class="siget-title">
                            Notas presentes no Siget e ausentes no Fortes
                            <span class="column-count" id="siget-count">(0)</span>
                        </h4>
                        <ul id="siget-only-list"></ul>
                    </div>
                    <div class="column">
                        <h4 class="fortes-title">
                            Notas presentes no Fortes e ausentes no Siget
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
            console.log('Reaplicando layout da aba Quantidade');
            targetTab.style.display = 'flex';
            targetTab.style.gap = '2rem';
            console.log('HTML de #quantidades-tab após troca:', targetTab.innerHTML);
            compareLists(); // Re-renderiza para garantir conteúdo atualizado
        }
    }

    function compareLists() {
        console.log('Comparando listas...');
        const sigetKeys = sigetData.map(item => item.key);
        const fortesKeys = fortesData.map(item => item.key);
    
        const sigetSet = new Set(sigetKeys);
        const fortesSet = new Set(fortesKeys);
    
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
                        Notas presentes no Siget e ausentes no Fortes
                        <span class="column-count" id="siget-count">(0)</span>
                    </h4>
                    <ul id="siget-only-list"></ul>
                </div>
                <div class="column">
                    <h4 class="fortes-title">
                        Notas presentes no Fortes e ausentes no Siget
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
    
        console.log('HTML de #quantidades-tab após atualização:', quantidadesTab.innerHTML);
    
        const commonKeys = sigetKeys.filter(key => fortesSet.has(key));
        const fortesHasNoValues = fortesData.every(item => !item.value || item.value === '0,00');
        const valoresTab = document.getElementById('valores-tab');
    
        if (commonKeys.length === 0 || fortesHasNoValues) {
            valoresTab.innerHTML = `<p class="error-message">Informações de Valores Ausentes</p>`;
            console.log('Nenhuma chave comum ou valores ausentes em Fortes. Exibindo mensagem de erro.');
        } else {
            const divergentValues = commonKeys.map(key => {
                const sigetItem = sigetData.find(item => item.key === key);
                const fortesItem = fortesData.find(item => item.key === key);
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
                                <th>Valor do Siget</th>
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

//---------------------------------- FIM NFe | CFe Comparasion ----------------------------------//

// Funções de exportação globais para NFe | CFe Comparison
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
            reportTitle = 'Relatório de Quantidades - NFe | CFe';
        } else if (tabType === 'valores') {
            reportTitle = 'Relatório de Valores - NFe | CFe';
        } else {
            reportTitle = 'Relatório de Comparação NFe | CFe';
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
                doc.setTextColor(0, 100, 0); // Verde para SIGET
                doc.text('SIGET:', sigetX, yPosition);
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
                
                quantidadesData.push(['SIGET - Chaves Exclusivas', 'FORTES - Chaves Exclusivas']);
                
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
                    <h3>Cadastrar Novo Usuário</h3>
                    <form id="user-registration-form">
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
                            <div class="input-group full-width">
                                <div class="input-box">
                                    <input type="password" id="user-password" required>
                                    <label for="user-password">Senha</label>
                                    <i class='bx bxs-lock-alt'></i>
                                </div>
                            </div>
                            <div class="input-group full-width">
                                <div class="input-box">
                                    <input type="password" id="user-confirm-password" required>
                                    <label for="user-confirm-password">Confirmar Senha</label>
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
                            <button type="button" class="btn-cancel" onclick="closeUserRegistrationModal()">Cancelar</button>
                            <button type="submit" class="btn-save">Cadastrar Usuário</button>
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
            <button class="btn-delete" onclick="deleteUser(${user.id})">
                <span class="material-icons-sharp">delete</span>
            </button>
        </div>
    `).join('');
}

// Função para deletar usuário
async function deleteUser(userId) {
    if (!confirm('Tem certeza que deseja deletar este usuário?')) {
        return;
    }

    const users = await loadDataSync('registeredUsers', []);
    const filteredUsers = users.filter(user => user.id !== userId);
    await saveDataSync('registeredUsers', filteredUsers);
    
    // Recarregar lista
    loadUsersList();
    
    alert('Usuário deletado com sucesso!');
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

    const name = document.getElementById('user-name').value.trim();
    const username = document.getElementById('user-username').value.trim().toLowerCase();
    const control = document.getElementById('user-control').value;
    const password = document.getElementById('user-password').value;
    const confirmPassword = document.getElementById('user-confirm-password').value;
    const profileImageInput = document.getElementById('user-profile-image');

    // Validações
    if (!name || !username || !control || !password || !confirmPassword) {
        alert('Todos os campos são obrigatórios.');
        return;
    }

    if (password !== confirmPassword) {
        alert('As senhas não coincidem.');
        return;
    }

    // Verificar se o username já existe (com sincronização)
    const existingUsers = await loadDataSync('registeredUsers', []);
    if (existingUsers.find(user => user.username === username)) {
        alert('Este username já está em uso. Escolha outro.');
        return;
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
            
            // Continuar com o cadastro após processar a imagem
            await completeUserRegistration(name, username, control, password, profileImage);
        };
        reader.onerror = function() {
            alert('Erro ao processar a imagem. Tente novamente.');
        };
        reader.readAsDataURL(file);
    } else {
        // Sem imagem selecionada, usar a imagem padrão
        await completeUserRegistration(name, username, control, password, profileImage);
    }
}

// Função para completar o cadastro do usuário
async function completeUserRegistration(name, username, control, password, profileImage) {
    // Criar hash da senha (usando a mesma função do sistema)
    const hashedPassword = generateUltraSecureHash(password);

    // Obter usuários existentes (com sincronização)
    const existingUsers = await loadDataSync('registeredUsers', []);

    // Criar objeto do usuário
    const newUser = {
        id: Date.now(),
        name: name,
        username: username,
        control: control,
        password: hashedPassword,
        profileImage: profileImage, // Adicionar imagem de perfil
        createdAt: new Date().toISOString(),
        createdBy: window.currentUser
    };

    // Salvar usuário (com sincronização automática)
    existingUsers.push(newUser);
    await saveDataSync('registeredUsers', existingUsers);
    console.log('✅ Usuário salvo e sincronizado:', newUser);

    // Limpar formulário
    document.getElementById('user-name').value = '';
    document.getElementById('user-username').value = '';
    document.getElementById('user-control').value = '';
    document.getElementById('user-password').value = '';
    document.getElementById('user-confirm-password').value = '';
    document.getElementById('user-profile-image').value = '';
    document.getElementById('profile-preview').src = 'assets/images/profile-1.png';

    // Recarregar lista de usuários
    await loadUsersList();

    alert(`Usuário "${name}" cadastrado com sucesso!`);
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
                    <h3>Cadastrar Novo Contribuinte</h3>
                    <form id="contributor-registration-form">
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
                            <button type="button" class="btn-cancel contributor-cancel-btn">Cancelar</button>
                            <button type="submit" class="btn-save">Cadastrar Contribuinte</button>
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
            <button class="btn-delete contributor-delete-btn" data-contributor-id="${safeId}" style="margin-left: 1rem;">
                <span class="material-icons-sharp">delete</span>
            </button>
        </div>
    `;
    }).join('');
    
    // Adicionar event listeners aos botões de delete
    contributorsList.querySelectorAll('.contributor-delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const contributorId = parseInt(this.getAttribute('data-contributor-id'));
            if (contributorId) {
                deleteContributor(contributorId);
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

    // Verificar se o CNPJ já existe (com sincronização)
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

    // Processar senha se fornecida
    let passwordHash = null;
    if (password && password.trim()) {
        passwordHash = generateUltraSecureHash(password);
    }

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

// Tornar funções de contribuintes globalmente acessíveis
window.showContributorRegistrationModal = showContributorRegistrationModal;
window.deleteContributor = deleteContributor;
window.closeContributorRegistrationModal = closeContributorRegistrationModal;
window.clearAllContributors = clearAllContributors;

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