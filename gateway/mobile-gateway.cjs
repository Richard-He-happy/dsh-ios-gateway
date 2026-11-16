// DSH mobile gateway: expose the loopback-only DSH Web GUI on the Tailscale
// interface with mobile-friendly adaptations, without restarting DSH.
//
// - Listens on the machine's Tailscale IPv4 address (never 0.0.0.0) and on
//   127.0.0.1 (so `tailscale serve` can later terminate HTTPS in front of it).
// - Authenticates the phone with a browser-session cookie minted from the local
//   stored secret, so the process launch token is never needed.
// - Rewrites Host/Origin to the upstream loopback authority so DSH's Host fence
//   and Origin check accept the request.
// - Proxies WebSocket upgrades.
// - Injects mobile.css / mobile.js / PWA meta into the index document.
// - Rediscovers the upstream port automatically (the desktop host listens on a
//   random loopback port that changes after every DSH restart).
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { loadSecret, mintCookie, cookieName } = require('./mint-cookie.cjs');

const here = __dirname;
const secret = loadSecret();

const LISTEN_PORT = Number(process.env.DSH_MOBILE_PORT || 50108);
const LOOPBACK_LISTEN = process.env.DSH_MOBILE_LOOPBACK !== '0';
const FIXED_UPSTREAM_PORT = process.env.DSH_UPSTREAM_PORT ? Number(process.env.DSH_UPSTREAM_PORT) : undefined;

const COOKIE_MAX_AGE_DAYS = 7;
const cookieCache = new Map();
function authCookie(authority) {
  const now = Date.now();
  const cached = cookieCache.get(authority);
  if (cached && now - cached.mintedAt < 24 * 60 * 60 * 1000) return cached.value;
  const value = `${cookieName(authority)}=${mintCookie(authority, secret, COOKIE_MAX_AGE_DAYS)}`;
  cookieCache.set(authority, { value, mintedAt: now });
  return value;
}

function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  console.log(line);
  try {
    const logFile = path.join(here, 'gateway.log');
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 4 * 1024 * 1024) fs.writeFileSync(logFile, '');
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    // logging is best-effort
  }
}

/* ---------- gzip for large static assets ---------- */

// DSH's static server sends the plugin bundle (~9 MB) uncompressed. Over a
// Tailscale DERP relay that can take minutes on iOS, so the gateway compresses
// cacheable assets itself and keeps the gzipped copy in memory.
const GZIP_CACHE_MAX_BYTES = 96 * 1024 * 1024;
// Enabled by default: the DSH plugin bundle (~9 MB) otherwise times out on iOS
// over slow Tailscale relay links before the app can boot. Responses are
// streamed and cached; set to false to debug a device-specific white screen.
const ENABLE_GZIP = true;
const gzipCache = new Map();
let gzipCacheBytes = 0;

function acceptsGzip(req) {
  return ENABLE_GZIP && /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
}

function isCompressibleAsset(pathname) {
  return (
    pathname.startsWith('/plugins/') ||
    pathname.startsWith('/assets/') ||
    /\.(?:js|mjs|css|json|svg|map|woff2?|ttf)$/i.test(pathname)
  );
}

function cacheGzip(key, buffer) {
  if (gzipCache.has(key)) return;
  gzipCache.set(key, buffer);
  gzipCacheBytes += buffer.length;
  while (gzipCacheBytes > GZIP_CACHE_MAX_BYTES) {
    const oldest = gzipCache.entries().next();
    if (oldest.done) break;
    gzipCache.delete(oldest.value[0]);
    gzipCacheBytes -= oldest.value[1].length;
  }
}

/* ---------- Tailscale address ---------- */

let tailscaleCandidatesCache;

function registryTailscaleDir() {
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Tailscale IPN', '/ve'], { encoding: 'utf8', timeout: 4000 });
    const match = /REG_SZ\s+(.+)\s*$/m.exec(out);
    if (match) return match[1].trim().replace(/\\+$/, '');
  } catch {
    // not installed per-machine, or reg unavailable
  }
  return undefined;
}

