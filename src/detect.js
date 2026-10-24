'use strict';

const { KNOWN } = require('./services');

const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const toDay = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
const toIso = d => new Date(d * DAY).toISOString().slice(0, 10);
const median = arr => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const CADENCES = [
  { key: 'weekly', label: 'every week', days: 7, tol: 2, perMonth: 52 / 12, min: 4 },
  { key: 'fortnightly', label: 'every 2 weeks', days: 14, tol: 3, perMonth: 26 / 12, min: 3 },
  { key: 'monthly', label: 'every month', days: 30.4, tol: 5, perMonth: 1, min: 2 },
  { key: 'quarterly', label: 'every 3 months', days: 91, tol: 10, perMonth: 1 / 3, min: 2 },
  { key: 'semiannual', label: 'every 6 months', days: 182, tol: 15, perMonth: 1 / 6, min: 2 },
  { key: 'yearly', label: 'every year', days: 365, tol: 18, perMonth: 1 / 12, min: 2 },
];
const CADENCE_BY_KEY = Object.fromEntries(CADENCES.map(c => [c.key, c]));

const NOISE = /\b(POS|PURCHASE|PAYMENT|PMT|PYMT|DEBIT|ORDER|D\/O|DR|CR|CARD|ACB|DEBICHECK|RECURRING|INSTALMENT|INSTALLMENT|ONLINE|EFT|TO|FROM|FNB|ABSA|NEDBANK|CAPITEC|STANDARD|BANK|STD|APP|INTERNET|BANKING|TRANSFER|REF|REFERENCE|FEE|CASH|WITHDRAWAL|ATM|DIRECT|THE|AND|CONTRACT|SUBSCRIPTION|MONTHLY)\b/g;

function titleCase(s) { return s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }

