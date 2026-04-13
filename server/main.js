const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Store for server state
let server = null;
let httpsServer = null;
let serverState = {
  running: false,
  url: '',
  localIp: '',
  port: 8080,
  https: false,
  connections: 0,
  startTime: null
};

// Known file hashes for duplicate detection
let knownHashes = new Set();

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
  const configPath = path.join(home, '.iPhonePhotoBridge', 'config.json');

  // Check for custom config
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.backupPath) {
        return path.resolve(config.backupPath.replace('~', home));
      }
    } catch (e) {
      // Use default
    }
  }

  return path.join(home, 'iPhonePhotoBridge', 'Backups');
}

// Get certs path
function getCertsPath() {
  const home = process.env.HOME || '/root';
  return path.join(home, '.iPhonePhotoBridge', 'certs');
}

// Generate self-signed certificate using Node.js crypto
async function generateSSLCerts() {
  const certsPath = getCertsPath();
  const keyPath = path.join(certsPath, 'server.key');
  const certPath = path.join(certsPath, 'server.crt');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  fs.mkdirSync(certsPath, { recursive: true });

  const localIp = getLocalIp();

  // Generate key pair
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  // Create self-signed certificate
  const certAttributes = [
    { name: 'commonName', value: localIp },
    { name: 'countryName', value: 'US' },
    { name: 'stateOrProvinceName', value: 'Local' },
    { name: 'localityName', value: 'Local' },
    { name: 'organizationName', value: 'iPhonePhotoBridge' }
  ];

  const certExtensions = [
    {
      name: 'basicConstraints',
      critical: true,
      cA: false,
      pathLenConstraint: 0
    },
    {
      name: 'keyUsage',
      critical: true,
      keyCertSign: false,
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: 'extKeyUsage',
      serverAuth: true
    },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 7, ip: Buffer.from(localIp.split('.').map(n => parseInt(n, 10))) }, // IP
        { type: 2, value: 'localhost' }, // DNS
        { type: 2, value: localIp } // DNS
      ]
    }
  ];

  const cert = crypto.createCertificate({
    subject: certAttributes,
    issuer: certAttributes,
    publicKey: publicKey,
    serialNumber: crypto.randomBytes(16).toString('hex'),
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    extensions: certExtensions,
    algorithm: 'sha256'
  });

  const certPem = cert.toString('pem');
  const keyPem = privateKey;

  fs.writeFileSync(keyPath, keyPem);
  fs.writeFileSync(certPath, certPem);

  console.log('SSL certificates generated successfully');

  return { key: keyPem, cert: certPem };
}

// Generate certificate using openssl fallback
async function generateCertsWithOpenSSL() {
  const certsPath = getCertsPath();
  const keyPath = path.join(certsPath, 'server.key');
  const certPath = path.join(certsPath, 'server.crt');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  fs.mkdirSync(certsPath, { recursive: true });

  const localIp = getLocalIp();
  const { execSync } = require('child_process');

  const subject = `/C=US/ST=Local/L=Local/O=iPhonePhotoBridge/CN=${localIp}`;

  try {
    execSync(`openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 -subj "${subject}" -keyout "${keyPath}" -out "${certPath}" -addext "subjectAltName=IP:${localIp},DNS:localhost,DNS:${localIp}"`, { stdio: 'pipe' });
    console.log('SSL certificates generated using openssl');
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  } catch (e) {
    console.error('OpenSSL failed, using Node.js crypto for certificate generation');
    return await generateSSLCerts();
  }
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

// Increment connection count
function incrementConnections() {
  serverState.connections++;
  emitEvent({ type: 'connection', count: serverState.connections });
}

// Decrement connection count
function decrementConnections() {
  serverState.connections = Math.max(0, serverState.connections - 1);
  emitEvent({ type: 'connection', count: serverState.connections });
}

// Load known hashes from existing metadata
function loadKnownHashes() {
  const metadataDir = path.join(path.dirname(getBackupPath()), 'MetaData');

  if (!fs.existsSync(metadataDir)) {
    return;
  }

  try {
    const files = fs.readdirSync(metadataDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const hash = file.replace('.json', '');
          knownHashes.add(hash);
        } catch (e) {
          // Skip
        }
      }
    }
    console.log(`Loaded ${knownHashes.size} known file hashes`);
  } catch (e) {
    console.error('Error loading known hashes:', e);
  }
}

