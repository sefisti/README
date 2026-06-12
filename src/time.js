// All times in the app are local-time strings: 'YYYY-MM-DDTHH:MM'.
// This is a single-timezone internal tool, so we avoid UTC conversions
// entirely and do arithmetic on minutes.

const DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseDT(s) {
  const m = DT_RE.exec(s);
  if (!m) throw new Error(`Invalid datetime '${s}', expected YYYY-MM-DDTHH:MM`);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

function formatDT(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
         `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function addMinutes(dt, minutes) {
  const d = parseDT(dt);
  d.setMinutes(d.getMinutes() + minutes);
  return formatDT(d);
}

// Difference b - a in minutes.
function diffMinutes(a, b) {
  return Math.round((parseDT(b) - parseDT(a)) / 60000);
}

function dateOf(dt) {
  return dt.slice(0, 10);
}

function timeOf(dt) {
  return dt.slice(11, 16);
}

// '21:10' -> '9:10pm' for human-readable feasibility messages.
function friendlyTime(dt) {
  const [h, m] = timeOf(dt).split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

module.exports = { parseDT, formatDT, addMinutes, diffMinutes, dateOf, timeOf, friendlyTime };
