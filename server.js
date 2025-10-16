const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const fs = require('fs');
const { promisify } = require('util');
const multer = require('multer');
const { exec, spawn } = require('child_process');
const pm2 = require('pm2');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, '.'); // Temporary destination
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

// Promisify file system operations
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);
const rename = promisify(fs.rename);
const copyFile = promisify(fs.copyFile);

// Middleware
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.json({ limit: '500mb' }));
app.use(express.static('public'));
app.use(session({
  secret: 'minecraft-server-manager',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Database setup
const db = new sqlite3.Database('./users.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the users database.');
});

// Create users table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
)`);

// Create default users for testing
const createDefaultUsers = () => {
  const defaultUsers = [
    { username: 'admin', password: 'admin123' },
    { username: 'moderator', password: 'mod123' }
  ];

  defaultUsers.forEach(user => {
    bcrypt.hash(user.password, 10, (err, hash) => {
      if (err) throw err;
      db.run(`INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)`, 
        [user.username, hash], 
        (err) => {
          if (err) {
            console.error('Error creating default user:', err.message);
          } else {
            console.log(`Default user '${user.username}' created or already exists`);
          }
        }
      );
    });
  });
};

createDefaultUsers();

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  // For API requests, send JSON response instead of redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
};

// Routes
app.get('/', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err) {
      return res.status(500).send('Server error');
    }
    
    if (!user) {
      return res.status(401).send('Invalid credentials');
    }
    
    bcrypt.compare(password, user.password, (err, result) => {
      if (err || !result) {
        return res.status(401).send('Invalid credentials');
      }
      
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect('/');
    });
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Error logging out');
    }
    res.redirect('/login');
  });
});

// API routes for server management
// Get list of servers
app.get('/api/servers', isAuthenticated, async (req, res) => {
  try {
    const serversDir = path.join(__dirname, 'servers');
    
    // Create the servers directory if it doesn't exist
    if (!fs.existsSync(serversDir)) {
      await mkdir(serversDir, { recursive: true });
    }
    
    const servers = await readdir(serversDir);
    const serverList = [];
    
    for (const server of servers) {
      const serverPath = path.join(serversDir, server);
      const stats = await stat(serverPath);
      
      if (stats.isDirectory()) {
        serverList.push({
          name: server,
          path: serverPath,
          modified: new Date(stats.mtime).toLocaleString('pt-BR')
        });
      }
    }
    
    res.json(serverList);
  } catch (error) {
    console.error('Error reading servers directory:', error);
    res.status(500).json({ error: 'Failed to read servers directory' });
  }
});

// Create a new server
app.post('/api/servers', isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, name);
    
    // Create server directory
    await mkdir(serverPath, { recursive: true });
    
    // Create default directories
    await mkdir(path.join(serverPath, 'plugins'), { recursive: true });
    await mkdir(path.join(serverPath, 'logs'), { recursive: true });
    await mkdir(path.join(serverPath, 'world'), { recursive: true });
    
    // Create default configuration files
    const serverProperties = `# Minecraft server properties
# Generated on ${new Date().toString()}
gamemode=survival
difficulty=normal
level-type=DEFAULT
max-players=20
online-mode=true`;
    
    const configYml = `# Configuration file
server-name: ${name}
motd: Welcome to ${name} server!
world:
  name: world
  seed: 12345
  generator: default
