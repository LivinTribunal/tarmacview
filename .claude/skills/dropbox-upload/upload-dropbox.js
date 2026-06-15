#!/usr/bin/env node
/**
 * Upload a single file (e.g. a browser-verify proof video) to Dropbox and print
 * the public share link to stdout. Used by the verify stage to attach a
 * viewable walkthrough of the asserted UI to a pull request, instead of citing
 * a local path that only exists on the self-hosted runner.
 *
 * Self-contained: uses only Node built-ins + global fetch (Node >= 18). No deps.
 *
 * Auth (two flavours - pick one, see .env.example for the full setup):
 *   - SHORT-LIVED: paste DROPBOX_ACCESS_TOKEN from the App Console (~4 h).
 *   - LONG-LIVED (recommended, what CI uses): set DROPBOX_APP_KEY +
 *     DROPBOX_APP_SECRET, run `./upload-dropbox.js --auth` once; a refresh
 *     token is written to .env and every later run mints a fresh access token
 *     silently. In CI the three DROPBOX_* values come from GitHub secrets via
 *     env (process.env wins over .env), so no .env file is needed there.
 *
 * Usage:
 *   ./upload-dropbox.js --auth                 # one-time OAuth, saves refresh token
 *   ./upload-dropbox.js <file>                 # upload, print share URL to stdout
 *   ./upload-dropbox.js <file> --name foo.mp4  # override the remote filename
 *   ./upload-dropbox.js <file> --dry-run       # no API calls; print what would happen
 *
 * Output: the public share URL is the ONLY thing printed to stdout (so callers
 * can capture it with $(...)). All human-facing chatter goes to stderr.
 */

const fs     = require('fs');
const http   = require('http');
const path   = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL }   = require('url');

const ENV_FILE     = path.join(__dirname, '.env');
const OAUTH_PORT   = 49234;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}`;
const log = (...a) => console.error(...a);   // human chatter -> stderr

// ---- .env loader / updater ----------------------------------------------------------
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const raw of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && !(k in process.env)) process.env[k] = v;
  }
}
function updateEnvFile(updates) {
  let text = '';
  try { text = fs.readFileSync(ENV_FILE, 'utf8'); } catch {}
  const lines = text.split('\n');
  const keys = new Set(Object.keys(updates));
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(\w+)=/);
    if (m && keys.has(m[1])) { out.push(`${m[1]}=${updates[m[1]]}`); keys.delete(m[1]); }
    else out.push(line);
  }
  for (const k of keys) out.push(`${k}=${updates[k]}`);
  fs.writeFileSync(ENV_FILE, out.join('\n'));
}

// ---- Dropbox OAuth flow -------------------------------------------------------------
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
          : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}

async function runInteractiveAuth(appKey, appSecret) {
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
    client_id: appKey,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state,
    token_access_type: 'offline',   // gives us a refresh_token
  });

  const server = http.createServer();
  const html = (msg) => `<html><body style="font:16px system-ui;padding:40px;line-height:1.4">${msg}</body></html>`;

  await new Promise((resolve, reject) => {
    server.once('error', err => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`port ${OAUTH_PORT} is already in use. Kill the process listening there (\`lsof -i :${OAUTH_PORT}\`) and re-run --auth.`));
      } else reject(err);
    });
    server.listen(OAUTH_PORT, '127.0.0.1', () => resolve());
  });
  log(`OK - OAuth callback server listening on ${REDIRECT_URI}`);

  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('OAuth flow timed out after 10 minutes - no callback received.'));
    }, 10 * 60 * 1000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      const code = u.searchParams.get('code');
      const gotState = u.searchParams.get('state');
      const err = u.searchParams.get('error');
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'text/html' }); res.end(html(body)); };
      if (err)               { send(400, `<h2>Authorization failed</h2><p>${err}</p>`); clearTimeout(timer); server.close(); return reject(new Error('oauth error: ' + err)); }
      if (gotState !== state){ send(400, '<h2>State mismatch</h2>'); clearTimeout(timer); server.close(); return reject(new Error('state mismatch')); }
      if (!code)             { send(400, '<h2>No authorization code in callback.</h2>'); clearTimeout(timer); server.close(); return reject(new Error('no code')); }
      send(200, '<h2>Authorized.</h2><p>You can close this tab and return to the terminal.</p>');
      clearTimeout(timer);
      res.on('close', () => server.close());
      resolve(code);
    });
  });

  log(`Opening browser for Dropbox authorization...`);
  log(`If it doesn't open, paste this URL into a browser:\n  ${authUrl}\n`);
  openBrowser(authUrl);

  const code = await codePromise;
  log(`Exchanging authorization code for tokens...`);
  const tokRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, grant_type: 'authorization_code',
      client_id: appKey, client_secret: appSecret, redirect_uri: REDIRECT_URI,
    }),
  });
  const tok = await tokRes.json();
  if (!tokRes.ok || !tok.refresh_token) throw new Error(`token exchange ${tokRes.status}: ${JSON.stringify(tok)}`);
  return { refreshToken: tok.refresh_token, accessToken: tok.access_token };
}