// Load saved photos from metadata
function loadPhotos() {
  const metadataDir = path.join(path.dirname(getBackupPath()), 'MetaData');
  const photos = [];
  const localIp = getLocalIp();
  const port = serverState.port || 3000;
  const protocol = serverState.https ? 'https' : 'http';

  if (!fs.existsSync(metadataDir)) {
    return photos;
  }

  try {
    const files = fs.readdirSync(metadataDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(metadataDir, file), 'utf8'));
          const hash = data.hash || path.basename(file, '.json');
          photos.push({
            id: hash,
            filename: data.filename,
            path: data.path,
            size: data.size,
            format: data.format,
            dateCreated: data.dateCreated,
            // Add thumbnail URL
            thumbnailUrl: `${protocol}://${localIp}:${port}/api/thumbnail/${hash}`,
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

// Organize file path by date
function organizeByDate(filePath, autoOrganize) {
  if (!autoOrganize) return filePath;

  try {
    const stat = fs.statSync(filePath);
    const date = stat.mtime || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const dir = path.dirname(filePath);
    const organizedDir = path.join(dir, year, month, day);

    if (!fs.existsSync(organizedDir)) {
      fs.mkdirSync(organizedDir, { recursive: true });
    }

    return path.join(organizedDir, path.basename(filePath));
  } catch (e) {
    return filePath;
  }
}

// Create WebDAV server
function createWebDAVServer(port, useHttps = false, autoOrganize = true) {
  return new Promise(async (resolve, reject) => {
    const backupPath = getBackupPath();

    // Ensure backup directory exists
    if (!fs.existsSync(backupPath)) {
      fs.mkdirSync(backupPath, { recursive: true });
    }

    const metadataDir = path.join(path.dirname(backupPath), 'MetaData');
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }

    // Load known hashes for duplicate detection
    loadKnownHashes();

    let credentials = null;
    if (useHttps) {
      try {
        credentials = await generateCertsWithOpenSSL();
      } catch (e) {
        console.log('SSL cert generation failed, falling back to HTTP');
        useHttps = false;
      }
    }

    const httpServer = useHttps && credentials
      ? https.createServer({ key: credentials.key, cert: credentials.cert }, (req, res) => {
          incrementConnections();
          req.on('close', () => decrementConnections());
          handleWebDAVRequest(req, res, backupPath, metadataDir, autoOrganize);
        })
      : http.createServer((req, res) => {
          incrementConnections();
          req.on('close', () => decrementConnections());
          handleWebDAVRequest(req, res, backupPath, metadataDir, autoOrganize);
        });

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    httpServer.listen(port, '0.0.0.0', () => {
      const protocol = useHttps ? 'https' : 'http';
      const localIp = getLocalIp();
      serverState = {
        running: true,
        url: `${protocol}://${localIp}:${port}`,
        localIp,
        port,
        https: useHttps,
        connections: 0,
        startTime: new Date().toISOString()
      };

      if (useHttps) {
        httpsServer = httpServer;
      } else {
        server = httpServer;
      }

      console.log(`WebDAV server running on ${protocol}://${localIp}:${port}`);
      resolve(serverState);
    });
  });
}

// Handle WebDAV requests
function handleWebDAVRequest(req, res, backupPath, metadataDir, autoOrganize) {
  const url = new URL(req.url, `http://localhost:${serverState.port}`);
  let pathname = decodeURIComponent(url.pathname);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, OPTIONS, HEAD, LOCK, UNLOCK');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('DAV', '1, 2');
  res.setHeader('MS-Author-Via', 'DAV');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Normalize path - remove leading slash issues
  let filePath = path.join(backupPath, pathname.slice(1) || '');

  // Handle root path
  if (pathname === '/' || pathname === '') {
    filePath = backupPath;
  }

  try {
    switch (req.method) {
      case 'GET':
      case 'HEAD':
        handleGet(req, res, filePath);
        break;
      case 'PROPFIND':
        handlePropfind(req, res, filePath, pathname);
        break;
      case 'PUT':
        handlePut(req, res, filePath, metadataDir, autoOrganize);
        break;
      case 'MKCOL':
        handleMkcol(req, res, filePath);
        break;
      case 'DELETE':
        handleDelete(req, res, filePath, metadataDir);
        break;
      case 'MOVE':
        handleMove(req, res, filePath);
        break;
      case 'COPY':
        handleCopy(req, res, filePath);
        break;
      case 'LOCK':
      case 'UNLOCK':
        res.writeHead(200);
        res.end();
        break;
      default:
        res.writeHead(405);
        res.end('Method not allowed');
    }
  } catch (err) {
    console.error('WebDAV error:', err);
    res.writeHead(500);
    res.end('Internal server error');
  }
}

function handleGet(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const stat = fs.statSync(filePath);

  if (stat.isDirectory()) {
    handlePropfind(req, res, filePath, req.url);
    return;
  }

  const fileSize = stat.size;
  const range = req.headers.range;

  res.setHeader('Content-Type', getMimeType(filePath));
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200);
    fs.createReadStream(filePath).pipe(res);
  }
}