plugins:
  enabled:
    - essentials
    - worldedit`;
    
    const bukkitYml = `# Bukkit configuration file
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
  icanhasbukkit: version $1-`;
    
    // Write default configuration files
    await writeFile(path.join(serverPath, 'server.properties'), serverProperties, 'utf8');
    await writeFile(path.join(serverPath, 'config.yml'), configYml, 'utf8');
    await writeFile(path.join(serverPath, 'bukkit.yml'), bukkitYml, 'utf8');
    
    res.json({ message: 'Server created successfully' });
  } catch (error) {
    console.error('Error creating server:', error);
    res.status(500).json({ error: 'Failed to create server' });
  }
});

// Delete a server
app.delete('/api/servers/:serverName', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    
    // Security check: ensure the path is within the servers directory
    if (!serverPath.startsWith(serversDir)) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Delete server directory
    await fs.promises.rm(serverPath, { recursive: true, force: true });
    res.json({ message: 'Server deleted successfully' });
  } catch (error) {
    console.error('Error deleting server:', error);
    res.status(500).json({ error: 'Failed to delete server' });
  }
});

// API routes for nHudVps menu access
// Get nHudVps menu items
app.get('/api/nhudvps/menu', isAuthenticated, async (req, res) => {
  try {
    const nhudvpsDir = path.join(__dirname, 'nHudVps');
    
    // Create the nHudVps directory if it doesn't exist
    if (!fs.existsSync(nhudvpsDir)) {
      await mkdir(nhudvpsDir, { recursive: true });
    }
    
    // Get parent directory (workspace)
    const workspaceDir = path.join(__dirname, '..');
    
    // Get root directory
    const rootDir = path.parse(__dirname).root;
    
    const menuItems = [
      {
        name: 'Área de Trabalho',
        path: workspaceDir,
        type: 'Pasta',
        description: 'Acessar a pasta da área de trabalho'
      },
      {
        name: 'Raiz do Sistema',
        path: rootDir,
        type: 'Pasta',
        description: 'Acessar a pasta raiz do sistema'
      },
      {
        name: 'nHudVps',
        path: nhudvpsDir,
        type: 'Pasta',
        description: 'Acessar a pasta nHudVps'
      }
    ];
    
    res.json(menuItems);
  } catch (error) {
    console.error('Error reading nHudVps menu:', error);
    res.status(500).json({ error: 'Failed to read nHudVps menu' });
  }
});

// API routes for file management within nHudVps or other directories
// Get list of files in a directory
app.get('/api/files', isAuthenticated, async (req, res) => {
  try {
    // Get the directory path from query parameter
    const directoryPath = req.query.path;
    
    if (!directoryPath) {
      return res.status(400).json({ error: 'Directory path is required' });
    }
    
    // Security check: ensure the path is accessible
    // For now, we'll allow access to the specific directories
    // In a production environment, you should implement stricter security checks
    
    // Check if directory exists
    if (!fs.existsSync(directoryPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }
    
    const files = await readdir(directoryPath);
    const fileList = [];
    
    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const stats = await stat(filePath);
      
      fileList.push({
        name: file,
        type: stats.isDirectory() ? 'Pasta' : 'Arquivo',
        size: stats.isDirectory() ? '-' : `${(stats.size / 1024).toFixed(2)} KB`,
        modified: new Date(stats.mtime).toLocaleString('pt-BR')
      });
    }
    
    res.json({
      path: directoryPath,
      files: fileList
    });
  } catch (error) {
    console.error('Error reading directory:', error);
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// Get content of a file
app.get('/api/files/content', isAuthenticated, async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    // Security check: ensure the path is accessible
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Read file content
    const content = await readFile(filePath, 'utf8');
    res.json({ content });
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Save content to a file
app.post('/api/files/content', isAuthenticated, async (req, res) => {
  try {
    const { filePath, content } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    // Security check: ensure the path is accessible
    
    // Write file content
    await writeFile(filePath, content, 'utf8');
    res.json({ message: 'File saved successfully' });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Delete a file or directory
app.delete('/api/files', isAuthenticated, async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    // Security check: ensure the path is accessible
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Delete file or directory
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      await fs.promises.rm(filePath, { recursive: true, force: true });
    } else {
      await unlink(filePath);
    }
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Create a new directory
app.post('/api/directories', isAuthenticated, async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    
    if (!dirPath) {
      return res.status(400).json({ error: 'Directory path is required' });
    }
    
    // Security check: ensure the path is accessible
    
    // Create directory
    await mkdir(dirPath, { recursive: true });
    res.json({ message: 'Directory created successfully' });
  } catch (error) {
    console.error('Error creating directory:', error);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// Upload files
app.post('/api/upload', isAuthenticated, upload.array('file'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const targetPath = req.body.path || __dirname;
    
    // Security check: ensure the path is accessible
    
    // Move uploaded files to the correct location
    for (const file of req.files) {
      const filePath = path.join(targetPath, file.originalname);
      await fs.promises.rename(file.path, filePath);
    }
    
    res.json({ 
      message: `${req.files.length} arquivo(s) enviado(s) com sucesso!`,
      count: req.files.length
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Extract ZIP file
app.post('/api/extract', isAuthenticated, async (req, res) => {
  try {
    const { filePath, targetPath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    // Security check: ensure the path is accessible
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check if file is a ZIP file
    if (!filePath.toLowerCase().endsWith('.zip')) {
      return res.status(400).json({ error: 'File is not a ZIP archive' });
    }
    
    // Extract ZIP file
    const zip = new AdmZip(filePath);
    zip.extractAllTo(targetPath || path.dirname(filePath), true); // true to overwrite existing files
    
    res.json({ message: 'ZIP file extracted successfully' });
  } catch (error) {
    console.error('Error extracting ZIP file:', error);
    res.status(500).json({ error: 'Failed to extract ZIP file' });
  }
});

// Copy a file or directory
app.post('/api/copy', isAuthenticated, async (req, res) => {
  try {
    const { sourcePath, destinationPath } = req.body;
    
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({ error: 'Source and destination paths are required' });
    }
    
    // Security check: ensure paths are accessible
    
    // Check if source file exists
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }
    
    // Check if destination already exists
    if (fs.existsSync(destinationPath)) {
      return res.status(400).json({ error: 'Destination already exists' });
    }
    
    // Copy file or directory
    const stats = await stat(sourcePath);
    if (stats.isDirectory()) {
      // For directories, we need to copy recursively
      await copyDirectory(sourcePath, destinationPath);
    } else {
      // For files, use copyFile
      await copyFile(sourcePath, destinationPath);
    }
    
    res.json({ message: 'Item copied successfully' });
  } catch (error) {
    console.error('Error copying item:', error);
    res.status(500).json({ error: 'Failed to copy item' });
  }
});

// Helper function to copy directories recursively
async function copyDirectory(src, dest) {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dest, { recursive: true });
  
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

// Move a file or directory
app.post('/api/move', isAuthenticated, async (req, res) => {
  try {
    const { sourcePath, destinationPath } = req.body;
    
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({ error: 'Source and destination paths are required' });
    }
    
    // Security check: ensure paths are accessible
    
    // Check if source file exists
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }
    
    // Check if destination already exists
    if (fs.existsSync(destinationPath)) {
      return res.status(400).json({ error: 'Destination already exists' });
    }
    
    // Move file or directory
    await rename(sourcePath, destinationPath);
    res.json({ message: 'Item moved successfully' });
  } catch (error) {
    console.error('Error moving item:', error);
    res.status(500).json({ error: 'Failed to move item' });
  }
});

// Rename a file or directory
app.post('/api/rename', isAuthenticated, async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Old and new paths are required' });
    }
    
    // Security check: ensure paths are accessible
    
    // Check if source file exists
    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }
    
    // Check if new path already exists
    if (fs.existsSync(newPath)) {
      return res.status(400).json({ error: 'A file or directory with that name already exists' });
    }
    
    // Rename file or directory
    await rename(oldPath, newPath);
    res.json({ message: 'Item renamed successfully' });
  } catch (error) {
    console.error('Error renaming item:', error);
    res.status(500).json({ error: 'Failed to rename item' });
  }
});

// Download a file
app.get('/api/download', isAuthenticated, (req, res) => {
  const { filePath } = req.query;
  
  if (!filePath) {
    return res.status(400).json({ error: 'File path is required' });
  }
  
  // Security check: ensure the path is accessible
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Get filename from path
  const filename = path.basename(filePath);
  
  // Send file for download
  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Error downloading file:', err);
      res.status(500).json({ error: 'Failed to download file' });
    }
  });
});

// API routes for file management within a server
// Get list of files in a server directory
app.get('/api/servers/:serverName/files', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    // Get the directory path from query parameter, default to root
    const relativePath = req.query.path || '';
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const targetDir = path.join(serverPath, relativePath);
    
    // Security check: ensure the path is within the server directory
    if (!targetDir.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }
    
    const files = await readdir(targetDir);
    const fileList = [];
    
    for (const file of files) {
      const filePath = path.join(targetDir, file);
      const stats = await stat(filePath);
      
      fileList.push({
        name: file,
        type: stats.isDirectory() ? 'Pasta' : 'Arquivo',
        size: stats.isDirectory() ? '-' : `${(stats.size / 1024).toFixed(2)} KB`,
        modified: new Date(stats.mtime).toLocaleString('pt-BR')
      });
    }
    
    res.json({
      server: serverName,
      path: relativePath,
      files: fileList
    });
  } catch (error) {
    console.error('Error reading directory:', error);
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// Get content of a file within a server
app.get('/api/servers/:serverName/files/:filename', isAuthenticated, async (req, res) => {
  try {
    const { serverName, filename } = req.params;
    const relativePath = req.query.path || '';
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const targetDir = path.join(serverPath, relativePath);
    const filePath = path.join(targetDir, filename);
    
    // Security check: ensure the path is within the server directory
    if (!filePath.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Read file content
    const content = await readFile(filePath, 'utf8');
    res.json({ content });
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Save content to a file within a server
app.post('/api/servers/:serverName/files/:filename', isAuthenticated, async (req, res) => {
  try {
    const { serverName, filename } = req.params;
    const { content } = req.body;
    const relativePath = req.query.path || '';
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const targetDir = path.join(serverPath, relativePath);
    const filePath = path.join(targetDir, filename);
    
    // Security check: ensure the path is within the server directory
    if (!filePath.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Write file content
    await writeFile(filePath, content, 'utf8');
    res.json({ message: 'File saved successfully' });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Delete a file within a server
app.delete('/api/servers/:serverName/files/:filename', isAuthenticated, async (req, res) => {
  try {
    const { serverName, filename } = req.params;
    const relativePath = req.query.path || '';
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const targetDir = path.join(serverPath, relativePath);
    const filePath = path.join(targetDir, filename);
    
    // Security check: ensure the path is within the server directory
    if (!filePath.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Delete file or directory
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      await fs.promises.rm(filePath, { recursive: true, force: true });
    } else {
      await unlink(filePath);
    }
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Create a new directory within a server
app.post('/api/servers/:serverName/directories', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    const { name } = req.body;
    const relativePath = req.body.path || '';
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const targetDir = path.join(serverPath, relativePath);
    const newDirPath = path.join(targetDir, name);
    
    // Security check: ensure the path is within the server directory
    if (!newDirPath.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Create directory
    await mkdir(newDirPath, { recursive: true });
    res.json({ message: 'Directory created successfully' });
  } catch (error) {
    console.error('Error creating directory:', error);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// Upload files to a server
app.post('/api/servers/:serverName/upload', isAuthenticated, upload.array('file'), async (req, res) => {
  try {
    const { serverName } = req.params;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const relativePath = req.body.path || '';
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const targetDir = path.join(serverPath, relativePath);
    
    // Security check: ensure the path is within the server directory
    if (!targetDir.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Move uploaded files to the correct location
    for (const file of req.files) {
      const filePath = path.join(targetDir, file.originalname);
      await fs.promises.rename(file.path, filePath);
    }
    
    res.json({ 
      message: `${req.files.length} arquivo(s) enviado(s) com sucesso!`,
      count: req.files.length
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Extract ZIP file within a server
app.post('/api/servers/:serverName/extract/:filename', isAuthenticated, async (req, res) => {
  try {
    const { serverName, filename } = req.params;
    const relativePath = req.body.path || '';
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const targetDir = path.join(serverPath, relativePath);
    const filePath = path.join(targetDir, filename);
    
    // Security check: ensure the path is within the server directory
    if (!filePath.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check if file is a ZIP file
    if (!filename.toLowerCase().endsWith('.zip')) {
      return res.status(400).json({ error: 'File is not a ZIP archive' });
    }
    
    // Extract ZIP file
    const zip = new AdmZip(filePath);
    zip.extractAllTo(targetDir, true); // true to overwrite existing files
    
    res.json({ message: 'ZIP file extracted successfully' });
  } catch (error) {
    console.error('Error extracting ZIP file:', error);
    res.status(500).json({ error: 'Failed to extract ZIP file' });
  }
});

// Move a file or directory within a server
app.post('/api/servers/:serverName/move', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    const { filename, destinationPath } = req.body;
    const relativePath = req.body.currentPath || '';
    
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const sourceDir = path.join(serverPath, relativePath);
    const destDir = path.join(serverPath, destinationPath);
    const sourceFilePath = path.join(sourceDir, filename);
    const destFilePath = path.join(destDir, filename);
    
    // Security check: ensure paths are within the server directory
    if (!sourceFilePath.startsWith(serverPath) || !destFilePath.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Check if source file exists
    if (!fs.existsSync(sourceFilePath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }
    
    // Check if destination directory exists
    if (!fs.existsSync(destDir)) {
      return res.status(404).json({ error: 'Destination directory not found' });
    }
    
    // Check if destination file already exists
    if (fs.existsSync(destFilePath)) {
      return res.status(400).json({ error: 'File already exists in destination' });
    }
    
    // Move file
    await rename(sourceFilePath, destFilePath);
    res.json({ message: 'File moved successfully' });
  } catch (error) {
    console.error('Error moving file:', error);
    res.status(500).json({ error: 'Failed to move file' });
  }
});

// Move multiple files within a server
app.post('/api/servers/:serverName/move-multiple', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    const { filenames, destinationPath } = req.body;
    const relativePath = req.body.currentPath || '';
    
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const sourceDir = path.join(serverPath, relativePath);
    const destDir = path.join(serverPath, destinationPath);
    
    // Security check: ensure paths are within the server directory
    if (!sourceDir.startsWith(serverPath) || !destDir.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Check if destination directory exists
    if (!fs.existsSync(destDir)) {
      return res.status(404).json({ error: 'Destination directory not found' });
    }
    
    // Move each file
    const results = [];
    for (const filename of filenames) {
      try {
        const sourceFilePath = path.join(sourceDir, filename);
        const destFilePath = path.join(destDir, filename);
        
        // Check if source file exists
        if (!fs.existsSync(sourceFilePath)) {
          results.push({ filename, status: 'error', message: 'Source file not found' });
          continue;
        }
        
        // Check if destination file already exists
        if (fs.existsSync(destFilePath)) {
          results.push({ filename, status: 'error', message: 'File already exists in destination' });
          continue;
        }
        
        // Move file
        await rename(sourceFilePath, destFilePath);
        results.push({ filename, status: 'success', message: 'File moved successfully' });
      } catch (error) {
        console.error(`Error moving file ${filename}:`, error);
        results.push({ filename, status: 'error', message: 'Failed to move file' });
      }
    }
    
    res.json({ 
      message: 'Files move operation completed',
      results
    });
  } catch (error) {
    console.error('Error moving files:', error);
    res.status(500).json({ error: 'Failed to move files' });
  }
});

// Copy a file or directory within a server
app.post('/api/servers/:serverName/copy', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    const { filename, destinationPath } = req.body;
    const relativePath = req.body.currentPath || '';
    
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const sourceDir = path.join(serverPath, relativePath);
    const destDir = path.join(serverPath, destinationPath);
    const sourceFilePath = path.join(sourceDir, filename);
    const destFilePath = path.join(destDir, filename);
    
    // Security check: ensure paths are within the server directory
    if (!sourceFilePath.startsWith(serverPath) || !destFilePath.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Check if source file exists
    if (!fs.existsSync(sourceFilePath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }
    
    // Check if destination directory exists
    if (!fs.existsSync(destDir)) {
      return res.status(404).json({ error: 'Destination directory not found' });
    }
    
    // Check if destination file already exists
    if (fs.existsSync(destFilePath)) {
      return res.status(400).json({ error: 'File already exists in destination' });
    }
    
    // Copy file or directory
    const stats = await stat(sourceFilePath);
    if (stats.isDirectory()) {
      // For directories, we need to copy recursively
      await copyDirectory(sourceFilePath, destFilePath);
    } else {
      // For files, use copyFile
      await copyFile(sourceFilePath, destFilePath);
    }
    
    res.json({ message: 'Item copied successfully' });
  } catch (error) {
    console.error('Error copying item:', error);
    res.status(500).json({ error: 'Failed to copy item' });
  }
});

// Rename a file or directory within a server
app.post('/api/servers/:serverName/rename', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    const { oldName, newName } = req.body;
    const relativePath = req.body.currentPath || '';
    
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const targetDir = path.join(serverPath, relativePath);
    const oldFilePath = path.join(targetDir, oldName);
    const newFilePath = path.join(targetDir, newName);
    
    // Security check: ensure paths are within the server directory
    if (!oldFilePath.startsWith(serverPath) || !newFilePath.startsWith(serverPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Check if source file exists
    if (!fs.existsSync(oldFilePath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }
    
    // Check if new name already exists
    if (fs.existsSync(newFilePath)) {
      return res.status(400).json({ error: 'A file or directory with that name already exists' });
    }
    
    // Rename file or directory
    await rename(oldFilePath, newFilePath);
    res.json({ message: 'Item renamed successfully' });
  } catch (error) {
    console.error('Error renaming item:', error);
    res.status(500).json({ error: 'Failed to rename item' });
  }
});

// Download a file from a server
app.get('/api/servers/:serverName/download/:filename', isAuthenticated, (req, res) => {
  const { serverName, filename } = req.params;
  const relativePath = req.query.path || '';
  const serversDir = path.join(__dirname, 'servers');
  const serverPath = path.join(serversDir, serverName);
  const targetDir = path.join(serverPath, relativePath);
  const filePath = path.join(targetDir, filename);
  
  // Security check: ensure the path is within the server directory
  if (!filePath.startsWith(serverPath)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  
  // Check if server exists
  if (!fs.existsSync(serverPath)) {
    return res.status(404).json({ error: 'Server not found' });
  }
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Send file for download
  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Error downloading file:', err);
      res.status(500).json({ error: 'Failed to download file' });
    }
  });
});

// Server management routes for Minecraft servers
// Get server status
app.get('/api/servers/:serverName/status', isAuthenticated, (req, res) => {
  const { serverName } = req.params;
  
  pm2.connect((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to connect to PM2' });
    }
    
    pm2.list((err, list) => {
      if (err) {
        pm2.disconnect();
        return res.status(500).json({ error: 'Failed to get process list' });
      }
      
      // Find Minecraft server process
      const serverProcess = list.find(process => process.name === serverName);
      pm2.disconnect();
      
      if (serverProcess) {
        res.json({
          running: serverProcess.pm2_env.status === 'online',
          status: serverProcess.pm2_env.status,
          pid: serverProcess.pid,
          uptime: serverProcess.pm2_env.status === 'online' ? 
            Math.floor((Date.now() - serverProcess.pm2_env.pm_uptime) / 1000) : 0
        });
      } else {
        res.json({ running: false, status: 'stopped' });
      }
    });
  });
});

// Start Minecraft server
app.post('/api/servers/:serverName/start', isAuthenticated, (req, res) => {
  const { serverName } = req.params;
  
  pm2.connect((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to connect to PM2' });
    }
    
    // Check if server is already running
    pm2.list((err, list) => {
      if (err) {
        pm2.disconnect();
        return res.status(500).json({ error: 'Failed to get process list' });
      }
      
      const serverProcess = list.find(process => process.name === serverName);
      if (serverProcess) {
        pm2.disconnect();
        return res.json({ message: 'Server is already running' });
      }
      
      // Start the server
      const serversDir = path.join(__dirname, 'servers');
      const serverPath = path.join(serversDir, serverName);
      
      // Check if server exists
      if (!fs.existsSync(serverPath)) {
        pm2.disconnect();
        return res.status(404).json({ error: 'Server not found' });
      }
      
      pm2.start({
        name: serverName,
        script: 'java',
        args: ['-Xmx1024M', '-Xms1024M', '-jar', 'server.jar', 'nogui'],
        cwd: serverPath,
        interpreter: 'none',
        out_file: path.join(serverPath, 'logs', 'server.log'),
        error_file: path.join(serverPath, 'logs', 'server-error.log'),
        combine_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss'
      }, (err, apps) => {
        pm2.disconnect();
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to start server' });
        }
        res.json({ message: 'Server started successfully' });
      });
    });
  });
});

// Stop Minecraft server
app.post('/api/servers/:serverName/stop', isAuthenticated, (req, res) => {
  const { serverName } = req.params;
  
  pm2.connect((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to connect to PM2' });
    }
    
    pm2.stop(serverName, (err, apps) => {
      pm2.disconnect();
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to stop server' });
      }
      res.json({ message: 'Server stopped successfully' });
    });
  });
});

// Restart Minecraft server
app.post('/api/servers/:serverName/restart', isAuthenticated, (req, res) => {
  const { serverName } = req.params;
  
  pm2.connect((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to connect to PM2' });
    }
    
    pm2.restart(serverName, (err, apps) => {
      pm2.disconnect();
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to restart server' });
      }
      res.json({ message: 'Server restarted successfully' });
    });
  });
});

// Get server console logs
app.get('/api/servers/:serverName/console', isAuthenticated, (req, res) => {
  const { serverName } = req.params;
  const serversDir = path.join(__dirname, 'servers');
  const serverPath = path.join(serversDir, serverName);
  const logFile = path.join(serverPath, 'logs', 'server.log');
  
  // Check if server exists
  if (!fs.existsSync(serverPath)) {
    return res.status(404).json({ error: 'Server not found' });
  }
  
  // Create logs directory if it doesn't exist
  const logsDir = path.join(serverPath, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Create log file if it doesn't exist
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, '');
  }
  
  // Read the last 100 lines of the log file
  const readLastLines = (file, numLines) => {
    return new Promise((resolve, reject) => {
      const lines = [];
      const rl = require('readline').createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity
      });
      
      rl.on('line', (line) => {
        lines.push(line);
        if (lines.length > numLines) {
          lines.shift();
        }
      });
      
      rl.on('close', () => {
        resolve(lines);
      });
      
      rl.on('error', (err) => {
        reject(err);
      });
    });
  };
  
  readLastLines(logFile, 100)
    .then(lines => {
      res.json({ logs: lines });
    })
    .catch(err => {
      console.error('Error reading log file:', err);
      res.json({ logs: [] });
    });
});

// Create server backup
app.post('/api/servers/:serverName/backup', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    const backupsDir = path.join(__dirname, 'backups');
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Create backups directory if it doesn't exist
    if (!fs.existsSync(backupsDir)) {
      await mkdir(backupsDir, { recursive: true });
    }
    
    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `${serverName}-backup-${timestamp}.zip`;
    const backupPath = path.join(backupsDir, backupFilename);
    
    // Create ZIP archive of the server directory
    const zip = new AdmZip();
    zip.addLocalFolder(serverPath);
    zip.writeZip(backupPath);
    
    res.json({ 
      message: 'Backup created successfully',
      filename: backupFilename,
      path: backupPath
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Download server as ZIP
app.get('/api/servers/:serverName/download-zip', isAuthenticated, async (req, res) => {
  try {
    const { serverName } = req.params;
    const serversDir = path.join(__dirname, 'servers');
    const serverPath = path.join(serversDir, serverName);
    
    // Check if server exists
    if (!fs.existsSync(serverPath)) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Generate temporary ZIP filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFilename = `${serverName}-${timestamp}.zip`;
    const tempZipPath = path.join(__dirname, zipFilename);
    
    // Create ZIP archive of the server directory
    const zip = new AdmZip();
    zip.addLocalFolder(serverPath);
    zip.writeZip(tempZipPath);
    
    // Send the ZIP file for download
    res.download(tempZipPath, zipFilename, (err) => {
      if (err) {
        console.error('Error downloading ZIP file:', err);
        // Try to send error response if headers haven't been sent
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download backup' });
        }
      }
      
      // Clean up temporary ZIP file after download
      setTimeout(() => {
        if (fs.existsSync(tempZipPath)) {
          fs.unlink(tempZipPath, (unlinkErr) => {
            if (unlinkErr) {
              console.error('Error deleting temporary ZIP file:', unlinkErr);
            }
          });
        }
      }, 1000);
    });
  } catch (error) {
    console.error('Error creating download backup:', error);
    res.status(500).json({ error: 'Failed to create download backup' });
  }
});

// Send command to Minecraft server
app.post('/api/servers/:serverName/command', isAuthenticated, (req, res) => {
  const { serverName } = req.params;
  const { command } = req.body;
  
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }
  
  pm2.connect((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to connect to PM2' });
    }
    
    // Find the server process
    pm2.list((err, list) => {
      if (err) {
        pm2.disconnect();
        return res.status(500).json({ error: 'Failed to get process list' });
      }
      
      const serverProcess = list.find(process => process.name === serverName);
      if (!serverProcess) {
        pm2.disconnect();
        return res.status(404).json({ error: 'Server not found or not running' });
      }
      
      // Send command to the process
      pm2.sendDataToProcessId(serverProcess.pm_id, {
        type: 'process:msg',
        data: {
          command: command
        },
        topic: 'command'
      }, (err, res) => {
        if (err) {
          console.error('Error sending command:', err);
          pm2.disconnect();
          return res.status(500).json({ error: 'Failed to send command' });
        }
        
        pm2.disconnect();
        res.json({ message: 'Command sent successfully' });
      });
    });
  });
});

// Handle favicon.ico request
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  
  // Create servers directory if it doesn't exist
  const serversDir = path.join(__dirname, 'servers');
  if (!fs.existsSync(serversDir)) {
    fs.mkdirSync(serversDir, { recursive: true });
  }
  
  // Create nHudVps directory if it doesn't exist
  const nhudvpsDir = path.join(__dirname, 'nHudVps');
  if (!fs.existsSync(nhudvpsDir)) {
    fs.mkdirSync(nhudvpsDir, { recursive: true });
  }
});