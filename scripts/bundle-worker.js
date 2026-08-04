/**
 * Gera `download/softtech-worker.zip` — o pacote do worker Node que QUALQUER
 * máquina com Node instalado baixa do site (Vercel) e roda para habilitar os
 * fluxos pesados (Baixar NFCe + DIRBI) fora do navegador.
 *
 * Por que existir: o site é estático na Vercel e o `.vercelignore` exclui a
 * pasta `worker/`. Então o worker não vai junto no deploy. Este script empacota
 * o worker (fonte + modelo DIRBI + launchers) num único .zip servido em
 * `download/`, que NÃO é ignorado. Reutiliza o `worker/lib/zip.js` (zero-dep).
 *
 * Rodar:  node scripts/bundle-worker.js
 * Saída:  download/softtech-worker.zip
 *
 * O .zip é commitado (regenerável por este script). Reexecute após mexer no
 * worker para manter o download em sincronia com a fonte.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildZip } = require('../worker/lib/zip');

const ROOT = path.join(__dirname, '..');
const WORKER = path.join(ROOT, 'worker');
const OUT_DIR = path.join(ROOT, 'download');
const OUT_ZIP = path.join(OUT_DIR, 'softtech-worker.zip');

// Arquivos da fonte do worker que entram no pacote (caminho no zip → no disco).
// NÃO inclui node_modules/dist: o launcher roda `npm install` na 1ª vez.
const FILES = [
    ['server.js', 'server.js'],
    ['lib/access.js', 'lib/access.js'],
    ['lib/nfce.js', 'lib/nfce.js'],
    ['lib/nfe.js', 'lib/nfe.js'],
    ['lib/dirbi.js', 'lib/dirbi.js'],
    ['lib/zip.js', 'lib/zip.js'],
    ['DIRBI MES-ANO.xlsx', 'DIRBI MES-ANO.xlsx'],
    ['package.json', 'package.json'],
    ['package-lock.json', 'package-lock.json'],
    ['README.md', 'README.md'],
];

const START_BAT = [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'where node >nul 2>nul || (echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org && pause && exit /b 1)',
    'if not exist node_modules (echo Instalando dependencias ^(primeira vez^)... && call npm install --omit=dev)',
    'echo Subindo worker SoftTech em http://127.0.0.1:47620 ...',
    'echo Deixe esta janela aberta enquanto usa o sistema.',
    'node server.js',
    'pause',
    '',
].join('\r\n');

const START_SH = [
    '#!/usr/bin/env bash',
    'set -e',
    'cd "$(dirname "$0")"',
    'command -v node >/dev/null 2>&1 || { echo "[ERRO] Node.js nao encontrado: https://nodejs.org"; exit 1; }',
    '[ -d node_modules ] || npm install --omit=dev',
    'echo "Subindo worker SoftTech em http://127.0.0.1:47620 ..."',
    'node server.js',
    '',
].join('\n');

const LEIA_ME = [
    'SoftTech Fiscal — Worker Node (Baixar NFCe + DIRBI)',
    '====================================================',
    '',
    'Este pacote habilita o processamento pesado (download de NFC-e na SEFAZ e',
    'geração da DIRBI a partir de pastas/zip) FORA do navegador. Sem ele, o site',
    'ainda funciona pelo navegador, mas com menos escala.',
    '',
    'PRE-REQUISITO: Node.js instalado (https://nodejs.org). Confira: node --version',
    '',
    'COMO USAR:',
    '  Windows : duplo-clique em start.bat',
    '  Linux/Mac: ./start.sh   (rode: chmod +x start.sh na primeira vez)',
    '',
    'Na 1a execucao ele baixa as dependencias (npm install) — pode levar 1-2 min.',
    'Depois sobe em http://127.0.0.1:47620. Deixe a janela aberta.',
    '',
    'Com o worker no ar, abra o site normalmente: as abas Baixar NFCe e DIRBI',
    'detectam o worker automaticamente e passam a usar o Node.',
    '',
    'Seguranca: o worker so escuta em 127.0.0.1 (loopback) — nao fica exposto na',
    'rede. Pare com Ctrl+C ou fechando a janela.',
    '',
].join('\r\n');

function main() {
    const entries = [];
    for (const [zipName, rel] of FILES) {
        const src = path.join(WORKER, rel);
        if (!fs.existsSync(src)) throw new Error('arquivo do worker ausente: ' + src);
        entries.push({ name: zipName, data: fs.readFileSync(src) });
    }
    entries.push({ name: 'start.bat', data: Buffer.from(START_BAT, 'utf8') });
    entries.push({ name: 'start.sh', data: Buffer.from(START_SH, 'utf8') });
    entries.push({ name: 'LEIA-ME.txt', data: Buffer.from(LEIA_ME, 'utf8') });

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const zip = buildZip(entries);
    fs.writeFileSync(OUT_ZIP, zip);
    console.log('OK: ' + OUT_ZIP + ' (' + entries.length + ' arquivos, ' + zip.length + ' bytes)');
}

main();
