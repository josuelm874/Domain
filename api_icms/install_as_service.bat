@echo off
echo ========================================
echo   Instalar API ICMS ST - Inicio Automatico
echo ========================================
echo.
echo Este script criara um atalho na pasta de inicializacao
echo para que a API inicie automaticamente com o Windows.
echo.
pause

cd /d "%~dp0"

REM Criar script de inicializacao que usa o monitor
echo @echo off > "%TEMP%\icms_api_autostart.bat"
echo cd /d "%~dp0" >> "%TEMP%\icms_api_autostart.bat"
echo start /min "API ICMS ST Monitor" "%~dp0auto_start_api.bat" >> "%TEMP%\icms_api_autostart.bat"

REM Copiar para pasta de inicializacao
set "startup_path=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy "%TEMP%\icms_api_autostart.bat" "%startup_path%\icms_api_autostart.bat" >nul 2>&1

if %errorlevel% == 0 (
    echo.
    echo ========================================
    echo   Instalado com sucesso!
    echo ========================================
    echo.
    echo A API iniciara automaticamente quando o Windows iniciar.
    echo O monitor verificara a cada minuto se a API esta rodando.
    echo.
    echo Para remover, delete o arquivo:
    echo %startup_path%\icms_api_autostart.bat
    echo.
    echo Para iniciar agora, execute: auto_start_api.bat
    echo.
) else (
    echo.
    echo ERRO ao instalar.
    echo Tente executar como Administrador.
    echo.
)

pause
