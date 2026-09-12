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
// NÃO inclui node_modules: o worker sobe sem ele. `exceljs` (única dependencia, so da
// DIRBI) e carregada sob demanda em lib/dirbi.js, entao Baixar NFCe funciona numa maquina
// que nunca conseguiu rodar `npm install` -- o caso da P1.
//
// TODO arquivo requerido por server.js tem que estar aqui: falta um e o worker morre no
// require antes de escutar a porta, com ERR_CONNECTION_REFUSED no browser e nenhuma pista.
const FILES = [
    ['server.js', 'server.js'],
    // ambiente.js e http.js sao requeridos na carga do server.js e do nfce.js. Esquece-los
    // reproduz exatamente a P3: zip publicado que morre no require. Foi a P8 que os trouxe.
    ['lib/ambiente.js', 'lib/ambiente.js'],
    ['lib/http.js', 'lib/http.js'],
    ['lib/access.js', 'lib/access.js'],
    ['lib/nfce.js', 'lib/nfce.js'],
    // token-mfe.js NAO e requerido por server.js hoje -- entra porque sem ele o zip
    // publicado nao leva a capacidade de obter o JWT sozinho, e a falha apareceria so
    // quando alguem ligasse a rota. O .pem VEM JUNTO ou nao adianta: e a cadeia ICP-Brasil
    // pinada, e sem ela o handshake com o Ambiente Seguro morre em
    // SELF_SIGNED_CERT_IN_CHAIN nos Node que nao tem a raiz brasileira na store.
    ['lib/token-mfe.js', 'lib/token-mfe.js'],
    ['lib/ca-icp-brasil.pem', 'lib/ca-icp-brasil.pem'],
    ['lib/nfe.js', 'lib/nfe.js'],
    ['lib/distnsu.js', 'lib/distnsu.js'],
    ['lib/cursor.js', 'lib/cursor.js'],
    ['lib/dirbi.js', 'lib/dirbi.js'],
    ['lib/zip.js', 'lib/zip.js'],
    ['DIRBI MES-ANO.xlsx', 'DIRBI MES-ANO.xlsx'],
    ['package.json', 'package.json'],
    ['package-lock.json', 'package-lock.json'],
    ['README.md', 'README.md'],
];

// Runtime Node embarcavel. v22 e nao v24 porque a v24 DEIXOU DE PUBLICAR win-x86:
// sem ela, maquina 32 bits simplesmente nao tem runtime. Os SHA-256 sao os oficiais de
// https://nodejs.org/dist/v22.23.2/SHASUMS256.txt -- conferidos pelo start.bat com
// `certutil`, que ja vem no Windows. Baixar binario e executar sem conferir hash e
// inaceitavel num processo que manipula credencial de fisco.
//
// Para atualizar: troque versao e os dois hashes pela linha correspondente do
// SHASUMS256.txt da nova versao, e rode `node scripts/bundle-worker.js`.
const NODE = {
    versao: 'v22.23.2',
    sha256: {
        x64: '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97',
        x86: '725c9e2bdd1c2016b41c995a81f4fa36ce4e2ee565b7455d8f889182727df647',
    },
};

