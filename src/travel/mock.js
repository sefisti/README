// Mock travel-time estimator, used until the Google Maps Routes API is set up.
//
// Strategy:
//  1. If both locations have coordinates (or their address mentions a known
//     town from the gazetteer below), estimate straight-line distance and
//     assume an average door-to-door speed.
//  2. Otherwise fall back to a fixed estimate.
//
// This module implements the same interface as ./google.js so the rest of
// the app never needs to know which one is in use.

const AVG_SPEED_KMH = 28;      // conservative door-to-door average incl. local roads
const ROAD_FACTOR = 1.4;       // straight-line -> actual road distance
const FIXED_OVERHEAD_MIN = 5;  // parking, finding the unit, loading the car
const FALLBACK_MIN = 25;       // when we know nothing about either location

// Rough centroids of towns in the service area (Laguna / Cavite / south Metro
// Manila). Used to geocode free-text addresses like "Blk 3 Lot 5, Carmona".
const GAZETTEER = {
  'santa rosa': { lat: 14.3122, lng: 121.1114 },
  'sta rosa': { lat: 14.3122, lng: 121.1114 },
  'sta. rosa': { lat: 14.3122, lng: 121.1114 },
  'carmona': { lat: 14.3167, lng: 121.0575 },
  'binan': { lat: 14.3424, lng: 121.0803 },
  'biñan': { lat: 14.3424, lng: 121.0803 },
  'san pedro': { lat: 14.3595, lng: 121.0473 },
  'cabuyao': { lat: 14.2726, lng: 121.1262 },
  'calamba': { lat: 14.2117, lng: 121.1653 },
  'gma': { lat: 14.2972, lng: 120.9447 },
  'general mariano alvarez': { lat: 14.2972, lng: 120.9447 },
  'silang': { lat: 14.2306, lng: 120.9747 },
  'dasmarinas': { lat: 14.3294, lng: 120.9367 },
  'dasmariñas': { lat: 14.3294, lng: 120.9367 },
  'bacoor': { lat: 14.4624, lng: 120.9645 },
  'imus': { lat: 14.4297, lng: 120.9367 },
  'muntinlupa': { lat: 14.4081, lng: 121.0415 },
  'alabang': { lat: 14.4193, lng: 121.0413 },
  'las pinas': { lat: 14.4445, lng: 120.9939 },
  'las piñas': { lat: 14.4445, lng: 120.9939 },
  'tagaytay': { lat: 14.1153, lng: 120.9621 }
};

function coordsFor(loc) {
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
    return { lat: loc.lat, lng: loc.lng };
  }
  const addr = (loc && loc.address ? loc.address : '').toLowerCase();
  for (const [town, coords] of Object.entries(GAZETTEER)) {
    if (addr.includes(town)) return coords;
  }
  return null;
}

function haversineKm(a, b) {
  const R = 6371;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// origin/destination: { address, lat?, lng? }
// Returns { minutes, source } like the Google implementation.
async function travelMinutes(origin, destination) {
  const a = coordsFor(origin);
  const b = coordsFor(destination);
  if (!a || !b) return { minutes: FALLBACK_MIN, source: 'mock-fallback' };

  const km = haversineKm(a, b) * ROAD_FACTOR;
  const minutes = Math.max(
    FIXED_OVERHEAD_MIN,
    Math.round((km / AVG_SPEED_KMH) * 60) + FIXED_OVERHEAD_MIN
  );
  return { minutes, source: 'mock-distance' };
}

module.exports = { travelMinutes, coordsFor, GAZETTEER };
