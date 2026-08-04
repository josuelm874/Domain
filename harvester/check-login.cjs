/**
 * Revalida o form de login do Ambiente Seguro SEFAZ-CE SEM credencial nenhuma.
 *
 * Responde a pergunta que bloqueia a Task 2 do plano de auto-token: os seletores
 * fixados em harvest-server.js (#txtUsuario / #txtSenha) ainda existem, e apareceu
 * captcha ou federacao gov.br desde a confirmacao de julho/2026?
 *
 * Nao loga, nao digita nada, nao envia formulario — so carrega a pagina e olha.
 */
'use strict';
const { chromium } = require('playwright');

const LOGIN_URL = 'https://servicos.sefaz.ce.gov.br/internet/acessoseguro/servicosenha/logarusuario/login.asp';
const SELETORES = ['#txtUsuario', '#txtSenha'];
const SUSPEITOS = ['recaptcha', 'hcaptcha', 'captcha', 'gov.br', 'sso', 'oauth'];

(async () => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, channel: 'chrome' });
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        const resp = await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

        console.log('HTTP:', resp ? resp.status() : '(sem resposta)');
        console.log('URL final:', page.url());
        console.log('redirecionou?', page.url() === LOGIN_URL ? 'nao' : 'SIM');

        for (const sel of SELETORES) {
            const n = await page.locator(sel).count();
            console.log(sel, n ? 'PRESENTE' : 'AUSENTE');
        }

        // Campos do form, para reconstruir seletores caso algum tenha sumido.
        const campos = await page.$$eval('input, select, button',
            (els) => els.map((e) => `${e.tagName.toLowerCase()}[type=${e.type || '-'}] id=${e.id || '-'} name=${e.name || '-'}`));
        console.log('campos do form:');
        campos.slice(0, 20).forEach((c) => console.log('  ', c));

        const html = (await page.content()).toLowerCase();
        const achados = SUSPEITOS.filter((m) => html.includes(m));
        console.log('marcadores suspeitos:', achados.length ? achados.join(', ') : 'nenhum');
    } catch (e) {
        console.log('FALHA:', e.message);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
    }
})();