function tailscaleExecutables() {
  if (tailscaleCandidatesCache) return tailscaleCandidatesCache;
  const candidates = [];
  if (process.env.TAILSCALE_EXE) candidates.push(process.env.TAILSCALE_EXE);
  // PATH entry (`tailscale` on PATH is common for MSI installs).
  candidates.push('tailscale');
  const registryDir = process.platform === 'win32' ? registryTailscaleDir() : undefined;
  if (registryDir) candidates.push(path.join(registryDir, 'tailscale.exe'));
  candidates.push(
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Tailscale', 'tailscale.exe') : 'C:\\Program Files\\Tailscale\\tailscale.exe',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Tailscale', 'tailscale.exe') : 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
    'C:\\Program Files\\Tailscale\\tailscale.exe',
    'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/usr/bin/tailscale',
    '/usr/local/bin/tailscale',
  );
  tailscaleCandidatesCache = [...new Set(candidates)].filter((exe) => exe === 'tailscale' || fs.existsSync(exe));
  return tailscaleCandidatesCache;
}

function tailscaleIPv4() {
  if (process.env.DSH_MOBILE_HOST) return process.env.DSH_MOBILE_HOST;
  for (const exe of tailscaleExecutables()) {
    try {
      const out = execFileSync(exe, ['ip', '-4'], { encoding: 'utf8', timeout: 5000 }).trim().split(/\s+/)[0];
      if (/^\d+\.\d+\.\d+\.\d+$/.test(out)) return out;
    } catch {
      // try the next location
    }
  }
  throw new Error(
    'Could not find the Tailscale IPv4 address. Install Tailscale, set TAILSCALE_EXE to tailscale.exe, or set DSH_MOBILE_HOST to the address to listen on.',
  );
}

function tailscaleIPv6() {
  for (const exe of tailscaleExecutables()) {
    try {
      const out = execFileSync(exe, ['ip', '-6'], { encoding: 'utf8', timeout: 5000 }).trim().split(/\s+/)[0];
      if (/^[0-9a-f:]+$/i.test(out) && out.includes(':')) return out;
    } catch {
      // try the next location
    }
  }
  return undefined;
}

/* ---------- upstream discovery ---------- */

let upstream = { port: FIXED_UPSTREAM_PORT, authority: FIXED_UPSTREAM_PORT ? `127.0.0.1:${FIXED_UPSTREAM_PORT}` : undefined };
let discovering = null;

function candidateLoopbackPorts() {
  const ports = new Set();
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 8000 });
    for (const line of out.split(/\r?\n/)) {
      const match = /^\s*TCP\s+(127\.0\.0\.1|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (match) ports.add(Number(match[2]));
    }
  } catch (error) {
    log('netstat failed', error.message);
  }
  ports.delete(LISTEN_PORT);
  return [...ports];
}

/** Prefer the loopback ports owned by the DeepSeek Harness host process. */
function dshCandidatePorts() {
  try {
    const script = "Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Where-Object { $_.CommandLine -like '*dsh-desktop-host*' } | ForEach-Object { $_.ProcessId }";
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 10000 });
    const pids = new Set(out.split(/\s+/).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0));
    if (pids.size === 0) return [];
    const ports = [];
    const netstat = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 8000 });
    for (const line of netstat.split(/\r?\n/)) {
      const match = /^\s*TCP\s+(127\.0\.0\.1|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (match && pids.has(Number(match[3]))) ports.push(Number(match[2]));
    }
    return [...new Set(ports)].filter((port) => port !== LISTEN_PORT);
  } catch (error) {
    log('dsh process query failed', error.message);
    return [];
  }
}

function probePort(port) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const authority = `127.0.0.1:${port}`;
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: '/', timeout: 1200, headers: { host: authority, cookie: authCookie(authority), connection: 'close' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (/<title>DeepSeek Harness<\/title>/.test(body)) {
            settle(res.statusCode === 200);
            res.destroy();
          } else if (body.length > 8000) {
            settle(false);
            res.destroy();
          }
        });
        res.on('end', () => settle(res.statusCode === 200 && /<title>DeepSeek Harness<\/title>/.test(body)));
        res.on('error', () => settle(false));
        res.on('close', () => settle(false));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      settle(false);
    });
    req.on('error', () => settle(false));
    req.end();
  });
}

