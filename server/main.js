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
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      // Ignore closed connections
    }
  });
}

// Escape XML special characters
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Get MIME type
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

// WebDAV request handler
function handleWebDAV(req, res) {
  // iOS requires these headers for WebDAV
  res.setHeader('DAV', '1, 2');
  res.setHeader('Allow', 'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, MKCOL');
  res.setHeader('MS-Author-Via', 'DAV');

  // CORS headers for iOS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Length, Authorization, Depth, Destination, If, Overwrite, X-Expected-Entity-Length, Lock-Token, Timeout, Accept, Accept-Language, Content-Language, Host, User-Agent, Range');
  res.setHeader('Access-Control-Expose-Headers', 'DAV, Content-Type, Upload-Offset, Location, Lock-Token, Timeout');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Track connection
  serverState.connections++;
  emitEvent({ type: 'connection', method: req.method, url: req.url });

  req.on('close', () => {
    serverState.connections = Math.max(0, serverState.connections - 1);
  });

  // Parse URL properly
  const requestedPath = req.url;
  const backupPath = getBackupPath();

  // Normalize the path - remove /photos prefix if present
  let relativePath = requestedPath;
  if (requestedPath.startsWith('/photos')) {
    relativePath = requestedPath.replace('/photos', '') || '/';
  }

  // Clean the path
  const cleanPath = relativePath === '/' || relativePath === '' ? '' : relativePath;
  const filePath = path.join(backupPath, cleanPath);

  // Ensure backup directory exists
  if (!fs.existsSync(backupPath)) {
    fs.mkdirSync(backupPath, { recursive: true });
  }

  const metadataDir = path.join(path.dirname(backupPath), 'MetaData');
  if (!fs.existsSync(metadataDir)) {
    fs.mkdirSync(metadataDir, { recursive: true });
  }

  try {
    switch (req.method) {
      case 'GET':
      case 'HEAD':
        handleGet(req, res, filePath);
        break;
      case 'PROPFIND':
        handlePropfind(req, res, filePath, requestedPath);
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
      case 'MOVE':
        handleMove(req, res, filePath);
        break;
      case 'COPY':
        handleCopy(req, res, filePath);
        break;
      default:
        res.writeHead(405, { 'Allow': 'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, MKCOL' });
        res.end('Method not allowed');
    }
  } catch (err) {
    console.error('WebDAV error:', err);
    res.writeHead(500);
    res.end('Internal error');
  }
}

function handleGet(req, res, filePath) {
  // For GET requests, also check if it's a directory with index
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const stat = fs.statSync(filePath);

  if (stat.isDirectory()) {
    // For directories, return PROPFIND response
    handlePropfind(req, res, filePath, req.url);
    return;
  }

  // Serve file
  const fileSize = stat.size;
  const range = req.headers.range;

  res.setHeader('Content-Type', getMimeType(filePath));
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', `"${crypto.createHash('md5').update(stat.ino + '-' + stat.mtimeMs).digest('hex')}"`);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    res.writeHead(200);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
}

