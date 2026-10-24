'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseStatement, parseAmount, parseDate } = require('./parse');
const { detectLeaks, CADENCES, toDay, toIso } = require('./detect');
const { demoStatement } = require('./demo');
const { STATUSES } = require('./store');
const { pages, letterText } = require('./views');

const CURRENCIES = ['R', '$', '€', '£'];
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";
const SECURITY = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin' };
const STATIC = { '/static/siphon.css': ['siphon.css', 'text/css; charset=utf-8'], '/static/siphon.js': ['siphon.js', 'text/javascript; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const VID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const BACK_RE = /^\/vault(\?status=(watching|keep|cut|ignore))?$/;
const MAX_FORM = 1_600_000;

class Limiter {
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; this.hits = new Map(); }
  allow(key, now) {
    const list = (this.hits.get(key) || []).filter(t => t > now - this.windowMs);
    if (list.length >= this.limit) { this.hits.set(key, list); return false; }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 20000) for (const k of [...this.hits.keys()].slice(0, 5000)) this.hits.delete(k);
    return true;
  }
}

function createApp({ store, secret, secure = false, publicDir, siteUrl = 'http://localhost:3000', now = () => Date.now() }) {
  const limits = { all: new Limiter(300, 60000), post: new Limiter(40, 60000), scan: new Limiter(15, 60000) };
  const tokenFor = vid => crypto.createHmac('sha256', secret).update(vid).digest('hex').slice(0, 40);
  const sameToken = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const cookie = (vid, maxAge) => `vid=${vid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const todayIso = () => new Date(now()).toISOString().slice(0, 10);

  function send(status, body, extra = {}) {
    const headers = { ...SECURITY, 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', ...extra };
    return { status, headers, body: Buffer.isBuffer(body) ? body : Buffer.from(body) };
  }

  function redirect(location, extra = {}) { return send(303, '', { Location: location, ...extra }); }

  function handle(req) {
    const t = now();
    const url = new URL(req.url, 'http://x');
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const plain = (status, text) => send(status, text, { 'Content-Type': 'text/plain; charset=utf-8' });
    if (!limits.all.allow(req.ip, t)) return plain(429, 'Slow down a little.');

    if (STATIC[pathname] && method === 'GET') {
      const [file, type] = STATIC[pathname];
      return { status: 200, headers: { ...SECURITY, 'Content-Type': type, 'Cache-Control': 'public, max-age=300' }, body: fs.readFileSync(path.join(publicDir, file)) };
    }
    if (pathname === '/healthz') return plain(200, 'ok');
    if (pathname === '/robots.txt') return plain(200, `User-agent: *\nAllow: /\nDisallow: /vault\nDisallow: /scan\nSitemap: ${siteUrl}/sitemap.xml\n`);
    if (pathname === '/sitemap.xml') {
      const urls = ['/', '/scan', '/how', '/cancel', '/privacy'].map(p => `<url><loc>${siteUrl}${p}</loc></url>`).join('');
      return send(200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { 'Content-Type': 'application/xml; charset=utf-8' });
    }
    if (pathname === '/sample.csv' && method === 'GET') return send(200, demoStatement(todayIso()), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sample-statement.csv"' });

    let vid = null;
    const m = /(?:^|;\s*)vid=([^;]+)/.exec(req.headers.cookie || '');
    if (m && VID_RE.test(m[1])) vid = m[1];
    const fresh = !vid;
    if (fresh) vid = crypto.randomBytes(24).toString('base64url');
    const visitor = store.visitor(vid, Math.floor(t / 1000));
    const ctx = { path: pathname, csrf: tokenFor(vid), cur: visitor.currency, count: store.activeCount(vid), today: todayIso() };
    const setCookie = fresh ? { 'Set-Cookie': cookie(vid, 15552000) } : {};
    const page = (status, html) => send(status, html, setCookie);
    const to = (location, extra = {}) => redirect(location, { ...setCookie, ...extra });

    let form = null;
    if (method === 'POST') {
      if (!limits.post.allow(req.ip, t)) return page(429, pages.errorPage(ctx, 'Too many requests. Wait a minute and try again.', 'Slow down'));
      if (req.body.length > MAX_FORM) return page(413, pages.errorPage(ctx, 'That is too big. Try a shorter statement, around six months.', 'Too big'));
      const origin = req.headers.origin;
      if (origin && origin !== 'null') { try { if (new URL(origin).host !== req.headers.host) return page(403, pages.errorPage(ctx, 'That request came from somewhere else, so it was blocked.', 'Blocked')); } catch { return page(403, pages.errorPage(ctx, 'That request was blocked.', 'Blocked')); } }
      form = new URLSearchParams(req.body.toString('utf8'));
      if (fresh || !sameToken(form.get('csrf') || '', ctx.csrf)) return page(403, pages.errorPage(ctx, 'Your page expired. Go back, reload it and try again.', 'Session expired'));
    }

    if (pathname === '/' && method === 'GET') return page(200, pages.home(ctx));
    if (pathname === '/how' && method === 'GET') return page(200, pages.howPage(ctx));
    if (pathname === '/privacy' && method === 'GET') return page(200, pages.privacyPage(ctx));
    if (pathname === '/scan' && method === 'GET') return page(200, pages.scanForm(ctx));

    if (pathname === '/scan' && method === 'POST') {
      if (!limits.scan.allow(req.ip, t)) return page(429, pages.errorPage(ctx, 'Too many scans. Wait a minute and try again.', 'Slow down'));
      const cur = form.get('currency');
      if (CURRENCIES.includes(cur)) { store.setCurrency(vid, cur); ctx.cur = cur; }
      const text = form.get('demo') === '1' ? demoStatement(ctx.today) : (form.get('statement') || '');
      if (!text.trim()) return page(400, pages.scanForm(ctx, { error: 'Paste your statement or choose a file first.' }));
      const parsed = parseStatement(text);
      if (!parsed.rows.length) return page(422, pages.scanForm(ctx, { error: 'We could not read any transactions. Check that each line has a date, a description and an amount.', text: text.slice(0, 20000) }));
      const result = detectLeaks(parsed.rows, { today: ctx.today });
      store.saveScan(vid, result, Math.floor(t / 1000));
      const saved = new Map(store.leaks(vid).map(l => [l.id, l]));
      result.leaks = result.leaks.map(l => ({ ...l, status: saved.has(l.id) ? saved.get(l.id).status : 'watching' }));
      ctx.count = store.activeCount(vid);
      return page(200, pages.scanResult(ctx, { parsed, result, summary: result.summary, alerts: result.alerts }));
    }

    if (pathname === '/vault' && method === 'GET') {
      const status = url.searchParams.get('status');
      const filter = STATUSES.includes(status) ? status : 'all';
      return page(200, pages.vaultPage(ctx, { leaks: store.leaks(vid), onces: store.onces(vid), filter }));
    }

    if (pathname === '/vault/status' && method === 'POST') {
      const id = form.get('id') || '', status = form.get('status') || '', back = BACK_RE.test(form.get('back') || '') ? form.get('back') : '/vault';
      if (!/^[a-z0-9-]{1,80}$/.test(id) || !store.setStatus(vid, id, status, Math.floor(t / 1000))) return page(400, pages.errorPage(ctx, 'That change could not be saved.', 'Could not save'));
      return to(back + '#leak-' + id);
    }

    if (pathname === '/vault/add' && method === 'POST') {
      const label = (form.get('label') || '').trim().slice(0, 40);
      const amount = parseAmount(form.get('amount') || '');
      const cad = CADENCES.find(c => c.key === form.get('cadence'));
      const next = parseDate(form.get('next') || '');
      const fail = error => page(400, pages.vaultPage(ctx, { leaks: store.leaks(vid), onces: store.onces(vid), filter: 'all', error }));
      if (!label) return fail('Give it a name.');
      if (!amount || Math.abs(amount.cents) < 100 || Math.abs(amount.cents) > 1_000_000_00) return fail('Enter an amount between 1.00 and 1 000 000.00.');
      if (!cad) return fail('Pick how often it is charged.');
      if (!next || toDay(next) < toDay(ctx.today) - 1 || toDay(next) > toDay(ctx.today) + 800) return fail('Pick a next charge date from today onwards.');
      const cents = Math.abs(amount.cents);
      store.addManual(vid, `manual-${crypto.randomBytes(5).toString('hex')}`, { label, cadence: cad.key, cadenceLabel: cad.label, amountCents: cents, monthlyCents: Math.round(cents * cad.perMonth), nextDate: next }, Math.floor(t / 1000));
      return to('/vault');
    }

    if (pathname === '/vault/clear' && method === 'POST') {
      if (form.get('confirm') !== 'yes') return page(400, pages.errorPage(ctx, 'Tick the box to confirm.', 'Not deleted'));
      store.clear(vid);
      return redirect('/', { 'Set-Cookie': cookie('', 0) });
    }

    if (pathname === '/radar' && method === 'GET') return page(200, pages.radarPage(ctx, store.leaks(vid)));

    if (pathname === '/cancel' && method === 'GET') {
      const q = k => (url.searchParams.get(k) || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 60);
      return page(200, pages.cancelPage(ctx, { merchant: q('merchant'), ref: q('ref'), name: q('name') }));
    }

    const known = ['/', '/how', '/privacy', '/scan', '/vault', '/radar', '/cancel', '/vault/status', '/vault/add', '/vault/clear'];
    if (known.includes(pathname)) return page(405, pages.errorPage(ctx, 'That page does not work that way.', 'Not allowed'));
    return page(404, pages.notFound(ctx));
  }

  return { handle, tokenFor };
}

module.exports = { createApp, MAX_FORM };