async function discoverUpstream() {
  if (FIXED_UPSTREAM_PORT) return upstream;
  if (discovering) return discovering;
  discovering = (async () => {
    // Fast path: only probe loopback ports owned by the DSH host process.
    let ports = dshCandidatePorts();
    if (ports.length === 0) ports = candidateLoopbackPorts();
    const probes = await Promise.all(ports.map(async (port) => ({ port, ok: await probePort(port) })));
    const hit = probes.find((entry) => entry.ok);
    if (hit) {
      if (!upstream.authority || upstream.port !== hit.port) log(`upstream DSH web server found on 127.0.0.1:${hit.port}`);
      upstream = { port: hit.port, authority: `127.0.0.1:${hit.port}` };
      return upstream;
    }
    log(`no DSH web server found among ${ports.length} loopback listeners; keeping ${upstream.authority || '(none)'}`);
    return upstream;
  })().finally(() => {
    discovering = null;
  });
  return discovering;
}

/* ---------- request handling ---------- */

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveLocalAsset(req, res, urlPath) {
  const rel = urlPath.slice('/__dsh_mobile/'.length);
  if (!rel || rel.includes('..') || rel.includes('/') || rel.includes('\\')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const file = path.join(here, rel);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(data);
  });
}

function isDocumentRequest(req, url) {
  if (req.method !== 'GET') return false;
  if (url.pathname === '/' || url.pathname.endsWith('/')) return true;
  return url.pathname.endsWith('.html');
}

/** Rewrite the SPA index document with mobile viewport + adaptation assets. */
function injectIndex(html) {
  let out = html;
  out = out.replace(
    /<meta name="viewport" content="[^"]*"\s*\/?>/u,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
  );
  const head = [
    '<meta name="theme-color" content="#151517" media="(prefers-color-scheme: dark)" />',
    '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    '<meta name="apple-mobile-web-app-title" content="DeepSeek Harness" />',
    '<meta name="application-name" content="DeepSeek Harness" />',
    '<meta name="format-detection" content="telephone=no" />',
    '<link rel="apple-touch-icon" sizes="180x180" href="/__dsh_mobile/apple-touch-icon-harness.png" />',
    '<link rel="stylesheet" href="/__dsh_mobile/mobile.css" />',
    '<script src="/__dsh_mobile/mobile.js" defer></script>',
  ].join('\n    ');
  out = out.replace('</head>', `  ${head}\n  </head>`);
  // Use a PNG-icon manifest so "Add to Home Screen" gets a proper icon.
  out = out.replace(/<link rel="manifest"[^>]*>/u, '<link rel="manifest" href="/__dsh_mobile/manifest.webmanifest?v=2" />');
  return out;
}

function upstreamHeaders(req, authority) {
  const headers = { ...req.headers };
  headers.host = authority;
  if (headers.origin !== undefined) {
    try {
      // Keep the scheme the browser used only as far as DSH can see it; DSH
      // compares Origin against Host, so mirror the rewritten upstream origin.
      headers.origin = `http://${authority}`;
    } catch {
      // ignore malformed Origin
    }
  }
  if (String(req.headers.upgrade || '').toLowerCase() === 'websocket') {
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
  }
  const cookie = authCookie(authority);
  headers.cookie = headers.cookie ? `${headers.cookie}; ${cookie}` : cookie;
  return headers;
}

