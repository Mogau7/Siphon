'use strict';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = n => String(n).padStart(2, '0');

function demoStatement(todayIso) {
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const rand = rng(7);
  const rows = [];
  const add = (y, m, d, desc, rand_) => {
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    rows.push({ date: `${y}-${pad(m)}-${pad(Math.min(d, dim))}`, desc, cents: rand_ });
  };
  for (let back = 5; back >= 0; back--) {
    const total = ty * 12 + (tm - 1) - back;
    const y = Math.floor(total / 12), m = (total % 12) + 1;
    add(y, m, 25, 'SALARY ACME CORP', 2800000);
    add(y, m, 1, 'DSTV DEBIT ORDER', -54900);
    add(y, m, 3, 'NETFLIX.COM', back >= 2 ? -16900 : -19900);
    add(y, m, 7, 'AFRIHOST FIBRE 0000123', -89900);
    add(y, m, 12, 'SPOTIFY P1A2B3C4D', -5999);
    if (back === 1) add(y, m, 12, 'SPOTIFY P1A2B3C4D', -5999);
    if (back <= 3) add(y, m, 9, 'GOOGLE *YouTube Premium', -7999);
    add(y, m, 15, 'FNB APP PREPAID AIRTIME', -Math.round((50 + rand() * 90)) * 100);
    add(y, m, 17, 'APPLE.COM/BILL', -2999);
    add(y, m, 20, 'VODACOM CONTRACT 0821234567', -59900);
    add(y, m, 25, 'VIRGIN ACTIVE JHB DEBIT ORDER', -49900);
    add(y, m, 28, 'OUTSURANCE DEBIT ORDER 99812', -115000);
    const shops = ['WOOLWORTHS FOOD', 'PICK N PAY', 'CHECKERS', 'SHELL ULTRA CITY', 'ENGEN', 'UBER *EATS', 'KFC', 'CLICKS PHARMACY', 'TAKEALOT.COM', 'MR PRICE'];
    const count = 14 + Math.floor(rand() * 6);
    for (let i = 0; i < count; i++) add(y, m, 1 + Math.floor(rand() * 28), shops[Math.floor(rand() * shops.length)], -Math.round((60 + rand() * 900)) * 100 / 1);
    if (back === 3) add(y, m, 14, 'NAMECHEAP.COM', -18900);
  }
  const kept = rows.filter(r => r.date <= todayIso).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let balance = 31500_00;
  const lines = ['Date,Description,Amount,Balance'];
  for (const r of kept) {
    balance += r.cents;
    lines.push(`${r.date},"${r.desc}",${(r.cents / 100).toFixed(2)},${(balance / 100).toFixed(2)}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = { demoStatement };
