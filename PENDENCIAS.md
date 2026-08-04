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

#### Sondagens de `distNSU` em 2026-08-03 — ambas rejeitadas, pergunta em aberto

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
