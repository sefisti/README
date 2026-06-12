const path = require('path');
const fs = require('fs');
const express = require('express');

// Minimal .env loader (KEY=VALUE lines) so no dotenv dependency is needed.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const { db, getSettings, setSettings } = require('./src/db');
const { checkTherapist, scheduleLegs } = require('./src/feasibility');
const { addMinutes } = require('./src/time');
const travel = require('./src/travel');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['confirmed', 'in_progress', 'completed', 'cancelled'];

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

// ---------- therapists ----------

app.get('/api/therapists', (req, res) => {
  res.json(db.prepare('SELECT * FROM therapists ORDER BY name').all());
});

// Working hours are compared lexicographically as `${day}T${HH:MM}` in the
// feasibility checks, so they must be strict zero-padded 24h HH:MM.
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateWorkHours(work_start, work_end) {
  if (!HM_RE.test(work_start)) return 'work_start must be HH:MM (24-hour, e.g. 14:00)';
  if (!HM_RE.test(work_end)) return 'work_end must be HH:MM (24-hour, e.g. 23:59)';
  if (work_end <= work_start) return 'work_end must be after work_start';
  return null;
}

app.post('/api/therapists', (req, res) => {
  const { name, work_start = '10:00', work_end = '23:59' } = req.body || {};
  if (!name || !String(name).trim()) return badRequest(res, 'name is required');
  const hoursErr = validateWorkHours(work_start, work_end);
  if (hoursErr) return badRequest(res, hoursErr);
  const info = db
    .prepare('INSERT INTO therapists (name, work_start, work_end) VALUES (?, ?, ?)')
    .run(String(name).trim(), work_start, work_end);
  res.status(201).json(db.prepare('SELECT * FROM therapists WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/therapists/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM therapists WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'therapist not found' });
  const { name = t.name, work_start = t.work_start, work_end = t.work_end, active = t.active } = req.body || {};
  const hoursErr = validateWorkHours(work_start, work_end);
  if (hoursErr) return badRequest(res, hoursErr);
  db.prepare('UPDATE therapists SET name = ?, work_start = ?, work_end = ?, active = ? WHERE id = ?')
    .run(name, work_start, work_end, active ? 1 : 0, t.id);
  res.json(db.prepare('SELECT * FROM therapists WHERE id = ?').get(t.id));
});

// ---------- bookings ----------

function validateBookingBody(b) {
  if (!b) return 'missing body';
  if (!b.client_name || !String(b.client_name).trim()) return 'client_name is required';
  if (!b.address || !String(b.address).trim()) return 'address is required';
  if (!b.service_type) return 'service_type is required';
  const dur = Number(b.duration_min);
  if (!Number.isInteger(dur) || dur < 15 || dur > 480) return 'duration_min must be 15–480 minutes';
  if (!DT_RE.test(b.start_time || '')) return 'start_time must be YYYY-MM-DDTHH:MM';
  return null;
}

app.get('/api/bookings', (req, res) => {
  const { date, therapist_id } = req.query;
  let sql = 'SELECT * FROM bookings WHERE 1=1';
  const params = [];
  if (date) {
    if (!DATE_RE.test(date)) return badRequest(res, 'date must be YYYY-MM-DD');
    sql += ' AND start_time >= ? AND start_time < ?';
    params.push(`${date}T00:00`, `${date}T24:00`);
  }
  if (therapist_id) {
    sql += ' AND therapist_id = ?';
    params.push(therapist_id);
  }
  sql += ' ORDER BY start_time';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/bookings', (req, res) => {
  const b = req.body;
  const err = validateBookingBody(b);
  if (err) return badRequest(res, err);
  if (!b.therapist_id) return badRequest(res, 'therapist_id is required');
  const t = db.prepare('SELECT * FROM therapists WHERE id = ?').get(b.therapist_id);
  if (!t) return badRequest(res, 'unknown therapist_id');

  const end_time = addMinutes(b.start_time, Number(b.duration_min));
  const info = db.prepare(`
    INSERT INTO bookings
      (therapist_id, client_name, contact, address, lat, lng, service_type,
       duration_min, start_time, end_time, status, notes, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
  `).run(
    t.id, String(b.client_name).trim(), b.contact || null, String(b.address).trim(),
    Number.isFinite(b.lat) ? b.lat : null, Number.isFinite(b.lng) ? b.lng : null,
    b.service_type, Number(b.duration_min), b.start_time, end_time,
    b.notes || null, b.price != null && b.price !== '' ? Number(b.price) : null
  );
  res.status(201).json(db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/bookings/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'booking not found' });
  const b = { ...existing, ...req.body };

  if (req.body.status && !STATUSES.includes(req.body.status)) {
    return badRequest(res, `status must be one of ${STATUSES.join(', ')}`);
  }
  const err = validateBookingBody(b);
  if (err) return badRequest(res, err);

  const end_time = addMinutes(b.start_time, Number(b.duration_min));
  db.prepare(`
    UPDATE bookings SET
      therapist_id = ?, client_name = ?, contact = ?, address = ?, lat = ?, lng = ?,
      service_type = ?, duration_min = ?, start_time = ?, end_time = ?,
      status = ?, notes = ?, price = ?
    WHERE id = ?
  `).run(
    b.therapist_id, b.client_name, b.contact || null, b.address,
    Number.isFinite(b.lat) ? b.lat : null, Number.isFinite(b.lng) ? b.lng : null,
    b.service_type, Number(b.duration_min), b.start_time, end_time,
    b.status, b.notes || null, b.price != null && b.price !== '' ? Number(b.price) : null,
    existing.id
  );
  res.json(db.prepare('SELECT * FROM bookings WHERE id = ?').get(existing.id));
});

app.delete('/api/bookings/:id', (req, res) => {
  const info = db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'booking not found' });
  res.status(204).end();
});

