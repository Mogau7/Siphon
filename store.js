'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STATUSES = ['watching', 'keep', 'cut', 'ignore'];

class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'R');
      CREATE TABLE IF NOT EXISTS leaks (
        vid TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL, category TEXT NOT NULL, cadence TEXT NOT NULL, cadence_label TEXT NOT NULL,
        amount_cents INTEGER NOT NULL, monthly_cents INTEGER NOT NULL, count INTEGER NOT NULL, first_date TEXT, last_date TEXT, next_date TEXT,
        fixed INTEGER NOT NULL, confidence TEXT NOT NULL, change_json TEXT, ended INTEGER NOT NULL DEFAULT 0, doubles_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'watching', source TEXT NOT NULL DEFAULT 'scan', created INTEGER NOT NULL, updated INTEGER NOT NULL,
        PRIMARY KEY (vid, id));
      CREATE TABLE IF NOT EXISTS onces (vid TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL, category TEXT NOT NULL, cents INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY (vid, id));
    `);
    this.q = {
      visitor: this.db.prepare('SELECT * FROM visitors WHERE id = ?'),
      newVisitor: this.db.prepare('INSERT OR IGNORE INTO visitors (id, created, last_seen) VALUES (?, ?, ?)'),
      touch: this.db.prepare('UPDATE visitors SET last_seen = ? WHERE id = ?'),
      setCurrency: this.db.prepare('UPDATE visitors SET currency = ? WHERE id = ?'),
      leaks: this.db.prepare('SELECT * FROM leaks WHERE vid = ? ORDER BY ended ASC, monthly_cents DESC, label ASC'),
      leak: this.db.prepare('SELECT * FROM leaks WHERE vid = ? AND id = ?'),
      upsert: this.db.prepare(`INSERT INTO leaks (vid, id, label, category, cadence, cadence_label, amount_cents, monthly_cents, count, first_date, last_date, next_date, fixed, confidence, change_json, ended, doubles_json, source, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scan', ?, ?)
        ON CONFLICT (vid, id) DO UPDATE SET label = excluded.label, category = excluded.category, cadence = excluded.cadence, cadence_label = excluded.cadence_label,
          amount_cents = excluded.amount_cents, monthly_cents = excluded.monthly_cents, count = excluded.count, first_date = excluded.first_date, last_date = excluded.last_date,
          next_date = excluded.next_date, fixed = excluded.fixed, confidence = excluded.confidence, change_json = excluded.change_json, ended = excluded.ended,
          doubles_json = excluded.doubles_json, updated = excluded.updated`),
      manual: this.db.prepare(`INSERT INTO leaks (vid, id, label, category, cadence, cadence_label, amount_cents, monthly_cents, count, first_date, last_date, next_date, fixed, confidence, ended, source, created, updated)
        VALUES (?, ?, ?, 'Added by you', ?, ?, ?, ?, 1, NULL, NULL, ?, 1, 'high', 0, 'manual', ?, ?)`),
      status: this.db.prepare('UPDATE leaks SET status = ?, updated = ? WHERE vid = ? AND id = ?'),
      del: this.db.prepare('DELETE FROM leaks WHERE vid = ? AND id = ?'),
      delLeaks: this.db.prepare('DELETE FROM leaks WHERE vid = ?'),
      delOnces: this.db.prepare('DELETE FROM onces WHERE vid = ?'),
      delVisitor: this.db.prepare('DELETE FROM visitors WHERE id = ?'),
      onces: this.db.prepare('SELECT * FROM onces WHERE vid = ? ORDER BY cents DESC'),
      upsertOnce: this.db.prepare('INSERT OR REPLACE INTO onces (vid, id, label, category, cents, date) VALUES (?, ?, ?, ?, ?, ?)'),
      count: this.db.prepare("SELECT COUNT(*) AS n FROM leaks WHERE vid = ? AND ended = 0 AND status != 'ignore'"),
      stale: this.db.prepare('SELECT id FROM visitors WHERE last_seen < ?'),
    };
  }

  close() { this.db.close(); }

  visitor(id, now) {
    this.q.newVisitor.run(id, now, now);
    this.q.touch.run(now, id);
    return this.q.visitor.get(id);
  }

  setCurrency(id, cur) { this.q.setCurrency.run(cur, id); }

  saveScan(vid, result, now) {
    this.db.exec('BEGIN');
    try {
      for (const l of result.leaks) {
        this.q.upsert.run(vid, l.id, l.label, l.category, l.cadence, l.cadenceLabel, l.amountCents, l.monthlyCents, l.count, l.firstDate, l.lastDate, l.nextDate,
          l.fixed ? 1 : 0, l.confidence, l.change ? JSON.stringify(l.change) : null, l.ended ? 1 : 0, JSON.stringify(l.doubles || []), now, now);
      }
      for (const o of result.once) this.q.upsertOnce.run(vid, o.id, o.label, o.category, o.cents, o.date);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  hydrate(row) {
    return {
      id: row.id, label: row.label, category: row.category, cadence: row.cadence, cadenceLabel: row.cadence_label, amountCents: row.amount_cents,
      monthlyCents: row.monthly_cents, annualCents: row.monthly_cents * 12, count: row.count, firstDate: row.first_date, lastDate: row.last_date, nextDate: row.next_date,
      fixed: !!row.fixed, confidence: row.confidence, change: row.change_json ? JSON.parse(row.change_json) : null, ended: !!row.ended,
      doubles: JSON.parse(row.doubles_json), status: row.status, source: row.source,
    };
  }

  leaks(vid) { return this.q.leaks.all(vid).map(r => this.hydrate(r)); }
  onces(vid) { return this.q.onces.all(vid); }
  activeCount(vid) { return this.q.count.get(vid).n; }

  setStatus(vid, id, status, now) {
    if (!STATUSES.includes(status)) return false;
    return this.q.status.run(status, now, vid, id).changes === 1;
  }

  addManual(vid, id, item, now) { this.q.manual.run(vid, id, item.label, item.cadence, item.cadenceLabel, item.amountCents, item.monthlyCents, item.nextDate, now, now); }
  remove(vid, id) { return this.q.del.run(vid, id).changes === 1; }

  clear(vid) {
    this.q.delLeaks.run(vid);
    this.q.delOnces.run(vid);
    this.q.delVisitor.run(vid);
  }

  purge(olderThan) {
    let n = 0;
    for (const row of this.q.stale.all(olderThan)) { this.clear(row.id); n++; }
    return n;
  }
}

module.exports = { Store, STATUSES };
