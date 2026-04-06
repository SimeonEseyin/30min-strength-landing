const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const rootDir = __dirname;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(rootDir, '.env.local'));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleFunctionRequest(req, res, parsedUrl) {
  const fnName = parsedUrl.pathname.replace('/.netlify/functions/', '');
  const filePath = path.join(rootDir, 'netlify', 'functions', `${fnName}.js`);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'Function not found' });
    return;
  }

  try {
    const rawBody = await readRequestBody(req);
    Object.keys(require.cache).forEach(cacheKey => {
      if (cacheKey.startsWith(path.join(rootDir, 'netlify', 'functions'))) {
        delete require.cache[cacheKey];
      }
    });
    const mod = require(filePath);
    const result = await mod.handler({
      httpMethod: req.method,
      body: rawBody,
      headers: req.headers,
      path: parsedUrl.pathname,
      queryStringParameters: Object.fromEntries(parsedUrl.searchParams.entries()),
    });

    const statusCode = result?.statusCode || 200;
    const headers = result?.headers || {};
    res.writeHead(statusCode, {
      'Access-Control-Allow-Origin': '*',
      ...headers,
    });
    res.end(result?.body || '');
  } catch (error) {
    console.error(`[function:${fnName}]`, error);
    sendJson(res, 500, { error: 'Local function error', detail: error.message });
  }
}

function safeFilePath(requestPath) {
  let pathname = decodeURIComponent(requestPath);
  if (pathname === '/') pathname = '/devdad-landing.html';

  const routeAliases = {
    '/app': '/devdad-app.html',
    '/app/': '/devdad-app.html',
    '/favicon.ico': '/icons/favicon.ico',
  };

  pathname = routeAliases[pathname] || pathname;
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  return path.join(rootDir, normalized);
}

function handleStaticRequest(req, res, parsedUrl) {
  const targetPath = safeFilePath(parsedUrl.pathname);
  if (!targetPath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let filePath = targetPath;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

const port = parseInt(process.env.PORT || '4173', 10);

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (parsedUrl.pathname.startsWith('/.netlify/functions/')) {
    await handleFunctionRequest(req, res, parsedUrl);
    return;
  }

  handleStaticRequest(req, res, parsedUrl);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local DevDad server running at http://127.0.0.1:${port}`);
});
