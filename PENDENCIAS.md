# Pendências — SoftTech Fiscal

Itens conhecidos para resolver depois. Ordem não é prioridade.

## Aberto

### P1 — Worker Node NFCe não roda na máquina empresarial
- **Sintoma:** o download NFCe pelo worker Node (`worker/`) funciona na máquina pessoal, mas não na empresarial.
- **Impacto:** na empresa cai no fallback do browser (funciona, mas sem a escala/sem-CORS do worker).
- **Hipóteses a investigar:** firewall/antivírus bloqueando a porta `47620`; SmartScreen barrando o `.exe`; permissão de rede de saída p/ a SEFAZ-CE; Node ausente quando rodado como script (vs `.exe` empacotado).
- **Status:** adiado a pedido do usuário (2026-06-29).

### P1b — Rebuild do worker após mudança de identidade por grupo
- A UI agora endereça empresas por `id = <cnpj>-<YYYYMM>` (separação por mês). O worker (`worker/lib/nfce.js`) foi atualizado para casar.
- **Ação:** rebuildar/redistribuir o `.exe` do worker (na máquina pessoal) para a versão nova. Worker antigo + UI nova = anéis não atualizam (a UI tem fallback `id || cnpj`, mas o worker antigo não devolve `id`).

### P2 — Baixar NFe: teto de 20 consultas/hora inviabiliza lote grande
- **Medido em 2026-08-03** com certificado A1 real: a SEFAZ rejeita com cStat 656 —
  `Rejeicao: Consumo Indevido (Ultrapassou o limite de 20 consultas por hora)`.
- `consChNFe` (o modo implementado) gasta **1 consulta por nota**. Um mês de entradas
  reais (346 notas) precisaria de ~18 horas em rodadas de 20.
- **Mitigado, não resolvido:** o worker agora para no orçamento de 20 e entrega o ZIP do
  que baixou (`maxConsultas` em `worker/lib/nfe.js`); a tela avisa antes de começar.
- **Caminho para resolver:** `distNSU` — o modo em lote do mesmo webservice, até **50
  documentos por consulta** (20 consultas/hora × 50 = 1000 docs/hora). A spec original
  deixou fora de escopo (`docs/superpowers/specs/2026-07-22-baixar-nfe-xml-design.md`).
- **Risco a medir antes:** via `distNSU` a SEFAZ pode devolver `resNFe` (resumo) em vez
  de `procNFe` para notas sem manifestação do destinatário. Por `consChNFe` veio
  `procNFe` completo sem manifestação nenhuma — não se pode assumir que vale para os dois.

#### `distNSU` FUNCIONA — medido em 2026-08-14 em outro CNPJ

O bloqueio de 2026-08-03 era **do CNPJ da A&R**, não do serviço. Sondagem única
(`scripts/probe-distnsu.cjs`) num CNPJ diferente, com `ultNSU=0`, **não foi punida**:

```
cStat 138 | Documento(s) localizado(s)
ultNSU 000000000022844 | maxNSU 000000000023179 | docZip 50
21× procNFe_v4.00 · 23× resNFe_v1.01 · 6× resEvento_v1.01
```

Medido a partir desse lote (`scripts/analyze-distnsu-dump.cjs`, sem gastar consulta):

- **`procNFe` completo vem sem manifestação** — 21 dos 44. Os outros 23 vieram como
  resumo. Os NSU são **intercalados** (`resNFe` 22795..22844, `procNFe` 22798..22842),
  e não há evento 2102xx no lote: **o que separa completo de resumo continua desconhecido**.
  Não bloqueia — a regra operacional é pegar o completo e manifestar o resumo.
- **`distNSU` não entrega SAÍDAS.** Zero documentos com a empresa como emitente em 50
  amostras. Mesma regra do cStat 641 do `consChNFe`: a SEFAZ não redistribui ao emitente
  a nota que ele emitiu. **Não existe rota de API para XML de saída** — tem que vir do
  sistema emissor.
- **`ultNSU=0` é seguro em CNPJ sem consumidor externo.** A SEFAZ ignora o que passou dos
  90 dias e entrega do mais antigo vivo. Foi punido na A&R e não aqui: a variável é o CNPJ.
- **Volume:** estoque retido inteiro dessa empresa = 385 documentos = **8 chamadas**.
  O teto de 20/hora deixa de ser gargalo.

