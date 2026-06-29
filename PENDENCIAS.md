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

## Resolvido

### ✓ Zip NFCe — separação por mês + nome com mês 2 dígitos (2026-06-29)
- Agrupamento passou de só-CNPJ para `CNPJ + mês`: meses diferentes da mesma empresa geram ZIPs separados.
- Nome do ZIP: `NFCe Mai-2026_...` → `NFCe 05-2026_...` (mês numérico 2 dígitos).
- Arquivos: `assets/js/app.js` (`buildCompanies`, `monthYearFromKey`, `createCompany`, `applyStatus`, `downloadCompanyZip`, `runBrowser`), `worker/lib/nfce.js` (`startJob`, `companyStatus`, `getCompanyDetail`, `getCompanyZip`).
