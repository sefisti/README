const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'booking-test-')
);
delete process.env.GOOGLE_MAPS_API_KEY; // force the mock provider in tests

const { checkTherapist } = require('../src/feasibility');
const { addMinutes, diffMinutes, friendlyTime } = require('../src/time');
const mock = require('../src/travel/mock');

const settings = { buffer_min: 10, buffer_pct: 20 };
const therapist = { id: 1, name: 'Ana', work_start: '08:00', work_end: '23:59' };

function booking(over) {
  const start = over.start_time;
  return {
    id: over.id || 1,
    therapist_id: 1,
    client_name: over.client_name || 'Client',
    address: over.address,
    lat: null,
    lng: null,
    status: over.status || 'confirmed',
    duration_min: over.duration_min || 90,
    start_time: start,
    end_time: addMinutes(start, over.duration_min || 90),
    ...over
  };
}

test('time helpers', () => {
  assert.equal(addMinutes('2026-06-12T23:30', 90), '2026-06-13T01:00');
  assert.equal(diffMinutes('2026-06-12T20:00', '2026-06-12T21:30'), 90);
  assert.equal(friendlyTime('2026-06-12T21:10'), '9:10pm');
  assert.equal(friendlyTime('2026-06-12T00:05'), '12:05am');
});

test('mock travel uses gazetteer distance between known towns', async () => {
  const r = await mock.travelMinutes(
    { address: 'Subdivision X, Santa Rosa' },
    { address: 'Blk 1, Carmona' }
  );
  assert.equal(r.source, 'mock-distance');
  assert.ok(r.minutes >= 10 && r.minutes <= 40, `got ${r.minutes}`);
});

test('mock travel falls back to fixed estimate for unknown addresses', async () => {
  const r = await mock.travelMinutes({ address: 'somewhere' }, { address: 'elsewhere' });
  assert.equal(r.source, 'mock-fallback');
  assert.equal(r.minutes, 25);
});

test('free therapist with no bookings is feasible', async () => {
  const res = await checkTherapist(therapist, [], {
    address: 'Carmona', start_time: '2026-06-12T22:00', duration_min: 90
  }, settings);
  assert.equal(res.feasible, true);
});

test('the Sta Rosa -> Carmona example: enough gap is feasible', async () => {
  // Booked 8:00–9:30pm in Sta Rosa; new request 10:00pm in Carmona is ~30min
  // gap. Travel Sta Rosa->Carmona is ~20min mock + buffer ~14 -> too tight.
  const bookings = [booking({ address: 'Santa Rosa', start_time: '2026-06-12T20:00' })];
  const tight = await checkTherapist(therapist, bookings, {
    address: 'Carmona', start_time: '2026-06-12T22:00', duration_min: 90
  }, settings);
  assert.equal(tight.feasible, false);
  assert.match(tight.reasons[0], /would need to leave/);
  assert.match(tight.reasons[0], /booked until 9:30pm/);

  // A 10:15pm request leaves a 45-minute gap, enough for ~23min travel
  // + ~15min buffer, and still ends within working hours — feasible.
  const ok = await checkTherapist(therapist, bookings, {
    address: 'Carmona', start_time: '2026-06-12T22:15', duration_min: 90
  }, settings);
  assert.equal(ok.feasible, true);
  assert.ok(ok.gaps.before.slack_min >= 0);
});

test('rejects when the next booking becomes unreachable', async () => {
  const bookings = [booking({
    id: 2, client_name: 'Next Client', address: 'Calamba',
    start_time: '2026-06-12T21:00'
  })];
  const res = await checkTherapist(therapist, bookings, {
    address: 'Bacoor', start_time: '2026-06-12T18:30', duration_min: 90
  }, settings);
  assert.equal(res.feasible, false);
  assert.match(res.reasons[0], /reach Next Client/);
});

test('rejects overlapping bookings', async () => {
  const bookings = [booking({ address: 'Santa Rosa', start_time: '2026-06-12T20:00' })];
  const res = await checkTherapist(therapist, bookings, {
    address: 'Santa Rosa', start_time: '2026-06-12T20:30', duration_min: 60
  }, settings);
  assert.equal(res.feasible, false);
  assert.match(res.reasons[0], /already has/);
});

test('cancelled bookings are ignored', async () => {
  const bookings = [booking({
    address: 'Santa Rosa', start_time: '2026-06-12T20:00', status: 'cancelled'
  })];
  const res = await checkTherapist(therapist, bookings, {
    address: 'Santa Rosa', start_time: '2026-06-12T20:30', duration_min: 60
  }, settings);
  assert.equal(res.feasible, true);
});

test('respects working hours', async () => {
  const res = await checkTherapist(therapist, [], {
    address: 'Carmona', start_time: '2026-06-12T23:30', duration_min: 90
  }, settings);
  assert.equal(res.feasible, false);
  assert.match(res.reasons[0], /works/);
});

test('API: create booking and check feasibility end-to-end', async () => {
  const app = require('../server');
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    let res = await fetch(`${base}/api/therapists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test T', work_start: '08:00', work_end: '23:59' })
    });
    assert.equal(res.status, 201);
    const t = await res.json();

    res = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        therapist_id: t.id, client_name: 'C1', address: 'Santa Rosa',
        service_type: 'Swedish', duration_min: 90, start_time: '2026-06-12T20:00'
      })
    });
    assert.equal(res.status, 201);
    const b = await res.json();
    assert.equal(b.end_time, '2026-06-12T21:30');

    res = await fetch(`${base}/api/feasibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: 'Carmona', start_time: '2026-06-12T22:00', duration_min: 90
      })
    });
    const feas = await res.json();
    const mine = feas.results.find((r) => r.therapist_id === t.id);
    assert.equal(mine.feasible, false);
    assert.match(mine.reasons[0], /would need to leave/);

    res = await fetch(`${base}/api/schedule?date=2026-06-12`);
    const sched = await res.json();
    assert.equal(sched.travel_provider, 'mock');
    const row = sched.therapists.find((r) => r.therapist.id === t.id);
    assert.equal(row.bookings.length, 1);
  } finally {
    server.close();
  }
});
