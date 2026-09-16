// Gera o valor de APP_ADMIN_PASSWORD_HASH (o login `adm`, super-admin local).
//
//     node scripts/gerar-hash-admin.mjs
//
// A senha é digitada aqui, no seu computador, e NÃO aparece na tela nem fica no
// histórico do shell. O que sai é só o hash — é ele que vai para a Vercel.
//
// Precisa bater exatamente com `window.generateSecureHash` (assets/js/app.js):
// PBKDF2-SHA-256, 100.000 iterações, 256 bits, salt = APP_PASSWORD_SALT, saída
// em base64 com o prefixo "pbkdf2$". Qualquer divergência aqui e o login falha
// sem dizer por quê.

import { pbkdf2Sync } from 'node:crypto';
import { createInterface } from 'node:readline';
import { stdin, stdout, argv, exit } from 'node:process';

const ITERACOES = 100000;
const BYTES = 32;
const PREFIXO = 'pbkdf2$';

// Fila de linhas quando o stdin NÃO é terminal (pipe, CI, teste). Lida de uma
// vez: intercalar `rl.question` com um stream já no fim perde as linhas que
// sobraram no buffer, e o script trava esperando algo que já chegou.
const filaNaoInterativa = stdin.isTTY ? null : (await lerTudo()).split(/\r?\n/);

function lerTudo() {
    return new Promise((resolve) => {
        let buf = '';
        stdin.setEncoding('utf8');
        stdin.on('data', (c) => { buf += c; });
        stdin.on('end', () => resolve(buf));
    });
}

/** Lê uma linha sem ecoar o que foi digitado. */
function perguntarOculto(pergunta) {
    if (filaNaoInterativa) return perguntar(pergunta);
    return new Promise((resolve) => {
        const rl = createInterface({ input: stdin, output: stdout, terminal: true });
        // readline ecoa por padrão; este _writeToOutput engole tudo menos o prompt.
        rl._writeToOutput = function (texto) {
            if (texto.includes(pergunta)) rl.output.write(pergunta);
        };
        rl.question(pergunta, (resposta) => {
            rl.output.write('\n');
            rl.close();
            resolve(resposta);
        });
    });
}

function perguntar(pergunta) {
    if (filaNaoInterativa) {
        stdout.write(pergunta + '\n');
        return Promise.resolve(filaNaoInterativa.shift() || '');
    }
    return new Promise((resolve) => {
        const rl = createInterface({ input: stdin, output: stdout });
        rl.question(pergunta, (r) => { rl.close(); resolve(r); });
    });
}

const salt = (argv[2] || '').trim() || (await perguntar(
    'APP_PASSWORD_SALT (cole o MESMO valor que está na Vercel): ')).trim();

if (salt.length < 32) {
    console.error('\nO salt precisa de 32 caracteres ou mais. O da Vercel está em');
    console.error('Project → Settings → Environment Variables → APP_PASSWORD_SALT.');
    console.error('Se ele mudar, TODOS os hashes existentes deixam de valer.');
    exit(1);
}

const senha = await perguntarOculto('Senha do admin (não aparece na tela): ');
if (!senha) {
    console.error('\nSenha vazia. Nada gerado.');
    exit(1);
}
const confirma = await perguntarOculto('Digite de novo para confirmar: ');
if (senha !== confirma) {
    console.error('\nAs duas senhas não bateram. Nada gerado.');
    exit(1);
}

const hash = PREFIXO + pbkdf2Sync(senha, salt, ITERACOES, BYTES, 'sha256').toString('base64');

console.log('\nAPP_ADMIN_PASSWORD_HASH =\n');
console.log(hash);
console.log('\nCole esse valor em Project → Settings → Environment Variables,');
console.log('em APP_ADMIN_PASSWORD_HASH, e refaça o deploy.');
console.log('\nConfira antes de colar: o valor tem que começar com "pbkdf2$".');
console.log('O build agora recusa qualquer outra coisa — foi assim que a URL da API');
console.log('de ICMS passou batido nessa variável e quebrou o login do `adm`.');
