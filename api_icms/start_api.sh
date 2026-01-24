#!/bin/bash
echo "========================================"
echo "  API ICMS ST - Servidor Python"
echo "========================================"
echo ""
echo "Iniciando servidor em http://localhost:5000"
echo ""
echo "Para parar o servidor, pressione Ctrl+C"
echo ""
echo "========================================"
echo ""

cd "$(dirname "$0")"
python3 api_icms.py
