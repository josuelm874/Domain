# API Python para Processamento ICMS ST

Esta API usa Python (openpyxl) para processar ICMS ST, garantindo que **fórmulas e tabelas sejam preservadas corretamente** (ao contrário do ExcelJS que tem problemas com isso).

## Por que usar esta API?

- ✅ **Preserva fórmulas perfeitamente** - openpyxl mantém todas as fórmulas intactas
- ✅ **Preserva tabelas do Excel** - Tabela2, Tabela22, etc. funcionam corretamente
- ✅ **Baseado no script Python que funciona** - Usa exatamente a mesma lógica do `Retencao_Autonoma.py`
- ✅ **Sem problemas de corrupção** - Não precisa reparar arquivos Excel

## Instalação

```bash
# Navegar para a pasta da API
cd api_icms

# Instalar dependências
pip install -r requirements.txt
```

## Execução

### Windows:

**Opção 1: Início Automático (Recomendado)**
```bash
# Monitor que inicia automaticamente se a API parar
auto_start_api.bat
```

**Opção 2: Início Manual**
```bash
# Executar uma vez
start_api.bat

# OU executar diretamente
python api_icms.py
```

**Opção 3: Iniciar com Windows (Serviço)**
```bash
# Instalar para iniciar automaticamente quando o Windows iniciar
install_as_service.bat
```

### Linux/Mac:
```bash
# Opção 1: Usar o script shell
chmod +x start_api.sh
./start_api.sh

# Opção 2: Executar diretamente
python3 api_icms.py
```

A API estará disponível em `http://localhost:5000`

**Importante:** Mantenha o servidor rodando enquanto usar a aplicação web.

## Nomenclatura das Planilhas

As planilhas geradas seguem o mesmo formato do script Python original:
```
ICMS ST {periodo}_{razao_social}.xlsx
```

Exemplo: `ICMS ST 07-2025_A & R COMERCIAL DE ALIMENTOS LTDA.xlsx`

Caracteres inválidos para nomes de arquivo são automaticamente removidos.

## Endpoints

- `GET /api/icms/health` - Health check
- `POST /api/icms/process` - Processar ICMS ST
  - FormData:
    - `modelo`: Arquivo Excel modelo (.xlsx)
    - `xmls`: Um ou mais arquivos XML

## Exemplo de uso (JavaScript)

```javascript
const formData = new FormData();
formData.append('modelo', modeloFile);
xmlFiles.forEach(xml => formData.append('xmls', xml));

const response = await fetch('http://localhost:5000/api/icms/process', {
    method: 'POST',
    body: formData
});

const blob = await response.blob();
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'ICMS ST.xlsx';
link.click();
```
