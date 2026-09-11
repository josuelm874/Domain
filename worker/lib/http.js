/* --------------------------------- HTTP sem `fetch` ---------------------------------
 *
 * Cliente HTTP minimo sobre `https.request` nativo. Existe por um motivo medido, nao por
 * gosto: `lib/nfce.js` usava o `fetch` global e o `AbortController`, e na maquina da
 * EMPRESA o download de NFCe pulava de 0% para 100% com TODAS as notas em erro,
 * instantaneamente. A mesma build funcionava na maquina pessoal.
 *
 * A anatomia da falha importa, porque desmente a leitura obvia:
 *
 *   - `fetch` ausente (Node < 18) lancava DENTRO do try de `fetchWithRetry`. Um
 *     ReferenceError sem `.kind` caia no ramo de retry: 500 + 1000 + 2000 ms por chave.
 *     3339 chaves / concorrencia 10 ~= 19 MINUTOS de barra andando. Nao e o sintoma.
 *   - `AbortController` ausente (Node < 15) lancava FORA do try, na primeira linha da
 *     funcao. Sem retry, sem backoff, sem tocar a rede: rejeicao imediata, chave por
 *     chave. Isso SIM da 0 -> 100% em segundos. Era o sintoma.
 *
 * Reforco independente: naquela maquina o Node recusou `--openssl-legacy-provider` em
 * NODE_OPTIONS -- flag que so existe a partir do Node 17.
 *
 * A correcao nao e detectar versao e ramificar: e parar de depender de global novo.
 * `https.request` existe desde sempre, e `lib/nfe.js` ja o usava com TLS mutuo -- o worker
 * tinha DOIS padroes de rede e so o moderno quebrava. Isto unifica no antigo.
 *
 * Restricao de portabilidade deste arquivo e de quem o consome: nada de `fetch`,
 * `AbortController`, `??`, `?.`, `Object.hasOwn`, `String.replaceAll`, `Array.at`,
 * `structuredClone`. Piso alvo: Node 12. `lib/ambiente.js` AFERE isso no boot em vez de
 * supor, e imprime o que falta.
 *
 * ponytail: reimplementar cliente HTTP e divida. O correto seria `undici` -- que e
 * dependencia npm, e dependencia npm instalavel e exatamente o que nao existe naquela
 * maquina (sem admin, sem registry). Divida assumida e documentada.
 * ------------------------------------------------------------------------------------- */
'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const TIMEOUT_PADRAO_MS = 45000;

/**
 * Resposta com a fatia da interface do `fetch` que o worker realmente usa. Manter os
 * mesmos nomes (`status`, `ok`, `json()`, `text()`) mantem o diff nos chamadores pequeno
 * e a troca reversivel: se um dia o piso subir para Node 18, troca-se o transporte sem
 * mexer na logica de negocio.
 */
class Resposta {
    constructor(status, headers, corpo, url) {
        this.status = status;
        this.headers = headers || {};
        this.corpo = corpo;              // Buffer cru
        this.url = url;
        this.ok = status >= 200 && status < 300;
    }
    text(enc) { return this.corpo.toString(enc || 'utf8'); }
    json() {
        const t = this.text();
        try {
            return JSON.parse(t);
        } catch (e) {
            // A mensagem carrega o inicio do corpo: "Unexpected token <" sozinho nao diz
            // que a SEFAZ devolveu pagina de login/erro em vez de JSON. Essa falta de
            // detalhe ja custou rodadas neste projeto.
            const amostra = t.replace(/\s+/g, ' ').trim().slice(0, 200);
            throw new Error('resposta nao e JSON (HTTP ' + this.status + '): ' + amostra);
        }
    }
    header(nome) { return this.headers[String(nome).toLowerCase()] || ''; }
}

