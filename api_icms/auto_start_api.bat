@echo off
title API ICMS ST - Monitor e Auto Start
echo ========================================
echo   API ICMS ST - Monitor Automatico
echo ========================================
echo.

cd /d "%~dp0"

REM Verificar dependencias
python -c "import flask" 2>nul
if errorlevel 1 (
    echo ERRO: Dependencias nao instaladas!
    echo Execute: install_simple.bat
    pause
    exit /b 1
)

:check
REM Verificar se API esta rodando usando PowerShell (mais confiavel que curl)
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:5000/api/icms/health' -TimeoutSec 2 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% == 0 (
    echo [%time%] API esta rodando - OK
    timeout /t 60 >nul
    goto check
)

echo [%time%] API nao esta rodando. Iniciando...
echo.

REM Verificar se ja existe processo Python rodando na porta 5000
netstat -ano | findstr ":5000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo Porta 5000 ja esta em uso. Aguardando...
    timeout /t 5 >nul
    goto check
)

REM Iniciar servidor em nova janela minimizada
start "API ICMS ST" /min python api_icms.py

REM Aguardar servidor iniciar (max 10 segundos)
set /a tentativas=0
:wait
timeout /t 2 >nul
set /a tentativas+=1
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:5000/api/icms/health' -TimeoutSec 1 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% == 0 (
    echo [%time%] API iniciada com sucesso!
    goto check
)
if %tentativas% geq 5 (
    echo [%time%] ERRO: API nao iniciou apos 10 segundos. Tentando novamente...
    timeout /t 5 >nul
    goto check
)
goto wait
