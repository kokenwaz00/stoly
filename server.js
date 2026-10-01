const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = __dirname;
const OPEN_DELAY_MS = 24 * 60 * 60 * 1000;

// Store the table 2 opening time when server starts (one-time calculation)
const SERVER_START_TIME_MS = Date.now();
const TABLE_2_OPEN_TIME_MS = SERVER_START_TIME_MS + OPEN_DELAY_MS;

console.log(`Server started at: ${new Date(SERVER_START_TIME_MS).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
console.log(`Table 2 will open at: ${new Date(TABLE_2_OPEN_TIME_MS).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(body);
}

function safeResolve(filePath) {
  const resolved = path.resolve(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return resolved;
}

function resolveStaticPath(requestPath) {
  if (requestPath === '/') return path.join(PUBLIC_DIR, 'index.html');

  const cleanPath = requestPath.replace(/^\/+/, '');
  if (!cleanPath) return path.join(PUBLIC_DIR, 'index.html');

  const candidate = safeResolve(cleanPath);
  if (candidate && fs.existsSync(candidate)) {
    return candidate;
  }

  return null;
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8'
    }[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300'
    });
    res.end(data);
  });
}

function getServerTimePayload() {
  const serverNowMs = Date.now();
  return {
    serverTimeMs: serverNowMs,
    serverTimeUtc: new Date(serverNowMs).toISOString(),
    serverTimeMsk: new Date(serverNowMs).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }),
    // IMPORTANT: Use fixed TABLE_2_OPEN_TIME_MS (calculated when server started)
    // NOT recalculated each request
    table2OpenAtMs: TABLE_2_OPEN_TIME_MS,
    table2OpenDelayMs: OPEN_DELAY_MS,
    timezone: 'Europe/Moscow'
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/server-time') {
    sendJson(res, 200, getServerTimePayload());
    return;
  }

  const staticPath = resolveStaticPath(url.pathname);
  if (staticPath) {
    serveFile(res, staticPath);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`✅ STOLY server running on http://localhost:${PORT}`);
  console.log(`📍 API endpoint: http://localhost:${PORT}/api/server-time`);
});
