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

const upload = multer({ storage: storage });

// Promisify file system operations
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);
const rename = promisify(fs.rename);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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

// API routes for file management
// Get list of files in the Minecraft server directory
app.get('/api/files', isAuthenticated, async (req, res) => {
  try {
    // Get the directory path from query parameter, default to root
    const relativePath = req.query.path || '';
    const serverDir = path.join(__dirname, 'minecraft-server');
    const targetDir = path.join(serverDir, relativePath);
    
    // Security check: ensure the path is within the server directory
    if (!targetDir.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
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
      path: relativePath,
      files: fileList
    });
  } catch (error) {
    console.error('Error reading directory:', error);
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// Get content of a YAML file
app.get('/api/files/:filename', isAuthenticated, async (req, res) => {
  try {
    const { filename } = req.params;
    const relativePath = req.query.path || '';
    const serverDir = path.join(__dirname, 'minecraft-server');
    const targetDir = path.join(serverDir, relativePath);
    const filePath = path.join(targetDir, filename);
    
    // Security check: ensure the path is within the server directory
    if (!filePath.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
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

// Save content to a YAML file
app.post('/api/files/:filename', isAuthenticated, async (req, res) => {
  try {
    const { filename } = req.params;
    const { content } = req.body;
    const relativePath = req.query.path || '';
    const serverDir = path.join(__dirname, 'minecraft-server');
    const targetDir = path.join(serverDir, relativePath);
    const filePath = path.join(targetDir, filename);
    
    // Security check: ensure the path is within the server directory
    if (!filePath.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Write file content
    await writeFile(filePath, content, 'utf8');
    res.json({ message: 'File saved successfully' });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Delete a file
app.delete('/api/files/:filename', isAuthenticated, async (req, res) => {
  try {
    const { filename } = req.params;
    const relativePath = req.query.path || '';
    const serverDir = path.join(__dirname, 'minecraft-server');
    const targetDir = path.join(serverDir, relativePath);
    const filePath = path.join(targetDir, filename);
    
    // Security check: ensure the path is within the server directory
    if (!filePath.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Delete file
    await unlink(filePath);
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Create a new directory
app.post('/api/directories', isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    const relativePath = req.body.path || '';
    const serverDir = path.join(__dirname, 'minecraft-server');
    const targetDir = path.join(serverDir, relativePath);
    const newDirPath = path.join(targetDir, name);
    
    // Security check: ensure the path is within the server directory
    if (!newDirPath.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // Create directory
    await mkdir(newDirPath, { recursive: true });
    res.json({ message: 'Directory created successfully' });
  } catch (error) {
    console.error('Error creating directory:', error);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// Upload a file
app.post('/api/upload', isAuthenticated, upload.array('file'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const relativePath = req.body.path || '';
    const serverDir = path.join(__dirname, 'minecraft-server');
    const targetDir = path.join(serverDir, relativePath);
    
    // Security check: ensure the path is within the server directory
    if (!targetDir.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
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

// Extract ZIP file
app.post('/api/extract/:filename', isAuthenticated, async (req, res) => {
  try {
    const { filename } = req.params;
    const relativePath = req.body.path || '';
    const serverDir = path.join(__dirname, 'minecraft-server');
    const targetDir = path.join(serverDir, relativePath);
    const filePath = path.join(targetDir, filename);
    
    // Security check: ensure the path is within the server directory
    if (!filePath.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
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

// Move a file or directory
app.post('/api/move', isAuthenticated, async (req, res) => {
  try {
    const { filename, destinationPath } = req.body;
    const relativePath = req.body.currentPath || '';
    
    const serverDir = path.join(__dirname, 'minecraft-server');
    const sourceDir = path.join(serverDir, relativePath);
    const destDir = path.join(serverDir, destinationPath);
    const sourceFilePath = path.join(sourceDir, filename);
    const destFilePath = path.join(destDir, filename);
    
    // Security check: ensure paths are within the server directory
    if (!sourceFilePath.startsWith(serverDir) || !destFilePath.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
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

// Move multiple files
app.post('/api/move-multiple', isAuthenticated, async (req, res) => {
  try {
    const { filenames, destinationPath } = req.body;
    const relativePath = req.body.currentPath || '';
    
    const serverDir = path.join(__dirname, 'minecraft-server');
    const sourceDir = path.join(serverDir, relativePath);
    const destDir = path.join(serverDir, destinationPath);
    
    // Security check: ensure paths are within the server directory
    if (!sourceDir.startsWith(serverDir) || !destDir.startsWith(serverDir)) {
      return res.status(400).json({ error: 'Invalid path' });
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

// Download a file
app.get('/api/download/:filename', isAuthenticated, (req, res) => {
  const { filename } = req.params;
  const relativePath = req.query.path || '';
  const serverDir = path.join(__dirname, 'minecraft-server');
  const targetDir = path.join(serverDir, relativePath);
  const filePath = path.join(targetDir, filename);
  
  // Security check: ensure the path is within the server directory
  if (!filePath.startsWith(serverDir)) {
    return res.status(400).json({ error: 'Invalid path' });
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

// Server management routes
// Get server status
app.get('/api/server/status', isAuthenticated, (req, res) => {
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
      const minecraftProcess = list.find(process => process.name === 'minecraft-server');
      pm2.disconnect();
      
      if (minecraftProcess) {
        res.json({
          running: minecraftProcess.pm2_env.status === 'online',
          status: minecraftProcess.pm2_env.status,
          pid: minecraftProcess.pid,
          uptime: minecraftProcess.pm2_env.status === 'online' ? 
            Math.floor((Date.now() - minecraftProcess.pm2_env.pm_uptime) / 1000) : 0
        });
      } else {
        res.json({ running: false, status: 'stopped' });
      }
    });
  });
});

// Start Minecraft server
app.post('/api/server/start', isAuthenticated, (req, res) => {
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
      
      const minecraftProcess = list.find(process => process.name === 'minecraft-server');
      if (minecraftProcess) {
        pm2.disconnect();
        return res.json({ message: 'Server is already running' });
      }
      
      // Start the server
      const serverDir = path.join(__dirname, 'minecraft-server');
      pm2.start({
        name: 'minecraft-server',
        script: 'java',
        args: ['-Xmx1024M', '-Xms1024M', '-jar', 'server.jar', 'nogui'],
        cwd: serverDir,
        interpreter: 'none',
        out_file: path.join(serverDir, 'logs', 'server.log'),
        error_file: path.join(serverDir, 'logs', 'server-error.log'),
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
app.post('/api/server/stop', isAuthenticated, (req, res) => {
  pm2.connect((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to connect to PM2' });
    }
    
    pm2.stop('minecraft-server', (err, apps) => {
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
app.post('/api/server/restart', isAuthenticated, (req, res) => {
  pm2.connect((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to connect to PM2' });
    }
    
    pm2.restart('minecraft-server', (err, apps) => {
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
app.get('/api/server/console', isAuthenticated, (req, res) => {
  const serverDir = path.join(__dirname, 'minecraft-server');
  const logFile = path.join(serverDir, 'logs', 'server.log');
  
  // Create logs directory if it doesn't exist
  const logsDir = path.join(serverDir, 'logs');
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

// Handle favicon.ico request
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  
  // Create logs directory for Minecraft server
  const logsDir = path.join(__dirname, 'minecraft-server', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
});