async function refreshAccessToken(appKey, appSecret, refreshToken) {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: appKey, client_secret: appSecret,
    }),
  });
  const tok = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`token refresh ${res.status}: ${JSON.stringify(tok)}`);
  return tok.access_token;
}

// ---- Dropbox API --------------------------------------------------------------------
function asciiSafe(s) {
  // Dropbox-API-Arg header must be ASCII; escape any non-ASCII chars (>= U+0080).
  return s.replace(/[\u0080-\uffff]/g, c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
}

async function dropboxUploadFile(accessToken, filePath, dropboxPath) {
  const data = fs.readFileSync(filePath);
  const apiArg = JSON.stringify({ path: dropboxPath, mode: 'overwrite', autorename: false, mute: true, strict_conflict: false });
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': asciiSafe(apiArg),
    },
    body: data,
  });
  if (!res.ok) throw new Error(`Dropbox upload ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

async function dropboxCreateShareLink(accessToken, dropboxPath) {
  const createRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dropboxPath, settings: { requested_visibility: 'public', audience: 'public', access: 'viewer' } }),
  });
  if (createRes.ok) return (await createRes.json()).url;
  const errText = await createRes.text();
  if (createRes.status === 409 && errText.includes('shared_link_already_exists')) {
    const listRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dropboxPath, direct_only: true }),
    });
    if (listRes.ok) {
      const j = await listRes.json();
      if (j.links && j.links.length > 0) return j.links[0].url;
    }
  }
  throw new Error(`Dropbox share-link ${createRes.status}: ${errText.slice(0, 400)}`);
}

// ---- Driver -------------------------------------------------------------------------
async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  let dryRun = false, doAuth = false, nameOverride = null;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--auth') doAuth = true;
    else if (a === '--name') nameOverride = argv[++i];
    else if (a === '-h' || a === '--help') {
      log('Usage: upload-dropbox.js --auth');
      log('       upload-dropbox.js <file> [--name remote.mp4] [--dry-run]');
      process.exit(0);
    }
    else if (a.startsWith('-')) { log('Unknown option:', a); process.exit(2); }
    else files.push(a);
  }

  const appKey         = process.env.DROPBOX_APP_KEY;
  const appSecret      = process.env.DROPBOX_APP_SECRET;
  const refreshToken   = process.env.DROPBOX_REFRESH_TOKEN;
  const staticToken    = process.env.DROPBOX_ACCESS_TOKEN;
  const uploadPathRoot = (process.env.DROPBOX_UPLOAD_PATH || '/verify-proofs').replace(/\/+$/, '');

  if (doAuth) {
    if (!appKey || !appSecret) { log('PRE-FLIGHT FAILED: set DROPBOX_APP_KEY and DROPBOX_APP_SECRET in .env first.'); process.exit(2); }
    try {
      const { refreshToken, accessToken } = await runInteractiveAuth(appKey, appSecret);
      updateEnvFile({ DROPBOX_REFRESH_TOKEN: refreshToken, DROPBOX_ACCESS_TOKEN: accessToken });
      log(`\nOK - saved DROPBOX_REFRESH_TOKEN (+ a fresh access token) to ${ENV_FILE}.`);
      process.exit(0);
    } catch (e) { log('Auth failed:', e.message); process.exit(2); }
  }

  if (files.length !== 1) { log('Provide exactly one <file> to upload (or --auth).'); process.exit(2); }
  const file = files[0];
  if (!fs.existsSync(file)) { log(`File not found: ${file}`); process.exit(1); }

  const ext = path.extname(file) || '.mp4';
  // Random 6-hex name avoids collisions and leaks no identifying info in the URL.
  const remoteName = nameOverride || `${crypto.randomBytes(3).toString('hex')}${ext}`;
  const dropboxPath = `${uploadPathRoot}/${remoteName}`.replace(/\/+/g, '/');
  const sizeMB = (fs.statSync(file).size / 1024 / 1024).toFixed(1);

  if (dryRun) { log(`[dry-run] would upload ${file} (${sizeMB}MB) -> ${dropboxPath}`); process.exit(0); }

  // Resolve auth: refresh token (preferred) -> static access token.
  let accessToken = null;
  if (refreshToken && appKey && appSecret) {
    try { accessToken = await refreshAccessToken(appKey, appSecret, refreshToken); }
    catch (e) { log('PRE-FLIGHT FAILED:', e.message); process.exit(2); }
  } else if (staticToken) {
    accessToken = staticToken;
  } else {
    log('PRE-FLIGHT FAILED: no Dropbox credentials in env or .env.');
    log('Set EITHER DROPBOX_ACCESS_TOKEN (short-lived) OR DROPBOX_APP_KEY + DROPBOX_APP_SECRET then run `--auth`.');
    process.exit(2);
  }

  log(`Uploading ${file} (${sizeMB}MB) -> ${dropboxPath} ...`);
  await dropboxUploadFile(accessToken, file, dropboxPath);
  const url = await dropboxCreateShareLink(accessToken, dropboxPath);
  log(`OK - uploaded. Public link:`);
  // The ONLY thing on stdout - so `URL=$(upload-dropbox.js file)` works.
  console.log(url);
  process.exit(0);
}

main().catch(e => { log('UNHANDLED:', e.message || e); process.exit(4); });
