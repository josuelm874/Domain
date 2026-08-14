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

- **A verificar (1 grep, nao feito):** o sistema ja ingere pasta/zip de XML de saida, ou o
  contador faz na mao? Se ja ingere, o assunto esta fechado. Se nao, e feature de
  importacao de arquivo — barata perto do `distNSU` e sem quota envolvida.

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
