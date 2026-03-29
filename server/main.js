const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('http');
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

// Get certs path
function getCertsPath() {
  const home = process.env.HOME || '/root';
  return path.join(home, 'iPhonePhotoBridge', 'certs');
}

// Generate self-signed certificate
function generateCerts() {
  const certsPath = getCertsPath();
  const keyPath = path.join(certsPath, 'server.key');
  const certPath = path.join(certsPath, 'server.crt');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  fs.mkdirSync(certsPath, { recursive: true });

  const { privateKey, certificate } = crypto.generateKeyPairSync('rsa', {
    name: 'rsa',
    modulusLength: 2048,
  });

  const cert = crypto.createSignMock || (() => {
    const localIp = getLocalIp();
    const attrs = [{ name: 'commonName', value: localIp }, { name: 'localityName', value: 'Local' }];
    const ext = [
      { name: 'subjectAltName', values: [`IP:${localIp}`, `DNS:localhost`, `DNS:${localIp}`] },
      { name: 'keyUsage', value: { digitalSignature: true, keyEncipherment: true } },
      { name: 'extKeyUsage', value: { serverAuth: true } }
    ];

    return crypto.createSelfSignedSessionTicket({
      keys: { privateKey, certificate },
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      serialNumber: crypto.randomBytes(16).toString('hex'),
      extensions: ext,
      subject: attrs,
      issuer: attrs
    });
  })();

  // Simple self-signed cert using crypto
  const certPem = `-----BEGIN CERTIFICATE-----
${Buffer.from(certificate).toString('base64').match(/.{1,64}/g).join('\n')}
-----END CERTIFICATE-----`;

  const keyPem = `-----BEGIN RSA PRIVATE KEY-----
${privateKey.export({ type: 'pkcs1', format: 'pem' }).toString('base64').match(/.{1,64}/g).join('\n')}
-----END RSA PRIVATE KEY-----`;

  fs.writeFileSync(keyPath, keyPem);
  fs.writeFileSync(certPath, certPem);

  return { key: keyPem, cert: certPem };
}

// Generate certificate using openssl fallback
async function generateSSLCerts() {
  const certsPath = getCertsPath();
  const keyPath = path.join(certsPath, 'server.key');
  const certPath = path.join(certsPath, 'server.crt');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  fs.mkdirSync(certsPath, { recursive: true });

  const localIp = getLocalIp();

  // Generate certificate using openssl
  const subject = `/C=US/ST=Local/L=Local/O=iPhonePhotoBridge/CN=${localIp}`;

  return new Promise((resolve, reject) => {
    const { execSync } = require('child_process');

    try {
      execSync(`openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 -subj "${subject}" -keyout "${keyPath}" -out "${certPath}" -addext "subjectAltName=IP:${localIp},DNS:localhost,DNS:${localIp}"`, { stdio: 'pipe' });
      resolve({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) });
    } catch (e) {
      // Fallback: generate basic cert
      const { privateKey, publicKey } = crypto.generateKeyPairSyncSync('rsa', { modulusLength: 2048 });
      const cert = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4P3c7PzANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjUwMzMwMTAwMDAwWhcNMjYwMzI5MTAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
o5E7V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5
V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V
5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5
V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5
V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5
AgMBAAEwDQYJKoZIhvcNAQELBQADggEBADe3Y9R9O5V5V5V5V5V5V5V5V5V5V5V5V
V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5
V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5V5
-----END CERTIFICATE-----`;
      fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs1', format: 'pem' }));
      fs.writeFileSync(certPath, cert);
      resolve({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) });
    }
  });
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

// Create WebDAV server
function createWebDAVServer(port, useHttps = false) {
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

    let credentials = null;
    if (useHttps) {
      try {
        credentials = await generateSSLCerts();
      } catch (e) {
        console.log('SSL cert generation failed, falling back to HTTP');
        useHttps = false;
      }
    }

    const httpServer = useHttps && credentials
      ? https.createServer({ key: credentials.key, cert: credentials.cert }, (req, res) => {
          handleWebDAVRequest(req, res, backupPath, metadataDir);
        })
      : createServer((req, res) => {
          handleWebDAVRequest(req, res, backupPath, metadataDir);
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
        connections: 0
      };

      if (useHttps) {
        httpsServer = httpServer;
      } else {
        server = httpServer;
      }

      resolve(serverState);
    });
  });
}

// Handle WebDAV requests
function handleWebDAVRequest(req, res, backupPath, metadataDir) {
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

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(filePath, { recursive: true });
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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function handlePut(req, res, filePath, metadataDir) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));

  req.on('end', () => {
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(filePath, buffer);

    const filename = path.basename(filePath);
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    const metadata = {
      filename,
      path: filePath,
      size: buffer.length,
      format: path.extname(filename).slice(1).toUpperCase() || 'Unknown',
      dateCreated: new Date().toISOString(),
      hash
    };

    const metadataPath = path.join(metadataDir, hash + '.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    emitEvent({
      type: 'upload',
      filename,
      path: filePath,
      size: buffer.length,
      progress: 100,
      status: 'complete',
      hash,
      metadata
    });

    res.writeHead(201, { 'Location': '/' + path.basename(filePath) });
    res.end('Created');
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

function handleMove(req, res, filePath) {
  const dest = req.headers.destination;
  if (!dest) {
    res.writeHead(400);
    res.end('Destination required');
    return;
  }

  const destPath = path.join(getBackupPath(), dest.replace(/^\//, ''));

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

  const destPath = path.join(getBackupPath(), dest.replace(/^\//, ''));

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
  const useHttps = req.body.https !== false; // Default to HTTPS for iOS compatibility

  try {
    const state = await createWebDAVServer(port, useHttps);
    res.json({
      success: true,
      url: state.url,
      localIp: state.localIp,
      port: state.port,
      https: state.https
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
  res.json(serverState);
});

app.get('/api/photos', (req, res) => {
  res.json({ photos: loadPhotos() });
});

app.get('/api/system/info', (req, res) => {
  res.json({
    localIp: getLocalIp(),
    homeDir: os.homedir(),
    backupPath: getBackupPath()
  });
});

app.get('/api/cert', (req, res) => {
  const certPath = path.join(getCertsPath(), 'server.crt');
  if (fs.existsSync(certPath)) {
    res.sendFile(certPath);
  } else {
    res.status(404).send('Certificate not found. Start server with HTTPS first.');
  }
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
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
