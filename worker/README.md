# SoftTech Worker (sidecar local)

Processa **Baixar NFCe** e **DIRBI** fora do navegador. O navegador só configura
e dispara; o worker faz o trabalho pesado e devolve progresso.

Estado atual: **ponte validada** + **fluxo NFCe implementado**. DIRBI entra depois
que o NFCe for validado em produção com token vivo.

## Rodar o worker

Máquina com Node (>=18):

```sh
node server.js
```

Deve imprimir `ouvindo em http://127.0.0.1:47620`. Deixe a janela aberta.

## Rotas

| Rota | Método | Para quê |
|------|--------|----------|
| `/health` | GET | health-check (a UI usa p/ detectar o worker) |
| `/echo` | POST | eco (validação da ponte) |
| `/nfce/start` | POST | inicia um job NFCe — body `{ concurrency, companies:[{cnpj,token,taxid,keys,meta}] }` → `{ jobId }` |
| `/nfce/status/{jobId}` | GET | progresso por empresa (polling) |
| `/nfce/detail/{jobId}/{cnpj}` | GET | falhas + divergências de conferência de uma empresa |
| `/nfce/zip/{jobId}/{cnpj}` | GET | baixa o ZIP da empresa (montado no worker) |

O worker faz os fetches à SEFAZ-CE (Node não tem CORS) e monta o ZIP por empresa
com `lib/zip.js` (sem dependências — `zlib` DEFLATE + formato PKZIP). Cada empresa
traz seu próprio token; no modo "1 token global" a UI replica o mesmo token em todas.

## Arquitetura interna

- `server.js` — roteador HTTP (loopback, CORS+PNA).
- `lib/nfce.js` — job manager (pool round-robin por empresa, fetch SEFAZ, conferência).
- `lib/zip.js` — zip-writer zero-deps (reutilizável pelo DIRBI depois).

## Validar a ponte (sem deploy)

O objetivo é confirmar que uma página **HTTPS** consegue chamar `http://localhost`
no **Chrome do trabalho**, incluindo o preflight do *Private Network Access*.

1. Com o worker rodando, abra o app que já está no ar na Vercel (a URL de produção).
2. Abra o DevTools: **F12 → aba Console**.
3. Cole e rode o snippet abaixo:

```js
(async () => {
  // 1) GET simples (caso fácil)
  try {
    const h = await fetch('http://localhost:47620/health').then(r => r.json());
    console.log('HEALTH OK ->', h);
  } catch (e) { console.error('HEALTH FALHOU ->', e); }

  // 2) POST com header custom (FORÇA o preflight PNA — é o caso real de NFCe/DIRBI)
  try {
    const e2 = await fetch('http://localhost:47620/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-authentication-token': 'teste' },
      body: JSON.stringify({ ping: 'softtech' }),
    }).then(r => r.json());
    console.log('ECHO OK ->', e2);
  } catch (e) { console.error('ECHO FALHOU ->', e); }
})();
```

### Como ler o resultado

- **`HEALTH OK` e `ECHO OK`** → ponte validada. Pode construir NFCe/DIRBI sobre ela.
- **`ECHO FALHOU` com erro de CORS / "Private Network Access"** → o Chrome está
  exigindo algo a mais no preflight. Anote a mensagem exata do console (e a aba
  **Network** → request `OPTIONS` → Response Headers) e me mande: o ajuste é no
  `applyCors` do `server.js`.
- **"Failed to fetch" sem mencionar CORS** → o worker não está rodando, ou a porta
  está bloqueada por firewall. Confirme a janela do `node server.js` aberta.

> Por que não testar localmente abrindo o app no `localhost`? Porque aí seria
> `http://localhost → http://localhost`, que **não** reproduz o mixed-content /
> PNA do caso real (HTTPS público → loopback). O teste tem de partir da página
> HTTPS da Vercel.

## Porta

Fixa em `47620` (loopback `127.0.0.1` apenas — não exposta na rede). Para trocar,
edite `PORT` em `server.js`.