function handlePropfind(req, res, filePath, urlPath) {
  const depth = req.headers.depth || '1';

  // Normalize URL path
  let normalizedPath = urlPath;
  if (normalizedPath.startsWith('/photos')) {
    normalizedPath = normalizedPath.replace('/photos', '') || '/';
  }
  if (!normalizedPath.endsWith('/') && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    normalizedPath = normalizedPath + '/';
  }

  // If path doesn't exist, create it
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(filePath, { recursive: true });
  }

  const stat = fs.statSync(filePath);
  const responses = [];

  // Root response
  const href = normalizedPath === '/' ? '/' : normalizedPath;
  responses.push(createResponse(href, stat, urlPath.startsWith('/photos') ? '/photos' : ''));

  // List contents if directory and depth != 0
  if (stat.isDirectory() && depth !== '0') {
    try {
      const entries = fs.readdirSync(filePath);
      for (const entry of entries) {
        const entryPath = path.join(filePath, entry);
        try {
          const entryStat = fs.statSync(entryPath);
          const entryHref = href === '/' ? `/${entry}` : `${href}/${entry}`;
          responses.push(createResponse(entryHref, entryStat, ''));
        } catch (e) {
          // Skip inaccessible entries
        }
      }
    } catch (e) {
      // Directory not readable
    }
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responses.join('\n')}
</D:multistatus>`;

  res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(xml);
}

function createResponse(href, stat, prefix = '') {
  const displayName = href === '/' ? '' : path.basename(href.replace(/\/$/, ''));
  const fullHref = prefix + href;
  const isDir = stat.isDirectory();

  const lastMod = stat.mtime.toUTCString();
  const resourceType = isDir ? '<D:collection/>' : '';
  const contentType = isDir ? 'httpd/unix-directory' : getMimeType(href);
  const contentLen = stat.size;

  return `  <D:response>
    <D:href>${escapeXml(fullHref)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(displayName)}</D:displayname>
        <D:getcontenttype>${contentType}</D:getcontenttype>
        <D:getcontentlength>${contentLen}</D:getcontentlength>
        <D:getlastmodified>${lastMod}</D:getlastmodified>
        <D:resourcetype>${resourceType}</D:resourcetype>
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
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
  if (fs.existsSync(filePath)) {
    res.writeHead(405);
    res.end('Directory already exists');
    return;
  }

  try {
    fs.mkdirSync(filePath, { recursive: true });
    res.writeHead(201);
    res.end('Created');
  } catch (e) {
    res.writeHead(403);
    res.end('Cannot create directory');
  }
}

function handleDelete(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
    res.writeHead(204);
    res.end();
  } catch (e) {
    res.writeHead(403);
    res.end('Cannot delete');
  }
}

function handleMove(req, res, filePath) {
  const destination = req.headers.destination;
  if (!destination) {
    res.writeHead(400);
    res.end('Destination required');
    return;
  }

  // Parse destination URL
  let destPath = destination;
  try {
    const destUrl = new URL(destination);
    destPath = destUrl.pathname;
    if (destPath.startsWith('/photos')) {
      destPath = destPath.replace('/photos', '') || '/';
    }
  } catch (e) {
    // Use destination as-is
  }

  const destFilePath = path.join(getBackupPath(), destPath === '/' ? '' : destPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Source not found');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.mkdirSync(destFilePath, { recursive: true });
      // Move contents
      const entries = fs.readdirSync(filePath);
      for (const entry of entries) {
        fs.renameSync(path.join(filePath, entry), path.join(destFilePath, entry));
      }
      fs.rmdirSync(filePath);
    } else {
      fs.renameSync(filePath, destFilePath);
    }
    res.writeHead(201);
    res.end('Moved');
  } catch (e) {
    res.writeHead(403);
    res.end('Cannot move');
  }
}

function handleCopy(req, res, filePath) {
  const destination = req.headers.destination;
  if (!destination) {
    res.writeHead(400);
    res.end('Destination required');
    return;
  }

  let destPath = destination;
  try {
    const destUrl = new URL(destination);
    destPath = destUrl.pathname;
    if (destPath.startsWith('/photos')) {
      destPath = destPath.replace('/photos', '') || '/';
    }
  } catch (e) {
    // Use destination as-is
  }

  const destFilePath = path.join(getBackupPath(), destPath === '/' ? '' : destPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Source not found');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.mkdirSync(destFilePath, { recursive: true });
      const entries = fs.readdirSync(filePath);
      for (const entry of entries) {
        fs.copyFileSync(path.join(filePath, entry), path.join(destFilePath, entry));
      }
    } else {
      fs.copyFileSync(filePath, destFilePath);
    }
    res.writeHead(201);
    res.end('Copied');
  } catch (e) {
    res.writeHead(403);
    res.end('Cannot copy');
  }
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
  console.log(`4. Enter: http://${getLocalIp()}:${PORT}`);
  console.log('');
});
