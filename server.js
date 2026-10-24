'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./src/store');
const { createApp } = require('./src/app');
const { createHttpServer } = require('./src/http');

const port = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

function loadSecret() {
  if (process.env.SIPHON_SECRET) return process.env.SIPHON_SECRET;
  const file = path.join(dataDir, 'secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const made = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, made, { mode: 0o600 });
  return made;
}

const store = new Store(path.join(dataDir, 'siphon.db'));
const app = createApp({ store, secret: loadSecret(), secure: process.env.SECURE_COOKIES === '1', publicDir: path.join(__dirname, 'public'), siteUrl: process.env.SITE_URL || `http://localhost:${port}` });
const server = createHttpServer(app, { trustProxy: process.env.TRUST_PROXY === '1' });

setInterval(() => {
  try { store.purge(Math.floor(Date.now() / 1000) - 180 * 86400); } catch (error) { console.error(error); }
}, 6 * 3600 * 1000).unref();

server.listen(port, () => console.log(`Siphon is listening on http://localhost:${port}`));
process.on('SIGTERM', () => server.close(() => { store.close(); process.exit(0); }));
