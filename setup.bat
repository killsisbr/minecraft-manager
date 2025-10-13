@echo off
title Minecraft Server Manager - Setup

echo === Minecraft Server Manager - Setup Automático ===
echo Iniciando processo de setup...

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

REM Instalar dependências do projeto
echo Instalando dependências do projeto...
npm install

REM Verificar se a instalação foi bem sucedida
if %errorlevel% neq 0 (
    echo Erro: Falha ao instalar dependências.
    pause
    exit /b 1
)

REM Criar diretório do servidor Minecraft se não existir
if not exist "minecraft-server" (
    echo Criando diretório do servidor Minecraft...
    mkdir minecraft-server
    mkdir minecraft-server\plugins
    mkdir minecraft-server\logs
    
    REM Criar arquivos de configuração de exemplo
    echo # Minecraft server properties> minecraft-server\server.properties
    echo # Generated on %date%>> minecraft-server\server.properties
    echo gamemode=survival>> minecraft-server\server.properties
    echo difficulty=easy>> minecraft-server\server.properties
    echo level-type=default>> minecraft-server\server.properties
    echo max-players=20>> minecraft-server\server.properties
    echo online-mode=true>> minecraft-server\server.properties
    
    echo # Configuration file> minecraft-server\config.yml
    echo server-name: My Minecraft Server>> minecraft-server\config.yml
    echo motd: Welcome to our server!>> minecraft-server\config.yml
    echo world:>> minecraft-server\config.yml
    echo   name: world>> minecraft-server\config.yml
    echo   seed: 12345>> minecraft-server\config.yml
    echo   generator: default>> minecraft-server\config.yml
    echo plugins:>> minecraft-server\config.yml
    echo   enabled:>> minecraft-server\config.yml
    echo     - essentials>> minecraft-server\config.yml
    echo     - worldedit>> minecraft-server\config.yml
    
    echo # Bukkit configuration file> minecraft-server\bukkit.yml
    echo # Settings for the Bukkit server implementation>> minecraft-server\bukkit.yml
    echo.>> minecraft-server\bukkit.yml
    echo settings:>> minecraft-server\bukkit.yml
    echo   allow-end: true>> minecraft-server\bukkit.yml
    echo   warn-on-overload: true>> minecraft-server\bukkit.yml
    echo   permissions-file: permissions.yml>> minecraft-server\bukkit.yml
    echo   update-folder: update>> minecraft-server\bukkit.yml
    echo   plugin-profiling: false>> minecraft-server\bukkit.yml
    echo   connection-throttle: 4000>> minecraft-server\bukkit.yml
    echo   query-plugins: true>> minecraft-server\bukkit.yml
    echo   deprecated-verbose: default>> minecraft-server\bukkit.yml
    echo   shutdown-message: Server closed>> minecraft-server\bukkit.yml
    echo   minimum-api: none>> minecraft-server\bukkit.yml
    echo.>> minecraft-server\bukkit.yml
    echo spawn-limits:>> minecraft-server\bukkit.yml
    echo   monsters: 70>> minecraft-server\bukkit.yml
    echo   animals: 15>> minecraft-server\bukkit.yml
    echo   water-animals: 5>> minecraft-server\bukkit.yml
    echo   ambient: 15>> minecraft-server\bukkit.yml
    echo.>> minecraft-server\bukkit.yml
    echo chunk-gc:>> minecraft-server\bukkit.yml
    echo   period-in-ticks: 600>> minecraft-server\bukkit.yml
    echo.>> minecraft-server\bukkit.yml
    echo ticks-per:>> minecraft-server\bukkit.yml
    echo   animal-spawns: 400>> minecraft-server\bukkit.yml
    echo   monster-spawns: 1>> minecraft-server\bukkit.yml
    echo   autosave: 6000>> minecraft-server\bukkit.yml
    echo.>> minecraft-server\bukkit.yml
    echo aliases:>> minecraft-server\bukkit.yml
    echo   icanhasbukkit: version $1->> minecraft-server\bukkit.yml
)

echo Setup concluído com sucesso!
echo.
echo Para iniciar o servidor, execute:
echo   start.bat
echo.
echo Ou manualmente:
echo   npm start
echo.
echo Acesse http://localhost:3000 no seu navegador
echo Credenciais padrão:
echo   Usuário: admin, Senha: admin123
echo   Usuário: moderator, Senha: mod123
pause