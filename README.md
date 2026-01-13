# Sistema ICMS - Sistema Interativo

Sistema para processamento de XMLs de ICMS ST com sincronização compartilhada entre múltiplos PCs.

## 🚀 Funcionalidades

- ✅ Processamento de XMLs de ICMS ST
- ✅ Extração automática de dados (CNPJ, Período, Produtos)
- ✅ Filtros por CST/CSOSN (Alíquotas 1,54%, 4%, 7%)
- ✅ Geração de planilha Excel preservando formatações
- ✅ Sincronização compartilhada via Supabase
- ✅ Múltiplos usuários simultâneos

## 📋 Tecnologias

- HTML5, CSS3, JavaScript
- ExcelJS (para manipulação de Excel)
- Supabase (para sincronização de dados)


## 📁 Estrutura do Projeto

```
SerconProgamming/
├── Dominium.html          # Página principal
├── index.html             # Redirecionamento para GitHub Pages
├── assets/
│   ├── js/
│   │   ├── app.js         # Código principal
│   │   ├── supabase-sync.js  # Sincronização Supabase
│   │   └── ICMS ST.xlsx   # Modelo Excel
│   ├── css/
│   │   └── main.css       # Estilos
│   └── images/            # Imagens
├── netlify.toml           # Configuração Netlify
└── README.md              # Este arquivo
```

## 🔒 Segurança

- Senhas são criptografadas com hash antes de salvar
- Credenciais do Supabase (anon key) são públicas por design (seguro)
- Dados protegidos por Row Level Security (RLS) do Supabase


## 🛠️ Desenvolvimento

### Estrutura de Dados

Os dados são armazenados no Supabase na tabela `system_data`:
- `key`: Nome do dado (ex: "registeredUsers", "users")
- `value`: Dados em formato JSON
- `updated_at`: Timestamp da última atualização

## 📝 Licença

Este é um projeto privado. Todos os direitos reservados.
