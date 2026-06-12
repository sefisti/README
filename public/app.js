/* Booking dashboard frontend. Plain JS, no build step. */

const $ = (sel) => document.querySelector(sel);

const KNOWN_AREAS = [
  'Santa Rosa', 'Carmona', 'Biñan', 'San Pedro', 'Cabuyao', 'Calamba',
  'GMA', 'Silang', 'Dasmariñas', 'Bacoor', 'Imus', 'Muntinlupa',
  'Alabang', 'Las Piñas', 'Tagaytay'
];

const STATUS_LABELS = {
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

const state = {
  date: new Date().toISOString().slice(0, 10),
  schedule: null,
  selectedTherapist: null // chosen via feasibility check in the booking form
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------------- helpers ---------------- */

function timeOf(dt) { return dt.slice(11, 16); }

function friendly(dt) {
  const [h, m] = timeOf(dt).split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function minutesOf(dt) {
  const [h, m] = timeOf(dt).split(':').map(Number);
  return h * 60 + m;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// Normalize a <input type="date"> value to 'YYYY-MM-DD'. Browsers that
// support the date input always return this format, but some browsers
// (older Safari, some Android webviews) fall back to a plain text field
// where users may type 'M/D/YYYY' etc. Returns null if unparseable.
function normalizeDate(raw) {
  const v = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(v);
  if (m) {
    const [, a, b, year] = m;
    // Assume M/D/YYYY (common fallback locale); pad to 2 digits.
    return `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  }
  return null;
}

// Normalize a <input type="time"> value to 24-hour 'HH:MM'. Standards-
// compliant browsers always return this, but text-input fallbacks may give
// '10:00 PM', '9:00', etc. Returns null if unparseable.
function normalizeTime(raw) {
  const v = String(raw || '').trim();
  if (/^\d{2}:\d{2}$/.test(v)) return v;
  // Allow an optional :SS (some browsers' time pickers include seconds).
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(v);
  if (!m) return null;
  let [, h, min, ampm] = m;
  h = Number(h);
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12;
    if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
  }
  if (h > 23 || Number(min) > 59) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function shiftDate(days) {
  const d = new Date(state.date + 'T12:00');
  d.setDate(d.getDate() + days);
  state.date = d.toISOString().slice(0, 10);
  refresh();
}

/* ---------------- schedule / timeline ---------------- */

async function refresh() {
  $('#datePicker').value = state.date;
  state.schedule = await api(`/api/schedule?date=${state.date}`);
  renderProviderBadge();
  renderTimeline();
  renderList();
}

function renderProviderBadge() {
  const el = $('#providerBadge');
  const mock = state.schedule.travel_provider !== 'google-routes';
  el.textContent = mock ? 'travel: estimated (mock)' : 'travel: Google Maps';
  el.classList.toggle('mock', mock);
}

function timelineWindow() {
  let start = Infinity, end = -Infinity;
  for (const row of state.schedule.therapists) {
    for (const b of row.bookings) {
      if (b.status === 'cancelled') continue;
      start = Math.min(start, minutesOf(b.start_time));
      end = Math.max(end, minutesOf(b.end_time));
    }
  }
  if (!Number.isFinite(start)) { start = 10 * 60; end = 22 * 60; }
  if (end - start < 6 * 60) end = start + 6 * 60; // keep blocks readable
  start = Math.max(0, Math.floor(start / 60) * 60 - 60);
  end = Math.min(24 * 60, Math.ceil(end / 60) * 60 + 60);
  return { start, end };
}

function renderTimeline() {
  const root = $('#timeline');
  const { therapists } = state.schedule;
  if (!therapists.length) {
    root.innerHTML = '<div class="tl-empty">No therapists yet — add one via the “Therapists” button.</div>';
    return;
  }

  const { start, end } = timelineWindow();
  const span = end - start;
  const pct = (min) => ((min - start) / span) * 100;

  let axis = '<div class="tl-axis"><div></div><div class="tl-axis-inner">';
  for (let h = Math.ceil(start / 60); h <= Math.floor(end / 60); h++) {
    const label = h === 24 ? '12am' : h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`;
    axis += `<span class="tl-axis-label" style="left:${pct(h * 60)}%">${label}</span>`;
  }
  axis += '</div></div>';

  let rows = '';
  for (const { therapist: t, bookings, legs } of therapists) {
    let blocks = '';
    for (const b of bookings) {
      const left = pct(minutesOf(b.start_time));
      const width = Math.max(1.5, pct(minutesOf(b.end_time)) - left);
      blocks += `<button class="tl-block ${b.status}" data-id="${b.id}"
        style="left:${left}%;width:${width}%"
        title="${esc(b.client_name)} · ${esc(b.address)} · ${friendly(b.start_time)}–${friendly(b.end_time)}">
        <b>${friendly(b.start_time)} ${esc(b.client_name)}</b><span>${esc(b.address)}</span>
      </button>`;
    }
    const byId = Object.fromEntries(bookings.map((b) => [b.id, b]));
    for (const leg of legs) {
      const from = byId[leg.from_id];
      const left = pct(minutesOf(from.end_time));
      const width = ((leg.travel_min + leg.buffer_min) / span) * 100;
      blocks += `<div class="tl-travel ${leg.tight ? 'tight' : ''}"
        style="left:${left}%;width:${width}%"
        title="Travel ${leg.travel_min} min + buffer ${leg.buffer_min} min${leg.tight ? ' — NOT ENOUGH TIME' : ` (${leg.slack_min} min spare)`}"></div>`;
    }
    rows += `<div class="tl-row">
      <div class="tl-name">${esc(t.name)}<small>${t.work_start}–${t.work_end}</small></div>
      <div class="tl-lane" style="--hour-w:${(60 / span) * 100}%">${blocks}</div>
    </div>`;
  }

  root.innerHTML = `<div class="tl-grid">${axis}${rows}</div>`;
  root.querySelectorAll('.tl-block').forEach((el) =>
    el.addEventListener('click', () => openDetail(Number(el.dataset.id)))
  );
}

function allBookings() {
  return state.schedule.therapists.flatMap((r) =>
    r.bookings.map((b) => ({ ...b, therapist_name: r.therapist.name }))
  );
}

function renderList() {
  const bookings = allBookings().sort((a, b) => a.start_time.localeCompare(b.start_time));
  $('#listTitle').textContent = `Bookings — ${state.date} (${bookings.length})`;
  const root = $('#bookingList');
  if (!bookings.length) {
    root.innerHTML = '<p class="hint">No bookings for this day.</p>';
    return;
  }
  root.innerHTML = bookings.map((b) => `
    <div class="bk-card ${b.status}" data-id="${b.id}">
      <span class="status-pill">${STATUS_LABELS[b.status]}</span>
      <div class="when">${friendly(b.start_time)}–${friendly(b.end_time)}</div>
      <div class="who">${esc(b.client_name)} · ${esc(b.service_type)} ${b.duration_min}min</div>
      <div class="meta">${esc(b.therapist_name)} · ${esc(b.address)}${b.contact ? ' · ' + esc(b.contact) : ''}</div>
    </div>`).join('');
  root.querySelectorAll('.bk-card').forEach((el) =>
    el.addEventListener('click', () => openDetail(Number(el.dataset.id)))
  );
}

/* ---------------- booking form + feasibility ---------------- */

function openBookingModal(existing) {
  state.selectedTherapist = null;
  $('#bookingForm').reset();
  $('#feasResults').innerHTML = '';
  $('#bookingError').textContent = '';
  $('#saveBookingBtn').disabled = true;
  $('#bookingModalTitle').textContent = existing ? 'Edit booking' : 'New booking';
  $('#bk_id').value = existing ? existing.id : '';
  $('#bk_date').value = existing ? existing.start_time.slice(0, 10) : state.date;
  if (existing) {
    $('#bk_client').value = existing.client_name;
    $('#bk_contact').value = existing.contact || '';
    $('#bk_address').value = existing.address;
    $('#bk_service').value = existing.service_type;
    $('#bk_duration').value = existing.duration_min;
    $('#bk_time').value = timeOf(existing.start_time);
    $('#bk_price').value = existing.price ?? '';
    $('#bk_notes').value = existing.notes || '';
  }
  $('#bookingModal').showModal();
}

// Returns the form data with a normalized start_time, or null in
// start_time if the date/time fields couldn't be parsed.
function bookingFormPayload() {
  const date = normalizeDate($('#bk_date').value);
  const time = normalizeTime($('#bk_time').value);
  return {
    client_name: $('#bk_client').value.trim(),
    contact: $('#bk_contact').value.trim(),
    address: $('#bk_address').value.trim(),
    service_type: $('#bk_service').value.trim(),
    duration_min: Number($('#bk_duration').value),
    start_time: date && time ? `${date}T${time}` : null,
    price: $('#bk_price').value.trim(),
    notes: $('#bk_notes').value.trim()
  };
}

async function checkFeasibility() {
  const err = $('#bookingError');
  err.textContent = '';
  const p = bookingFormPayload();
  if (!p.address || !$('#bk_date').value || !$('#bk_time').value) {
    err.textContent = 'Fill in address, date and start time first.';
    return;
  }
  if (!p.start_time) {
    err.textContent = 'Date or start time isn\'t in a recognized format. ' +
      'Try entering the date as YYYY-MM-DD and the time as HH:MM (e.g. 22:00 or 10:00 PM).';
    return;
  }
  const btn = $('#checkFeasBtn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const editingId = $('#bk_id').value;
    const data = await api('/api/feasibility', {
      method: 'POST',
      body: {
        address: p.address,
        start_time: p.start_time,
        duration_min: p.duration_min,
        exclude_booking_id: editingId ? Number(editingId) : undefined
      }
    });
    renderFeasResults(data);
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check who can take it';
  }
}

function renderFeasResults(data) {
  const root = $('#feasResults');
  state.selectedTherapist = null;
  $('#saveBookingBtn').disabled = true;

  if (!data.results.length) {
    root.innerHTML = '<p class="hint">No active therapists — add one first.</p>';
    return;
  }
  const summary = data.feasible_count
    ? `<p class="hint">✅ ${data.feasible_count} therapist(s) can take this — pick one:</p>`
    : '<p class="hint">❌ Nobody can take this slot:</p>';

  root.innerHTML = summary + data.results.map((r) => {
    const slackBits = [];
    if (r.gaps.before) slackBits.push(`needs to leave previous client by ${friendly(r.gaps.before.leave_by)} (travel ${r.gaps.before.travel_min}m + buffer ${r.gaps.before.buffer_min}m)`);
    if (r.gaps.after) slackBits.push(`would reach next client with ${r.gaps.after.slack_min} min to spare`);
    if (r.feasible) {
      return `<label class="feas-item ok">
        <input type="radio" name="feasTherapist" value="${r.therapist_id}">
        <span><span class="fname">${esc(r.therapist_name)} ✓</span><br>
        <span class="fslack">${slackBits.length ? esc(slackBits.join(' · ')) : 'free at that time'}</span></span>
      </label>`;
    }
    return `<div class="feas-item no">
      <span><span class="fname">${esc(r.therapist_name)} ✗</span><br>
      <span class="freason">${r.reasons.map(esc).join('<br>')}</span></span>
    </div>`;
  }).join('');

  root.querySelectorAll('input[name=feasTherapist]').forEach((radio) =>
    radio.addEventListener('change', () => {
      state.selectedTherapist = Number(radio.value);
      $('#saveBookingBtn').disabled = false;
    })
  );
}

async function saveBooking(e) {
  e.preventDefault();
  const err = $('#bookingError');
  err.textContent = '';
  if (!state.selectedTherapist) {
    err.textContent = 'Run the feasibility check and pick a therapist first.';
    return;
  }
  const p = { ...bookingFormPayload(), therapist_id: state.selectedTherapist };
  try {
    const id = $('#bk_id').value;
    if (id) await api(`/api/bookings/${id}`, { method: 'PATCH', body: p });
    else await api('/api/bookings', { method: 'POST', body: p });
    $('#bookingModal').close();
    state.date = p.start_time.slice(0, 10);
    refresh();
  } catch (e2) {
    err.textContent = e2.message;
  }
}

/* ---------------- booking detail ---------------- */

let detailBooking = null;

function openDetail(id) {
  detailBooking = allBookings().find((b) => b.id === id);
  if (!detailBooking) return;
  const b = detailBooking;
  $('#detailBody').innerHTML = `
    <div class="when">${friendly(b.start_time)}–${friendly(b.end_time)} · ${esc(b.therapist_name)}</div>
    <p><span class="label">Client</span><br>${esc(b.client_name)}${b.contact ? ` · <a href="tel:${esc(b.contact)}">${esc(b.contact)}</a>` : ''}</p>
    <p><span class="label">Address</span><br>${esc(b.address)}</p>
    <p><span class="label">Service</span><br>${esc(b.service_type)} — ${b.duration_min} min${b.price != null ? ` — ₱${b.price}` : ''}</p>
    ${b.notes ? `<p><span class="label">Notes</span><br>${esc(b.notes)}</p>` : ''}
  `;
  $('#statusActions').innerHTML = Object.entries(STATUS_LABELS).map(([k, label]) =>
    `<button data-status="${k}" class="${b.status === k ? 'active' : ''}">${label}</button>`
  ).join('');
  $('#statusActions').querySelectorAll('button').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/api/bookings/${b.id}`, { method: 'PATCH', body: { status: btn.dataset.status } });
      $('#detailModal').close();
      refresh();
    })
  );
  $('#detailModal').showModal();
}

/* ---------------- therapists ---------------- */

async function openTherapists() {
  const list = await api('/api/therapists');
  $('#therapistList').innerHTML = list.length
    ? list.map((t) => `
        <div class="th-row" data-id="${t.id}">
          <span class="th-name">${esc(t.name)}${t.active ? '' : ' (inactive)'}</span>
          <label class="th-hours-label">From
            <input type="time" class="th-start" value="${t.work_start}">
          </label>
          <label class="th-hours-label">Until
            <input type="time" class="th-end" value="${t.work_end}">
          </label>
          <button class="ghost-btn th-save">Save</button>
          <button class="ghost-btn th-toggle" data-active="${t.active}">
            ${t.active ? 'Deactivate' : 'Activate'}
          </button>
          <span class="th-saved hint"></span>
        </div>`).join('')
    : '<p class="hint">No therapists yet.</p>';

  $('#therapistList').querySelectorAll('.th-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.th-save').addEventListener('click', async () => {
      const saved = row.querySelector('.th-saved');
      // normalizeTime handles text-input fallbacks like '02:00 PM'.
      const work_start = normalizeTime(row.querySelector('.th-start').value);
      const work_end = normalizeTime(row.querySelector('.th-end').value);
      if (!work_start || !work_end) {
        saved.textContent = 'Times must be HH:MM (e.g. 14:00 or 2:00 PM)';
        return;
      }
      try {
        await api(`/api/therapists/${id}`, { method: 'PATCH', body: { work_start, work_end } });
        saved.textContent = 'Saved ✓';
        setTimeout(() => { saved.textContent = ''; }, 1500);
        refresh();
      } catch (e) {
        saved.textContent = e.message;
      }
    });
    row.querySelector('.th-toggle').addEventListener('click', async (e) => {
      await api(`/api/therapists/${id}`, {
        method: 'PATCH',
        body: { active: e.target.dataset.active === '1' ? 0 : 1 }
      });
      openTherapists();
      refresh();
    });
  });
  $('#therapistModal').showModal();
}

/* ---------------- settings ---------------- */

async function openSettings() {
  const s = await api('/api/settings');
  $('#set_min').value = s.buffer_min;
  $('#set_pct').value = s.buffer_pct;
  updateBufferExample();
  $('#settingsModal').showModal();
}

function updateBufferExample() {
  const min = Number($('#set_min').value) || 0;
  const pct = Number($('#set_pct').value) || 0;
  const example = Math.round(min + (30 * pct) / 100);
  $('#bufferExample').textContent =
    `Example: a 30-minute drive gets ${example} min of buffer → ${30 + example} min total.`;
}

/* ---------------- wiring ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  $('#knownAreas').innerHTML = KNOWN_AREAS.map((a) => `<option value="${a}">`).join('');

  $('#datePicker').addEventListener('change', (e) => { state.date = e.target.value; refresh(); });
  $('#prevDay').addEventListener('click', () => shiftDate(-1));
  $('#nextDay').addEventListener('click', () => shiftDate(1));
  $('#todayBtn').addEventListener('click', () => {
    state.date = new Date().toISOString().slice(0, 10);
    refresh();
  });

  $('#newBookingBtn').addEventListener('click', () => openBookingModal(null));
  $('#checkFeasBtn').addEventListener('click', checkFeasibility);
  $('#bookingForm').addEventListener('submit', saveBooking);

  // Re-check required when timing inputs change after a successful check.
  for (const id of ['bk_address', 'bk_date', 'bk_time', 'bk_duration']) {
    $('#' + id).addEventListener('change', () => {
      state.selectedTherapist = null;
      $('#saveBookingBtn').disabled = true;
      $('#feasResults').innerHTML = '<p class="hint">Details changed — run the check again.</p>';
    });
  }

  $('#editBookingBtn').addEventListener('click', () => {
    $('#detailModal').close();
    if (detailBooking) openBookingModal(detailBooking);
  });
  $('#deleteBookingBtn').addEventListener('click', async () => {
    if (!detailBooking) return;
    if (!confirm(`Delete booking for ${detailBooking.client_name}?`)) return;
    await api(`/api/bookings/${detailBooking.id}`, { method: 'DELETE' });
    $('#detailModal').close();
    refresh();
  });

  $('#therapistsBtn').addEventListener('click', openTherapists);
  $('#therapistForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const work_start = normalizeTime($('#th_start').value);
    const work_end = normalizeTime($('#th_end').value);
    if (!work_start || !work_end) {
      alert('Working hours must be HH:MM (e.g. 14:00 or 2:00 PM).');
      return;
    }
    await api('/api/therapists', {
      method: 'POST',
      body: { name: $('#th_name').value, work_start, work_end }
    });
    $('#th_name').value = '';
    openTherapists();
    refresh();
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#set_min').addEventListener('input', updateBufferExample);
  $('#set_pct').addEventListener('input', updateBufferExample);
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/settings', {
      method: 'PUT',
      body: { buffer_min: Number($('#set_min').value), buffer_pct: Number($('#set_pct').value) }
    });
    $('#settingsModal').close();
    refresh();
  });

  document.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => btn.closest('dialog').close())
  );

  refresh().catch((e) => alert('Failed to load: ' + e.message));
});
