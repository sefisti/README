// Seed demo data for testing: 3 therapists and a day of bookings around
// Laguna/Cavite, including the Sta Rosa -> Carmona scenario from the brief.
// Usage: npm run seed   (safe to re-run; it only seeds an empty database)

const { db } = require('../src/db');
const { addMinutes } = require('../src/time');

const existing = db.prepare('SELECT COUNT(*) AS n FROM therapists').get();
if (existing.n > 0) {
  console.log('Database already has data — not seeding. Delete data/bookings.db to start fresh.');
  process.exit(0);
}

const insertT = db.prepare(
  'INSERT INTO therapists (name, work_start, work_end) VALUES (?, ?, ?)'
);
const t1 = insertT.run('Therapist 1 (Ana)', '14:00', '23:59').lastInsertRowid;
const t2 = insertT.run('Therapist 2 (Marco)', '14:00', '23:59').lastInsertRowid;
const t3 = insertT.run('Therapist 3 (Liza)', '16:00', '23:59').lastInsertRowid;

const today = new Date();
const p = (n) => String(n).padStart(2, '0');
const date = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;

const insertB = db.prepare(`
  INSERT INTO bookings
    (therapist_id, client_name, contact, address, service_type, duration_min,
     start_time, end_time, status, price)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
`);

function book(tid, client, contact, address, service, dur, time, price) {
  const start = `${date}T${time}`;
  insertB.run(tid, client, contact, address, service, dur, start, addMinutes(start, dur), price);
}

book(t1, 'Mrs. Reyes', '0917 555 1001', 'Avida Settings, Santa Rosa', 'Swedish', 90, '17:00', 600);
book(t1, 'J. Santos', '0917 555 1002', 'Camella Homes, Santa Rosa', 'Combination', 90, '20:00', 600);
book(t2, 'K. Lim', '0918 555 2001', 'Pacita Complex, San Pedro', 'Shiatsu', 60, '18:00', 500);
book(t2, 'B. Cruz', '0918 555 2002', 'Southview Homes, Biñan', 'Swedish', 120, '20:30', 750);
book(t3, 'D. Garcia', '0919 555 3001', 'Waltermart area, Carmona', 'Hot Stone', 90, '19:00', 700);

console.log(`Seeded 3 therapists and 5 bookings for ${date}.`);
console.log('Try the feasibility check: a 22:00 booking in Carmona.');
