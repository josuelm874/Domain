// harvest-tokens.js — colhe UM token (x-authentication-token) do Ambiente Seguro
// SEFAZ-CE. Um token basta: o download em node baixa NFCe de qualquer empresa e
// filtra por chave. Então: login → primeira empresa da lista → captura 1 JWT →
// grava token.txt.
//
// Login digitado na PÁGINA REAL da SEFAZ (o script nunca vê a senha). Contexto
// efêmero (sempre pede login, nada persistido).
//
// Uso:
//   cd harvester
//   npm i playwright          (usa o Chrome instalado via channel:'chrome')
//   node harvest-tokens.js
//
// Segurança: token.txt contém um JWT vivo (~24h) — trate como segredo, apague
// após usar, adicione ao .gitignore antes de qualquer commit.

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOGIN_URL = 'https://servicos.sefaz.ce.gov.br/internet/acessoseguro/servicosenha/logarusuario/login.asp';
const OUT = path.join(__dirname, 'token.txt');

// Seletores (ajustar no 1º run se o texto do menu divergir por acento):
const SEL = {
    menuMFE:    'text=MFE - Modulo Fiscal Eletronico',
    acessarMFe: 'text=Acessar MFe',
    companyRow: 'a[href^="JavaScript:submete"]',
};

(async () => {
    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    // efêmero: sempre pede login. ignoreHTTPSErrors: o cert da SEFAZ usa CA que
    // o Chromium do Playwright não traz (teu Chrome confia por ter a raiz gov).
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

    // Captura o 1º x-authentication-token que aparecer (dispara no boot do
    // portal-mfe da empresa selecionada). Imune ao modal central.
    let token = '';
    ctx.on('request', (req) => {
        const t = req.headers()['x-authentication-token'];
        if (t && !token) token = t;
    });

    const page = await ctx.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    console.log('\n>> Faça login (usuário, senha, vínculo = Contador) na janela aberta. Aguardando (até 5 min)...\n');
    await page.waitForSelector(SEL.menuMFE, { timeout: 300000 });

    await page.click(SEL.menuMFE);
    await page.click(SEL.acessarMFe);
    await page.waitForSelector(SEL.companyRow);

    // Primeira empresa basta — 1 token baixa NFCe de qualquer uma.
    await page.locator(SEL.companyRow).first().click();

    for (let w = 0; w < 60 && !token; w++) await page.waitForTimeout(500);
    if (!token) {
        console.error('ERRO: token não capturado (o MFe abriu? apareceu o header x-authentication-token?)');
        await browser.close();
        process.exit(1);
    }

    fs.writeFileSync(OUT, token);
    console.log('\ntoken salvo em ' + OUT + '\n');
    console.log(token + '\n');
    await browser.close();
})().catch((e) => { console.error('ERRO:', e && e.message); process.exit(1); });
