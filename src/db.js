const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'bookings.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS therapists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    work_start  TEXT NOT NULL DEFAULT '10:00',  -- HH:MM local
    work_end    TEXT NOT NULL DEFAULT '23:59',
    active      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    therapist_id  INTEGER NOT NULL REFERENCES therapists(id),
    client_name   TEXT NOT NULL,
    contact       TEXT,
    address       TEXT NOT NULL,
    lat           REAL,
    lng           REAL,
    service_type  TEXT NOT NULL,
    duration_min  INTEGER NOT NULL,
    start_time    TEXT NOT NULL,  -- 'YYYY-MM-DDTHH:MM' local time
    end_time      TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed','in_progress','completed','cancelled')),
    notes         TEXT,
    price         REAL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_therapist_start
    ON bookings (therapist_id, start_time);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
  // Extra slack added on top of the raw travel estimate.
  buffer_min: '10', // flat minutes
  buffer_pct: '20'  // percentage of the travel estimate
};

const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return {
    buffer_min: Number(out.buffer_min ?? DEFAULT_SETTINGS.buffer_min),
    buffer_pct: Number(out.buffer_pct ?? DEFAULT_SETTINGS.buffer_pct)
  };
}

function setSettings(patch) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const key of ['buffer_min', 'buffer_pct']) {
    if (patch[key] !== undefined) upsert.run(key, String(Number(patch[key])));
  }
  return getSettings();
}

module.exports = { db, getSettings, setSettings };