// start.bat -- SEM acento de proposito: o console do Windows troca de codepage e
// qualquer caractere fora de ASCII vira lixo na tela do usuario.
//
// Ordem de resolucao do runtime, da melhor para a pior:
//   1. node\<arch>\node.exe ao lado do .bat  -> pacote offline, ou download anterior
//   2. Node do sistema, se for >= 18         -> quem ja tinha instalado nao perde nada
//   3. baixa o oficial para dentro da pasta  -> sem instalar, sem admin, sem PATH
//
// Nada aqui escreve fora da propria pasta nem no registro, que e o motivo de nao
// precisar de administrador. O que exigia elevacao era o INSTALADOR do Node (MSI grava
// em C:\Program Files) -- nunca o .bat.
const START_BAT = [
    '@echo off',
    'setlocal enabledelayedexpansion',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'title SoftTech Worker',
    '',
    'set "NODE_VER=' + NODE.versao + '"',
    'set "NODE_BASE=https://nodejs.org/dist/' + NODE.versao + '"',
    'set "SHA_x64=' + NODE.sha256.x64 + '"',
    'set "SHA_x86=' + NODE.sha256.x86 + '"',
    '',
    'rem ---- 1) arquitetura REAL do Windows ----',
    'rem PROCESSOR_ARCHITECTURE mente quando um processo 32 bits roda em SO 64 bits:',
    'rem nesse caso o valor real vem em PROCESSOR_ARCHITEW6432. Por isso os dois testes.',
    'rem ARM64 cai em x86 de proposito: todo Windows on ARM emula x86, mas so o Windows 11',
    'rem emula x64 -- x86 e a escolha que funciona nos dois.',
    'set "ARCH=x86"',
    'if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "ARCH=x64"',
    'if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "ARCH=x64"',
    '',
    'rem ---- 2) runtime ja presente nesta pasta? ----',
    'set "NODE_EXE=%CD%\\node\\%ARCH%\\node.exe"',
    'if exist "%NODE_EXE%" goto :run',
    '',
    'rem ---- 3) Node do sistema, se for recente o bastante ----',
    'where node >nul 2>nul',
    'if errorlevel 1 goto :bootstrap',
    'set "SYSMAJOR="',
    'for /f "tokens=1 delims=." %%v in (\'node -p "process.versions.node" 2^>nul\') do set "SYSMAJOR=%%v"',
    'if not defined SYSMAJOR goto :bootstrap',
    'rem Node antigo sobe e morre depois, em sintaxe moderna, com erro que nao ajuda.',
    'rem Melhor ignora-lo aqui e baixar um que funciona.',
    'if !SYSMAJOR! LSS 18 goto :bootstrap',
    'set "NODE_EXE=node"',
    'goto :run',
    '',
    ':bootstrap',
    'echo.',
    'echo  Node.js utilizavel nao foi encontrado nesta maquina.',
    'echo  Vou baixar o oficial %NODE_VER% ^(%ARCH%^) para DENTRO desta pasta.',
    'echo  Nao instala nada no Windows, nao mexe no PATH, nao precisa de administrador.',
    'echo.',
    'set "ZIPNAME=node-%NODE_VER%-win-%ARCH%.zip"',
    'set "WANT=!SHA_%ARCH%!"',
    'echo  Baixando %ZIPNAME% ^(cerca de 30 MB^)...',
    'where curl >nul 2>nul',
    'if errorlevel 1 goto :dl_ps',
    'curl -L --fail -o "%ZIPNAME%" "%NODE_BASE%/%ZIPNAME%"',
    'if errorlevel 1 goto :dl_fail',
    'goto :dl_ok',
    ':dl_ps',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \'%NODE_BASE%/%ZIPNAME%\' -OutFile \'%ZIPNAME%\'"',
    'if errorlevel 1 goto :dl_fail',
    ':dl_ok',
    '',
    'rem ---- confere o SHA-256 antes de executar qualquer coisa ----',
    'echo  Conferindo a assinatura do arquivo...',
    'set "GOT="',
    'for /f "skip=1 tokens=1" %%h in (\'certutil -hashfile "%ZIPNAME%" SHA256\') do if not defined GOT set "GOT=%%h"',
    'if /i not "!GOT!"=="!WANT!" goto :hash_fail',
    '',
    'rem ---- extrai: tar vem no Windows 10 1803+; Expand-Archive cobre o resto ----',
    'echo  Extraindo...',
    'if exist "node\\_tmp" rmdir /s /q "node\\_tmp"',
    'mkdir "node\\_tmp" 2>nul',
    'where tar >nul 2>nul',
    'if errorlevel 1 goto :unzip_ps',
    'tar -xf "%ZIPNAME%" -C "node\\_tmp"',
    'if errorlevel 1 goto :unzip_ps',
    'goto :unzip_ok',
    ':unzip_ps',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath \'%ZIPNAME%\' -DestinationPath \'node\\_tmp\' -Force"',
    'if errorlevel 1 goto :unzip_fail',
    ':unzip_ok',
    'move "node\\_tmp\\node-%NODE_VER%-win-%ARCH%" "node\\%ARCH%" >nul',
    'if errorlevel 1 goto :unzip_fail',
    'rmdir /s /q "node\\_tmp" 2>nul',
    'del /q "%ZIPNAME%" 2>nul',
    'set "NODE_EXE=%CD%\\node\\%ARCH%\\node.exe"',
    'if not exist "%NODE_EXE%" goto :unzip_fail',
    'echo  Pronto. O runtime ficou em node\\%ARCH% e so sera baixado esta vez.',
    'echo.',
    '',
    ':run',
    'rem Dependencia OPCIONAL: so a DIRBI usa exceljs, e lib/dirbi.js a carrega sob demanda.',
    'rem Baixar NFCe sobe sem nenhum node_modules -- por isso a falha aqui nunca e fatal.',
    'if exist node_modules goto :serve',
    'set "NPM_CMD=%CD%\\node\\%ARCH%\\npm.cmd"',
    'if not exist "%NPM_CMD%" set "NPM_CMD=npm"',
    'echo Instalando dependencias OPCIONAIS ^(somente a DIRBI precisa^)...',
    'call "%NPM_CMD%" install --omit=dev',
    'if not errorlevel 1 goto :serve',
    'echo [AVISO] npm install falhou. O download de NFCe funciona assim mesmo;',
    'echo          apenas a DIRBI ficara indisponivel.',
    'rem Causa medida em teste: npm cria caminhos internos longos e estoura o limite',
    'rem de 260 caracteres do Windows, falhando SEM MENSAGEM. Com a pasta em 228',
    'rem caracteres o npm morreu calado; com 66 instalou os 108 pacotes.',
    'echo          Causa comum: a pasta esta muito funda no disco. Mova o worker para',
    'echo          uma pasta curta, logo na raiz do disco C:, e rode de novo.',
    '',
    ':serve',
    'rem Quem imprime a URL e o server.js -- ele conhece a porta de verdade. Fixar',
    'rem 47620 nesta mensagem mentiria quando SOFTTECH_WORKER_PORT estiver setado.',
    'echo Subindo o worker SoftTech. Deixe esta janela aberta enquanto usa o sistema.',
    '"%NODE_EXE%" server.js',
    'pause',
    'exit /b 0',
    '',
    ':dl_fail',
    'echo.',
    'echo  [ERRO] Nao consegui baixar o Node de %NODE_BASE%.',
    'echo  Causa mais comum: proxy ou firewall da empresa bloqueando nodejs.org.',
    'echo  Saida: peca o pacote OFFLINE ^(softtech-worker-offline.zip^), que ja vem com o',
    'echo  runtime embutido e nao baixa nada.',
    'del /q "%ZIPNAME%" 2>nul',
    'pause',
    'exit /b 1',
    '',
    ':hash_fail',
    'echo.',
    'echo  [ERRO] O arquivo baixado NAO confere com a assinatura oficial do Node.',
    'echo  esperado: !WANT!',
    'echo  recebido: !GOT!',
    'echo  Download corrompido, ou algo no caminho alterou o arquivo. Nao vou executa-lo.',
    'del /q "%ZIPNAME%" 2>nul',
    'pause',
    'exit /b 1',
    '',
    ':unzip_fail',
    'echo.',
    'echo  [ERRO] Baixou, conferiu, mas nao consegui extrair o runtime.',
    'echo  Extraia "%ZIPNAME%" na mao e renomeie a pasta interna para node\\%ARCH%.',
    'pause',
    'exit /b 1',
    '',
].join('\r\n');

