# Changelog - API ICMS ST

## ✅ Melhorias Implementadas

### 1. Nomenclatura das Planilhas
- ✅ **Formato igual ao Python original**: `ICMS ST {periodo}_{razao_social}.xlsx`
- ✅ Sanitização automática de caracteres inválidos no nome do arquivo
- ✅ JavaScript extrai corretamente o nome do arquivo do header `Content-Disposition`

### 2. Inicialização Automática da API

#### Opção 1: Monitor Automático (`auto_start_api.bat`)
- Monitora a API a cada minuto
- Reinicia automaticamente se a API parar
- Verifica dependências antes de iniciar
- Usa PowerShell para verificação mais confiável

#### Opção 2: Início com Windows (`install_as_service.bat`)
- Instala atalho na pasta de inicialização do Windows
- API inicia automaticamente quando o Windows iniciar
- Usa o monitor automático para garantir que continue rodando

### 3. Melhorias Técnicas
- ✅ Melhor extração do nome do arquivo no JavaScript (suporta UTF-8)
- ✅ Sanitização de caracteres inválidos no nome do arquivo (Windows)
- ✅ Documentação atualizada com todas as opções de inicialização

## 📋 Como Usar

### Início Automático (Recomendado)
```bash
# Windows: Execute uma vez e deixe rodando
auto_start_api.bat
```

### Início com Windows
```bash
# Windows: Instala para iniciar automaticamente com o sistema
install_as_service.bat
```

### Início Manual
```bash
# Windows
start_api.bat

# Linux/Mac
./start_api.sh
```

## 🔍 Verificação

A API está funcionando se:
- ✅ Responde em `http://localhost:5000/api/icms/health`
- ✅ A aplicação web mostra: "Planilha gerada com sucesso via Python"
- ✅ As planilhas geradas têm o nome: `ICMS ST {periodo}_{razao_social}.xlsx`
