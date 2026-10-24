'use strict';

const { GUIDES } = require('./services');
const { upcoming, CADENCES } = require('./detect');

const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CURRENCIES = ['R', '$', '€', '£'];

function money(cents, cur = 'R', decimals = true) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100), frac = String(abs % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${neg ? '-' : ''}${cur}${grouped}${decimals ? '.' + frac : ''}`;
}

function when(iso, today) {
  if (!iso) return 'unknown';
  const [y, m, d] = iso.split('-').map(Number);
  const sameYear = today && Number(today.slice(0, 4)) === y;
  return `${d} ${MONTHS[m - 1]}${sameYear ? '' : ' ' + y}`;
}

const NAV = [['/scan', 'Scan'], ['/vault', 'Vault'], ['/radar', 'Radar'], ['/cancel', 'Cancel'], ['/how', 'How']];

function layout(ctx, { title, description, body, wide }) {
  const nav = NAV.map(([href, label]) => {
    const on = ctx.path === href || (href !== '/' && ctx.path.startsWith(href + '/'));
    const badge = href === '/vault' && ctx.count ? `<span class="badge" aria-label="${ctx.count} active">${ctx.count}</span>` : '';
    return `<a href="${href}"${on ? ' aria-current="page"' : ''}>${label}${badge}</a>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07080d">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || 'Siphon finds the charges that quietly drain your money.')}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description || 'Find every charge that keeps coming back.')}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/siphon.css">
<script src="/static/siphon.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="fog" aria-hidden="true"></div><div class="grain" aria-hidden="true"></div><div class="beam" aria-hidden="true"></div>
<header class="top"><a class="brand" href="/" aria-label="Siphon, home"><svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><circle cx="16" cy="16" r="12" class="b1"/><circle cx="16" cy="16" r="6" class="b2"/><path d="M16 16 L26 8" class="b3"/><circle cx="22" cy="21" r="2.4" class="b4"/></svg><span>siphon</span></a><nav aria-label="Main">${nav}</nav></header>
<main id="main" class="${wide ? 'wide' : ''}">${body}</main>
<footer class="foot"><div><strong>siphon</strong> finds the charges that keep coming back.</div><div><a href="/how">How it works</a> <a href="/privacy">Privacy</a> <a href="/sample.csv">Sample statement</a></div><p>Siphon reads patterns in the statement you give it. It cannot see your bank, and it is not financial or legal advice.</p></footer>
</body>
</html>`;
}

function csrfField(ctx) { return `<input type="hidden" name="csrf" value="${esc(ctx.csrf)}">`; }

function radarMini() {
  const blips = [[44, 150, 'a'], [210, 70, 'b'], [250, 190, 'c'], [120, 230, 'd'], [175, 120, 'e']];
  return `<svg class="radar hero-radar" viewBox="0 0 300 300" role="img" aria-label="A radar sweeping for hidden charges"><g class="rings"><circle cx="150" cy="150" r="140"/><circle cx="150" cy="150" r="100"/><circle cx="150" cy="150" r="60"/><circle cx="150" cy="150" r="22"/><path d="M150 10V290M10 150H290"/></g><g class="sweep"><path d="M150 150 L150 10 A140 140 0 0 1 249 51 Z" class="wedge"/><path d="M150 150 L150 10" class="needle"/></g>${blips.map(([x, y, k], i) => `<g class="blip d${i + 1}"><circle cx="${x}" cy="${y}" r="9" class="halo"/><circle cx="${x}" cy="${y}" r="4" class="dot"/></g>`).join('')}</svg>`;
}

function home(ctx) {
  const body = `
<section class="hero">
  <div class="hero-text">
    <p class="eyebrow">// something is leaking</p>
    <h1><span class="whisper">Something is quietly</span> <span class="whisper late">taking your money.</span></h1>
    <p class="lede">Drop in a bank statement. Siphon finds every charge that keeps coming back, shows what it costs you in a year, and helps you stop it.</p>
    <div class="cta">
      <a class="btn btn-scan" href="/scan"><span>Run the scan</span></a>
      <form method="post" action="/scan" class="inline">${csrfField(ctx)}<input type="hidden" name="demo" value="1"><button class="btn btn-ghost" type="submit">Try it with sample data</button></form>
    </div>
    <p class="fine">No account. No bank login. Your statement is read once and thrown away.</p>
  </div>
  <div class="hero-art">${radarMini()}</div>
</section>
<section class="band reveal">
  <h2>Three ways money slips out</h2>
  <div class="trio">
    <article class="ghost"><h3>You forgot it existed</h3><p>A gym you stopped visiting. An app you tried once. A debit order from three jobs ago.</p></article>
    <article class="ghost"><h3>The price crept up</h3><p>Streaming went from one price to another and nobody told you. It shows up as a quiet change on your statement.</p></article>
    <article class="ghost"><h3>You meant to cancel</h3><p>You said you would sort it out next month. That was a year ago.</p></article>
  </div>
</section>
<section class="band reveal">
  <h2>How it works</h2>
  <ol class="steps">
    <li><span>1</span><div><h3>Drop</h3><p>Download a CSV from your banking app, or paste the text of your statement.</p></div></li>
    <li><span>2</span><div><h3>Scan</h3><p>Siphon looks for the same payee, on a steady rhythm, for a steady amount.</p></div></li>
    <li><span>3</span><div><h3>Cut</h3><p>Mark what to keep and what to stop. See the next 30 days on the radar, and get the cancel steps and a letter.</p></div></li>
  </ol>
  <p><a class="btn btn-scan" href="/scan"><span>Run the scan</span></a></p>
</section>`;
  return layout(ctx, { title: 'Siphon: find what is quietly draining your money', description: 'Drop in a bank statement. Siphon finds every subscription and debit order that keeps coming back and shows what it costs a year.', body });
}

function scanForm(ctx, { error, text = '' } = {}) {
  const body = `
<section class="page-head"><p class="eyebrow">// step one</p><h1>Drop in a statement</h1><p class="lede">Use a CSV from your banking app, or paste the lines of your statement. Three to six months works best.</p></section>
<form method="post" action="/scan" class="scanform ghost" data-scan>
  ${csrfField(ctx)}
  ${error ? `<p class="alert" role="alert">${esc(error)}</p>` : ''}
  <label class="drop" for="file"><input id="file" type="file" accept=".csv,.txt,text/csv,text/plain"><strong>Choose a file</strong><span>or drag it here</span><em data-file-name></em></label>
  <label for="statement">Or paste it here</label>
  <textarea id="statement" name="statement" rows="10" maxlength="1500000" placeholder="Date,Description,Amount&#10;2026-09-03,NETFLIX.COM,-199.00&#10;2026-10-03,NETFLIX.COM,-199.00" spellcheck="false">${esc(text)}</textarea>
  <div class="row"><label for="currency" class="inline-label">Currency</label><select id="currency" name="currency">${CURRENCIES.map(c => `<option value="${esc(c)}"${c === ctx.cur ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
  <div class="row"><button class="btn btn-scan" type="submit" data-busy="Scanning..."><span>Run the scan</span></button><button class="btn btn-ghost" type="submit" name="demo" value="1" formnovalidate>Use sample data</button></div>
  <p class="fine">Read once on our server, in memory, then discarded. Only the charges Siphon finds are kept for you, and you can delete them any time. <a href="/privacy">Privacy</a></p>
</form>
<section class="band"><h2>Where do I get a CSV?</h2><p>In most banking apps: Accounts, pick the account, Statements or Transactions, then Export or Download and choose CSV. PDF statements are not supported yet. If you only have a PDF, open it, select the transactions and paste them above.</p></section>`;
  return layout(ctx, { title: 'Scan a statement - Siphon', description: 'Paste or upload a bank statement to find recurring charges.', body });
}

const CONF = { high: 'Very likely', medium: 'Probably', low: 'Maybe' };
const STATUS_LABEL = { watching: 'Watching', keep: 'Keeping', cut: 'Cutting', ignore: 'Not a leak' };

function leakCard(ctx, l, back) {
  const cur = ctx.cur;
  const notes = [];
  if (l.change) notes.push(`<p class="note rise">Price went ${l.change.toCents > l.change.fromCents ? 'up' : 'down'} ${Math.abs(l.change.pct)}%: ${esc(money(l.change.fromCents, cur))} to ${esc(money(l.change.toCents, cur))} (from ${esc(when(l.change.date, ctx.today))}).</p>`);
  for (const d of l.doubles || []) notes.push(`<p class="note double">Charged twice around ${esc(when(d, ctx.today))}. Worth asking for a refund.</p>`);
  if (l.ended) notes.push('<p class="note">The last charge was a while ago. This looks like it already stopped.</p>');
  if (!l.fixed) notes.push('<p class="note">The amount changes each time, so the cost is an average.</p>');
  const buttons = ['keep', 'cut', 'ignore', 'watching'].filter(s => s !== l.status).map(s => {
    const text = { keep: 'Keep it', cut: 'Cut it', ignore: 'Not a leak', watching: 'Reset' }[s];
    return `<button class="btn btn-${s}" type="submit" name="status" value="${s}">${text}</button>`;
  }).join('');
  return `<article class="leak conf-${esc(l.confidence)} st-${esc(l.status)}${l.ended ? ' is-ended' : ''}" id="leak-${esc(l.id)}">
  <header><h3>${esc(l.label)}</h3><span class="tag">${esc(l.category)}</span><span class="pill pill-${esc(l.status)}">${esc(STATUS_LABEL[l.status])}</span></header>
  <div class="price"><strong>${esc(money(l.amountCents, cur))}</strong><span>${esc(l.cadenceLabel)}</span></div>
  <dl><div><dt>A year</dt><dd>${esc(money(l.annualCents, cur, false))}</dd></div><div><dt>Last charged</dt><dd>${esc(when(l.lastDate, ctx.today))}</dd></div><div><dt>Next</dt><dd>${l.nextDate && !l.ended ? esc(when(l.nextDate, ctx.today)) : '-'}</dd></div><div><dt>Seen</dt><dd>${l.count}x</dd></div><div><dt>Sure?</dt><dd>${esc(CONF[l.confidence])}</dd></div></dl>
  ${notes.join('')}
  <form method="post" action="/vault/status" class="actions">${csrfField(ctx)}<input type="hidden" name="id" value="${esc(l.id)}"><input type="hidden" name="back" value="${esc(back)}">${buttons}<a class="textlink" href="/cancel?merchant=${encodeURIComponent(l.label)}#letter">How to cancel</a></form>
</article>`;
}

function onceList(ctx, onces) {
  if (!onces.length) return '';
  return `<section class="band"><h2>Worth a look</h2><p class="muted">These look like subscriptions but showed up only once, so Siphon cannot tell the rhythm. A longer statement would settle it.</p><ul class="once">${onces.map(o => `<li><strong>${esc(o.label)}</strong> <span class="tag">${esc(o.category)}</span> <span>${esc(money(o.cents, ctx.cur))} on ${esc(when(o.date, ctx.today))}</span></li>`).join('')}</ul></section>`;
}

function drainHeadline(ctx, summary, intro) {
  return `<section class="drain"><p class="eyebrow">${esc(intro)}</p><div class="drip-wrap"><p class="bignum" aria-live="polite"><span>${esc(money(summary.monthlyCents, ctx.cur, false))}</span><small>a month</small></p><span class="drip" aria-hidden="true"></span></div><p class="lede">That is <strong>${esc(money(summary.annualCents, ctx.cur, false))}</strong> a year leaving without you deciding to spend it.</p></section>`;
}

function scanResult(ctx, { parsed, result, summary, alerts }) {
  const { stats, warnings } = parsed;
  const shown = result.leaks;
  const cards = shown.map(l => leakCard(ctx, { ...l, status: l.status || 'watching', doubles: l.doubles || [] }, '/vault')).join('');
  const body = `
<section class="page-head"><p class="eyebrow">// scan complete</p><h1>${shown.filter(l => !l.ended).length ? `We found ${shown.filter(l => !l.ended).length} thing${shown.filter(l => !l.ended).length === 1 ? '' : 's'} that keep coming back` : 'No clear leaks found'}</h1>
<p class="muted">Read ${stats.count} lines from ${esc(when(stats.from, ctx.today))} to ${esc(when(stats.to, ctx.today))} (about ${stats.months} month${stats.months === 1 ? '' : 's'}).</p>
${warnings.map(w => `<p class="note">${esc(w)}</p>`).join('')}</section>
${summary.count ? drainHeadline(ctx, summary, 'quietly leaving your account') : ''}
${alerts.length ? `<section class="band"><h2>Charged twice</h2><ul class="once">${alerts.map(a => `<li><strong>${esc(a.label)}</strong> <span>${esc(money(a.cents, ctx.cur))} on ${esc(when(a.date, ctx.today))}</span></li>`).join('')}</ul></section>` : ''}
${shown.length ? `<section class="leaks"><h2>The leaks</h2><p class="muted">Tell Siphon what to do with each one. Your choices are saved in your vault.</p>${cards}</section>` : `<section class="band"><p>Nothing repeated on a steady rhythm. Try a longer statement, or add the months before. Siphon needs to see a charge at least twice.</p><p><a class="btn btn-scan" href="/scan"><span>Try again</span></a></p></section>`}
${onceList(ctx, result.once)}
<p class="next"><a class="btn btn-scan" href="/vault"><span>Open my vault</span></a> <a class="btn btn-ghost" href="/radar">See the radar</a></p>`;
  return layout(ctx, { title: 'Your scan - Siphon', body });
}

function vaultPage(ctx, { leaks, onces, filter, error }) {
  const counts = { all: leaks.length };
  for (const s of ['watching', 'keep', 'cut', 'ignore']) counts[s] = leaks.filter(l => l.status === s).length;
  const live = leaks.filter(l => !l.ended && l.status !== 'ignore');
  const monthly = live.reduce((s, l) => s + l.monthlyCents, 0);
  const cutting = live.filter(l => l.status === 'cut').reduce((s, l) => s + l.monthlyCents, 0);
  const keeping = live.filter(l => l.status === 'keep').reduce((s, l) => s + l.monthlyCents, 0);
  const list = leaks.filter(l => filter === 'all' || l.status === filter);
  const chip = (key, label) => `<a class="chip${filter === key ? ' on' : ''}" href="/vault${key === 'all' ? '' : '?status=' + key}"${filter === key ? ' aria-current="true"' : ''}>${label} <b>${counts[key]}</b></a>`;
  const body = `
<section class="page-head"><p class="eyebrow">// your vault</p><h1>Everything draining you</h1></section>
${leaks.length ? `<section class="tiles"><div class="tile"><small>Draining you now</small><b>${esc(money(monthly, ctx.cur, false))}</b><span>a month</span></div><div class="tile cut"><small>Marked to cut</small><b>${esc(money(cutting, ctx.cur, false))}</b><span>saves ${esc(money(cutting * 12, ctx.cur, false))} a year</span></div><div class="tile keep"><small>Keeping on purpose</small><b>${esc(money(keeping, ctx.cur, false))}</b><span>a month</span></div></section>
<nav class="chips" aria-label="Filter">${chip('all', 'All')}${chip('watching', 'Watching')}${chip('cut', 'Cutting')}${chip('keep', 'Keeping')}${chip('ignore', 'Not a leak')}</nav>
<section class="leaks">${list.length ? list.map(l => leakCard(ctx, l, '/vault' + (filter === 'all' ? '' : '?status=' + filter))).join('') : '<p class="muted">Nothing in this view.</p>'}</section>` : `<section class="band"><p>Your vault is empty. Run a scan and what Siphon finds will live here.</p><p><a class="btn btn-scan" href="/scan"><span>Run the scan</span></a></p></section>`}
${onceList(ctx, onces)}
<section class="band" id="add"><h2>Add one by hand</h2><p class="muted">For charges a statement cannot show, like an annual fee you know is coming.</p>
${error ? `<p class="alert" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/vault/add" class="ghost addform">${csrfField(ctx)}
<label for="m-label">Name</label><input id="m-label" name="label" maxlength="40" required placeholder="Gym, magazine, cloud storage...">
<div class="two"><div><label for="m-amount">Amount</label><input id="m-amount" name="amount" inputmode="decimal" required placeholder="199.00"></div><div><label for="m-cadence">How often</label><select id="m-cadence" name="cadence">${CADENCES.map(c => `<option value="${c.key}"${c.key === 'monthly' ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div></div>
<label for="m-next">Next charge date</label><input id="m-next" name="next" type="date" required>
<p><button class="btn btn-note" type="submit">Add to vault</button></p></form></section>
${leaks.length || onces.length ? `<section class="band danger"><h2>Delete everything</h2><p class="muted">Removes your vault and your cookie. This cannot be undone.</p><form method="post" action="/vault/clear">${csrfField(ctx)}<label class="check"><input type="checkbox" name="confirm" value="yes" required> Yes, delete my vault</label><p><button class="btn btn-cut" type="submit">Delete my data</button></p></form></section>` : ''}`;
  return layout(ctx, { title: 'Your vault - Siphon', body });
}

function radarSvg(ctx, leaks) {
  const live = leaks.filter(l => !l.ended && l.nextDate && l.status !== 'ignore');
  const max = Math.max(1, ...live.map(l => l.monthlyCents));
  const C = 280, R = 238;
  const rings = [R, R * 0.72, R * 0.46, R * 0.22].map(r => `<circle cx="${C}" cy="${C}" r="${r.toFixed(1)}"/>`).join('');
  const ticks = Array.from({ length: 31 }, (_, i) => {
    const a = (i / 31) * Math.PI * 2 - Math.PI / 2;
    const long = (i + 1) % 5 === 0 || i === 0;
    const r1 = R, r2 = R + (long ? 12 : 6);
    const label = long ? `<text x="${(C + Math.cos(a) * (R + 26)).toFixed(1)}" y="${(C + Math.sin(a) * (R + 26) + 4).toFixed(1)}" text-anchor="middle" class="daynum">${i + 1}</text>` : '';
    return `<path d="M${(C + Math.cos(a) * r1).toFixed(1)} ${(C + Math.sin(a) * r1).toFixed(1)}L${(C + Math.cos(a) * r2).toFixed(1)} ${(C + Math.sin(a) * r2).toFixed(1)}" class="tick"/>${label}`;
  }).join('');
  const blips = live.map((l, i) => {
    const day = Number(l.nextDate.slice(8, 10));
    const a = ((day - 1) / 31) * Math.PI * 2 - Math.PI / 2;
    const norm = Math.sqrt(l.monthlyCents / max);
    const r = R * 0.9 - norm * R * 0.62 - (i % 3) * 7;
    const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r, size = 5 + norm * 9;
    const cls = l.status === 'keep' ? 'keep' : l.status === 'cut' ? 'cut' : 'leak';
    const lx = x + (Math.cos(a) >= 0 ? 12 : -12) + (Math.cos(a) >= 0 ? size : -size) * 0.4;
    return `<g class="blip d${(i % 6) + 1} ${cls}"><title>${esc(l.label)}: ${esc(money(l.amountCents, ctx.cur))} ${esc(l.cadenceLabel)}, next ${esc(when(l.nextDate, ctx.today))}</title><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(size * 1.9).toFixed(1)}" class="halo"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" class="dot"/><text x="${lx.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${Math.cos(a) >= 0 ? 'start' : 'end'}" class="blabel">${esc(l.label.slice(0, 14))}</text></g>`;
  }).join('');
  return `<svg class="radar big-radar" viewBox="-30 -30 620 620" role="img" aria-label="Radar of your charges by day of the month. Closer to the centre costs more."><g class="rings">${rings}<path d="M${C} ${C - R}V${C + R}M${C - R} ${C}H${C + R}"/></g>${ticks}<g class="sweep"><path d="M${C} ${C} L${C} ${C - R} A${R} ${R} 0 0 1 ${(C + Math.sin(0.5) * R).toFixed(1)} ${(C - Math.cos(0.5) * R).toFixed(1)} Z" class="wedge"/><path d="M${C} ${C} L${C} ${C - R}" class="needle"/></g>${blips}<circle cx="${C}" cy="${C}" r="5" class="core"/></svg>`;
}

function radarPage(ctx, leaks) {
  const live = leaks.filter(l => !l.ended && l.status !== 'ignore');
  const list = upcoming(live.map(l => ({ id: l.id, label: l.label, cadence: l.cadence, nextDate: l.nextDate, amountCents: l.amountCents, ended: l.ended })), ctx.today, 30);
  const total = list.reduce((s, x) => s + x.cents, 0);
  const body = `
<section class="page-head"><p class="eyebrow">// radar</p><h1>When it hits you</h1><p class="lede">Each blip is a charge, placed by the day of the month it lands. Closer to the centre costs more.</p></section>
${live.length ? `<section class="radar-wrap">${radarSvg(ctx, leaks)}<aside class="ghost"><h2>Next 30 days</h2><p class="bignum small"><span>${esc(money(total, ctx.cur, false))}</span><small>leaving</small></p><ol class="timeline">${list.map(x => `<li><time datetime="${esc(x.date)}">${esc(when(x.date, ctx.today))}</time><span>${esc(x.label)}</span><b>${esc(money(x.cents, ctx.cur))}</b></li>`).join('') || '<li class="muted">Nothing due.</li>'}</ol></aside></section>` : `<section class="band"><p>The radar is empty. Run a scan to put your charges on it.</p><p><a class="btn btn-scan" href="/scan"><span>Run the scan</span></a></p></section>`}`;
  return layout(ctx, { title: 'Radar - Siphon', description: 'See when your recurring charges hit during the month.', body, wide: true });
}

function letterText({ merchant, ref, name }) {
  const m = merchant || '[Company name]';
  return `Subject: Cancellation of my subscription / debit order - ${m}

To the ${m} accounts team,

I, ${name || '[Your full name]'}, am writing to cancel my subscription / debit order with you.
Account or reference number: ${ref || '[Your account or reference number]'}

Please:
1. Cancel the agreement and stop all future debit orders from my account.
2. Confirm the cancellation in writing, with the last date I will be charged.
3. Send me a final statement.

Please do not collect any payment after the date you confirm. If a payment is collected after cancellation, I will dispute it with my bank and ask for a refund.

Kind regards,
${name || '[Your full name]'}`;
}

function cancelPage(ctx, { merchant = '', ref = '', name = '' }) {
  const body = `
<section class="page-head"><p class="eyebrow">// getting out</p><h1>How to cancel</h1><p class="lede">Steps for common services, how to stop a debit order, and a letter you can send.</p></section>
<section class="guides">${GUIDES.map(g => `<details class="ghost"><summary>${esc(g.name)}</summary><ol>${g.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>`).join('')}</section>
<section class="band"><h2>Stop a debit order at your bank</h2><ol class="plain"><li>Tell the company first and get the cancellation in writing.</li><li>Then tell your bank to stop the debit order. Most banks let you do this in the app or by phone.</li><li>If a debit order was never authorised, contact your bank quickly and ask to dispute it. Banks usually allow disputes for only a limited time after the charge, often around 40 days, so check yours.</li><li>Keep every email and reference number.</li></ol><p class="muted">This is general information, not legal advice. Rules differ by bank and by contract.</p></section>
<section class="band" id="letter"><h2>Write the letter</h2>
<form method="get" action="/cancel#letter" class="ghost addform"><label for="l-merchant">Company</label><input id="l-merchant" name="merchant" maxlength="60" value="${esc(merchant)}" placeholder="Virgin Active"><div class="two"><div><label for="l-ref">Account or reference</label><input id="l-ref" name="ref" maxlength="40" value="${esc(ref)}"></div><div><label for="l-name">Your name</label><input id="l-name" name="name" maxlength="60" value="${esc(name)}"></div></div><p><button class="btn btn-note" type="submit">Write it</button></p></form>
<pre class="letter" id="letter-text">${esc(letterText({ merchant, ref, name }))}</pre><p><button class="btn btn-ghost" type="button" data-copy="#letter-text">Copy the letter</button></p></section>`;
  return layout(ctx, { title: 'How to cancel - Siphon', description: 'Cancel steps for common subscriptions, how to stop a debit order, and a cancellation letter.', body });
}

function howPage(ctx) {
  const body = `
<section class="page-head"><p class="eyebrow">// how it works</p><h1>No magic. Just patterns.</h1><p class="lede">Siphon is a set of plain rules. Here is what it looks for, and where it can be wrong.</p></section>
<section class="band"><h2>What counts as a leak</h2><p>A charge that comes back from the same payee, on a steady rhythm, for a steady amount. Weekly, every two weeks, monthly, every three or six months, or yearly.</p></section>
<section class="band"><h2>How it decides</h2><ol class="plain"><li><b>Clean the name.</b> Bank noise like "POS PURCHASE", card numbers and reference codes is stripped so the same payee groups together.</li><li><b>Look at the gaps.</b> It measures the days between charges and checks whether they fit a rhythm.</li><li><b>Look at the amounts.</b> Steady amounts score higher. A step up or down is reported as a price change.</li><li><b>Score it.</b> More charges, a regular rhythm, a steady price and a known service raise the score.</li><li><b>Check if it stopped.</b> If the last charge is long past its rhythm, it is marked as already ended.</li></ol></section>
<section class="band"><h2>What it cannot see</h2><ul class="plain"><li>A charge seen only once. A subscription needs two sightings to show a rhythm.</li><li>Payments from another account or card that you did not include.</li><li>Charges that change a lot and do not land on a steady day.</li><li>Why a charge exists. A flagged item may be something you want. That is what Keep is for.</li></ul></section>
<section class="band"><h2>Sure or not sure</h2><p><b>Very likely</b>: clear rhythm, steady price, several charges. <b>Probably</b>: a pattern, but with fewer charges or a changing price. <b>Maybe</b>: worth checking yourself.</p><p class="muted">Siphon is a helper, not an authority. Always check before you cancel anything you rely on, like insurance.</p></section>`;
  return layout(ctx, { title: 'How it works - Siphon', description: 'The plain rules Siphon uses to find recurring charges, and what it cannot see.', body });
}

function privacyPage(ctx) {
  const body = `
<section class="page-head"><p class="eyebrow">// privacy</p><h1>What happens to your statement</h1></section>
<section class="band"><h2>The statement</h2><p>When you press scan, your statement is sent to our server, read in memory, and thrown away when the page is ready. It is not written to disk and it is not logged.</p></section>
<section class="band"><h2>What we keep</h2><ul class="plain"><li>The charges Siphon found: name, amount, rhythm and dates. This is your vault.</li><li>Your choices (keep, cut, not a leak) and the currency you picked.</li><li>One cookie that links your browser to your vault. It has no name or email in it.</li></ul><p>We do not ask for your name, email or bank login. We do not use advertising or tracking scripts, and we do not share your data with anyone.</p></section>
<section class="band"><h2>Deleting it</h2><p>Open your <a href="/vault">vault</a> and press Delete my data. It is removed straight away. A vault that is not opened for 180 days is deleted automatically.</p></section>
<section class="band"><h2>Good to know</h2><p>Anyone using your browser can open your vault, so do not use Siphon on a shared device. Use a private window if in doubt.</p><p class="muted">Operator details and contact address: <span class="fill">[add before launch]</span></p></section>`;
  return layout(ctx, { title: 'Privacy - Siphon', body });
}

function notFound(ctx) {
  const body = `<section class="page-head center"><p class="eyebrow">// 404</p><h1>Nothing here.</h1><p class="lede">This page slipped away, like a charge you did not notice.</p><p><a class="btn btn-scan" href="/"><span>Back to the start</span></a></p></section>`;
  return layout(ctx, { title: 'Not found - Siphon', body });
}

function errorPage(ctx, message, title = 'Something went wrong') {
  const body = `<section class="page-head center"><p class="eyebrow">// oops</p><h1>${esc(title)}</h1><p class="lede">${esc(message)}</p><p><a class="btn btn-scan" href="/scan"><span>Go back</span></a></p></section>`;
  return layout(ctx, { title: `${title} - Siphon`, body });
}

module.exports = { esc, money, when, letterText, pages: { home, scanForm, scanResult, vaultPage, radarPage, cancelPage, howPage, privacyPage, notFound, errorPage } };
