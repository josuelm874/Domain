# Guia Rápido - API ICMS ST

## 🚀 Iniciar o Servidor Python

### Passo 1: Instalar dependências (apenas na primeira vez)

**Windows:**
- Duplo clique em `install_simple.bat`
- OU execute no terminal: `python -m pip install Flask flask-cors openpyxl lxml Werkzeug`

**Linux/Mac:**
```bash
cd api_icms
pip3 install Flask flask-cors openpyxl lxml Werkzeug
```

**Nota:** A instalação do `lxml` pode demorar alguns minutos (compilação). Aguarde até concluir.

### Passo 2: Iniciar o servidor

**Windows (Recomendado - Início Automático):**
- Duplo clique em `auto_start_api.bat` (monitor que reinicia automaticamente se parar)
- OU para iniciar com Windows: `install_as_service.bat` (instala na inicialização do sistema)

**Windows (Início Manual):**
- Duplo clique em `start_api.bat`
- OU execute no terminal: `python api_icms.py`

**Linux/Mac:**
- Execute: `./start_api.sh`
- OU execute: `python3 api_icms.py`

### Passo 3: Verificar se está rodando
Você deve ver a mensagem:
```
🚀 API ICMS ST iniciando...
📁 Diretório temporário: ...
 * Running on http://0.0.0.0:5000
```

## ✅ Como Usar na Aplicação Web

1. **Inicie o servidor Python** (veja Passo 2 acima)
2. **Abra a aplicação web** no navegador
3. **Carregue o modelo Excel** "ICMS ST.xlsx"
4. **Selecione os arquivos XML** para processar
5. **Clique em "Processar XMLs"**

A aplicação irá:
- ✅ Tentar usar a API Python primeiro (preserva fórmulas perfeitamente)
- ⚠️ Se a API não estiver disponível, usar processamento JavaScript local (fórmulas podem falhar)

## 🔍 Verificar se está funcionando

A aplicação mostrará uma das mensagens:

- ✅ **"Planilha gerada com sucesso via Python"** = API Python funcionando (fórmulas preservadas)
- ⚠️ **"Processando localmente com JavaScript"** = API não disponível (fórmulas podem falhar)

## 🛠️ Solução de Problemas

### Erro: "API Python não está disponível"
- Verifique se o servidor Python está rodando
- Abra http://localhost:5000/api/icms/health no navegador
- Deve retornar: `{"status":"ok","service":"ICMS ST API"}`

### Erro: "ModuleNotFoundError: No module named 'flask'"
- **Windows:** Execute `install_simple.bat` ou `python -m pip install Flask flask-cors openpyxl lxml Werkzeug`
- **Linux/Mac:** Execute `pip3 install Flask flask-cors openpyxl lxml Werkzeug`
- Aguarde a instalação concluir (lxml pode demorar alguns minutos)

### Porta 5000 já em uso
- Altere a porta no arquivo `api_icms.py` (linha 241)
- Altere também `ICMS_API_URL` no arquivo `app.js` (linha 2570)

## 📝 Notas Importantes

- **Mantenha o servidor Python rodando** enquanto usar a aplicação
- A API Python usa **openpyxl** que preserva fórmulas e tabelas perfeitamente
- O processamento JavaScript local é apenas um **fallback** caso a API não esteja disponível
- **Nomenclatura das planilhas:** `ICMS ST {periodo}_{razao_social}.xlsx` (igual ao script Python original)
- **Início automático:** Use `auto_start_api.bat` para monitorar e reiniciar automaticamente, ou `install_as_service.bat` para iniciar com o Windows
