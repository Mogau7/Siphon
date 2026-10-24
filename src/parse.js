'use strict';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseDate(text, fallbackYear) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/.exec(s))) {
    let day = +m[1], month = +m[2], year = +m[3];
    if (year < 100) year += 2000;
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return iso(year, month, day);
  }
  if ((m = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?,?[ -]?(\d{2}|\d{4})?$/.exec(s))) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    let year = m[3] ? +m[3] : fallbackYear;
    if (year && year < 100) year += 2000;
    return month && year ? iso(year, month, +m[1]) : null;
  }
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s))) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return month ? iso(+m[3], month, +m[2]) : null;
  }
  return null;
}

function parseAmount(raw) {
  let s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!s) return null;
  let neg = false, pos = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/(^|\s)(DR|DEBIT)$/i.test(s)) { neg = true; s = s.replace(/(\s|^)(DR|DEBIT)$/i, ''); }
  if (/(^|\s)(CR|CREDIT)$/i.test(s)) { pos = true; s = s.replace(/(\s|^)(CR|CREDIT)$/i, ''); }
  s = s.replace(/ZAR|USD|EUR|GBP/gi, '').replace(/[R$€£]/g, '').replace(/[\s\u00a0]/g, '').replace(/[\u2212\u2013]/g, '-');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/^\+/, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  let decimal = null;
  if (lastComma >= 0 && lastDot >= 0) decimal = lastComma > lastDot ? ',' : '.';
  else if (lastComma >= 0) decimal = (s.match(/,/g).length === 1 && /,\d{1,2}$/.test(s)) ? ',' : null;
  else if (lastDot >= 0) decimal = s.match(/\./g).length === 1 ? '.' : null;
  let digits = decimal ? s.split(decimal === ',' ? '.' : ',').join('') : s.replace(/[.,]/g, '');
  if (decimal === ',') digits = digits.replace(',', '.');
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return { cents: neg ? -cents : cents, explicit: neg ? 'debit' : pos ? 'credit' : null };
}

function splitLine(line, delim) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function pickDelimiter(lines) {
  let best = null, bestCount = 0;
  for (const d of [',', ';', '\t', '|']) {
    const sample = lines.slice(0, 12).map(l => splitLine(l, d).length);
    const good = sample.filter(n => n >= 3).length;
    if (good / sample.length >= 0.6 && good > bestCount) { best = d; bestCount = good; }
  }
  return best;
}

const HEAD = {
  date: /^(transaction |posting |value |trans\.? |processing )?date$|^date\b|^posted$/i,
  desc: /desc|detail|narrat|payee|memo|particular|merchant|transaction$|^reference$|^name$/i,
  amount: /^(transaction )?amount|^value$|^amt/i,
  debit: /debit|withdraw|money out|paid out|payment out|^out$/i,
  credit: /credit|deposit|money in|paid in|^in$/i,
  balance: /balance/i,
};

function mapHeader(cells) {
  const map = {};
  cells.forEach((cell, i) => {
    for (const k of ['date', 'debit', 'credit', 'balance', 'amount', 'desc']) {
      if (map[k] === undefined && HEAD[k].test(cell.trim())) { map[k] = i; break; }
    }
  });
  return map.date !== undefined && (map.amount !== undefined || map.debit !== undefined || map.credit !== undefined) ? map : null;
}

function inferColumns(rows) {
  const width = Math.max(...rows.map(r => r.length));
  const sample = rows.slice(0, 60);
  const score = i => ({
    date: sample.filter(r => parseDate(r[i])).length / sample.length,
    num: sample.filter(r => r[i] !== undefined && r[i] !== '' && parseAmount(r[i])).length / sample.length,
    text: sample.filter(r => r[i] && /[A-Za-z]{3}/.test(r[i]) && !parseDate(r[i]) && !parseAmount(r[i])).length / sample.length,
  });
  const scores = Array.from({ length: width }, (_, i) => score(i));
  const date = scores.findIndex(s => s.date > 0.6);
  if (date < 0) return null;
  let desc = -1, bestText = 0.4;
  scores.forEach((s, i) => { if (i !== date && s.text > bestText) { bestText = s.text; desc = i; } });
  if (desc < 0) return null;
  const nums = scores.map((s, i) => (s.num > 0.6 && i !== date && i !== desc ? i : -1)).filter(i => i >= 0);
  if (!nums.length) return null;
  return { date, desc, amount: nums[0], balance: nums.length > 1 ? nums[nums.length - 1] : undefined };
}

