#!/bin/bash

# Script de setup automático para Minecraft Server Manager
# Este script instala todas as dependências necessárias e configura o ambiente

echo "=== Minecraft Server Manager - Setup Automático ==="
echo "Iniciando processo de setup..."

# Verificar se o Node.js está instalado
if ! command -v node &> /dev/null
then
    echo "Erro: Node.js não encontrado. Por favor, instale o Node.js primeiro."
    exit 1
fi

echo "Node.js encontrado: $(node --version)"

# Verificar se o npm está instalado
if ! command -v npm &> /dev/null
then
    echo "Erro: npm não encontrado. Por favor, instale o npm primeiro."
    exit 1
fi

echo "npm encontrado: $(npm --version)"

# Instalar dependências do projeto
echo "Instalando dependências do projeto..."
npm install

# Verificar se a instalação foi bem sucedida
if [ $? -ne 0 ]; then
    echo "Erro: Falha ao instalar dependências."
    exit 1
fi

# Criar diretório do servidor Minecraft se não existir
if [ ! -d "minecraft-server" ]; then
    echo "Criando diretório do servidor Minecraft..."
    mkdir minecraft-server
    mkdir minecraft-server/plugins
    mkdir minecraft-server/logs
    
    # Criar arquivos de configuração de exemplo
    echo "# Minecraft server properties
# Generated on $(date)
gamemode=survival
difficulty=easy
level-type=default
max-players=20
online-mode=true" > minecraft-server/server.properties
    
    echo "# Configuration file
server-name: My Minecraft Server
motd: Welcome to our server!
world:
  name: world
  seed: 12345
  generator: default
plugins:
  enabled:
    - essentials
    - worldedit" > minecraft-server/config.yml
    
    echo "# Bukkit configuration file
# Settings for the Bukkit server implementation

settings:
  allow-end: true
  warn-on-overload: true
  permissions-file: permissions.yml
  update-folder: update
  plugin-profiling: false
  connection-throttle: 4000
  query-plugins: true
  deprecated-verbose: default
  shutdown-message: Server closed
  minimum-api: none

spawn-limits:
  monsters: 70
  animals: 15
  water-animals: 5
  ambient: 15

chunk-gc:
  period-in-ticks: 600

ticks-per:
  animal-spawns: 400
  monster-spawns: 1
  autosave: 6000

aliases:
  icanhasbukkit: version \$1-" > minecraft-server/bukkit.yml
fi

# Criar banco de dados de usuários se não existir
echo "Setup concluído com sucesso!"
echo ""
echo "Para iniciar o servidor, execute:"
echo "  ./start.sh"
echo ""
echo "Ou manualmente:"
echo "  npm start"
echo ""
echo "Acesse http://localhost:3000 no seu navegador"
echo "Credenciais padrão:"
echo "  Usuário: admin, Senha: admin123"
echo "  Usuário: moderator, Senha: mod123"