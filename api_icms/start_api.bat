@echo off
echo ========================================
echo   API ICMS ST - Servidor Python
echo ========================================
echo.

cd /d "%~dp0"

echo Verificando dependencias...
python -c "import flask" 2>nul
if errorlevel 1 (
    echo.
    echo ERRO: Dependencias nao instaladas!
    echo.
    echo Execute primeiro: install_simple.bat
    echo OU: python -m pip install Flask flask-cors openpyxl lxml Werkzeug
    echo.
    pause
    exit /b 1
)

echo Dependencias OK!
echo.
echo Iniciando servidor em http://localhost:5000
echo.
echo Para parar o servidor, pressione Ctrl+C
echo.
echo ========================================
echo.

python api_icms.py

pause
