# Minecraft Server Manager

Um aplicativo web para gerenciar servidores Minecraft locais, com recursos para editar arquivos de configuração YAML, importar arquivos, apagar e baixar arquivos, além de um sistema de autenticação.

## Recursos

- Autenticação de usuários com login/senha
- Gerenciamento de arquivos do servidor Minecraft
- Edição de arquivos YAML/configuração
- Upload, download e exclusão de arquivos
- Extração de arquivos ZIP
- Navegação em pastas
- Gerenciamento do servidor Minecraft (iniciar, parar, reiniciar)
- Console do servidor em tempo real
- Interface amigável em português

## Tecnologias Utilizadas

- Node.js
- Express.js
- SQLite3
- HTML/CSS/JavaScript
- Bcrypt.js (para hashing de senhas)
- Express-session (para gerenciamento de sessões)
- Multer (para upload de arquivos)
- Adm-zip (para extração de arquivos ZIP)
- PM2 (para gerenciamento de processos)

## Instalação

### Método 1: Script Automático (Recomendado)

#### Linux/macOS:
```bash
./setup.sh
```

#### Windows:
```cmd
setup.bat
```

### Método 2: Instalação Manual

1. Clone o repositório:
   ```
   git clone <repository-url>
   ```

2. Navegue até o diretório do projeto:
   ```
   cd minecraft-manager
   ```

3. Instale as dependências:
   ```
   npm install
   ```

## Uso

### Inicialização com Scripts (Recomendado)

#### Linux/macOS:
```bash
./start.sh
```

#### Windows:
```cmd
start.bat
```

### Inicialização Manual

1. Inicie o servidor:
   ```
   npm start
   ```

2. Acesse o aplicativo em seu navegador:
   ```
   http://localhost:3000
   ```

3. Faça login com uma das credenciais padrão:
   - Usuário: `admin`, Senha: `admin123`
   - Usuário: `moderator`, Senha: `mod123`

## Estrutura do Projeto

```
minecraft-manager/
├── server.js              # Servidor principal
├── setup.sh               # Script de setup automático (Linux/macOS)
├── setup.bat              # Script de setup automático (Windows)
├── start.sh               # Script de inicialização (Linux/macOS)
├── start.bat              # Script de inicialização (Windows)
├── package.json           # Dependências e scripts
├── users.db               # Banco de dados SQLite (gerado automaticamente)
├── public/                # Arquivos estáticos
│   ├── index.html         # Página principal
│   └── login.html         # Página de login
├── minecraft-server/      # Diretório simulado do servidor Minecraft
│   ├── server.properties
│   ├── config.yml
│   ├── bukkit.yml
│   └── plugins/           # Diretório de plugins
└── README.md              # Documentação
```

## Funcionalidades Detalhadas

### Gerenciamento de Arquivos
- Visualização de arquivos e pastas com informações de tamanho e data de modificação
- Navegação em pastas através de um sistema de breadcrumb
- Edição de arquivos de configuração (YAML, properties, etc.)
- Upload de arquivos múltiplos com barra de progresso
- Download de arquivos individuais
- Exclusão de arquivos e pastas
- Extração de arquivos ZIP diretamente na interface

### Gerenciamento do Servidor Minecraft
- Iniciar, parar e reiniciar o servidor Minecraft
- Visualização do status do servidor (rodando/parado) com indicador visual
- Tempo de atividade (uptime) do servidor
- Console do servidor em tempo real em um popup dedicado
- Atualização automática do console a cada 5 segundos quando aberto

### Autenticação
- Sistema de login seguro com hashing de senhas (bcrypt)
- Sessões de usuário gerenciadas com express-session
- Proteção de rotas e APIs com middleware de autenticação

## Configuração do Servidor Minecraft

Para usar um servidor Minecraft real, substitua o arquivo `server.jar` na pasta `minecraft-server` por um servidor Minecraft verdadeiro (PaperMC, Spigot, Vanilla, etc.).

As configurações atuais do servidor estão em:
- `server.properties` - Configurações principais do servidor
- `config.yml` - Configurações do Bukkit/Spigot
- `bukkit.yml` - Configurações específicas do Bukkit

## APIs Disponíveis

### Autenticação
- `POST /login` - Realiza login do usuário
- `GET /logout` - Realiza logout do usuário

### Gerenciamento de Arquivos
- `GET /api/files` - Lista arquivos e pastas
- `GET /api/files/:filename` - Obtém conteúdo de um arquivo
- `POST /api/files/:filename` - Salva conteúdo em um arquivo
- `DELETE /api/files/:filename` - Exclui um arquivo
- `POST /api/directories` - Cria uma nova pasta
- `POST /api/upload` - Faz upload de arquivos
- `POST /api/extract/:filename` - Extrai um arquivo ZIP
- `GET /api/download/:filename` - Faz download de um arquivo

### Gerenciamento do Servidor
- `GET /api/server/status` - Obtém status do servidor
- `POST /api/server/start` - Inicia o servidor
- `POST /api/server/stop` - Para o servidor
- `POST /api/server/restart` - Reinicia o servidor
- `GET /api/server/console` - Obtém logs do console do servidor

## Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues e pull requests.

## Licença

Este projeto é licenciado sob a licença MIT.