const AMT = String.raw`[-+(]?\s*(?:ZAR|R|\$|€|£)?\s*\d[\d\s.,]*[.,]\d{2}\)?-?(?:\s?(?:DR|CR))?`;
const DATE_RE = new RegExp(String.raw`^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2} [A-Za-z]{3,9}\.?,? \d{2,4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9})\s+(.*)$`);
const TAIL_RE = new RegExp(String.raw`^(.*?)\s+(${AMT})(?:\s+(${AMT}))?\s*$`, 'i');

function parseFreeText(lines, warnings) {
  const rows = [];
  let skipped = 0;
  for (const line of lines) {
    const d = DATE_RE.exec(line);
    if (!d) { skipped++; continue; }
    const t = TAIL_RE.exec(d[2]);
    if (!t) { skipped++; continue; }
    const date = parseDate(d[1], new Date().getUTCFullYear());
    const amount = parseAmount(t[2]);
    if (!date || !amount) { skipped++; continue; }
    rows.push({ date, desc: t[1].trim(), cents: amount.cents, explicit: amount.explicit });
  }
  if (skipped) warnings.push(`${skipped} line${skipped === 1 ? '' : 's'} could not be read and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  return rows;
}

function parseTable(rows, warnings) {
  let start = 0, map = null;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    if (!rows[i].some(c => parseDate(c))) {
      const m = mapHeader(rows[i]);
      if (m) { map = m; start = i + 1; break; }
    }
  }
  const body = rows.slice(start);
  if (!map) map = inferColumns(body);
  if (!map) return null;
  const out = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[map.date]);
    if (!date) { skipped++; continue; }
    const desc = map.desc !== undefined ? r[map.desc] : r.filter((c, i) => i !== map.date && !parseAmount(c)).join(' ');
    if (!desc) { skipped++; continue; }
    let cents = null, explicit = null;
    if (map.debit !== undefined || map.credit !== undefined) {
      const dr = map.debit !== undefined ? parseAmount(r[map.debit]) : null;
      const cr = map.credit !== undefined ? parseAmount(r[map.credit]) : null;
      if (dr && dr.cents) { cents = -Math.abs(dr.cents); explicit = 'debit'; }
      else if (cr && cr.cents) { cents = Math.abs(cr.cents); explicit = 'credit'; }
      else if (map.amount !== undefined) { const a = parseAmount(r[map.amount]); if (a) { cents = a.cents; explicit = a.explicit; } }
    } else {
      const a = parseAmount(r[map.amount]);
      if (a) { cents = a.cents; explicit = a.explicit; }
    }
    if (cents === null) { skipped++; continue; }
    out.push({ date, desc: desc.trim(), cents, explicit });
  }
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} could not be read and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  return out;
}

function parseStatement(text) {
  const warnings = [];
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 20000) { lines = lines.slice(0, 20000); warnings.push('The statement is very long, so only the first 20,000 lines were read.'); }
  if (!lines.length) return { rows: [], warnings: ['Nothing to read yet. Paste your statement or choose a file.'], stats: { count: 0, from: null, to: null, months: 0 } };
  const delim = pickDelimiter(lines);
  let rows = null;
  if (delim) rows = parseTable(lines.map(l => splitLine(l, delim)), warnings);
  if (!rows || !rows.length) { warnings.length = 0; rows = parseFreeText(lines, warnings); }
  const hasNeg = rows.some(r => r.cents < 0 || r.explicit === 'debit');
  const hasCredit = rows.some(r => r.explicit === 'credit');
  if (!hasNeg && !hasCredit && rows.length) {
    rows = rows.map(r => ({ ...r, cents: -Math.abs(r.cents) }));
    warnings.push('Every amount was positive, so all of them were treated as money going out.');
  } else {
    rows = rows.map(r => (r.explicit === 'debit' ? { ...r, cents: -Math.abs(r.cents) } : r.explicit === 'credit' ? { ...r, cents: Math.abs(r.cents) } : r));
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const from = rows.length ? rows[0].date : null, to = rows.length ? rows[rows.length - 1].date : null;
  const months = from ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000 / 30.4)) : 0;
  return { rows, warnings, stats: { count: rows.length, from, to, months } };
}

module.exports = { parseStatement, parseDate, parseAmount, splitLine };
