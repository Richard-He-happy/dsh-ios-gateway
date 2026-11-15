// Mint a DSH web browser-session cookie from the local browser-session secret.
// The secret lives in $DSH_HOME/.credentials.yaml (client-connection/browser-session).
// Usage: node mint-cookie.cjs [authority] [days]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
const credentials = process.env.DSH_CREDENTIALS || path.join(home, '.credentials.yaml');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function readSecret() {
  const text = fs.readFileSync(credentials, 'utf8');
  // The record is a simple two-level YAML mapping; read its `secret:` scalar.
  const start = text.indexOf('client-connection/browser-session:');
  if (start === -1) throw new Error('browser-session credential record not found');
  const rest = text.slice(start);
  const m = /secret:\s*([A-Za-z0-9_-]{43})\b/u.exec(rest);
  if (!m) throw new Error('browser-session secret not found');
  return b64url; // placeholder to keep function shape; not used
}

function loadSecret() {
  const text = fs.readFileSync(credentials, 'utf8');
  const start = text.indexOf('client-connection/browser-session:');
  if (start === -1) throw new Error('browser-session credential record not found');
  const rest = text.slice(start);
  const m = /secret:\s*([A-Za-z0-9_-]{43})\b/u.exec(rest);
  if (!m) throw new Error('browser-session secret not found');
  return Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

function cookieName(authority) {
  const hash = crypto.createHash('sha256').update(authority).digest();
  return 'dsh-auth-' + b64url(hash);
}

function mintCookie(authority, secret, days = 7) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + days * 24 * 60 * 60 * 1000;
  const payload = { version: 1, authority, issuedAt, expiresAt };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `v1.${body}.${sig}`;
}

if (require.main === module) {
  const authority = process.argv[2] || '127.0.0.1:50107';
  const days = Number(process.argv[3] || 7);
  const secret = loadSecret();
  const value = mintCookie(authority, secret, days);
  process.stdout.write(`Cookie: ${cookieName(authority)}=${value}\n`);
}

module.exports = { loadSecret, mintCookie, cookieName, b64url };