/**
 * Uma requisicao, sem retry e sem seguir redirect (quem chama decide as duas coisas).
 *
 * O timeout e do socket via `req.setTimeout` -- equivalente nativo do que o
 * AbortController fazia, sem depender de global novo. Sem ele, uma requisicao que abre e
 * nunca responde pendura a promise para sempre, o slot do pool nunca volta e o job fica
 * eterno: foi o defeito medido em 2026-09-10 (3332 de 3339 baixadas, 7 penduradas).
 *
 * @param {string} url
 * @param {{method?:string, headers?:object, body?:string|Buffer, timeoutMs?:number, tls?:object}} opc
 * @returns {Promise<Resposta>}
 */
function pedir(url, opc) {
    const o = opc || {};
    const metodo = o.method || 'GET';
    const timeoutMs = o.timeoutMs || TIMEOUT_PADRAO_MS;

    return new Promise(function (resolve, reject) {
        let u;
        try {
            u = new URL(url);
        } catch (e) {
            reject(new Error('URL invalida: ' + url));
            return;
        }
        const seguro = u.protocol === 'https:';
        const mod = seguro ? https : http;

        const headers = {};
        const dados = o.headers || {};
        for (const k of Object.keys(dados)) {
            if (dados[k] !== undefined && dados[k] !== null) headers[k.toLowerCase()] = dados[k];
        }
        if (!headers['user-agent']) headers['user-agent'] = 'softtech-worker';
        if (!headers['accept']) headers['accept'] = '*/*';

        let corpo = null;
        if (o.body !== undefined && o.body !== null && o.body !== '') {
            corpo = Buffer.isBuffer(o.body) ? o.body : Buffer.from(String(o.body), 'utf8');
            headers['content-length'] = corpo.length;
            if (!headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded';
        }

        const conf = {
            method: metodo,
            hostname: u.hostname,
            port: u.port || (seguro ? 443 : 80),
            path: u.pathname + u.search,
            headers: headers,
        };
        // `tls` so entra em https. Em http o Node ignoraria essas chaves, mas passa-las
        // seria mentir sobre a seguranca da conexao no proprio objeto de config.
        if (seguro && o.tls) {
            for (const k of Object.keys(o.tls)) conf[k] = o.tls[k];
        }

        const req = mod.request(conf, function (res) {
            const pedacos = [];
            res.on('data', function (c) { pedacos.push(c); });
            res.on('end', function () {
                resolve(new Resposta(res.statusCode, res.headers, Buffer.concat(pedacos), url));
            });
            // Erro DEPOIS dos headers (conexao cortada no meio do corpo) nao dispara o
            // 'error' do req: sem este handler a promise fica pendurada.
            res.on('error', function (e) { reject(enriquecer(e, url)); });
        });

        req.setTimeout(timeoutMs, function () {
            const e = new Error('sem resposta em ' + Math.round(timeoutMs / 1000) + 's');
            e.code = 'ETIMEDOUT';
            e.timeout = true;
            req.destroy(e);
        });

        // Expor `code` e `cause`: "fetch failed" sozinho nao dizia nada e custou uma
        // rodada inteira ate descobrir que era handshake TLS. Mesma licao, mesmo lugar.
        req.on('error', function (e) { reject(enriquecer(e, url)); });

        if (corpo) req.write(corpo);
        req.end();
    });
}

/** Anexa code/cause/host a mensagem. Erro que nao diz o que houve ja custou 4 rodadas aqui. */
function enriquecer(e, url) {
    let host = url;
    try { host = new URL(url).host; } catch (x) { /* mantem a url crua */ }
    const partes = [(e && e.message) || String(e)];
    if (e && e.code) partes.push('[' + e.code + ']');
    if (e && e.cause && e.cause.code) partes.push('cause=' + e.cause.code);
    else if (e && e.cause && e.cause.message) partes.push('cause=' + e.cause.message);
    partes.push('host=' + host);
    const novo = new Error(partes.join(' '));
    novo.code = (e && e.code) || '';
    novo.timeout = !!(e && e.timeout);
    return novo;
}

module.exports = { pedir, Resposta, TIMEOUT_PADRAO_MS };
