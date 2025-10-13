#!/bin/bash

# Script de inicialização para Minecraft Server Manager
# Este script inicia o servidor web

echo "=== Minecraft Server Manager - Inicialização ==="

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

# Verificar se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo "Dependências não encontradas. Executando setup..."
    ./setup.sh
fi

# Criar diretório de logs se não existir
if [ ! -d "minecraft-server/logs" ]; then
    mkdir -p minecraft-server/logs
fi

# Iniciar o servidor
echo "Iniciando servidor web..."
echo "Acesse http://localhost:3000 no seu navegador"
echo "Pressione Ctrl+C para parar o servidor"
echo ""

# Iniciar o servidor em modo de desenvolvimento
npm start