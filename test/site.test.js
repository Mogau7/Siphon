'use strict';
const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const path = require('node:path');
const { Store } = require('../src/store');
const { createApp } = require('../src/app');
const { createHttpServer } = require('../src/http');

async function boot() {
  const store = new Store(':memory:');
  const app = createApp({ store, secret: 'test-secret', publicDir: path.join(__dirname, '..', 'public'), siteUrl: 'https://siphon.example' });
  const server = createHttpServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let jar = '';
    const call = async (method, p, { form, headers = {}, body } = {}) => {
      const opts = { method, redirect: 'manual', headers: { ...headers } };
      if (jar) opts.headers.cookie = jar;
      if (form) { opts.body = new URLSearchParams(form).toString(); opts.headers['content-type'] = 'application/x-www-form-urlencoded'; }
      if (body !== undefined) opts.body = body;
      const res = await fetch(base + p, opts);
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of set) { const pair = c.split(';')[0]; if (/Max-Age=0/.test(c)) jar = ''; else jar = pair; }
      const text = await res.text();
      return { status: res.status, headers: res.headers, text, set };
    };
    const csrf = async () => /name="csrf" value="([a-f0-9]+)"/.exec((await call('GET', '/scan')).text)[1];
    return { call, csrf, get jar() { return jar; } };
  };
  const close = () => new Promise(r => { server.close(() => r()); server.closeAllConnections(); });
  opened.push(close);
  return { base, store, client, close };
}

const opened = [];
after(async () => { for (const close of opened) await close(); });

const PAGES = ['/', '/scan', '/how', '/privacy', '/cancel', '/radar', '/vault'];

