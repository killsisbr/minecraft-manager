@echo off
title Minecraft Server Manager - Inicialização

echo === Minecraft Server Manager - Inicialização ===

REM Verificar se o Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Erro: Node.js não encontrado. Por favor, instale o Node.js primeiro.
    pause
    exit /b 1
)

echo Node.js encontrado:
node --version

REM Verificar se o npm está instalado
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Erro: npm não encontrado. Por favor, instale o npm primeiro.
    pause
    exit /b 1
)

echo npm encontrado:
npm --version

REM Verificar se as dependências estão instaladas
if not exist "node_modules" (
    echo Dependências não encontradas. Executando setup...
    call setup.bat
)

REM Criar diretório de logs se não existir
if not exist "minecraft-server\logs" (
    mkdir minecraft-server\logs
)

REM Iniciar o servidor
echo Iniciando servidor web...
echo Acesse http://localhost:3000 no seu navegador
echo Pressione Ctrl+C para parar o servidor
echo.

REM Iniciar o servidor em modo de desenvolvimento
npm start