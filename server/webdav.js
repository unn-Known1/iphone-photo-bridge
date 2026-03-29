const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class WebDAVServer {
  constructor(options = {}) {
    this.port = options.port || 8080;
    this.backupPath = options.backupPath || path.join(process.env.HOME || '/root', 'iPhonePhotoBridge', 'Backups');
    this.authEnabled = options.authEnabled || false;
    this.username = options.username || '';
    this.password = options.password || '';
    this.onFileUpload = options.onFileUpload || (() => {});
    this.onConnection = options.onConnection || (() => {});
    this.server = null;
  }

  async start() {
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupPath)) {
      fs.mkdirSync(this.backupPath, { recursive: true });
    }

    const metadataPath = path.join(path.dirname(this.backupPath), 'MetaData');
    if (!fs.existsSync(metadataPath)) {
      fs.mkdirSync(metadataPath, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        console.log(`WebDAV server running on port ${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('WebDAV server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  authenticate(req) {
    if (!this.authEnabled) return true;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return false;
    }

    try {
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [user, pass] = credentials.split(':');
      return user === this.username && pass === this.password;
    } catch {
      return false;
    }
  }

  sendAuthChallenge(res) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="iPhone Photo Bridge"',
      'Content-Type': 'text/plain'
    });
    res.end('Authentication required');
  }

  async handleRequest(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Length, Authorization, Depth, Destination, If, Overwrite, X-Expected-Entity-Length');
    res.setHeader('Access-Control-Expose-Headers', 'DAV, Content-Type, Upload-Offset, Location');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!this.authenticate(req)) {
      this.sendAuthChallenge(res);
      return;
    }

    this.onConnection(req);

    const url = new URL(req.url, `http://localhost:${this.port}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method;

    try {
      if (pathname === '/' || pathname === '') {
        await this.handleRoot(req, res, method);
      } else if (pathname.startsWith('/photos/')) {
        await this.handlePhotos(req, res, method, pathname);
      } else {
        await this.handleFileOperations(req, res, method, pathname);
      }
    } catch (err) {
      console.error('Request error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  }

  async handleRoot(req, res, method) {
    if (method === 'GET' || method === 'PROPFIND') {
      const depth = req.headers.depth || '1';
      const props = this.generateDirProps('/', depth);

      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(this.generateMultiStatus([props], depth));
    } else {
      res.writeHead(405);
      res.end('Method not allowed');
    }
  }

  async handlePhotos(req, res, method, pathname) {
    const relativePath = pathname.replace('/photos/', '');
    const filePath = path.join(this.backupPath, relativePath);

    if (method === 'GET') {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          await this.listDirectory(req, res, filePath, '/photos/' + relativePath);
        } else {
          await this.serveFile(req, res, filePath);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } else if (method === 'PUT') {
      await this.uploadFile(req, res, filePath);
    } else if (method === 'MKCOL') {
      await this.createDirectory(req, res, filePath);
    } else if (method === 'DELETE') {
      await this.deleteResource(req, res, filePath);
    } else if (method === 'PROPFIND') {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          await this.listDirectory(req, res, filePath, '/photos/' + relativePath);
        } else {
          const props = this.generateFileProps('/photos/' + relativePath, stat);
          res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
          res.end(this.generateMultiStatus([props], '0'));
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } else {
      res.writeHead(405);
      res.end('Method not allowed');
    }
  }

  async handleFileOperations(req, res, method, pathname) {
    const relativePath = pathname.slice(1);
    const filePath = path.join(this.backupPath, relativePath);

    if (method === 'GET') {
      await this.serveFile(req, res, filePath);
    } else if (method === 'PUT') {
      await this.uploadFile(req, res, filePath);
    } else if (method === 'MKCOL') {
      await this.createDirectory(req, res, filePath);
    } else if (method === 'DELETE') {
      await this.deleteResource(req, res, filePath);
    } else if (method === 'PROPFIND') {
      const depth = req.headers.depth || '1';
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          await this.listDirectory(req, res, filePath, pathname);
        } else {
          const props = this.generateFileProps(pathname, stat);
          res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
          res.end(this.generateMultiStatus([props], '0'));
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } else {
      res.writeHead(405);
      res.end('Method not allowed');
    }
  }

  async serveFile(req, res, filePath) {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': this.getMimeType(filePath)
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': this.getMimeType(filePath)
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    }
  }

  async uploadFile(req, res, filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileSize = parseInt(req.headers['x-expected-entity-length'] || req.headers['content-length'] || '0', 10);
    const writeStream = fs.createWriteStream(filePath);
    let uploadedSize = 0;
    const chunks = [];

    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        chunks.push(chunk);
        uploadedSize += chunk.length;
        writeStream.write(chunk);

        // Emit progress
        if (fileSize > 0) {
          const progress = (uploadedSize / fileSize) * 100;
          this.onFileUpload({
            filename: path.basename(filePath),
            path: filePath,
            size: uploadedSize,
            progress,
            status: 'uploading'
          });
        }
      });

      req.on('end', () => {
        writeStream.end();
        resolve(null);
      });

      req.on('error', reject);
    });

    // Calculate file hash for duplicate detection
    const hash = await this.calculateFileHash(filePath);

    // Extract metadata
    const metadata = await this.extractMetadata(filePath);

    this.onFileUpload({
      filename: path.basename(filePath),
      path: filePath,
      size: uploadedSize,
      progress: 100,
      status: 'complete',
      hash,
      metadata
    });

    res.writeHead(201, { 'Location': '/' + path.relative(this.backupPath, filePath) });
    res.end('Created');
  }

  async createDirectory(req, res, filePath) {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath, { recursive: true });
      res.writeHead(201);
      res.end('Created');
    } else {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Directory already exists');
    }
  }

  async deleteResource(req, res, filePath) {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmdirSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }

    res.writeHead(204);
    res.end();
  }

  async listDirectory(req, res, dirPath, urlPath) {
    const depth = req.headers.depth || '1';
    const items = [];

    // Add current directory
    const dirStat = fs.statSync(dirPath);
    items.push(this.generateDirProps(urlPath, '0'));

    if (depth !== '0') {
      // List contents
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        try {
          const stat = fs.statSync(entryPath);
          const entryUrl = urlPath.endsWith('/') ? urlPath + entry : urlPath + '/' + entry;

          if (stat.isDirectory()) {
            items.push(this.generateDirProps(entryUrl, '0'));
          } else {
            items.push(this.generateFileProps(entryUrl, stat));
          }
        } catch (e) {
          console.error(`Error reading ${entryPath}:`, e);
        }
      }
    }

    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(this.generateMultiStatus(items, depth));
  }

  generateDirProps(href, depth) {
    const displayName = href === '/' ? '' : path.basename(href);
    return `
      <D:response>
        <D:href>${this.escapeXml(href)}</D:href>
        <D:propstat>
          <D:prop>
            <D:displayname>${this.escapeXml(displayName)}</D:displayname>
            <D:getcontenttype>httpd/unix-directory</D:getcontenttype>
            <D:resourcetype><D:collection/></D:resourcetype>
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

  generateFileProps(href, stat) {
    const displayName = path.basename(href);
    const contentType = this.getMimeType(href);
    const lastModified = stat.mtime.toUTCString();
    const contentLength = stat.size;
    const etag = `"${this.generateETag(stat)}"`;

    return `
      <D:response>
        <D:href>${this.escapeXml(href)}</D:href>
        <D:propstat>
          <D:prop>
            <D:displayname>${this.escapeXml(displayName)}</D:displayname>
            <D:getcontenttype>${contentType}</D:getcontenttype>
            <D:getcontentlength>${contentLength}</D:getcontentlength>
            <D:getlastmodified>${lastModified}</D:getlastmodified>
            <D:getetag>${etag}</D:getetag>
            <D:resourcetype/>
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

  generateMultiStatus(items, depth) {
    return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:responsexmlns:D="DAV:">
    <D:homerepo>DAV:</D:homerepo>
  </D:responsexmlns:D="DAV:">
  ${items.join('')}
</D:multistatus>`;
  }

  generateETag(stat) {
    return crypto
      .createHash('md5')
      .update(`${stat.ino}-${stat.mtimeMs}`)
      .digest('hex');
  }

  escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  getMimeType(filePath) {
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
      '.json': 'application/json',
      '.xml': 'application/xml',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async extractMetadata(filePath) {
    // Basic metadata extraction
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    const metadata = {
      filename: path.basename(filePath),
      path: filePath,
      size: stat.size,
      format: ext.slice(1).toUpperCase(),
      dateCreated: stat.birthtime.toISOString(),
      dateModified: stat.mtime.toISOString(),
      hash: await this.calculateFileHash(filePath)
    };

    // Try to extract EXIF data using file command as fallback
    // For full EXIF support, you'd integrate exiftool or similar
    return metadata;
  }
}

module.exports = WebDAVServer;
