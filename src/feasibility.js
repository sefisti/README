// Feasibility checking: can a therapist take a new booking given travel time
// from their previous booking and to their next one?

const { travelMinutes } = require('./travel');
const { addMinutes, diffMinutes, dateOf, timeOf, friendlyTime } = require('./time');

const ACTIVE_STATUSES = ['confirmed', 'in_progress', 'completed'];

// Buffer applied on top of the raw travel estimate.
function bufferFor(travelMin, settings) {
  return Math.round(settings.buffer_min + (travelMin * settings.buffer_pct) / 100);
}

// Short label for a location in human-readable messages: the part of the
// address after the last comma usually names the town ("Blk 3, Carmona").
function placeLabel(address) {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'their previous location';
}

/**
 * Check whether one therapist can take a proposed booking.
 *
 * @param {object} therapist  { id, name, work_start, work_end }
 * @param {array}  bookings   that therapist's bookings on the same date
 *                            (any status; cancelled ones are ignored here)
 * @param {object} proposed   { address, lat?, lng?, start_time, duration_min }
 * @param {object} settings   { buffer_min, buffer_pct }
 * @returns {object} { feasible, reasons: [string], gaps: {...} }
 */
async function checkTherapist(therapist, bookings, proposed, settings) {
  const reasons = [];
  const gaps = {};
  const newStart = proposed.start_time;
  const newEnd = addMinutes(newStart, proposed.duration_min);

  // Working hours.
  const day = dateOf(newStart);
  const workStart = `${day}T${therapist.work_start}`;
  const workEnd = `${day}T${therapist.work_end}`;
  if (newStart < workStart || newEnd > workEnd) {
    reasons.push(
      `${therapist.name} works ${friendlyTime(workStart)}–${friendlyTime(workEnd)}; ` +
      `this booking (${friendlyTime(newStart)}–${friendlyTime(newEnd)}) falls outside that.`
    );
  }

  const active = bookings
    .filter((b) => ACTIVE_STATUSES.includes(b.status))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  // Direct overlap with an existing booking.
  const overlap = active.find((b) => b.start_time < newEnd && b.end_time > newStart);
  if (overlap) {
    reasons.push(
      `${therapist.name} already has ${overlap.client_name} ` +
      `${friendlyTime(overlap.start_time)}–${friendlyTime(overlap.end_time)} at that time.`
    );
    return { feasible: false, reasons, gaps };
  }

  const prev = [...active].reverse().find((b) => b.end_time <= newStart);
  const next = active.find((b) => b.start_time >= newEnd);

  if (prev) {
    const { minutes: travel, source } = await travelMinutes(
      { address: prev.address, lat: prev.lat, lng: prev.lng },
      { address: proposed.address, lat: proposed.lat, lng: proposed.lng }
    );
    const buffer = bufferFor(travel, settings);
    const leaveBy = addMinutes(newStart, -(travel + buffer));
    gaps.before = {
      booking_id: prev.id,
      travel_min: travel,
      buffer_min: buffer,
      leave_by: leaveBy,
      slack_min: diffMinutes(prev.end_time, leaveBy),
      source
    };
    if (prev.end_time > leaveBy) {
      reasons.push(
        `${therapist.name} would need to leave ${placeLabel(prev.address)} by ` +
        `${friendlyTime(leaveBy)} (${travel} min travel + ${buffer} min buffer) — ` +
        `currently booked until ${friendlyTime(prev.end_time)}.`
      );
    }
  }

  if (next) {
    const { minutes: travel, source } = await travelMinutes(
      { address: proposed.address, lat: proposed.lat, lng: proposed.lng },
      { address: next.address, lat: next.lat, lng: next.lng }
    );
    const buffer = bufferFor(travel, settings);
    const arriveBy = addMinutes(newEnd, travel + buffer);
    gaps.after = {
      booking_id: next.id,
      travel_min: travel,
      buffer_min: buffer,
      earliest_arrival: arriveBy,
      slack_min: diffMinutes(arriveBy, next.start_time),
      source
    };
    if (arriveBy > next.start_time) {
      reasons.push(
        `Taking this would make ${therapist.name} reach ${next.client_name} in ` +
        `${placeLabel(next.address)} around ${friendlyTime(arriveBy)} ` +
        `(${travel} min travel + ${buffer} min buffer) — that booking starts at ` +
        `${friendlyTime(next.start_time)}.`
      );
    }
  }

  return { feasible: reasons.length === 0, reasons, gaps };
}

/**
 * Compute travel info between consecutive bookings for the schedule view.
 * Mutates nothing; returns an array parallel to `bookings` (sorted by start)
 * where entry i describes the leg from booking i to booking i+1.
 */
async function scheduleLegs(bookings, settings) {
  const sorted = bookings
    .filter((b) => ACTIVE_STATUSES.includes(b.status))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const legs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const { minutes: travel, source } = await travelMinutes(
      { address: from.address, lat: from.lat, lng: from.lng },
      { address: to.address, lat: to.lat, lng: to.lng }
    );
    const buffer = bufferFor(travel, settings);
    const gap = diffMinutes(from.end_time, to.start_time);
    legs.push({
      from_id: from.id,
      to_id: to.id,
      travel_min: travel,
      buffer_min: buffer,
      gap_min: gap,
      slack_min: gap - travel - buffer,
      tight: gap < travel + buffer,
      source
    });
  }
  return { sorted, legs };
}

module.exports = { checkTherapist, scheduleLegs, bufferFor, ACTIVE_STATUSES };