function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url || '/', 'http://mobile.invalid');
  } catch {
    res.writeHead(400);
    res.end('bad request');
    return;
  }
  // Access log: document loads, errors and WebSocket-adjacent traffic are enough
  // to diagnose a phone that cannot reach the GUI.
  const startedAt = Date.now();
  const remote = req.socket?.remoteAddress || '?';
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 100);
  res.on('finish', () => {
    const document = url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
    if (document || res.statusCode >= 400) {
      log(`access ${req.method} ${url.pathname} -> ${res.statusCode} ${Date.now() - startedAt}ms from ${remote} ua="${userAgent}"`);
    }
  });
  // Log the start of document loads so a hanging request (never reaching
  // "finish") is still visible in the log.
  const isDocument = url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isDocument) log(`begin GET ${url.pathname}${url.search} from ${remote} ua="${userAgent}"`);
  res.on('close', () => {
    if (!res.writableEnded) log(`aborted GET ${url.pathname} from ${remote} after ${Date.now() - startedAt}ms`);
  });
  if (url.pathname === '/__dsh_mobile/ping') {
    // Tiny plain-text probe: lets a phone verify the Tailscale path and the
    // gateway without loading the whole DSH app.
    log(`ping from ${remote} ua="${userAgent}"`);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('ok\n');
    return;
  }
  if (url.pathname === '/__dsh_mobile/diag') {
    // Standalone page with zero DSH dependencies: if a phone can show this,
    // rendering/network are fine and the problem is inside the DSH app bundle.
    log(`diag from ${remote} ua="${userAgent}"`);
    const now = new Date().toISOString();
    const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DSH 网关自检</title><style>
html,body{margin:0;height:100%;background:#0f7a3f;color:#fff;font:20px/1.7 -apple-system,"PingFang SC",sans-serif}
main{padding:40px 24px}h1{font-size:30px;margin:0 0 20px}.ok{font-weight:700;font-size:24px}
a{color:#ffe07a}code{background:#0b5c2f;padding:2px 6px;border-radius:6px;font-size:15px}
</style></head><body><main>
<h1>网关自检</h1>
<p class="ok">页面渲染正常 ✅</p>
<p>时间：<code>${now}</code></p>
<p>如果你能看到这一页，说明手机 → Tailscale → 网关 → 浏览器渲染整条链路没问题。</p>
<p>下一步可试：<a href="/?plain=1">/?plain=1</a>（不注入移动端脚本的原版 DSH）</p>
<p><a href="/">返回 DSH</a></p>
</main></body></html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(Buffer.byteLength(body)) });
    res.end(body);
    return;
  }
  if (url.pathname === '/__dsh_mobile/reset') {
    // One-tap recovery: clear this origin's local storage / IndexedDB / caches
    // (a stale client state can leave the DSH SPA on a blank screen), then go
    // back to the app. Gateway auth does not depend on browser storage.
    log(`reset from ${remote}`);
    const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>重置 DSH 本地缓存</title><style>
html,body{margin:0;height:100%;background:#111317;color:#f2f4f7;font:18px/1.7 -apple-system,"PingFang SC",sans-serif}
main{padding:48px 24px}p{margin:0 0 14px}#s{color:#8ee6a8;font-weight:600}
</style></head><body><main>
<h1>正在重置 DSH 本地缓存…</h1>
<p id="s">清理中，请稍候…</p>
<p>会清除本网站的 localStorage / sessionStorage / IndexedDB / Cache Storage，然后自动打开 DSH。</p>
</main><script>
(async () => {
  const step = document.getElementById('s');
  try { localStorage.clear(); } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
  try {
    if (window.indexedDB && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db && db.name) indexedDB.deleteDatabase(db.name);
    }
  } catch (e) {}
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {}
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {}
  step.textContent = '已清理完成，正在重新加载 DSH…';
  setTimeout(() => location.replace('/'), 900);
})();
</script></body></html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(Buffer.byteLength(body)) });
    res.end(body);
    return;
  }
  if (url.pathname === '/__dsh_mobile/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ upstream, gatewayPort: LISTEN_PORT, host: process.env.DSH_MOBILE_HOST || tailscaleIPv4() }));
    return;
  }
  if (url.pathname === '/__dsh_mobile/metrics') {
    // Diagnostics beacon from the mobile client (layout/keyboard troubleshooting).
    log(`client-metrics ${remote} ${url.search}`);
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  if (url.pathname.startsWith('/__dsh_mobile/')) {
    serveLocalAsset(req, res, url.pathname);
    return;
  }

  const sendToUpstream = (attempt) => {
    if (!upstream.port) {
      discoverUpstream().then(() => {
        if (!upstream.port) {
          res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(UNAVAILABLE_PAGE);
          return;
        }
        sendToUpstream(attempt);
      });
      return;
    }
    const headers = upstreamHeaders(req, upstream.authority);
    if (isDocumentRequest(req, url)) delete headers['accept-encoding'];

    const proxied = http.request(
      { host: '127.0.0.1', port: upstream.port, method: req.method, path: req.url, headers },
      (upRes) => {
        const contentType = String(upRes.headers['content-type'] || '');
        if (upRes.statusCode === 401 && attempt === 0) {
          // Session cookie / port may be stale: rediscover and retry once (GETs only).
          upRes.resume();
          discoverUpstream().then(() => {
            if (req.method === 'GET' || req.method === 'HEAD') sendToUpstream(1);
            else {
              res.writeHead(401);
              res.end();
            }
          });
          return;
        }
        if (isDocumentRequest(req, url) && contentType.startsWith('text/html')) {
          const chunks = [];
          upRes.on('data', (chunk) => chunks.push(chunk));
          upRes.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const body = url.searchParams?.has('plain') ? raw : injectIndex(raw);
            const buf = Buffer.from(body, 'utf8');
            const outHeaders = { ...upRes.headers };
            delete outHeaders['content-encoding'];
            delete outHeaders['transfer-encoding'];
            outHeaders['cache-control'] = 'no-store';
            outHeaders['content-length'] = String(buf.byteLength);
            res.writeHead(upRes.statusCode || 200, outHeaders);
            res.end(buf);
          });
          return;
        }

        // Compress cacheable scripts/styles so the first load over a relay is
        // several times faster; the gzipped copy is reused for later requests.
        if (
          req.method === 'GET' &&
          acceptsGzip(req) &&
          !upRes.headers['content-encoding'] &&
          upRes.statusCode === 200 &&
          isCompressibleAsset(url.pathname)
        ) {
          const cacheKey = req.url;
          const cached = gzipCache.get(cacheKey);
          if (cached) {
            const headers = {
              ...upRes.headers,
              'content-encoding': 'gzip',
              'content-length': String(cached.length),
              vary: 'Accept-Encoding',
            };
            delete headers['transfer-encoding'];
            res.writeHead(200, headers);
            res.end(cached);
            upRes.resume();
            return;
          }
          // Stream gzip so Safari receives bytes immediately; buffering a 9 MB
          // bundle before compressing made iOS abort the request and reload.
          const headers = {
            ...upRes.headers,
            'content-encoding': 'gzip',
            vary: 'Accept-Encoding',
          };
          delete headers['content-length'];
          delete headers['transfer-encoding'];
          res.writeHead(200, headers);
          const gzipStream = zlib.createGzip({ level: 5 });
          const collected = [];
          let collectedBytes = 0;
          gzipStream.on('data', (chunk) => {
            res.write(chunk);
            if (collectedBytes < 32 * 1024 * 1024) {
              collected.push(chunk);
              collectedBytes += chunk.length;
            }
          });
          gzipStream.on('end', () => {
            res.end();
            if (collectedBytes < 32 * 1024 * 1024) cacheGzip(cacheKey, Buffer.concat(collected));
          });
          gzipStream.on('error', (error) => {
            log('gzip stream failed', error.message);
            res.destroy();
          });
          upRes.on('error', () => gzipStream.destroy());
          upRes.pipe(gzipStream);
          return;
        }
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    proxied.on('error', (error) => {
      log('upstream error', error.message);
      if (attempt === 0) {
        discoverUpstream().then(() => sendToUpstream(1));
        return;
      }
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
      res.end(UNAVAILABLE_PAGE);
    });
    req.pipe(proxied);
  };

  sendToUpstream(0);
}