function handlePropfind(req, res, filePath, urlPath) {
  const depth = req.headers.depth || '1';

  // Create directory if it doesn't exist
  if (!fs.existsSync(filePath)) {
    try {
      fs.mkdirSync(filePath, { recursive: true });
    } catch (e) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  const stat = fs.statSync(filePath);
  const responses = [];

  // Current item
  const href = urlPath === '/' ? '/' : urlPath;
  responses.push(createResponse(href, stat));

  // List contents
  if (stat.isDirectory() && depth !== '0') {
    try {
      const entries = fs.readdirSync(filePath);
      for (const entry of entries) {
        const entryPath = path.join(filePath, entry);
        try {
          const entryStat = fs.statSync(entryPath);
          const entryHref = href === '/' ? `/${entry}` : `${href}/${entry}`;
          responses.push(createResponse(entryHref, entryStat));
        } catch (e) {
          // Skip
        }
      }
    } catch (e) {
      // Skip
    }
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responses.join('\n')}
</D:multistatus>`;

  res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(xml);
}

function createResponse(href, stat) {
  const displayName = path.basename(href) || '';
  const isDir = stat.isDirectory();
  const contentType = isDir ? 'httpd/unix-directory' : getMimeType(href);

  return `  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(displayName)}</D:displayname>
        <D:getcontenttype>${contentType}</D:getcontenttype>
        <D:getcontentlength>${stat.size}</D:getcontentlength>
        <D:getlastmodified>${stat.mtime.toUTCString()}</D:getlastmodified>
        <D:resourcetype>${isDir ? '<D:collection/>' : ''}</D:resourcetype>
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

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.dng': 'image/x-adobe-dng',
    '.raw': 'image/x-raw',
    '.cr2': 'image/x-canon-cr2',
    '.nef': 'image/x-nikon-nef',
    '.arw': 'image/x-sony-arw',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.json': 'application/json',
    '.xml': 'application/xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function handlePut(req, res, filePath, metadataDir, autoOrganize) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const chunks = [];
  let totalSize = 0;

  req.on('data', chunk => {
    chunks.push(chunk);
    totalSize += chunk.length;
  });

  req.on('end', () => {
    const buffer = Buffer.concat(chunks);

    // Calculate hash for duplicate detection
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    // Check for duplicate
    if (knownHashes.has(hash)) {
      emitEvent({
        type: 'upload',
        filename: path.basename(filePath),
        path: filePath,
        size: buffer.length,
        progress: 100,
        status: 'duplicate',
        hash,
        duplicate: true
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        duplicate: true,
        message: 'File already exists (duplicate detected)',
        hash
      }));
      return;
    }

    // Organize by date if enabled
    const organizedPath = organizeByDate(filePath, autoOrganize);
    const organizedDir = path.dirname(organizedPath);

    if (!fs.existsSync(organizedDir)) {
      fs.mkdirSync(organizedDir, { recursive: true });
    }

    fs.writeFileSync(organizedPath, buffer);

    const filename = path.basename(organizedPath);

    // Add to known hashes
    knownHashes.add(hash);

    const metadata = {
      filename,
      path: organizedPath,
      size: buffer.length,
      format: path.extname(filename).slice(1).toUpperCase() || 'Unknown',
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      hash,
      originalName: path.basename(filePath)
    };

    const metadataPath = path.join(metadataDir, hash + '.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    emitEvent({
      type: 'upload',
      filename,
      path: organizedPath,
      size: buffer.length,
      progress: 100,
      status: 'complete',
      hash,
      metadata
    });

    res.writeHead(201, {
      'Location': '/' + path.basename(organizedPath),
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({
      success: true,
      hash,
      organized: organizedPath !== filePath
    }));
  });
}

