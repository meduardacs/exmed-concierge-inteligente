@echo off
setlocal
cd /d "%~dp0"
title Exmed Concierge Inteligente - Demonstracao

echo.
echo  =============================================
echo     EXMED CONCIERGE - AMBIENTE DE TESTES
 echo  =============================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Criando ambiente virtual Python...
    py -m venv .venv
    if errorlevel 1 (
        echo O inicializador py nao esta disponivel. Tentando python...
        python -m venv .venv
    )
)
if not exist ".venv\Scripts\python.exe" (
    echo.
    echo ERRO: nao foi possivel criar o ambiente Python.
    echo Instale Python 3.11 ou superior: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [2/3] Conferindo dependencias...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo ERRO: instalacao das dependencias falhou. Consulte o README.md.
    pause
    exit /b 1
)

echo.
echo [3/3] Iniciando servidor...
echo.
echo   Acesse: http://127.0.0.1:8000
 echo   API:    http://127.0.0.1:8000/docs
 echo.
echo   Pressione CTRL+C para encerrar.
echo.
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
endlocal