const UNAVAILABLE_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1" /><meta http-equiv="refresh" content="5" />
<title>DSH 未运行</title><style>
html,body{height:100%;margin:0;background:#151517;color:#f3f4f6;font:16px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;display:flex;align-items:center;justify-content:center}
.card{max-width:420px;padding:28px;border:1px solid #2f3136;border-radius:18px;background:#1b1c1f}
h1{font-size:20px;margin:0 0 12px}p{color:#b9bec6;margin:0 0 8px}code{background:#26272b;padding:1px 5px;border-radius:6px}
</style></head><body><div class="card">
<h1>DSH 桌面端还没有运行</h1>
<p>手机网关已就绪，但本机没有检测到 DeepSeek Harness 的 Web 服务。</p>
<p>请在这台电脑上启动 <strong>DeepSeek Harness</strong>，本页面会在 5 秒后自动重试。</p>
<p>如果桌面端已启动，请稍等几秒；持续失败可查看 <code>gateway.log</code>。</p>
</div></body></html>`;

const server = http.createServer(handleRequest);

// WebSocket: raw TCP passthrough with rewritten handshake headers.
server.on('upgrade', (req, socket, head) => {
  log(`ws upgrade ${req.url} from ${req.socket?.remoteAddress || '?'} ua="${String(req.headers['user-agent'] || '').slice(0, 80)}"`);
  const connect = () => {
    if (!upstream.port) {
      discoverUpstream().then(() => (upstream.port ? connect() : socket.destroy()));
      return;
    }
    const headers = upstreamHeaders(req, upstream.authority);
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const entry of value) lines.push(`${name}: ${entry}`);
      else lines.push(`${name}: ${value}`);
    }
    lines.push('', '');
    const upstreamSocket = net.connect(upstream.port, '127.0.0.1', () => {
      upstreamSocket.write(lines.join('\r\n'));
      if (head && head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });
    // Keep the long-lived WebSocket responsive and let the OS detect dead peers
    // on flaky relay links instead of leaving the phone on a half-open socket.
    socket.setNoDelay(true);
    upstreamSocket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);
    upstreamSocket.setKeepAlive(true, 30000);
    upstreamSocket.on('error', (error) => {
      log('ws upstream error', error.message);
      socket.destroy();
    });
    socket.on('error', () => upstreamSocket.destroy());
    socket.on('close', () => upstreamSocket.destroy());
    upstreamSocket.on('close', () => socket.destroy());
  };
  connect();
});

/* ---------- start ---------- */

async function main() {
  const host = tailscaleIPv4();
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      log(`port ${LISTEN_PORT} already in use; another gateway instance is running`);
      process.exit(0);
    }
    log('gateway error', error.message);
  });
  server.listen(LISTEN_PORT, host, () => {
    log(`dsh mobile gateway listening on http://${host}:${LISTEN_PORT}/`);
  });
  if (LOOPBACK_LISTEN) {
    const loopback = http.createServer(handleRequest);
    loopback.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head));
    loopback.on('error', (error) => log('loopback listener error', error.message));
    loopback.listen(LISTEN_PORT, '127.0.0.1', () => {
      log(`also listening on http://127.0.0.1:${LISTEN_PORT}/ (for tailscale serve HTTPS)`);
    });
  }
  // MagicDNS returns AAAA records too; listen on the Tailscale IPv6 address so
  // iOS Safari never stalls on an IPv6-first connection attempt.
  const host6 = tailscaleIPv6();
  if (host6) {
    const server6 = http.createServer(handleRequest);
    server6.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head));
    server6.on('error', (error) => log('ipv6 listener error', error.message));
    server6.listen(LISTEN_PORT, host6, () => {
      log(`also listening on http://[${host6}]:${LISTEN_PORT}/`);
    });
  }
  // Discovery happens in the background; early requests wait for it.
  discoverUpstream().then((found) => {
    log(`upstream ${found.authority || '(not found yet)'}`);
  });
  // Keep re-discovering while DSH is not running, and after restarts.
  setInterval(() => {
    if (!upstream.port) discoverUpstream();
  }, 15000).unref();
}

main().catch((error) => {
  const detail = error && (error.stack || error.message) ? String(error.stack || error.message) : String(error);
  log('fatal', detail);
  process.exitCode = 1;
});
