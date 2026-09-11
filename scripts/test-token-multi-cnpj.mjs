/* ---------------- Um JWT do MFe serve N CNPJs? ----------------
 *
 * Pergunta que decide o desenho da integração. Se um token serve só a empresa que foi
 * selecionada no passo 4, então é UM LOGIN NO PORTAL POR EMPRESA do lote — com 195 empresas
 * no CPF, isso muda tudo: virar cache por CNPJ, serializar, e provavelmente aceitar que
 * lote grande leva minutos só de autenticação. Se serve várias, um login basta.
 *
 * `lib/nfce.js` hoje assume implicitamente que serve (comentário "PREMISSA AINDA NÃO
 * VALIDADA" no topo). Isto valida.
 *
 * COMO MEDE. Sonda `GET /coupons/extract/<chave>` — o mesmo endpoint que o download usa —
 * e lê o STATUS, que já é o que `lib/nfce.js` classifica:
 *     401/403 -> token recusado para esse contribuinte   (kind 'auth')
 *     404     -> token ACEITO, cupom é que não existe    (kind 'notfound')
 *     200     -> token aceito e cupom encontrado
 * A diferença entre 401/403 e 404 é a resposta inteira: um diz "você não pode perguntar",
 * o outro diz "pode perguntar, não achei".
 *
 * CUSTO: faz DOIS logins no Ambiente Seguro (um por CNPJ). Não rode em laço.
 *
 * As credenciais saem de ~/.softtech-ambiente-seguro.json pelo próprio token-mfe.js.
 * Nenhum valor de token é impresso — só CNPJ, status e veredito.
 *
 * Rodar (do worktree):
 *   node scripts/test-token-multi-cnpj.mjs --a=<cnpj A> --b=<cnpj B> [--chave=<44 dígitos de B>]
 *
 * `--chave` é OPCIONAL mas deixa o resultado forte. Sem ela o script sintetiza uma chave
 * com o CNPJ de B embutido; aí um 404 fica ambíguo (pode ser "não autorizado" respondido
 * como 404), e o script diz isso em vez de fingir conclusão.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { obterToken } = require_(path.join(__dirname, '..', 'worker', 'lib', 'token-mfe.js'));
const { pedir } = require_(path.join(__dirname, '..', 'worker', 'lib', 'http.js'));

const API = process.env.SEFAZ_BASE || 'https://cfe.sefaz.ce.gov.br:8443/portalcfews/nfce';

const arg = (n) => {
    const a = process.argv.find((x) => x.indexOf('--' + n + '=') === 0);
    return a ? a.split('=').slice(1).join('=') : '';
};
const digitos = (s) => String(s || '').replace(/\D/g, '');

const A = digitos(arg('a'));
const B = digitos(arg('b'));
let chave = digitos(arg('chave'));
const chaveSintetica = !chave;

if (A.length !== 14 || B.length !== 14) {
    console.error('Uso: node scripts/test-token-multi-cnpj.mjs --a=<cnpj 14> --b=<cnpj 14> [--chave=<44>]');
    console.error('  A e B precisam ser DUAS empresas diferentes do mesmo CPF/contador.');
    process.exit(2);
}
if (A === B) { console.error('A e B têm que ser CNPJs diferentes.'); process.exit(2); }

if (chaveSintetica) {
    // Chave em formato válido com o CNPJ de B nas posições 6..20 (é onde a NFC-e carrega o
    // emitente). Serve para o servidor decidir autorização antes de procurar o documento.
    chave = '23' + '2601' + B + '65' + '001' + '000000001' + '1' + '00000001' + '0';
    chave = chave.slice(0, 44);
}
if (chave.length !== 44) { console.error('--chave precisa ter 44 dígitos, veio ' + chave.length); process.exit(2); }

/** Uma sondagem. Devolve só status e um rótulo — nunca o token. */
async function sondar(rotulo, token, taxid) {
    const url = API + '/coupons/extract/' + encodeURIComponent(chave);
    let r;
    try {
        r = await pedir(url, {
            headers: {
                'x-authentication-token': token,
                'x-authentication-taxid': taxid,
                accept: 'application/json',
            },
            timeoutMs: 45000,
        });
    } catch (e) {
        return { rotulo, status: 0, veredito: 'ERRO DE REDE', detalhe: (e && e.message) || String(e) };
    }
    const s = r.status;
    const veredito = (s === 401 || s === 403) ? 'RECUSADO (token não vale para esse contribuinte)'
        : s === 404 ? 'ACEITO (cupom não encontrado)'
        : s === 200 ? 'ACEITO (cupom encontrado)'
        : 'INDEFINIDO';
    let detalhe = '';
    try { detalhe = ' campos: ' + Object.keys(r.json()).join(', '); }
    catch (e) { detalhe = ' corpo: ' + r.text().replace(/\s+/g, ' ').trim().slice(0, 120); }
    return { rotulo, status: s, veredito, detalhe };
}

