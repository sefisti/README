// Google Maps Platform Routes API (computeRouteMatrix) travel-time provider.
// Activated automatically when GOOGLE_MAPS_API_KEY is set — see ./index.js.
//
// Docs: https://developers.google.com/maps/documentation/routes/calculate_route_matrix
//
// The Routes API accepts either coordinates or free-text addresses as
// waypoints, so bookings without geocoded coordinates still work.

const ENDPOINT = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

function toWaypoint(loc) {
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
    return {
      waypoint: {
        location: { latLng: { latitude: loc.lat, longitude: loc.lng } }
      }
    };
  }
  return { waypoint: { address: loc.address } };
}

// origin/destination: { address, lat?, lng? }
// Returns { minutes, source }.
async function travelMinutes(origin, destination) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is not set');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition'
    },
    body: JSON.stringify({
      origins: [toWaypoint(origin)],
      destinations: [toWaypoint(destination)],
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE'
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Routes API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const rows = await res.json();
  const el = Array.isArray(rows) ? rows[0] : null;
  if (!el || el.condition !== 'ROUTE_EXISTS' || !el.duration) {
    throw new Error(`Routes API returned no route: ${JSON.stringify(el)}`);
  }

  const seconds = parseInt(el.duration, 10); // duration is like '1234s'
  return { minutes: Math.ceil(seconds / 60), source: 'google-routes' };
}

module.exports = { travelMinutes };