function handleMkcol(req, res, filePath) {
  if (fs.existsSync(filePath)) {
    res.writeHead(405);
    res.end('Already exists');
    return;
  }
  fs.mkdirSync(filePath, { recursive: true });
  res.writeHead(201);
  res.end('Created');
}

function handleDelete(req, res, filePath, metadataDir) {
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

function handleMove(req, res, filePath) {
  const dest = req.headers.destination;
  if (!dest) {
    res.writeHead(400);
    res.end('Destination required');
    return;
  }

  const destPath = path.join(getBackupPath(), decodeURIComponent(dest.replace(/^\//, '')));

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.renameSync(filePath, destPath);
    }
    res.writeHead(201);
    res.end('Moved');
  } catch (e) {
    res.writeHead(403);
    res.end('Cannot move');
  }
}

function handleCopy(req, res, filePath) {
  const dest = req.headers.destination;
  if (!dest) {
    res.writeHead(400);
    res.end('Destination required');
    return;
  }

  const destPath = path.join(getBackupPath(), decodeURIComponent(dest.replace(/^\//, '')));

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
    } else {
      fs.copyFileSync(filePath, destPath);
    }
    res.writeHead(201);
    res.end('Copied');
  } catch (e) {
    res.writeHead(403);
    res.end('Cannot copy');
  }
}

// API Routes
app.post('/api/server/start', async (req, res) => {
  if (server || httpsServer) {
    res.json({ success: false, error: 'Server already running' });
    return;
  }

  const port = req.body.port || 8080;
  const useHttps = req.body.https !== false;
  const autoOrganize = req.body.autoOrganize !== false;

  try {
    const state = await createWebDAVServer(port, useHttps, autoOrganize);
    res.json({
      success: true,
      url: state.url,
      localIp: state.localIp,
      port: state.port,
      https: state.https,
      startTime: state.startTime
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/server/stop', (req, res) => {
  if (server) {
    server.close();
    server = null;
  }
  if (httpsServer) {
    httpsServer.close();
    httpsServer = null;
  }
  serverState.running = false;
  serverState.url = '';
  res.json({ success: true });
});

app.get('/api/server/status', (req, res) => {
  res.json({
    ...serverState,
    uptime: serverState.startTime ?
      Math.floor((Date.now() - new Date(serverState.startTime).getTime()) / 1000) : 0
  });
});

app.get('/api/photos', (req, res) => {
  res.json({ photos: loadPhotos() });
});

app.get('/api/photos/:hash', (req, res) => {
  const metadataDir = path.join(path.dirname(getBackupPath()), 'MetaData');
  const metadataPath = path.join(metadataDir, req.params.hash + '.json');

  if (fs.existsSync(metadataPath)) {
    res.json(JSON.parse(fs.readFileSync(metadataPath, 'utf8')));
  } else {
    res.status(404).json({ error: 'Photo not found' });
  }
});

// Serve thumbnail for a photo
app.get('/api/thumbnail/:hash', (req, res) => {
  const metadataDir = path.join(path.dirname(getBackupPath()), 'MetaData');
  const metadataPath = path.join(metadataDir, req.params.hash + '.json');

  if (!fs.existsSync(metadataPath)) {
    res.status(404).json({ error: 'Photo not found' });
    return;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const photoPath = metadata.path;

    if (!fs.existsSync(photoPath)) {
      res.status(404).json({ error: 'Photo file not found' });
      return;
    }

    // Check if it's an image format we can serve
    const ext = path.extname(photoPath).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'];

    if (imageExts.includes(ext)) {
      // Check for cached thumbnail first
      const thumbnailDir = path.join(path.dirname(getBackupPath()), 'Thumbnails');
      const thumbnailPath = path.join(thumbnailDir, req.params.hash + '.jpg');

      if (fs.existsSync(thumbnailPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.sendFile(thumbnailPath);
        return;
      }

      // No thumbnail cache, serve original with caching headers
      const mimeType = getMimeType(photoPath);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.sendFile(photoPath);
    } else {
      // For non-image files (videos), return a placeholder indicator
      res.status(200).json({ type: 'video', format: metadata.format });
    }
  } catch (e) {
    console.error('Error serving thumbnail:', e);
    res.status(500).json({ error: 'Error loading thumbnail' });
  }
});

app.get('/api/system/info', (req, res) => {
  const backupPath = getBackupPath();
  const stats = {
    localIp: getLocalIp(),
    homeDir: os.homedir(),
    backupPath: backupPath,
    totalPhotos: 0,
    totalSize: 0,
    formats: {}
  };

  // Calculate stats
  const photos = loadPhotos();
  stats.totalPhotos = photos.length;
  photos.forEach(p => {
    stats.totalSize += p.size || 0;
    const format = p.format || 'Unknown';
    stats.formats[format] = (stats.formats[format] || 0) + 1;
  });

  res.json(stats);
});

app.get('/api/cert', (req, res) => {
  const certPath = path.join(getCertsPath(), 'server.crt');
  if (fs.existsSync(certPath)) {
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename=iphone-photo-bridge.crt');
    res.sendFile(certPath);
  } else {
    res.status(404).send('Certificate not found. Start server with HTTPS first.');
  }
});

app.get('/api/config', (req, res) => {
  const configPath = path.join(os.homedir(), '.iPhonePhotoBridge', 'config.json');
  if (fs.existsSync(configPath)) {
    res.json(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } else {
    res.json({
      backupPath: getBackupPath(),
      autoOrganize: true
    });
  }
});

app.post('/api/config', (req, res) => {
  const configDir = path.join(os.homedir(), '.iPhonePhotoBridge');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const configPath = path.join(configDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', count: serverState.connections })}\n\n`);
  eventListeners.push(res);

  req.on('close', () => {
    eventListeners = eventListeners.filter(r => r !== res);
  });
});

// Serve static files
const publicPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}

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
  const localIp = getLocalIp();
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║          iPhone Photo Bridge - Web Interface              ║
╠═══════════════════════════════════════════════════════════╣
║  Web Interface:  http://${localIp}:${PORT}
║  WebDAV URL:     https://${localIp}:8080
║  (HTTPS enabled for iOS Files app compatibility)
╚═══════════════════════════════════════════════════════════╝

iPhone Connection Steps:
1. Open Safari on your iPhone
2. Go to: https://${localIp}:${PORT}
3. Download and trust the SSL certificate
4. Open Files app > ... > Connect to Server
5. Enter: https://${localIp}:8080
6. Accept the certificate when prompted
`);
});