// start.sh -- Linux/Mac. Mesma ordem de resolucao, sem o bootstrap de download: nesses
// SOs o Node vem do gerenciador de pacotes e nao exige privilegio de administrador do
// jeito que o MSI do Windows exige. O caso que doia era o Windows.
const START_SH = [
    '#!/usr/bin/env bash',
    'set -e',
    'cd "$(dirname "$0")"',
    '',
    'case "$(uname -m)" in',
    '  x86_64|amd64) ARCH=x64 ;;',
    '  aarch64|arm64) ARCH=arm64 ;;',
    '  *) ARCH=x86 ;;',
    'esac',
    '',
    '# Runtime embarcado ao lado tem precedencia sobre o do sistema.',
    'if [ -x "node/$ARCH/bin/node" ]; then',
    '  NODE_EXE="./node/$ARCH/bin/node"',
    'elif command -v node >/dev/null 2>&1; then',
    '  NODE_EXE=node',
    'else',
    '  echo "[ERRO] Node.js nao encontrado. Instale pelo gerenciador de pacotes ou veja https://nodejs.org"',
    '  exit 1',
    'fi',
    '',
    'if [ ! -d node_modules ]; then',
    '  echo "Instalando dependencias OPCIONAIS (somente a DIRBI precisa)..."',
    '  npm install --omit=dev || echo "[AVISO] npm install falhou. O download de NFCe funciona assim mesmo; apenas a DIRBI ficara indisponivel."',
    'fi',
    'echo "Subindo o worker SoftTech. Deixe este terminal aberto."',
    '"$NODE_EXE" server.js',
    '',
].join('\n');

