@echo off
echo ========================================
echo   Instalando dependencias da API ICMS
echo ========================================
echo.
echo Isso pode levar alguns minutos...
echo.

cd /d "%~dp0"

echo [1/4] Instalando Flask...
python -m pip install Flask==3.0.0
if errorlevel 1 (
    echo ERRO ao instalar Flask
    pause
    exit /b 1
)

echo.
echo [2/4] Instalando flask-cors...
python -m pip install flask-cors==4.0.0
if errorlevel 1 (
    echo ERRO ao instalar flask-cors
    pause
    exit /b 1
)

echo.
echo [3/4] Instalando openpyxl...
python -m pip install openpyxl==3.1.2
if errorlevel 1 (
    echo ERRO ao instalar openpyxl
    pause
    exit /b 1
)

echo.
echo [4/4] Instalando lxml (pode demorar alguns minutos)...
python -m pip install lxml==5.1.0
if errorlevel 1 (
    echo ERRO ao instalar lxml
    echo.
    echo Tentando instalar versao pre-compilada...
    python -m pip install --only-binary :all: lxml
    if errorlevel 1 (
        echo ERRO ao instalar lxml
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo   Instalacao concluida com sucesso!
echo ========================================
echo.
echo Agora voce pode executar: start_api.bat
echo.
pause
