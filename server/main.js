const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Store for server state
let webdavServer = null;
let serverState = {
  running: false,
  url: '',
  localIp: '',
  port: 8080,
  connections: 0
};

// Event listeners for SSE
let eventListeners = [];

// Get local IP address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Get backup path
function getBackupPath() {
  const home = process.env.HOME || '/root';
  return path.join(home, 'iPhonePhotoBridge', 'Backups');
}

// Emit event to all listeners
function emitEvent(data) {
  eventListeners.forEach(res => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// WebDAV request handler
function handleWebDAV(req, res) {
  // CORS headers for WebDAV
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Length, Authorization, Depth, Destination, If, Overwrite, X-Expected-Entity-Length');
  res.setHeader('Access-Control-Expose-Headers', 'DAV, Content-Type, Upload-Offset, Location');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Track connection
  serverState.connections++;
  emitEvent({ type: 'connection', method: req.method, url: req.url });

  req.on('close', () => {
    serverState.connections = Math.max(0, serverState.connections - 1);
  });

  const url = new URL(req.url, `http://localhost:${serverState.port}`);
  const pathname = decodeURIComponent(url.pathname);
  const backupPath = getBackupPath();

  // Handle photos folder
  let relativePath = pathname;
  if (pathname.startsWith('/photos')) {
    relativePath = pathname.replace('/photos', '');
  }

  const filePath = path.join(backupPath, relativePath === '/' ? '' : relativePath);
  const dirPath = backupPath;

  // Ensure backup directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const metadataDir = path.join(path.dirname(backupPath), 'MetaData');
  if (!fs.existsSync(metadataDir)) {
    fs.mkdirSync(metadataDir, { recursive: true });
  }

  try {
    switch (req.method) {
      case 'GET':
      case 'PROPFIND':
        handlePropfind(req, res, filePath, pathname, dirPath);
        break;
      case 'PUT':
        handlePut(req, res, filePath, metadataDir);
        break;
      case 'MKCOL':
        handleMkcol(req, res, filePath);
        break;
      case 'DELETE':
        handleDelete(req, res, filePath);
        break;
      default:
        res.writeHead(405);
        res.end('Method not allowed');
    }
  } catch (err) {
    console.error('WebDAV error:', err);
    res.writeHead(500);
    res.end('Internal error');
  }
}

function handlePropfind(req, res, filePath, urlPath, basePath) {
  const depth = req.headers.depth || '1';

  // If path doesn't exist, return 404
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const stat = fs.statSync(filePath);

  // Generate response based on whether it's a file or directory
  let responses = [];

  if (stat.isDirectory()) {
    // Root or directory listing
    responses.push(createDirResponse(urlPath === '/' ? '/photos/' : urlPath + '/'));

    if (depth !== '0') {
      try {
        const entries = fs.readdirSync(filePath);
        for (const entry of entries) {
          const entryPath = path.join(filePath, entry);
          try {
            const entryStat = fs.statSync(entryPath);
            const entryUrl = urlPath.endsWith('/') ? urlPath + entry : urlPath + '/' + entry;

            if (entryStat.isDirectory()) {
              responses.push(createDirResponse(entryUrl + '/'));
            } else {
              responses.push(createFileResponse(entryUrl, entryStat));
            }
          } catch (e) {
            // Skip inaccessible entries
          }
        }
      } catch (e) {
        // Directory not readable
      }
    }
  } else {
    // Single file
    responses.push(createFileResponse(urlPath, stat));
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  ${responses.join('')}
</D:multistatus>`;

  res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(xml);
}

function createDirResponse(href) {
  const displayName = href === '/photos/' ? '' : path.basename(href.replace(/\/$/, ''));
  return `
  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(displayName)}</D:displayname>
        <D:getcontenttype>httpd/unix-directory</D:getcontenttype>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

function createFileResponse(href, stat) {
  const displayName = path.basename(href);
  const contentType = getMimeType(href);
  const lastModified = stat.mtime.toUTCString();
  const etag = `"${crypto.createHash('md5').update(stat.ino + '-' + stat.mtimeMs).digest('hex')}"`;

  return `
  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(displayName)}</D:displayname>
        <D:getcontenttype>${contentType}</D:getcontenttype>
        <D:getcontentlength>${stat.size}</D:getcontentlength>
        <D:getlastmodified>${lastModified}</D:getlastmodified>
        <D:getetag>${etag}</D:getetag>
        <D:resourcetype/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

function handlePut(req, res, filePath, metadataDir) {
  const dir = path.dirname(filePath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = path.basename(filePath);
  const chunks = [];
  let uploadedSize = 0;
  const contentLength = parseInt(req.headers['content-length'] || req.headers['x-expected-entity-length'] || '0', 10);

  req.on('data', (chunk) => {
    chunks.push(chunk);
    uploadedSize += chunk.length;
  });

  req.on('end', async () => {
    const buffer = Buffer.concat(chunks);

    // Write file
    fs.writeFileSync(filePath, buffer);

    // Calculate hash
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    // Extract and save metadata
    const metadata = {
      filename,
      path: filePath,
      size: uploadedSize,
      format: path.extname(filename).slice(1).toUpperCase() || 'Unknown',
      dateCreated: new Date().toISOString(),
      hash
    };

    const metadataPath = path.join(metadataDir, hash + '.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Emit upload event
    emitEvent({
      type: 'upload',
      filename,
      path: filePath,
      size: uploadedSize,
      progress: 100,
      status: 'complete',
      hash,
      metadata
    });

    res.writeHead(201, { 'Location': '/photos/' + path.relative(getBackupPath(), filePath) });
    res.end('Created');
  });

  req.on('error', (err) => {
    res.writeHead(500);
    res.end('Upload failed');
  });
}

function handleMkcol(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(filePath, { recursive: true });
    res.writeHead(201);
    res.end('Created');
  } else {
    res.writeHead(405);
    res.end('Directory already exists');
  }
}

function handleDelete(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    fs.rmSync(filePath, { recursive: true });
  } else {
    fs.unlinkSync(filePath);
  }

  res.writeHead(204);
  res.end();
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.dng': 'image/x-adobe-dng',
    '.raw': 'image/x-raw',
    '.cr2': 'image/x-canon-cr2',
    '.nef': 'image/x-nikon-nef',
    '.arw': 'image/x-sony-arw',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.live': 'image/x-live-photo',
    '.json': 'application/json',
    '.xml': 'application/xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Load saved photos from metadata
function loadPhotos() {
  const metadataDir = path.join(path.dirname(getBackupPath()), 'MetaData');
  const photos = [];

  if (!fs.existsSync(metadataDir)) {
    return photos;
  }

  try {
    const files = fs.readdirSync(metadataDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(metadataDir, file), 'utf8'));
          photos.push({
            id: data.hash || path.basename(file, '.json'),
            filename: data.filename,
            path: data.path,
            size: data.size,
            format: data.format,
            dateCreated: data.dateCreated,
            metadata: data
          });
        } catch (e) {
          // Skip invalid files
        }
      }
    }
  } catch (e) {
    console.error('Error loading photos:', e);
  }

  return photos.sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
}

// API Routes
app.post('/api/server/start', (req, res) => {
  if (webdavServer) {
    res.json({ success: false, error: 'Server already running' });
    return;
  }

  const port = req.body.port || 8080;
  const localIp = getLocalIp();

  webdavServer = http.createServer((req, res) => {
    // Inject authentication if enabled
    handleWebDAV(req, res);
  });

  webdavServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      res.json({ success: false, error: `Port ${port} is already in use` });
    } else {
      res.json({ success: false, error: err.message });
    }
  });

  webdavServer.listen(port, '0.0.0.0', () => {
    serverState = {
      running: true,
      url: `http://${localIp}:${port}`,
      localIp,
      port,
      connections: 0
    };

    // Ensure backup directory exists
    const backupPath = getBackupPath();
    if (!fs.existsSync(backupPath)) {
      fs.mkdirSync(backupPath, { recursive: true });
    }

    // Ensure metadata directory exists
    const metadataDir = path.join(path.dirname(backupPath), 'MetaData');
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }

    res.json({
      success: true,
      url: serverState.url,
      localIp,
      port
    });
  });
});

