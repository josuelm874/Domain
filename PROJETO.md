# SoftTech Fiscal — Sistema de Processamento ICMS ST

> Sistema web para processamento de XMLs fiscais de ICMS Substituição Tributária, com geração automática de planilhas Excel e sincronização entre múltiplos computadores.

---

## Índice

1. [O que é este sistema](#1-o-que-é-este-sistema)
2. [Para quem é feito](#2-para-quem-é-feito)
3. [Como rodar o projeto](#3-como-rodar-o-projeto)
4. [Estrutura de arquivos](#4-estrutura-de-arquivos)
5. [Arquitetura e funcionamento](#5-arquitetura-e-funcionamento)
6. [API Python — ICMS ST](#6-api-python--icms-st)
7. [Banco de dados — Supabase](#7-banco-de-dados--supabase)
8. [Tecnologias utilizadas](#8-tecnologias-utilizadas)
9. [Guia educativo — entenda cada parte](#9-guia-educativo--entenda-cada-parte)
10. [Como dar continuidade ao projeto](#10-como-dar-continuidade-ao-projeto)

---

## 1. O que é este sistema

O **SoftTech Fiscal** é um sistema para processamento de arquivos XML de **ICMS ST** (Imposto sobre Circulação de Mercadorias e Serviços — Substituição Tributária). Ele automatiza um processo que normalmente é feito manualmente: ler os XMLs fiscais, extrair os dados relevantes (CNPJ, período, produtos e valores), filtrar por tipo de tributação, e gerar uma planilha Excel formatada.

**Em linguagem simples:** o contador recebe vários arquivos XML das notas fiscais de um cliente. Em vez de abrir cada um manualmente para copiar os dados para uma planilha, ele arrasta todos para o sistema — e em segundos recebe uma planilha Excel pronta, preservando todas as fórmulas e tabelas do modelo.

### O que ele resolve

- Trabalho manual e repetitivo de copiar dados de XMLs para planilhas
- Erros humanos durante a digitação de valores fiscais
- Necessidade de instalar softwares pesados (o sistema roda no navegador)
- Dados não sincronizados entre computadores da equipe
- Fórmulas do Excel quebradas ao usar ferramentas JavaScript simples (resolvido com a API Python)

---

## 2. Para quem é feito

| Perfil | Uso no sistema |
|--------|----------------|
| **Contador / Fiscal** | Processa XMLs, gera planilhas, consulta dados |
| **Equipe do escritório** | Acessa dados sincronizados via Supabase |
| **Administrador** | Gerencia usuários e permissões |

---

## 3. Como rodar o projeto

### Interface web (navegador)

O sistema roda diretamente no navegador. Abra o arquivo `Dominium.html` via servidor local:

```bash
# Opção simples com Node.js
npx serve .

# Acessar:
# http://localhost:3000/Dominium.html
```

### API Python (obrigatória para geração de Excel)

A API Python é necessária para preservar fórmulas e tabelas do Excel. Sem ela, o sistema usa um fallback JavaScript que pode não preservar todas as fórmulas.

**Windows — instalação:**

```bash
# Instalar dependências (apenas uma vez)
cd api_icms
python -m pip install Flask flask-cors openpyxl lxml Werkzeug
```

**Windows — iniciar:**

```bash
# Opção 1: Monitorado (reinicia automaticamente se parar) — RECOMENDADO
auto_start_api.bat

# Opção 2: Iniciar com o Windows (instala como serviço)
install_as_service.bat

# Opção 3: Manual
start_api.bat
```

**Linux/Mac:**

```bash
cd api_icms
pip3 install Flask flask-cors openpyxl lxml Werkzeug
./start_api.sh
```

A API ficará disponível em `http://localhost:5000`. Para verificar:

```
http://localhost:5000/api/icms/health
# Resposta esperada: {"status":"ok","service":"ICMS ST API"}
```

---

## 4. Estrutura de arquivos

```
softtech-fiscal/
│
├── Dominium.html                 # Interface principal do sistema
├── index.html                    # Redirecionamento (usado para deploy GitHub Pages)
│
├── assets/
│   ├── js/
│   │   ├── app.js                # Lógica principal (~9.490 linhas)
│   │   ├── orders.js             # Gerenciamento de ordens/pedidos
│   │   ├── supabase-sync.js      # Sincronização com Supabase
│   │   └── ICMS ST.xlsx          # Modelo Excel usado como base para geração
│   ├── css/
│   │   └── main.css              # Estilos visuais
│   └── images/                   # Logos, avatares e ícones
│
├── api_icms/                     # API Python para processamento Excel
│   ├── api_icms.py               # Servidor Flask (API principal)
│   ├── requirements.txt          # Dependências Python
│   ├── start_api.bat             # Inicialização simples (Windows)
│   ├── auto_start_api.bat        # Inicialização com monitoramento (Windows)
│   ├── install_as_service.bat    # Instala como serviço do Windows
│   ├── install_simple.bat        # Instala dependências (Windows)
│   ├── start_api.sh              # Inicialização (Linux/Mac)
│   ├── GUIA_RAPIDO.md            # Guia de uso da API
│   └── CHANGELOG.md              # Histórico de versões da API
│
├── .py/                          # Scripts Python auxiliares
│   ├── Contribuicao_Ajuste.py    # Ajuste de contribuições
│   └── Eliminar_Inventario.py    # Eliminação de inventário
│
├── cest_backup_inicial.json      # Backup inicial da tabela CEST
└── PROJETO.md                    # Este arquivo
```

---

## 5. Arquitetura e funcionamento

### Fluxo principal de processamento

```
Usuário seleciona:
  ├── Modelo Excel (ICMS ST.xlsx)
  └── Arquivos XML (um ou vários)
           │
           ▼
    app.js (navegador)
    ├── Lê os XMLs
    ├── Extrai dados: CNPJ, período, produtos, valores
    ├── Filtra por CST/CSOSN (1,54% / 4% / 7%)
    └── Envia para API Python via fetch()
           │
           ▼
    api_icms.py (localhost:5000)
    ├── Recebe modelo Excel e dados extraídos
    ├── Usa openpyxl para preencher a planilha
    ├── Preserva fórmulas, tabelas e formatação
    └── Retorna arquivo .xlsx pronto
           │
           ▼
    Navegador faz download automático:
    "ICMS ST {periodo}_{razao_social}.xlsx"
```

### Por que duas camadas (JS + Python)?

O JavaScript no navegador tem limitações sérias ao trabalhar com Excel. A biblioteca ExcelJS (JS) não consegue preservar fórmulas complexas e tabelas nomeadas do Excel. O Python com openpyxl faz isso perfeitamente.

**Solução adotada:** o JavaScript faz a leitura e extração dos XMLs (algo que faz bem), e o Python faz a escrita no Excel (algo que faz melhor). O JavaScript serve apenas como fallback se a API não estiver rodando.

### Sincronização entre computadores

```
PC 1 (salva dados)  ──► Supabase (nuvem) ──► PC 2 (lê dados)
```

Toda a equipe do escritório acessa os mesmos dados em tempo real. Usuários, contribuintes, configurações — tudo fica no Supabase.

---

## 6. API Python — ICMS ST

### Endpoints disponíveis

| Método | Rota | Função |
|--------|------|--------|
| `GET` | `/api/icms/health` | Verifica se a API está rodando |
| `POST` | `/api/icms/process` | Processa XMLs e retorna Excel |

### Como o endpoint `/process` funciona

```
Recebe (FormData):
  modelo  → arquivo Excel modelo (.xlsx)
  xmls    → um ou mais arquivos XML

Retorna:
  → arquivo .xlsx como download direto
```

### Exemplo de chamada (JavaScript)

```javascript
const formData = new FormData();
formData.append('modelo', modeloFile);
xmlFiles.forEach(xml => formData.append('xmls', xml));

const response = await fetch('http://localhost:5000/api/icms/process', {
  method: 'POST',
  body: formData
});

// Baixa o arquivo gerado
const blob = await response.blob();
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'ICMS ST.xlsx';
link.click();
```

### Filtros de tributação aplicados

O sistema filtra os produtos do XML pelos seguintes critérios CST/CSOSN:

| Filtro | Alíquota | Aplicação |
|--------|----------|-----------|
| CST específicos | 1,54% | Regime Normal |
| CST específicos | 4% | Regime Normal |
| CST específicos | 7% | Regime Normal / Simples |

---

## 7. Banco de dados — Supabase

### Tabela `system_data`

Armazena todos os dados do sistema de forma sincronizada.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `key` | text (PK) | Nome do dado (ex: "registeredUsers") |
| `value` | jsonb | Dados em formato JSON |
| `updated_at` | timestamptz | Data/hora da última atualização |

### Configuração no código

Preencha `assets/js/config.js` (copiado de `config.example.js`, gitignored):

- **SUPABASE_CONFIG.url** — URL do projeto (Project Settings → API)
- **SUPABASE_CONFIG.publishableKey** — publishable/anon key (pública, segura no frontend)

### Segurança

- **Senhas:** armazenadas como hash (não em texto puro)
- **Chave anon:** é a chave pública do Supabase, segura para estar no código frontend
- **RLS (Row Level Security):** configurar no Supabase Dashboard para proteger dados sensíveis

---

## 8. Tecnologias utilizadas

| Tecnologia | Função | Por que foi escolhida |
|------------|--------|-----------------------|
| HTML5 / CSS3 / JS Vanilla | Interface do sistema | Sem dependências de frameworks, leve e rápido |
| Python + Flask | API de processamento Excel | Única solução confiável para preservar fórmulas |
| openpyxl | Manipulação de Excel no Python | Biblioteca madura, preserva 100% das estruturas |
| lxml | Leitura de XMLs fiscais | Alta performance na leitura de arquivos XML |
| ExcelJS | Fallback JavaScript para Excel | Usado apenas quando a API Python não está disponível |
| Supabase | Banco de dados na nuvem | Sincronização simples sem servidor próprio |
| Flask-CORS | Permissão cross-origin | Permite que o navegador acesse a API local |

---

## 9. Guia educativo — entenda cada parte

### O que é ICMS ST?

**ICMS** é o imposto estadual sobre circulação de mercadorias. A **Substituição Tributária (ST)** é um regime onde quem paga o imposto de toda a cadeia é o primeiro da cadeia (indústria/importador), não o varejista. Para calcular o valor correto, o contador precisa processar as notas fiscais e extrair os valores específicos.

### O que é um arquivo XML fiscal?

XML (eXtensible Markup Language) é um formato de texto para trocar dados de forma estruturada. As notas fiscais eletrônicas (NF-e) são emitidas como arquivos XML. Dentro do XML, cada produto tem um código CST/CSOSN que indica o regime tributário.

Exemplo simplificado de um trecho de XML fiscal:

```xml
<det nItem="1">
  <prod>
    <xProd>ARROZ TIPO 1 5KG</xProd>
    <NCM>10063021</NCM>
    <vProd>150.00</vProd>
  </prod>
  <imposto>
    <ICMS>
      <ICMSST>
        <CST>60</CST>
        <vICMSST>7.23</vICMSST>
      </ICMSST>
    </ICMS>
  </imposto>
</det>
```

### Por que o Python é necessário?

Ao trabalhar com Excel, o JavaScript consegue criar planilhas simples. Mas planilhas complexas com fórmulas como `=SOMA(Tabela2[Valor])` são destruídas pelo JavaScript — as fórmulas somem. O Python com openpyxl consegue abrir o Excel modelo, preencher apenas as células necessárias, e salvar mantendo tudo intacto.

### O que é uma API REST?

Uma API REST é como um cardápio de restaurante: você pede um prato específico (faz uma requisição para uma rota), e o cozinheiro (servidor) prepara e te entrega (resposta). No caso da API ICMS:

```
Você pede:  POST /api/icms/process  (enviando XMLs e o modelo Excel)
API entrega: arquivo .xlsx pronto para download
```

### O que é CST/CSOSN?

São códigos numéricos que identificam como um produto é tributado:
- **CST** (Código de Situação Tributária): usado por empresas do regime normal
- **CSOSN** (Código de Situação da Operação do Simples Nacional): usado por empresas do Simples Nacional

O sistema filtra os produtos do XML com base nesses códigos para calcular corretamente o ICMS ST.

---

## 10. Como dar continuidade ao projeto

### Para um novo desenvolvedor começar

1. Leia este arquivo inteiro
2. Instale as dependências da API Python (`api_icms/install_simple.bat`)
3. Inicie a API (`api_icms/auto_start_api.bat`)
4. Abra `Dominium.html` via `npx serve .`
5. Configure o Supabase em `assets/js/supabase-sync.js`
6. O arquivo principal de lógica é `assets/js/app.js`

### Pontos de atenção

- **Sempre mantenha a API Python rodando** enquanto usar o sistema
- Se a porta 5000 estiver ocupada, altere em `api_icms.py` linha 241 e em `app.js` na variável `ICMS_API_URL`
- O arquivo `ICMS ST.xlsx` em `assets/js/` é o modelo base — não altere sua estrutura

### Próximos passos naturais para evolução

- Interface de upload mais moderna (drag-and-drop com preview dos XMLs)
- Histórico de processamentos (salvo no Supabase)
- Validação dos XMLs antes de processar (verificar integridade)
- Dashboard com estatísticas (total processado, valores por período)
- Suporte a outros tipos de XML fiscal além de ICMS ST

---

*Documento gerado em maio de 2026 — SoftTech Fiscal*
