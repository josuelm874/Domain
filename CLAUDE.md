# SoftTech Fiscal — instruções do repo

## Grafo de código (Graphify) — consultar ANTES de ler arquivo grande

Este repo tem arquivos enormes (`assets/js/app.js` ~588KB / ~9600 linhas). **Não leia
inteiros** para responder "onde está X", "quem chama Y" ou "como funciona o fluxo Z" —
consulte primeiro o grafo AST (local, 0 API), em `graphify-out/` (gitignored, regenerável):

```bash
python -m graphify query "como o download de NFCe monta o zip" --budget 2000
python -m graphify explain "processSpedFiscal"
python -m graphify path "processIcmsXmls" "saveDataSync"
python -m graphify affected "loadDataSync"
```

Retorna `função → arquivo:linha` com **paths reais** — ex.: `assets/js/app.js loc=L4639`.
Aí sim abrir o arquivo no ponto certo (Read com offset), em vez de varrer 9600 linhas.

- Escopo do grafo: definido em `.graphifyignore` (só código; planilhas/css/imagens/zip fora).
- **Limite honesto:** é um **localizador de call-graph (AST)** — diz ONDE, não O QUÊ. Funções
  top-level são capturadas; funções aninhadas em closures (ex.: dentro de
  `createBaixarNfcePage`) podem não aparecer. Para essas, `grep` no arquivo apontado.

### Manter o grafo fresco (sem LLM)

```bash
python -m graphify update .    # AST-only, rápido, 0 API
```

Rodar após mudanças relevantes de código. (Não há git hook instalado aqui — atualização manual.)

## Pendências

Ver [PENDENCIAS.md](PENDENCIAS.md). Doc geral do sistema em [PROJETO.md](PROJETO.md).