const LEIA_ME = [
    'SoftTech Fiscal -- Worker Node (Baixar NFCe + DIRBI)',
    '====================================================',
    '',
    'Este pacote habilita o processamento pesado (download de NFC-e na SEFAZ e',
    'geracao da DIRBI a partir de pastas/zip) FORA do navegador. Sem ele, o site',
    'ainda funciona pelo navegador, mas com menos escala.',
    '',
    'NAO PRECISA INSTALAR NADA. Nao precisa de Node.js instalado, nao precisa de',
    'administrador, nao mexe no PATH nem no registro do Windows.',
    '',
    'COMO USAR:',
    '  Windows  : duplo-clique em start.bat',
    '  Linux/Mac: ./start.sh   (rode: chmod +x start.sh na primeira vez)',
    '',
    'O QUE O start.bat FAZ, nesta ordem:',
    '  1. Descobre se o Windows e 32 ou 64 bits.',
    '  2. Usa o runtime que ja estiver na pasta node\\ ao lado dele, se existir.',
    '  3. Senao, usa o Node.js do sistema -- desde que seja versao 18 ou mais nova.',
    '  4. Senao, baixa o Node.js oficial (cerca de 30 MB, uma unica vez) para DENTRO',
    '     desta pasta, confere a assinatura SHA-256 publicada pelo projeto Node, e roda.',
    '',
    'Ou seja: na 1a execucao de uma maquina nova pode demorar 1-2 minutos baixando.',
    'Da 2a em diante sobe na hora.',
    '',
    'PAREAMENTO (uma vez por maquina):',
    '  Na 1a execucao o worker imprime um token na propria janela, embaixo de',
    '  "Cole este token no sistema quando ele pedir". Copie e cole no sistema quando a',
    '  tela pedir. SEM ISSO o worker sobe mas o sistema nao consegue usa-lo -- e parece',
    '  que nao funcionou. O token fica guardado na pasta do seu usuario e vale para os',
    '  proximos boots: so precisa colar uma vez.',
    '',
    'ACESSO AO AMBIENTE SEGURO (uma vez por maquina):',
    '  Para o download de NFCe o worker faz o login no Ambiente Seguro sozinho e pega o',
    '  token da SEFAZ. Informe CPF, senha e vinculo na propria tela Baixar NFCe, no',
    '  painel "Acesso ao Ambiente Seguro". Fica gravado so na pasta do seu usuario desta',
    '  maquina, nunca sobe para o site. Quem preferir nao gravar senha pode continuar',
    '  colando o token JWT a mao.',
    '',
    'Com o worker no ar e pareado, abra o site normalmente: as abas Baixar NFCe e DIRBI',
    'detectam o worker automaticamente e passam a usar o Node.',
    '',
    'Seguranca: o worker so escuta em 127.0.0.1 (loopback) -- nao fica exposto na rede, e',
    'so aceita chamadas que tragam o token de pareamento. Pare com Ctrl+C ou fechando a',
    'janela.',
    '',
    'NAO SOBE? As causas conhecidas:',
    '  - "Nao consegui baixar o Node"  -> proxy/firewall da empresa bloqueia nodejs.org.',
    '                                     Peca o pacote OFFLINE, que ja vem com o runtime.',
    '  - "NAO confere com a assinatura"-> download corrompido. Rode de novo.',
    '  - "EADDRINUSE"                  -> porta 47620 ocupada (worker ja rodando?).',
    '  - "Cannot find module"          -> pacote incompleto: baixe o zip de novo.',
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