function normalize(desc) {
  const s = String(desc || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const svc of KNOWN) {
    if (svc.re.test(s)) return { key: svc.label.toUpperCase(), label: svc.label, cat: svc.cat, known: true };
  }
  const cleaned = s.replace(NOISE, ' ').replace(/[*#:_/\\|,;()[\]]/g, ' ').replace(/X{2,}\d*/g, ' ').replace(/\b[\w.-]*\d[\w.-]*\b/g, ' ')
    .replace(/[^A-Z&' -]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter(t => t.length > 1);
  const key = tokens.slice(0, 2).join(' ');
  return { key: key || 'UNKNOWN', label: key ? titleCase(key) : 'Unknown', cat: 'Other', known: false };
}

function addMonthsIso(iso, n, anchorDay) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(anchorDay || d, dim))}`;
}

function step(iso, cad, anchor) {
  switch (cad.key) {
    case 'weekly': return toIso(toDay(iso) + 7);
    case 'fortnightly': return toIso(toDay(iso) + 14);
    case 'monthly': return addMonthsIso(iso, 1, anchor);
    case 'quarterly': return addMonthsIso(iso, 3, anchor);
    case 'semiannual': return addMonthsIso(iso, 6, anchor);
    default: return addMonthsIso(iso, 12, anchor);
  }
}

function nextDue(lastIso, cad, anchor, todayIso) {
  let next = step(lastIso, cad, anchor), guard = 0;
  while (next < todayIso && guard++ < 500) next = step(next, cad, anchor);
  return next;
}

function pickCadence(median_) {
  return CADENCES.find(c => Math.abs(median_ - c.days) <= c.tol) || null;
}

function clusterAmounts(charges) {
  const sorted = [...charges].sort((a, b) => a.cents - b.cents);
  const clusters = [];
  for (const c of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && c.cents <= last[0].cents * 1.04 + 50) last.push(c); else clusters.push([c]);
  }
  return clusters;
}

function levels(amounts) {
  const segs = [];
  for (const a of amounts) {
    const last = segs[segs.length - 1];
    if (last && Math.abs(a - last.base) <= last.base * 0.03 + 30) last.items.push(a); else segs.push({ base: a, items: [a] });
  }
  return segs;
}

function daySpread(days) {
  const dom = [...new Set(days.map(d => Number(toIso(d).slice(8, 10))))].sort((a, b) => a - b);
  if (dom.length === 1) return 0;
  let maxGap = 0;
  for (let i = 0; i < dom.length; i++) {
    const next = i === dom.length - 1 ? dom[0] + 31 : dom[i + 1];
    maxGap = Math.max(maxGap, next - dom[i]);
  }
  return 31 - maxGap;
}

function analyse(charges, meta, ctx) {
  const list = [...charges].sort((a, b) => a.day - b.day);
  const alerts = [];
  const distinct = [];
  for (const c of list) {
    const prev = distinct[distinct.length - 1];
    if (prev && c.day - prev.day <= 1) {
      if (Math.abs(c.cents - prev.cents) <= 1 && c.cents >= 5000) alerts.push({ type: 'double', label: meta.label, date: c.date, cents: c.cents });
    } else distinct.push(c);
  }
  const n = distinct.length;
  if (n < 2) return { leak: null, alerts };
  if (median(distinct.map(c => c.cents)) < 500) return { leak: null, alerts };
  const days = distinct.map(c => c.day);
  const intervals = days.slice(1).map((d, i) => d - days[i]);
  const cad = pickCadence(median(intervals));
  if (!cad || n < cad.min) return { leak: null, alerts };
  const within = intervals.filter(i => Math.abs(i - cad.days) <= cad.tol).length;
  const regularity = within / intervals.length;
  if (regularity < 0.6) return { leak: null, alerts };
  const amounts = distinct.map(c => c.cents);
  const segs = levels(amounts);
  let fixed = false, change = null;
  if (segs.length === 1) fixed = true;
  else if (segs.length === 2) {
    const [a, b] = segs, ratio = b.base / a.base;
    if ((a.items.length >= 2 || b.items.length >= 2) && ratio >= 0.5 && ratio <= 1.6) {
      fixed = true;
      const idx = a.items.length;
      change = { fromCents: a.base, toCents: b.base, pct: Math.round((ratio - 1) * 100), date: distinct[idx].date };
    }
  }
  const spread = cad.key === 'monthly' || cad.key === 'quarterly' || cad.key === 'yearly' ? daySpread(days) : 0;
  if (!fixed) {
    const med = median(amounts);
    const share = amounts.filter(a => Math.abs(a - med) <= med * 0.25).length / n;
    const okCadence = ['monthly', 'quarterly', 'yearly'].includes(cad.key);
    if (!okCadence || n < 3 || regularity < 0.75 || spread > 3 || (share < 0.5 && !meta.known)) return { leak: null, alerts };
  }
  const last = distinct[n - 1];
  const recentAmounts = amounts.slice(-3);
  const amountCents = fixed ? last.cents : Math.round(recentAmounts.reduce((a, b) => a + b, 0) / recentAmounts.length);
  const monthlyCents = Math.round(amountCents * cad.perMonth);
  const ended = ctx.endDay - last.day > cad.days + cad.tol + 7;
  const anchor = Number(last.date.slice(8, 10));
  const score = 0.3 * regularity + 0.3 * (fixed ? 1 : 0.4) + 0.2 * Math.min(1, n / 4) + 0.1 * (meta.known ? 1 : 0) + 0.1 * (spread <= 3 ? 1 : 0);
  let confidence = score >= 0.78 ? 'high' : score >= 0.6 ? 'medium' : 'low';
  if (n === 2 && !meta.known && confidence === 'high') confidence = 'medium';
  const dupes = alerts.filter(a => a.type === 'double');
  return {
    leak: {
      id: meta.id, key: meta.key, label: meta.label, category: meta.cat, variantCents: meta.variantCents || 0,
      cadence: cad.key, cadenceLabel: cad.label, amountCents, monthlyCents, annualCents: monthlyCents * 12, count: n,
      firstDate: distinct[0].date, lastDate: last.date, nextDate: ended ? null : nextDue(last.date, cad, anchor, ctx.today),
      fixed, confidence, score: Math.round(score * 100) / 100, change, ended, known: !!meta.known, doubles: dupes.map(d => d.date),
    },
    alerts,
  };
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function detectLeaks(rows, options = {}) {
  const todayIso = options.today || new Date().toISOString().slice(0, 10);
  const groups = new Map();
  let endDay = 0;
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) || !Number.isFinite(r.cents)) continue;
    const day = toDay(r.date);
    if (!Number.isFinite(day)) continue;
    if (day > endDay) endDay = day;
    if (r.cents >= 0) continue;
    const norm = normalize(r.desc);
    if (norm.key === 'UNKNOWN') continue;
    if (!groups.has(norm.key)) groups.set(norm.key, { meta: norm, charges: [] });
    groups.get(norm.key).charges.push({ date: r.date, day, cents: -r.cents });
  }
  const ctx = { today: todayIso, endDay: endDay || toDay(todayIso) };
  const leaks = [], once = [], alerts = [];
  for (const { meta, charges } of groups.values()) {
    const clusters = clusterAmounts(charges).filter(c => c.length >= (meta.known ? 2 : 3));
    const spans = clusters.map(c => ({ min: Math.min(...c.map(x => x.day)), max: Math.max(...c.map(x => x.day)) }));
    const overlapping = spans.some((a, i) => spans.some((b, j) => i < j && a.min <= b.max && b.min <= a.max));
    const attempts = overlapping ? [clusters] : [[charges], clusters.map(c => [c])];
    let found = 0;
    for (const attempt of attempts) {
      if (found) break;
      for (const part of attempt) {
        const variant = overlapping || attempt.length > 1 || part !== charges ? Math.round(median(part.map(x => x.cents))) : 0;
        const useVariant = overlapping || (part !== charges && attempt.length > 1) ? variant : 0;
        const result = analyse(part, { ...meta, variantCents: useVariant }, ctx);
        if (result.leak) {
          result.leak.id = `${slug(meta.key)}${useVariant ? '-' + useVariant : ''}-${result.leak.cadence}`;
          leaks.push(result.leak);
          alerts.push(...result.alerts);
          found++;
        }
      }
    }
    if (!found && meta.known) {
      const last = [...charges].sort((a, b) => b.day - a.day)[0];
      once.push({ id: `${slug(meta.key)}-once`, key: meta.key, label: meta.label, category: meta.cat, cents: last.cents, date: last.date, count: charges.length });
    }
  }
  leaks.sort((a, b) => (a.ended - b.ended) || (b.annualCents - a.annualCents));
  once.sort((a, b) => b.cents - a.cents);
  return { leaks, once, alerts, summary: summarise(leaks) };
}

function summarise(leaks) {
  const live = leaks.filter(l => !l.ended);
  const monthlyCents = live.reduce((s, l) => s + l.monthlyCents, 0);
  return { monthlyCents, annualCents: monthlyCents * 12, count: live.length };
}

function upcoming(items, todayIso, days = 30) {
  const out = [];
  const endIso = toIso(toDay(todayIso) + days);
  for (const it of items) {
    if (it.ended || !it.nextDate) continue;
    const cad = CADENCE_BY_KEY[it.cadence];
    if (!cad) continue;
    const anchor = Number(it.nextDate.slice(8, 10));
    let d = it.nextDate, guard = 0;
    while (d <= endIso && guard++ < 40) {
      if (d >= todayIso) out.push({ id: it.id, label: it.label, date: d, cents: it.amountCents });
      d = step(d, cad, anchor);
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.cents - a.cents));
  return out;
}

module.exports = { detectLeaks, normalize, summarise, upcoming, addMonthsIso, CADENCES, CADENCE_BY_KEY, toDay, toIso };