app.post('/api/server/stop', (req, res) => {
  if (webdavServer) {
    webdavServer.close();
    webdavServer = null;
    serverState.running = false;
    serverState.url = '';
    serverState.connections = 0;
    res.json({ success: true });
  } else {
    res.json({ success: true });
  }
});

app.get('/api/server/status', (req, res) => {
  res.json({
    running: serverState.running,
    url: serverState.url,
    localIp: serverState.localIp,
    port: serverState.port,
    connections: serverState.connections
  });
});

app.get('/api/photos', (req, res) => {
  const photos = loadPhotos();
  res.json({ photos });
});

app.get('/api/system/info', (req, res) => {
  res.json({
    localIp: getLocalIp(),
    homeDir: os.homedir(),
    backupPath: getBackupPath()
  });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  eventListeners.push(res);

  req.on('close', () => {
    eventListeners = eventListeners.filter(r => r !== res);
  });
});

// Serve static files from public folder
const publicPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`iPhone Photo Bridge server running on http://0.0.0.0:${PORT}`);
  console.log(`Local IP: ${getLocalIp()}`);
  console.log(`Backup path: ${getBackupPath()}`);
  console.log('');
  console.log('=== iPhone Connection Guide ===');
  console.log('1. Open Files app on your iPhone');
  console.log('2. Tap "..." or "+" to add a connection');
  console.log('3. Select "Connect to Server"');
  console.log(`4. Enter the server URL shown in the web interface`);
  console.log('');
});