**Fronteira do Baixar NFe (confirmada com o usuario em 2026-08-14):** os XMLs de saida
vem do **sistema emissor do cliente**, por arquivo. Entradas por API, saidas por arquivo —
isso e fronteira do escopo, nao lacuna. Nenhuma rota de SEFAZ devolve ao emitente a nota
que ele emitiu.

- **Verificado em 2026-08-14 — o sistema JÁ ingere XML de saída por arquivo.** O grep
  fechou o assunto: existe caminho de saída, não só de entrada.
  - **Saída (empresa é a emitente): tela DIRBI.** `createDirbiPage`
    ([app.js:4204](assets/js/app.js#L4204)) → `processDirbiXmls`
    ([app.js:4318](assets/js/app.js#L4318)) agrupa por `emit>CNPJ`. Aceita `.xml` avulso
    e `.zip` (drop ou seleção múltipla) via `expandXmlInputs`
    ([app.js:3956](assets/js/app.js#L3956)). Com o worker Node ligado, aceita **caminho de
    pasta com subpastas** — `listFilesRec` em [worker/lib/dirbi.js:182](worker/lib/dirbi.js#L182),
    preso sob `INBOX_ROOT` contra travessia de diretório. Sem filtro de modelo: qualquer
    XML com `emit>CNPJ` entra (NF-e 55 e NFC-e 65).
  - **Entrada (empresa é a destinatária): tela ICMS Withholding.**
    `createIcmsWithholdingPage` ([app.js:2789](assets/js/app.js#L2789)) → `processIcmsXmls`
    ([app.js:3057](assets/js/app.js#L3057)), mesmo `expandXmlInputs`. Filtra
    `CFOP_VALIDOS` 5101/5102/5103/5105/5910 e `UF_VALIDO 23`
    ([app.js:2749](assets/js/app.js#L2749)) — CFOP de saída **do fornecedor**, que é
    entrada da empresa.
  - **`tpNF` não é lido em lugar nenhum do código.** A separação entrada/saída é feita por
    qual CNPJ agrupa (emitente vs destinatário), não pelo campo da NF-e.

- **Lacunas que sobram (não bloqueiam o Baixar NFe; nenhuma foi aprovada):**
  1. Ingestão de saída existe **só dentro da DIRBI** e só desemboca na planilha DIRBI. Não
     há importação de saída genérica que alimente outra apuração.
  2. **Pasta só pelo worker Node, e só na DIRBI.** No browser nenhuma tela tem
     `webkitdirectory` — pasta vira multi-seleção de arquivos ou `.zip`. Se valer a pena,
     é `webkitdirectory` no input de [app.js:4219](assets/js/app.js#L4219) (~1 linha, mais
     o filtro de extensão no handler de drop).
  3. **Nenhum XML é persistido.** Toda tela é upload → planilha → descarta (`indexedDB` só
     guarda file handles do SPED). Cada apuração reimporta os mesmos arquivos.

#### Sondagens de `distNSU` em 2026-08-03 — rejeitadas, e o diagnóstico estava incompleto

> Superado pela medição de 2026-08-14 acima. O serviço nunca esteve fechado; o CNPJ da
> A&R é que está. Mantido como registro do caso patológico.

Duas tentativas, com 1 h de intervalo, as duas com a mesma resposta:

```
cStat 656 | Rejeicao: Consumo Indevido (Deve ser utilizado o ultNSU nas
solicitacoes subsequentes. Tente apos 1 hora)
ultNSU retornado: 000000000103111 | maxNSU: 000000000000000
```

- 22:24 com `ultNSU=0` (partida do zero é punida, é o comportamento documentado).
- 23:30 com `ultNSU=103111` — o cursor que a própria SEFAZ devolveu na 1ª rejeição,
  que é o padrão de "solicitação subsequente". **Mesma rejeição**, e o `ultNSU` devolvido
  não mudou. Como na 1ª tentativa mandei `0` e recebi `103111`, o número é dado real da
  SEFAZ, não eco do que enviei: o fluxo DFe deste CNPJ já está em 103111.
- **Não sabemos ainda** se `distNSU` devolve `procNFe` ou `resNFe`: nenhuma das duas
  chamadas chegou a retornar documento.
- **Hipótese principal, não provada:** outro sistema (fsist ou o que a empresa usa)
  já consome esse fluxo e avançou o cursor até 103111. Se a penalidade/quota de consumo
  é por CNPJ, estamos disputando a mesma janela com um consumidor que não controlamos —
  o que inviabilizaria `distNSU` aqui sem antes descobrir e coordenar com esse consumidor.
- **Próximo passo sugerido (não é mais sondagem cega):** descobrir quem consome o fluxo
  da A&R antes de gastar outra hora. Sondar de novo só depois disso.

### P4 — Transferências: 43 notas de saída com chave mas sem CFOP
- **Medido em 2026-08-25** sobre os 10 relatórios de `Downloads/TRANSFERENCIAS`: 43 linhas
  trazem chave eletrônica de 44 dígitos válida, mas as células de CFOP e Valor Total vêm
  em branco — 21 na FILIAL 002, 12 na MATRIZ, 8 na 004, 2 na 005. Nenhuma na ENTRADA.
- Sem CFOP a nota não é classificável como transferência, então fica fora da checagem.
  Hoje isso vira aviso visível no modal (`assets/js/transf-check.js`), não mais silêncio.
- **A decidir:** o que essas linhas são no ERP — nota cancelada/denegada, célula mesclada
  perdida na exportação, ou nota sem itens. Se alguma puder ser transferência, a checagem
  está cega para até 43 notas e o tratamento precisa mudar.

### P5 — Transferências: 30 notas com CFOP 5152 na saída escrituradas como 1409 na entrada
- Das 148 transferências conferidas, 118 batem e **30 divergem, todas só no CFOP**.
  Valor idêntico nos dois lados em **30/30**; nenhuma nota ausente.
- Padrão: 28× saída `5152 / 5409` → entrada `1409`; 2× saída `5152` → entrada `1409`.
- Concentração: 26 das 30 saem da **FILIAL 002** (25 para a FILIAL 003).

**Hipótese descartada (2026-08-25).** A primeira leitura foi "o ERP consolida os CFOPs no
lado da entrada". Os dados contradizem:

| Medição na ENTRADA (2.296 notas) | |
|---|---|
| Notas com mais de um CFOP na mesma célula | 290 (12,6%) — `1102/1403` aparece 267× |
| Notas com CFOP 1409 | 133 |
| …com 1409 **sozinho** | 133 |
| …com 1409 acompanhado de outro CFOP | **0** |
| Notas com 1152 em qualquer posição | 6 |

O relatório de entrada exibe dois CFOPs quando eles existem (267 vezes). `1409` nunca vem
acompanhado. Logo não é artefato de exibição — a entrada está registrada só como 1409.

- **Leitura provisória:** a filial destinatária escritura a nota inteira como ST (1409),
  inclusive a parcela que a origem emitiu como 5152 (fora do ST). Confirmação é do contador.
- **Decidido (2026-08-25, Josué):** conferência validada — as 30 são divergência real de
  escrituração, não falso positivo. `compararTransferencias` (`assets/js/transf-check.js`)
  **fica como está**: igualdade de conjunto de CFOPs é a regra correta. O achado é fiscal,
  não de software — tratar na escrituração da filial destinatária.
- Planilha de conferência com as 30 notas (chave de acesso completa) gerada em 2026-08-25.

### P3 — Rebundle do worker (`download/softtech-worker.zip`) desatualizado
- `scripts/bundle-worker.js` passou a incluir `lib/access.js` (token/allowlist) e
  `lib/nfe.js`. O zip publicado em `download/` ainda é o antigo: quem baixar hoje pega um
  worker que quebra no `require('./lib/access')`.
- **Ação:** rodar `node scripts/bundle-worker.js` e republicar. Ver também P1b.

## Resolvido

### ✓ Zip NFCe — separação por mês + nome com mês 2 dígitos (2026-06-29)
- Agrupamento passou de só-CNPJ para `CNPJ + mês`: meses diferentes da mesma empresa geram ZIPs separados.
- Nome do ZIP: `NFCe Mai-2026_...` → `NFCe 05-2026_...` (mês numérico 2 dígitos).
- Arquivos: `assets/js/app.js` (`buildCompanies`, `monthYearFromKey`, `createCompany`, `applyStatus`, `downloadCompanyZip`, `runBrowser`), `worker/lib/nfce.js` (`startJob`, `companyStatus`, `getCompanyDetail`, `getCompanyZip`).
