#!/usr/bin/env python3
"""
Script para gerar automaticamente o arquivo index.json
que lista todos os arquivos Python na pasta assets/py/

Execute este script sempre que adicionar novos arquivos Python.
Ou configure para executar automaticamente.
"""

import os
import json

# Diretório onde estão os arquivos Python
PY_DIR = os.path.dirname(os.path.abspath(__file__))

# Nome do arquivo de índice
INDEX_FILE = os.path.join(PY_DIR, 'index.json')

def generate_index():
    """Gera o arquivo index.json com lista de arquivos .py"""
    # Listar todos os arquivos .py no diretório
    python_files = []
    
    if os.path.exists(PY_DIR):
        for filename in os.listdir(PY_DIR):
            if filename.endswith('.py') and filename != 'generate_index.py':
                python_files.append(filename)
    
    # Ordenar alfabeticamente
    python_files.sort()
    
    # Criar estrutura do índice
    index_data = {
        "files": python_files,
        "generated_at": None,
        "total_files": len(python_files)
    }
    
    # Salvar em index.json
    with open(INDEX_FILE, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, indent=2, ensure_ascii=False)
    
    print(f"✅ index.json gerado com {len(python_files)} arquivo(s) Python:")
    for filename in python_files:
        print(f"   - {filename}")
    
    return python_files

if __name__ == '__main__':
    generate_index()
