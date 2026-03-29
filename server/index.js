const WebDAVServer = require('./webdav');
const os = require('os');

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

function getBackupPath() {
  const home = process.env.HOME || '/root';
  return process.env.BACKUP_PATH || `${home}/iPhonePhotoBridge/Backups`;
}

async function main() {
  const port = parseInt(process.env.PORT || '8080', 10);
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const username = process.env.AUTH_USER || '';
  const password = process.env.AUTH_PASS || '';

  const server = new WebDAVServer({
    port,
    backupPath: getBackupPath(),
    authEnabled,
    username,
    password,
    onFileUpload: (data) => {
      console.log(JSON.stringify({ type: 'upload', ...data }));
    },
    onConnection: (req) => {
      console.log(JSON.stringify({
        type: 'connection',
        method: req.method,
        url: req.url,
        timestamp: new Date().toISOString()
      }));
    }
  });

  try {
    await server.start();
    const localIp = getLocalIp();
    console.log(JSON.stringify({
      type: 'server_started',
      url: `http://${localIp}:${port}`,
      localIp,
      port,
      backupPath: getBackupPath()
    }));

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      await server.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      await server.stop();
      process.exit(0);
    });
  } catch (err) {
    console.error(JSON.stringify({
      type: 'error',
      message: err.message
    }));
    process.exit(1);
  }
}

main();
