# Spec — Frente #5: Geração PIS/COFINS + MIT

> Análise completa pronta para implementar. Construir em sessão nova (contexto leve)
> usando `python -m graphify query` para localizar pontos de inserção sem reler app.js.

## Onde liga (UI)

- Bloco clicável na **aba Dashboard** (`createDashboardContentManually` em `assets/js/app.js` ~L807).
  Adicionar um card que chama `showPisCofinsModal()`.
- Padrão de modal: espelhar `showContributorRegistrationModal()` (cria innerHTML, append no body, listeners).
- Persistência não é necessária (cálculo on-demand). XLSX já disponível via global `XLSX` (SheetJS).
- ZIP no browser: usar `JSZip` (já carregado; usado em `finalizeBrowser`).

## Entrada

Dois arquivos `.xlsx` de apuração: **anterior** e **atual**. Aba **"Pis e Cofins"**.
Layout (0-based para SheetJS `sheet_to_json {header:1}`):
- Linha 1 vazia, linhas 2-3 cabeçalho → dados a partir da **linha 4** (índice 3).
- Coluna **C** (idx 2) = Razão Social
- Coluna **D** (idx 3) = CNPJ
- Coluna **E** (idx 4) = Compras
- Coluna **F** (idx 5) = Vendas
- Coluna **K** (idx 10) = COFINS (lido SÓ da apuração **anterior**)

Match de empresa entre os dois arquivos por **Razão Social + CNPJ** (NÃO por índice de linha —
pode entrar empresa nova). Normalizar CNPJ (só dígitos) e razão (trim/upper) para casar.

## Cálculo (por empresa)

```
base_ant   = Vendas_ant   - Compras_ant          # apuração anterior
base_atual = Vendas_atual - Compras_atual         # apuração atual
COFINS_novo = COFINS_ant * (base_atual / base_ant)   # escala proporcional à variação da base
PIS_novo    = (COFINS_novo / 0.076) * 0.0165
mult_base_% = (COFINS_ant / base_ant) * 100          # == COFINS_novo/base_atual (taxa efetiva)
```

Verificado com exemplo real: PIS = 4822.29/0.076*0.0165 = **1046.94** (bate com
`01275237-MIT-202605.JSON`). Arredondar valores a 2 casas.

> Ambiguidade resolvida: a fórmula do Multiplicador é `base_atual * X% = COFINS_novo`
> (leitura "multiplicar a base até chegar no COFINS"), NÃO `... = COFINS/7,6%`. A segunda
> leitura dá número sem sentido. Confirmar com o Josué nos primeiros números reais.

## Saída no modal (lote, todas as empresas)

Tabela: **Razão Social | CNPJ | PIS | COFINS | Multiplicador Base %**.
Botão "copiar Multiplicador Base %" → copia só os multiplicadores, um por linha (`\n`),
na ordem das empresas, pra colar de uma vez na coluna G da planilha de controle.

## Geração MIT (JSON por empresa)

Template = `MODELO.JSON` replicado **verbatim**, variando só 4 campos:
- `PeriodoApuracao.MesApuracao` = mês da apuração **atual** (dígito puro, ex.: `5`, sem zero à esquerda)
- `PeriodoApuracao.AnoApuracao` = ano da apuração atual (ex.: `2026`)
- `Debitos.PisPasep.ListaDebitos[0].ValorDebito` = PIS_novo
- `Debitos.Cofins.ListaDebitos[0].ValorDebito` = COFINS_novo

Mês/ano extraídos do **nome do arquivo da apuração atual**: `Apuração Ac Fiscal 05-2026.xlsx`
→ mês=5, ano=2026 (regex `(\d{2})-(\d{4})`).

Template literal do MODELO (campos fixos — replicar exatamente):
```json
{"PeriodoApuracao":{"MesApuracao":<MES>,"AnoApuracao":<ANO>},"DadosIniciais":{"SemMovimento":false,"QualificacaoPj":1,"TributacaoLucro":2,"VariacoesMonetarias":2,"RegimePisCofins":1,"ResponsavelApuracao":{"CpfResponsavel":"31580734391","EmailResponsavel":""},"RegistroCrc":{"UfRegistro":"CE","NumRegistro":"009551O2"}},"Debitos":{"PisPasep":{"ListaDebitos":[{"IdDebito":1,"CodigoDebito":"691201","ValorDebito":<PIS>}]},"Cofins":{"ListaDebitos":[{"IdDebito":2,"CodigoDebito":"585601","ValorDebito":<COFINS>}]}}}
```

> Divergência: `MODELO.JSON` tem `NumRegistro:"009551O2"`; um exemplo tem `"9551O2"`.
> Spec do Josué manda replicar o MODELO -> usar `"009551O2"`. Confirmar.

### Nomenclatura do arquivo MIT (RÍGIDA — se errar, não serve)

`<cnpj8>-MIT-<YYYYMM>.JSON`
- `cnpj8` = primeiros 8 dígitos do CNPJ da empresa (coluna D).
- `MIT` literal.
- `YYYYMM` = 4 díg ano + 2 díg mês (mês com zero à esquerda, ex.: `202605`).
- Ex.: `51287137-MIT-202605.JSON`.

Empacotar todos os JSONs num ZIP para download.

## Validação pendente

Construir conforme o layout acima, mas **validar com 1 planilha de apuração real** do Josué
(aba "Pis e Cofins") — leitura de colunas e match de empresa não foram testados contra arquivo real.