test('every page loads with strict security headers and no inline scripts or styles', async () => {
  const s = await boot();
  const c = s.client();
  for (const p of PAGES) {
    const r = await c.call('GET', p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.doesNotMatch(r.text, /<script(?![^>]*\bsrc=)[^>]*>/i, p);
    assert.doesNotMatch(r.text, /\sstyle=/i, p);
    assert.doesNotMatch(r.text, /\son[a-z]+\s*=/i, p);
    assert.match(r.text, /<main id="main"/);
    assert.match(r.text, /<title>[^<]+<\/title>/);
  }
  await s.close();
});

test('first visit sets a locked-down cookie, repeat visits do not', async () => {
  const s = await boot();
  const c = s.client();
  const first = await c.call('GET', '/');
  assert.match(first.set[0], /^vid=[A-Za-z0-9_-]{20,}/);
  assert.match(first.set[0], /HttpOnly/);
  assert.match(first.set[0], /SameSite=Lax/);
  assert.equal((await c.call('GET', '/how')).set.length, 0);
  await s.close();
});

test('unknown pages are a styled 404, wrong methods are 405, static files are served, traversal is blocked', async () => {
  const s = await boot();
  const c = s.client();
  const nf = await c.call('GET', '/nope');
  assert.equal(nf.status, 404);
  assert.match(nf.text, /Nothing here/);
  assert.equal((await c.call('POST', '/nope', { form: { a: 1 } })).status, 403);
  assert.equal((await c.call('POST', '/nope', { form: { csrf: await c.csrf() } })).status, 404);
  assert.equal((await c.call('PUT', '/scan')).status, 405);
  const css = await c.call('GET', '/static/siphon.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match((await c.call('GET', '/static/siphon.js')).headers.get('content-type'), /javascript/);
  assert.match((await c.call('GET', '/favicon.svg')).headers.get('content-type'), /svg/);
  for (const bad of ['/static/../server.js', '/static/%2e%2e/server.js', '/static/siphon.css/../../server.js', '/static/', '/static/siphon.css%00', '/src/app.js', '/data/siphon.db', '/package.json']) {
    const r = await c.call('GET', bad);
    assert.ok([404, 400].includes(r.status), bad + ' ' + r.status);
    assert.doesNotMatch(r.text, /createApp|require\(/);
  }
  const head = await fetch(s.base + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await head.text()).length, 0);
  await s.close();
});

test('posts need the page token, a matching origin and a cookie', async () => {
  const s = await boot();
  const c = s.client();
  assert.equal((await c.call('POST', '/scan', { form: { demo: '1' } })).status, 403);
  await c.call('GET', '/');
  assert.equal((await c.call('POST', '/scan', { form: { demo: '1', csrf: 'wrong' } })).status, 403);
  const token = await c.csrf();
  assert.equal((await c.call('POST', '/scan', { form: { demo: '1', csrf: token }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await c.call('POST', '/scan', { form: { demo: '1', csrf: token }, headers: { origin: 'null' } })).status, 200);
  assert.equal((await c.call('POST', '/scan', { form: { demo: '1', csrf: token }, headers: { origin: s.base } })).status, 200);
  assert.equal((await c.call('POST', '/scan', { form: { demo: '1', csrf: 'wrong' }, headers: { origin: 'null' } })).status, 403);
  const other = s.client();
  await other.call('GET', '/');
  assert.equal((await other.call('POST', '/scan', { form: { demo: '1', csrf: token } })).status, 403);
  assert.equal((await c.call('POST', '/scan', { form: { demo: '1', csrf: token } })).status, 200);
  await s.close();
});

test('the whole journey: scan, decide, see the radar, add by hand, delete everything', async () => {
  const s = await boot();
  const c = s.client();
  let token = await c.csrf();
  const scan = await c.call('POST', '/scan', { form: { demo: '1', csrf: token, currency: 'R' } });
  assert.equal(scan.status, 200);
  for (const want of ['DStv', 'Netflix', 'Virgin Active', 'Spotify', 'Outsurance', 'a month', 'Price went up 18%', 'Charged twice', 'Namecheap']) assert.ok(scan.text.includes(want), want);
  assert.doesNotMatch(scan.text, /Woolworths|Pick N Pay|Checkers/);
  const vault = await c.call('GET', '/vault');
  assert.match(vault.text, /Draining you now/);
  const id = /name="id" value="([a-z0-9-]+)"/.exec(vault.text)[1];
  const moved = await c.call('POST', '/vault/status', { form: { csrf: token, id, status: 'cut', back: '/vault' } });
  assert.equal(moved.status, 303);
  assert.equal(moved.headers.get('location'), `/vault#leak-${id}`);
  const after = await c.call('GET', '/vault');
  assert.match(after.text, /pill-cut/);
  assert.match(after.text, /saves/);
  assert.match((await c.call('GET', '/vault?status=cut')).text, /pill-cut/);
  assert.doesNotMatch((await c.call('GET', '/vault?status=keep')).text, /class="leak /);
  const radar = await c.call('GET', '/radar');
  assert.match(radar.text, /<svg class="radar big-radar"/);
  assert.match(radar.text, /Next 30 days/);
  assert.match(radar.text, /class="blip /);
  const next = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const add = await c.call('POST', '/vault/add', { form: { csrf: token, label: 'Magazine', amount: '120.00', cadence: 'monthly', next } });
  assert.equal(add.status, 303);
  assert.match((await c.call('GET', '/vault')).text, /Magazine/);
  for (const bad of [{ label: '', amount: '1', cadence: 'monthly', next }, { label: 'X', amount: 'abc', cadence: 'monthly', next }, { label: 'X', amount: '5', cadence: 'daily', next }, { label: 'X', amount: '5', cadence: 'monthly', next: '2001-01-01' }, { label: 'X', amount: '99999999999', cadence: 'monthly', next }]) {
    assert.equal((await c.call('POST', '/vault/add', { form: { csrf: token, ...bad } })).status, 400);
  }
  assert.equal((await c.call('POST', '/vault/clear', { form: { csrf: token } })).status, 400);
  const clear = await c.call('POST', '/vault/clear', { form: { csrf: token, confirm: 'yes' } });
  assert.equal(clear.status, 303);
  assert.match(clear.set[0], /Max-Age=0/);
  assert.match((await c.call('GET', '/vault')).text, /Your vault is empty/);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM leaks').get().n, 0);
  await s.close();
});

test('each visitor only ever sees their own vault', async () => {
  const s = await boot();
  const a = s.client(), b = s.client();
  const ta = await a.csrf();
  await a.call('POST', '/scan', { form: { demo: '1', csrf: ta } });
  const idA = /name="id" value="([a-z0-9-]+)"/.exec((await a.call('GET', '/vault')).text)[1];
  assert.match((await b.call('GET', '/vault')).text, /Your vault is empty/);
  const tb = await b.csrf();
  assert.equal((await b.call('POST', '/vault/status', { form: { csrf: tb, id: idA, status: 'ignore', back: '/vault' } })).status, 400);
  assert.doesNotMatch((await a.call('GET', '/vault')).text, /pill-pill-ignore|Not a leak<\/span>/);
  await s.close();
});

test('hostile input is escaped and bad redirects are refused', async () => {
  const s = await boot();
  const c = s.client();
  const token = await c.csrf();
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const lines = ['2026-06-12', '2026-07-12', '2026-08-12', '2026-09-12', '2026-10-12'].map(d => `${d},"${evil} SHOP",-250.00,1.00`).join('\n');
  const r = await c.call('POST', '/scan', { form: { csrf: token, statement: 'Date,Description,Amount,Balance\n' + lines } });
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /<script>alert|<img src=x/);
  const manual = await c.call('POST', '/vault/add', { form: { csrf: token, label: '<img src=x onerror=1>', amount: '50', cadence: 'monthly', next: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10) } });
  assert.equal(manual.status, 303);
  const shown = await c.call('GET', '/vault');
  assert.doesNotMatch(shown.text, /<img src=x/);
  assert.match(shown.text, /&lt;img src=x/);
  const cancel = await c.call('GET', '/cancel?merchant=' + encodeURIComponent('<img src=x onerror=1>') + '&name=%22%3E%3Cscript%3E');
  assert.doesNotMatch(cancel.text, /<img src=x|<script>/);
  const id = /name="id" value="([a-z0-9-]+)"/.exec((await c.call('GET', '/vault')).text)[1];
  const open = await c.call('POST', '/vault/status', { form: { csrf: token, id, status: 'keep', back: 'https://evil.example/' } });
  assert.equal(open.headers.get('location').startsWith('/vault'), true);
  const open2 = await c.call('POST', '/vault/status', { form: { csrf: token, id, status: 'keep', back: '//evil.example' } });
  assert.equal(open2.headers.get('location').startsWith('/vault'), true);
  assert.equal((await c.call('POST', '/vault/status', { form: { csrf: token, id, status: 'hacked', back: '/vault' } })).status, 400);
  assert.equal((await c.call('POST', '/vault/status', { form: { csrf: token, id: "x'; DROP TABLE leaks;--", status: 'keep', back: '/vault' } })).status, 400);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM leaks').get().n >= 1, true);
  await s.close();
});

test('empty, unreadable and oversized statements get friendly answers', async () => {
  const s = await boot();
  const c = s.client();
  const token = await c.csrf();
  const empty = await c.call('POST', '/scan', { form: { csrf: token, statement: '   ' } });
  assert.equal(empty.status, 400);
  assert.match(empty.text, /Paste your statement/);
  const junk = await c.call('POST', '/scan', { form: { csrf: token, statement: 'hello there\nthis is not a statement' } });
  assert.equal(junk.status, 422);
  assert.match(junk.text, /could not read any transactions/);
  const huge = await fetch(s.base + '/scan', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: c.jar }, body: 'statement=' + 'a'.repeat(2_000_000) }).then(r => r.status).catch(() => 413);
  assert.equal(huge, 413);
  const onlyOne = await c.call('POST', '/scan', { form: { csrf: token, statement: '2026-10-03,NETFLIX.COM,-199.00' } });
  assert.equal(onlyOne.status, 200);
  assert.match(onlyOne.text, /Worth a look|No clear leaks/);
  await s.close();
});

test('scans are rate limited', async () => {
  const s = await boot();
  const c = s.client();
  const token = await c.csrf();
  const codes = [];
  for (let i = 0; i < 17; i++) codes.push((await c.call('POST', '/scan', { form: { csrf: token, demo: '1' } })).status);
  assert.equal(codes[0], 200);
  assert.ok(codes.includes(429));
  await s.close();
});

test('utility endpoints', async () => {
  const s = await boot();
  const c = s.client();
  assert.equal((await c.call('GET', '/healthz')).text, 'ok');
  const robots = await c.call('GET', '/robots.txt');
  assert.match(robots.text, /Disallow: \/vault/);
  assert.match(robots.text, /https:\/\/siphon\.example\/sitemap\.xml/);
  assert.match((await c.call('GET', '/sitemap.xml')).text, /<loc>https:\/\/siphon\.example\/how<\/loc>/);
  const csv = await c.call('GET', '/sample.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /^Date,Description,Amount,Balance/);
  assert.ok(csv.text.split('\n').length > 100);
  const letter = await c.call('GET', '/cancel?merchant=Virgin%20Active&ref=12345&name=Thandi');
  assert.match(letter.text, /Cancellation of my subscription \/ debit order - Virgin Active/);
  assert.match(letter.text, /12345/);
  await s.close();
});

test('old vaults are purged and the currency choice sticks', async () => {
  const s = await boot();
  const c = s.client();
  const token = await c.csrf();
  const r = await c.call('POST', '/scan', { form: { csrf: token, demo: '1', currency: '$' } });
  assert.match(r.text, /\$199\.00/);
  assert.match((await c.call('GET', '/vault')).text, /\$/);
  assert.equal(s.store.purge(Math.floor(Date.now() / 1000) + 10), 1);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM leaks').get().n, 0);
  await s.close();
});
