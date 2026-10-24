'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAmount, parseDate, parseStatement } = require('../src/parse');
const { detectLeaks, normalize, upcoming, summarise, addMonthsIso, toDay, toIso } = require('../src/detect');
const { demoStatement } = require('../src/demo');

const TODAY = '2026-10-23';
const rows = (desc, dates, cents) => dates.map((d, i) => ({ date: d, desc, cents: -(Array.isArray(cents) ? cents[i] : cents) }));
const monthly = (desc, day, count, cents, endMonth = 10) => {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = endMonth - i, y = m < 1 ? 2025 : 2026, mm = m < 1 ? m + 12 : m;
    out.push(`${y}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return rows(desc, out, cents);
};

test('amounts in many bank formats', () => {
  assert.equal(parseAmount('R1 234,50').cents, 123450);
  assert.equal(parseAmount('1,234.50').cents, 123450);
  assert.equal(parseAmount('-199.00').cents, -19900);
  assert.equal(parseAmount('(199.00)').cents, -19900);
  assert.equal(parseAmount('199.00 Dr').cents, -19900);
  assert.equal(parseAmount('199.00 CR').explicit, 'credit');
  assert.equal(parseAmount('1.234,56').cents, 123456);
  assert.equal(parseAmount('199,5').cents, 19950);
  for (const bad of ['', 'abc', '--', null, undefined, '12-34-56']) assert.equal(parseAmount(bad), null);
});

test('dates in many formats and bad dates', () => {
  assert.equal(parseDate('2026-01-05'), '2026-01-05');
  assert.equal(parseDate('05/01/2026'), '2026-01-05');
  assert.equal(parseDate('13/01/2026'), '2026-01-13');
  assert.equal(parseDate('01/13/2026'), '2026-01-13');
  assert.equal(parseDate('5 Jan 2026'), '2026-01-05');
  assert.equal(parseDate('Jan 5, 2026'), '2026-01-05');
  assert.equal(parseDate('20260105'), '2026-01-05');
  assert.equal(parseDate('05-01-26'), '2026-01-05');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('hello'), null);
});

test('statement layouts: header csv, semicolons with debit and credit columns, free text, no header', () => {
  const a = parseStatement('Date,Description,Amount,Balance\n2026-01-05,"NETFLIX, INC",-199.00,10.00\n2026-01-06,SALARY,25000.00,50.00');
  assert.deepEqual(a.rows.map(r => r.cents), [-19900, 2500000]);
  assert.equal(a.rows[0].desc, 'NETFLIX, INC');
  const b = parseStatement('Transaction Date;Details;Debit;Credit;Balance\n05/01/2026;DSTV;549,00;;100,00\n25/01/2026;SALARY;;28000,00;28100,00');
  assert.deepEqual(b.rows.map(r => r.cents), [-54900, 2800000]);
  const c = parseStatement('05 Jan 2026 NETFLIX.COM 199.00 Dr 1 801.00\n06 Jan 2026 SALARY ACME 25 000.00 Cr 26 801.00\nnot a transaction line');
  assert.deepEqual(c.rows.map(r => r.cents), [-19900, 2500000]);
  assert.equal(c.warnings.length, 1);
  const d = parseStatement('2026-01-05,NETFLIX.COM,-199.00,1000.00\n2026-02-05,NETFLIX.COM,-199.00,801.00\n2026-03-05,NETFLIX.COM,-199.00,602.00');
  assert.equal(d.rows.length, 3);
});

test('all positive amounts are treated as spending, and empty or garbage input does not crash', () => {
  const p = parseStatement('Date,Description,Amount\n2026-01-05,NETFLIX,199.00\n2026-02-05,NETFLIX,199.00');
  assert.ok(p.rows.every(r => r.cents < 0));
  assert.ok(p.warnings.some(w => /positive/.test(w)));
  for (const junk of ['', '   \n\n', 'hello world', '\u0000\u0001', '{"a":1}', 'a,b,c\n1,2,3', ',,,\n,,,']) {
    const r = parseStatement(junk);
    assert.ok(Array.isArray(r.rows));
  }
  const big = parseStatement(Array.from({ length: 25000 }, (_, i) => `2026-01-05,SHOP ${i},-10.00`).join('\n'));
  assert.ok(big.warnings.some(w => /20,000/.test(w)));
});

test('merchant names are cleaned of bank noise', () => {
  assert.equal(normalize('POS PURCHASE NETFLIX.COM 4412').label, 'Netflix');
  assert.equal(normalize('DEBIT ORDER DSTV 0012345').label, 'DStv');
  assert.equal(normalize('PURE GYM SANDTON 4455 POS').label, 'Gym');
  assert.equal(normalize('ACB DEBIT FOOBAR STUDIOS 99812 REF').label, 'Foobar Studios');
  assert.equal(normalize('1234 5678').key, 'UNKNOWN');
});

test('a fixed monthly charge is found with the right cost and next date', () => {
  const r = detectLeaks(monthly('FOOBAR STUDIOS', 12, 4, 25000), { today: TODAY });
  assert.equal(r.leaks.length, 1);
  const l = r.leaks[0];
  assert.deepEqual([l.cadence, l.amountCents, l.annualCents, l.confidence, l.nextDate], ['monthly', 25000, 300000, 'high', '2026-11-12']);
});

test('a price rise is reported as one subscription with the change', () => {
  const r = detectLeaks([...monthly('NETFLIX.COM', 3, 4, 16900, 8), ...monthly('NETFLIX.COM', 3, 2, 19900, 10)], { today: TODAY });
  assert.equal(r.leaks.length, 1);
  assert.equal(r.leaks[0].change.fromCents, 16900);
  assert.equal(r.leaks[0].change.toCents, 19900);
  assert.equal(r.leaks[0].change.pct, 18);
  assert.equal(r.leaks[0].amountCents, 19900);
});

test('two different plans billed at the same time are two leaks', () => {
  const r = detectLeaks([...monthly('APPLE.COM/BILL', 17, 4, 2999), ...monthly('APPLE.COM/BILL', 18, 4, 17999)], { today: TODAY });
  assert.equal(r.leaks.length, 2);
  assert.deepEqual(r.leaks.map(l => l.amountCents).sort((a, b) => a - b), [2999, 17999]);
});

test('weekly and yearly rhythms', () => {
  const weekly = Array.from({ length: 6 }, (_, i) => toIso(toDay('2026-09-01') + i * 7));
  const w = detectLeaks(rows('FOOBAR CLUB', weekly, 20000), { today: TODAY });
  assert.equal(w.leaks[0].cadence, 'weekly');
  assert.equal(w.leaks[0].monthlyCents, Math.round(20000 * 52 / 12));
  const y = detectLeaks(rows('ACME DOMAINS', ['2025-03-10', '2026-03-10'], 18900), { today: TODAY });
  assert.equal(y.leaks[0].cadence, 'yearly');
  assert.equal(y.leaks[0].monthlyCents, Math.round(18900 / 12));
  const few = detectLeaks(rows('FOOBAR CLUB', weekly.slice(0, 3), 20000), { today: TODAY });
  assert.equal(few.leaks.length, 0);
});

test('shopping that is not a subscription is left alone', () => {
  const shop = [];
  const seed = [3, 9, 14, 21, 26, 2, 11, 19, 24, 5, 13, 29];
  seed.forEach((d, i) => shop.push({ date: `2026-${String(5 + Math.floor(i / 3)).padStart(2, '0')}-${String(d).padStart(2, '0')}`, desc: 'WOOLWORTHS FOOD', cents: -(8000 + i * 3700) }));
  const r = detectLeaks(shop, { today: TODAY });
  assert.equal(r.leaks.length, 0);
});

test('variable bills on the same day each month are flagged without a fixed price', () => {
  const r = detectLeaks(monthly('CITY POWER PREPAID', 15, 5, [51000, 38000, 62000, 45000, 58000]), { today: TODAY });
  assert.equal(r.leaks.length, 1);
  assert.equal(r.leaks[0].fixed, false);
  assert.notEqual(r.leaks[0].confidence, 'high');
});

test('a charge that stopped is marked ended and left out of the totals', () => {
  const r = detectLeaks([...monthly('FOOBAR STUDIOS', 12, 3, 25000, 5), ...monthly('OTHER SHOP LAB', 20, 4, 10000, 10)], { today: TODAY });
  const old = r.leaks.find(l => l.label === 'Foobar Studios');
  assert.equal(old.ended, true);
  assert.equal(old.nextDate, null);
  assert.equal(r.summary.monthlyCents, 10000);
  assert.equal(summarise(r.leaks).count, 1);
});

test('a double charge raises an alert', () => {
  const r = detectLeaks([...monthly('SPOTIFY P1A2B3', 12, 4, 5999), { date: '2026-10-12', desc: 'SPOTIFY P1A2B3', cents: -5999 }], { today: TODAY });
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].type, 'double');
  assert.equal(r.leaks[0].doubles.length, 1);
});

test('a known service seen once is offered as worth a look, tiny amounts are ignored', () => {
  const r = detectLeaks(rows('NAMECHEAP.COM', ['2026-06-14'], 18900), { today: TODAY });
  assert.equal(r.leaks.length, 0);
  assert.equal(r.once[0].label, 'Namecheap');
  assert.equal(detectLeaks(monthly('PARKING METER', 3, 5, 300), { today: TODAY }).leaks.length, 0);
});

test('money coming in is never a leak', () => {
  const salary = Array.from({ length: 5 }, (_, i) => ({ date: `2026-0${5 + i}-25`, desc: 'SALARY ACME CORP', cents: 2800000 }));
  assert.equal(detectLeaks(salary, { today: TODAY }).leaks.length, 0);
});

test('month ends are handled', () => {
  assert.equal(addMonthsIso('2026-01-31', 1, 31), '2026-02-28');
  assert.equal(addMonthsIso('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addMonthsIso('2026-11-30', 3, 30), '2027-02-28');
  const r = detectLeaks(rows('FOOBAR STUDIOS', ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31'], 9900), { today: '2026-10-31' });
  assert.equal(r.leaks[0].nextDate, '2026-11-30');
});

test('the next 30 days list is in date order and weekly items repeat', () => {
  const r = detectLeaks([...monthly('FOOBAR STUDIOS', 25, 4, 25000, 9), ...rows('FOOBAR CLUB', ['2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21'], 5000)], { today: TODAY });
  const u = upcoming(r.leaks, TODAY, 30);
  assert.ok(u.length >= 5);
  assert.deepEqual(u.map(x => x.date), [...u.map(x => x.date)].sort());
  assert.equal(u.filter(x => x.label === 'Foobar Club').length, 4);
  assert.ok(u.every(x => x.date >= TODAY));
});

test('the demo statement finds the right leaks and no false alarms', () => {
  const parsed = parseStatement(demoStatement(TODAY));
  assert.ok(parsed.stats.count > 100);
  const r = detectLeaks(parsed.rows, { today: TODAY });
  const labels = r.leaks.map(l => l.label);
  for (const want of ['DStv', 'Netflix', 'Virgin Active', 'Spotify', 'Outsurance', 'Vodacom', 'Afrihost', 'Apple', 'YouTube Premium']) assert.ok(labels.includes(want), want);
  assert.equal(r.leaks.filter(l => l.label === 'Netflix').length, 1);
  assert.ok(r.leaks.find(l => l.label === 'Netflix').change);
  for (const shop of ['Woolworths Food', 'Pick N Pay', 'Checkers', 'Kfc', 'Uber Eats', 'Mr Price', 'Engen']) assert.ok(!labels.includes(shop), shop);
  assert.equal(r.alerts.filter(a => a.label === 'Spotify').length, 1);
  assert.ok(r.once.some(o => o.label === 'Namecheap'));
  assert.ok(r.summary.monthlyCents > 400000 && r.summary.monthlyCents < 600000);
});

test('detection is fast on a large statement', () => {
  const big = [];
  for (let i = 0; i < 20000; i++) big.push({ date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`, desc: `SHOP ${i % 400} CITY`, cents: -(1000 + (i * 37) % 9000) });
  const t = Date.now();
  detectLeaks(big, { today: TODAY });
  assert.ok(Date.now() - t < 3000);
});

test('rows with bad dates or amounts are skipped instead of crashing', () => {
  const r = detectLeaks([{ date: '2026-09-36', desc: 'X SHOP', cents: -5000 }, { date: 'nope', desc: 'X SHOP', cents: -5000 }, { date: '2026-09-01', desc: 'X SHOP', cents: NaN }, ...monthly('FOOBAR STUDIOS', 12, 3, 25000)], { today: TODAY });
  assert.equal(r.leaks.length, 1);
});