const linha = (x) => console.log(
    '  ' + x.rotulo.padEnd(34) + ' HTTP ' + String(x.status).padEnd(5) + x.veredito + (x.detalhe || ''));

(async () => {
    console.log('\n  Um JWT do MFe serve N CNPJs?');
    console.log('  A = ' + A + '   B = ' + B);
    console.log('  chave sondada: ' + chave + (chaveSintetica ? '  (SINTÉTICA — ver ressalva no fim)' : '  (real, informada)'));
    console.log('  dois logins no Ambiente Seguro; nenhum token é impresso.\n');

    // ENCERRAR a sessão de A antes de logar como B não é higiene: é obrigatório. O Ambiente
    // Seguro é de SESSÃO ÚNICA e a primeira versão deste script derrubou a si mesma —
    // o portal recusou o segundo login com "O usuário já está logado no sistema. Verifique
    // outro login, ou se o último foi encerrado corretamente e aguarde alguns minutos".
    //
    // Efeito colateral útil: com o logout ANTES das sondas, r1 também mede se o JWT
    // sobrevive ao encerramento da sessão do portal. Se r1 vier 401, o worker NÃO pode
    // deslogar depois de pegar o token — e aí lote multiempresa precisa de espera entre
    // CNPJs em vez de logout.
    console.log('  obtendo token de A (e encerrando a sessão em seguida)...');
    const tA = await obterToken({ cnpj: A, encerrar: true });
    console.log('  token A: sub=' + tA.cnpj + ' expira ' + new Date(tA.exp * 1000).toLocaleString('pt-BR'));
    if (tA.cnpj !== A) console.log('  [ATENÇÃO] o sub do token de A não é o CNPJ pedido.');

    const r1 = await sondar('token A + taxid A (controle)', tA.jwt, A);
    const r2 = await sondar('token A + taxid B  <-- A PERGUNTA', tA.jwt, B);

    console.log('\n  obtendo token de B (sessão de A já encerrada)...');
    const tB = await obterToken({ cnpj: B, forcar: true, encerrar: true });
    console.log('  token B: sub=' + tB.cnpj + ' expira ' + new Date(tB.exp * 1000).toLocaleString('pt-BR'));

    const r3 = await sondar('token B + taxid B (controle +)', tB.jwt, B);

    console.log('\n  --- resultado ---');
    [r1, r2, r3].forEach(linha);

    console.log('\n  --- leitura ---');
    const mesmoToken = tA.jwt === tB.jwt;
    console.log('  token de A e de B são o MESMO valor? ' + (mesmoToken ? 'SIM' : 'não'));
    if (mesmoToken) {
        console.log('  => um token só para o CPF inteiro. Um login serve todas as empresas.');
    } else if (r2.status === 404 || r2.status === 200) {
        console.log('  => o token de A foi ACEITO para o CNPJ de B: um login serve várias empresas.');
        console.log('     `lib/nfce.js` pode replicar um token por todo o lote, como a UI já faz hoje.');
    } else if (r2.status === 401 || r2.status === 403) {
        console.log('  => o token é POR EMPRESA: um login no portal por CNPJ do lote.');
        console.log('     A integração precisa de cache por CNPJ e de aceitar que lote grande');
        console.log('     gasta minutos só autenticando. 195 empresas = 195 logins.');
    } else {
        console.log('  => INDEFINIDO. O controle r3 diz se a sonda em si presta:');
        console.log('     se r3 também não deu 200/404, a chave ou o endpoint é que estão errados.');
    }
    if (r1.status === 401 || r1.status === 403) {
        console.log('\n  [ACHADO] r1 recusou com o taxid do PRÓPRIO token. Como a sessão do portal');
        console.log('  foi encerrada antes das sondas, a leitura é: o JWT MORRE junto com a sessão do');
        console.log('  Ambiente Seguro. Consequência para a integração: o worker NÃO pode deslogar');
        console.log('  depois de pegar o token — e como o portal é sessão única, lote multiempresa');
        console.log('  vira fila com espera entre CNPJs, não logout-e-relogin.');
    }
    if (chaveSintetica) {
        console.log('\n  RESSALVA: a chave é sintética. Se r1 e r3 (controles) deram 404 junto com r2,');
        console.log('  o teste não separa "autorizado" de "não autorizado" — rode de novo com');
        console.log('  --chave=<chave real de uma NFC-e da empresa B> para conclusão firme.');
    }
    console.log('');
})().catch((e) => {
    console.error('\n  FALHOU: ' + ((e && e.message) || e));
    if (e && e.trilha) e.trilha.forEach((p) => console.error('    ' + JSON.stringify(p)));
    process.exit(1);
});
