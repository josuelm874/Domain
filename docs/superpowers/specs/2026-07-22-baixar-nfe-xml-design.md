# Baixar NFe (XML) — via `NFeDistribuicaoDFe` / `consChNFe`

**Data:** 2026-07-22
**Status:** Design aprovado, pronto para plano de implementação

## Problema

Hoje o download de XML de NFe (modelo 55) é manual, via `fsist.com.br`: acessa o site,
consulta a primeira nota, resolve um captcha (às vezes seleção de imagens), o Fsist usa o
certificado digital da empresa, e só então libera o download. Para trocar de empresa, é
preciso fechar o navegador e refazer tudo.

O objetivo aparente ("automatizar o captcha do fsist") é o problema errado (XY problem). O
captcha — em especial o de seleção de imagem — é o muro anti-bot por design: automatizá-lo é
frágil, viola o ToS do fsist, quebra a cada mudança de tela e exige serviço pago de resolução
sem garantia.

A chave real é o **certificado digital** que o fsist já exige. Com o certificado A1 em mãos,
o fsist é dispensável: a SEFAZ oferece o webservice oficial **`NFeDistribuicaoDFe`**, que
retorna as NFe emitidas contra um CNPJ usando **apenas o certificado** (autenticação por TLS
mútuo), sem captcha e sem intermediário. É o que o fsist faz por baixo, só que oficial.

## Decisões tomadas (brainstorming)

| Pergunta | Resposta |
|----------|----------|
| Tipo de certificado | **A1** (`.pfx` + senha) — automatizável headless |
| Escopo das notas | **Lista específica de chaves** (de relatório xls, igual ao NFCe) → `consChNFe` |
| Entrada do certificado | **Upload na UI por empresa** (`.pfx` + senha), em memória, nunca persistido |

## Arquitetura

Espelha o pipeline **Baixar NFCe** já existente, com duas trocas:

- **token JWT → certificado A1** (mTLS no lugar do header de auth);
- **REST GET por chave → SOAP `distDFeInt`/`consChNFe`** ao Ambiente Nacional.

O restante da engrenagem (report → chaves → agrupa por CNPJ → job no worker → ZIP por empresa
→ polling de status) é reaproveitado.

### Componentes

1. **Browser (reaproveita parsing existente)**
   - Parseia os relatórios xls → chaves de 44 dígitos.
   - Filtra **modelo 55** (NFe): posições 20–21 da chave == `55` (NFCe == `65`).
   - Agrupa por CNPJ destinatário.

2. **UI nova — página "Baixar NFe"** (espelha `createBaixarNfcePage` em `app.js`)
   - Para cada empresa (CNPJ): `<input type="file" accept=".pfx,.p12">` + campo senha,
     ao lado da contagem de chaves daquele CNPJ.
   - Dispara `POST /nfe/start`.
   - Polling de status; botão de download do ZIP por empresa.

3. **Worker — `worker/lib/nfe.js` (novo, espelha `lib/nfce.js`)**
   - Job manager com pool por empresa.
   - Por empresa: carrega `.pfx` + senha num agente mTLS.
   - Por chave: monta `distDFeInt` com `consChNFe`, faz POST SOAP ao endpoint do
     Ambiente Nacional (endpoint único, serve todas as UFs), TLS mútuo autentica.
   - Resposta `retDistDFeInt` → cada `docZip` é base64 + gzip → `zlib.gunzip` → XML `procNFe`.
   - Throttle + retry/backoff (helpers já existentes em `nfce.js`).
   - Monta ZIP por empresa via `lib/zip.js` (reuso).
   - **Descarta `.pfx` e senha da memória ao fim do job.**

4. **Rotas novas no `worker/server.js`** (espelham as de NFCe)
   - `POST /nfe/start` — body `{ concurrency, companies:[{cnpj, pfxB64, senha, chaves[], meta}] }` → `{ jobId }`
   - `GET /nfe/status/{jobId}` — progresso por empresa (polling)
   - `GET /nfe/detail/{jobId}/{cnpj}` — falhas por chave (não encontrada / erro)
   - `GET /nfe/zip/{jobId}/{cnpj}` — baixa o ZIP da empresa

### Fluxo de dados