// ---------- schedule (timeline view data) ----------

app.get('/api/schedule', asyncRoute(async (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || '')) return badRequest(res, 'date must be YYYY-MM-DD');

  const settings = getSettings();
  const therapists = db
    .prepare('SELECT * FROM therapists WHERE active = 1 ORDER BY name')
    .all();
  const rows = db
    .prepare('SELECT * FROM bookings WHERE start_time >= ? AND start_time < ? ORDER BY start_time')
    .all(`${date}T00:00`, `${date}T24:00`);

  const out = [];
  for (const t of therapists) {
    const bookings = rows.filter((b) => b.therapist_id === t.id);
    const { legs } = await scheduleLegs(bookings, settings);
    out.push({ therapist: t, bookings, legs });
  }
  res.json({ date, settings, travel_provider: travel.provider(), therapists: out });
}));

// ---------- feasibility ----------

app.post('/api/feasibility', asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!b.address || !String(b.address).trim()) return badRequest(res, 'address is required');
  if (!DT_RE.test(b.start_time || '')) return badRequest(res, 'start_time must be YYYY-MM-DDTHH:MM');
  const dur = Number(b.duration_min);
  if (!Number.isInteger(dur) || dur < 15 || dur > 480) return badRequest(res, 'duration_min must be 15–480 minutes');

  const proposed = {
    address: String(b.address).trim(),
    lat: Number.isFinite(b.lat) ? b.lat : undefined,
    lng: Number.isFinite(b.lng) ? b.lng : undefined,
    start_time: b.start_time,
    duration_min: dur
  };
  const date = b.start_time.slice(0, 10);
  const settings = getSettings();
  const therapists = db
    .prepare('SELECT * FROM therapists WHERE active = 1 ORDER BY name')
    .all();
  const rows = db
    .prepare('SELECT * FROM bookings WHERE start_time >= ? AND start_time < ? ORDER BY start_time')
    .all(`${date}T00:00`, `${date}T24:00`);

  const results = [];
  for (const t of therapists) {
    const ignoreId = Number(b.exclude_booking_id) || null; // when editing an existing booking
    const bookings = rows.filter((x) => x.therapist_id === t.id && x.id !== ignoreId);
    const check = await checkTherapist(t, bookings, proposed, settings);
    results.push({ therapist_id: t.id, therapist_name: t.name, ...check });
  }
  res.json({
    proposed,
    travel_provider: travel.provider(),
    feasible_count: results.filter((r) => r.feasible).length,
    results
  });
}));

// ---------- settings ----------

app.get('/api/settings', (req, res) => {
  res.json({ ...getSettings(), travel_provider: travel.provider() });
});

app.put('/api/settings', (req, res) => {
  const { buffer_min, buffer_pct } = req.body || {};
  if (buffer_min !== undefined && (!Number.isFinite(Number(buffer_min)) || Number(buffer_min) < 0)) {
    return badRequest(res, 'buffer_min must be a non-negative number');
  }
  if (buffer_pct !== undefined && (!Number.isFinite(Number(buffer_pct)) || Number(buffer_pct) < 0)) {
    return badRequest(res, 'buffer_pct must be a non-negative number');
  }
  res.json({ ...setSettings({ buffer_min, buffer_pct }), travel_provider: travel.provider() });
});

// ---------- errors ----------

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Booking dashboard running at http://localhost:${PORT}`);
    console.log(`Travel-time provider: ${travel.provider()}`);
  });
}

module.exports = app;
