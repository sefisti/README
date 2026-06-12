// Travel-time provider selection.
//
// The rest of the app only ever calls travelMinutes(origin, destination) and
// never knows which provider answered. To switch to the real Google Routes
// API, set GOOGLE_MAPS_API_KEY in the environment — no code changes needed.
// If the Google call fails (quota, network, bad address), we fall back to the
// mock estimate rather than blocking the booking flow.

const mock = require('./mock');
const google = require('./google');

const cache = new Map(); // simple per-process cache to limit API calls
const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKey(o, d) {
  const k = (l) =>
    Number.isFinite(l.lat) && Number.isFinite(l.lng)
      ? `${l.lat.toFixed(4)},${l.lng.toFixed(4)}`
      : (l.address || '').toLowerCase().trim();
  return `${k(o)}|${k(d)}`;
}

async function travelMinutes(origin, destination) {
  const key = cacheKey(origin, destination);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value;
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      value = await google.travelMinutes(origin, destination);
    } catch (err) {
      console.error(`[travel] Google Routes API failed, using mock: ${err.message}`);
      value = await mock.travelMinutes(origin, destination);
    }
  } else {
    value = await mock.travelMinutes(origin, destination);
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

function provider() {
  return process.env.GOOGLE_MAPS_API_KEY ? 'google-routes' : 'mock';
}

module.exports = { travelMinutes, provider };