```
report xls ──(browser)──> chaves modelo 55 ──agrupa CNPJ──> [empresa: cnpj, chaves[]]
                                                                    │
                              usuário faz upload .pfx + senha por empresa (UI)
                                                                    │
                          POST /nfe/start {companies:[{cnpj, pfxB64, senha, chaves[]}]}
                                                                    │
                                                               worker/lib/nfe.js
                          por empresa: agente mTLS (pfx+senha)
                          por chave: distDFeInt+consChNFe ──SOAP mTLS──> Ambiente Nacional
                                     retDistDFeInt.docZip ──base64+gunzip──> procNFe XML
                                                                    │
                                              ZIP por empresa (lib/zip.js)
                                                                    │
                          GET /nfe/status (polling)  ·  GET /nfe/zip/{jobId}/{cnpj}
                                                                    │
                                          worker descarta pfx+senha da memória
```

## Segurança

A chave privada do certificado A1 é altamente sensível.

- `.pfx` e senha trafegam **apenas** browser → loopback (`127.0.0.1:47620`, já não exposto na rede).
- Mantidos **só em memória** durante o job; **nunca** gravados em disco pelo app.
- **Nunca** logados (nem a senha, nem o conteúdo do `.pfx`).
- Descartados da memória do worker ao término do job (sucesso ou falha).

## Tratamento de erros (mapa cStat da SEFAZ)

| cStat | Significado | Ação |
|-------|-------------|------|
| `100` / `150` | NFe autorizada | XML extraído com sucesso |
| `137` / `138` | Sem documentos localizados | Marca chave como "não encontrada" (CNPJ não é parte interessada naquela nota) |
| `656` | Consumo indevido | Backoff longo — a SEFAZ limita consumo por CNPJ |
| cert inválido / senha errada / erro TLS | Falha de autenticação | Erro registrado **por empresa**, não derruba as demais |

**Restrição conhecida do `consChNFe`:** só retorna o XML completo se o CNPJ do certificado for
parte interessada (destinatário/emitente/transportador) naquela chave. Como o caso de uso é
entradas (empresa = destinatário), funciona. Nota fora do interesse do CNPJ → retorno vazio.

## Testes

- **Mock do endpoint AN** (mesmo padrão do override `SEFAZ_BASE` do NFCe): devolve um
  `retDistDFeInt` com um `procNFe` de amostra gzipado → assert `gunzip` → XML → entra no ZIP.
- **Carga do certificado**: `.pfx` self-signed carrega; senha errada → erro tratado (não crash).
- **Filtro de modelo**: chave `65` (NFCe) não entra no fluxo NFe; chave `55` entra.
- **Isolamento por empresa**: falha de uma empresa (cert ruim) não interrompe as outras.

## A verificar na implementação (não assumir)

- **URL exata** do endpoint `NFeDistribuicaoDFe` em produção e homologação + `SOAPAction` —
  confirmar no manual/WSDL oficial da SEFAZ antes de codar.
- **mTLS no Node com `fetch`**: o `fetch` global (undici) não aceita `agent`; usar
  `dispatcher` com `undici.Agent({ connect: { pfx, passphrase } })`, ou `https.request` direto.
  Decidir na implementação qual é mais limpo dado o resto do worker.
- **Limites exatos de consumo** do `consChNFe` por CNPJ (intervalo mínimo, quota) para
  calibrar a concorrência/throttle inicial (começar conservador).

## Fora de escopo (YAGNI, por ora)

- Modo `distNSU` (bulk de todas as entradas) — só `consChNFe` por lista de chaves.
- Certificado A3 (token/hardware) — decisão foi A1.
- Manifestação do destinatário (ciência/confirmação) — não necessária para `consChNFe` de entradas.
- Persistência de certificados entre sessões — upload a cada job, por segurança.

## Reaproveitamento vs. novo

| Peça | Estado |
|------|--------|
| Parsing report xls → chaves | Reusa (filtra modelo 55) |
| Agrupamento por CNPJ | Reusa |
| `lib/zip.js` (ZIP por empresa) | Reusa |
| Polling de status / detail / zip | Reusa padrão do NFCe |
| Retry / backoff / concorrência | Reusa helpers de `nfce.js` |
| Agente mTLS + SOAP `consChNFe` + gunzip `docZip` | **Novo** (`lib/nfe.js`) |
| UI de upload `.pfx` + senha por empresa | **Novo** (página "Baixar NFe") |
| Rotas `/nfe/*` no `server.js` | **Novo** (espelham `/nfce/*`) |
