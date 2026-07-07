# Mobile Massage Booking Dashboard

Internal dashboard for managing door-to-door massage bookings across multiple
therapists, with automatic travel-time feasibility checks ("can Therapist A
finish in Sta Rosa and still make the 10pm booking in Carmona?").

Also in this repo: the customer-facing **Serenova Wellness landing page**
(`landing/index.html`) — a self-contained static page (no build step, no
dependencies) with the service menu and pricing, WhatsApp/Messenger booking
gateways, and a web booking form. Open it directly in a browser or host it
on any static file host.

## Quick start

```bash
npm install
npm run seed   # optional: demo therapists + bookings for today
npm start      # http://localhost:3000
```

Requires Node.js 18+. Data is stored in a local SQLite file (`data/bookings.db`)
— no database server needed. Back it up by copying that file.

## What it does

- **Timeline per therapist** — each day's bookings as blocks, with the
  travel + buffer time to the next booking shown as a striped tail (red if
  the gap is too tight).
- **New booking form** — client, contact, address, service, duration, time,
  price, notes.
- **Feasibility check** — "Check who can take it" tests every active
  therapist: travel from their previous booking, travel to their next one,
  working hours, and overlaps. Infeasible therapists get a plain-English
  reason, e.g. *"Ana would need to leave Santa Rosa by 9:10pm (35 min travel
  + 17 min buffer) — currently booked until 9:30pm."* You pick the therapist
  from the feasible list, so a booking can never be saved onto an impossible
  slot.
- **Status tracking** — confirmed → in progress → completed / cancelled,
  changed from the booking detail view.
- **Buffer settings** — slack added on top of travel estimates
  (flat minutes + % of travel time), adjustable under "⚙ Buffer".
- **Therapist management** — add therapists with working hours,
  activate/deactivate.

Works on phones — the layout collapses to single-column and the timeline
scrolls horizontally.

## Travel times: mock now, Google Maps later

All travel-time lookups go through one function,
`src/travel/index.js → travelMinutes(origin, destination)`. Two providers
implement the same interface:

| Provider | File | When used |
|---|---|---|
| Mock estimator | `src/travel/mock.js` | Default (no API key) |
| Google Routes API (`computeRouteMatrix`) | `src/travel/google.js` | When `GOOGLE_MAPS_API_KEY` is set |

The **mock** recognizes town names in the service area (Sta Rosa, Carmona,
Biñan, San Pedro, Cabuyao, Calamba, GMA, Silang, Dasmariñas, Bacoor, Imus,
Muntinlupa, Alabang, Las Piñas, Tagaytay — see `GAZETTEER` in
`src/travel/mock.js` to add more), estimates road distance between them, and
assumes a conservative 28 km/h door-to-door average. Unknown addresses fall
back to a flat 25-minute estimate. The UI shows a yellow
"travel: estimated (mock)" badge so staff always know estimates aren't live
traffic data.

### Switching to the real Google Routes API

1. Follow the Google Cloud setup guide (project + billing + enable
   **Routes API** + create an API key restricted to the Routes API).
2. Copy `.env.example` to `.env` and set `GOOGLE_MAPS_API_KEY=...`.
3. Restart the server. The badge switches to "travel: Google Maps".

No code changes needed. The Google provider uses `TRAFFIC_AWARE` routing and
accepts free-text addresses, so existing bookings without coordinates keep
working. If a Google call fails (quota, network, unresolvable address), the
app logs the error and falls back to the mock estimate instead of blocking
the booking flow. Results are cached in memory for 10 minutes to limit API
usage.

## How the feasibility check works

For a requested time + location, for each active therapist on that date:

1. **Overlap** — rejected if an existing (non-cancelled) booking overlaps.
2. **Getting there** — `previous booking end + travel + buffer ≤ new start`,
   otherwise it reports the required leave-by time vs. when they're booked
   until.
3. **Getting away** — `new end + travel + buffer ≤ next booking start`,
   otherwise it reports when they'd actually reach the next client.
4. **Working hours** — the booking must fit inside the therapist's hours.

Buffer = flat minutes + percentage of the travel estimate (default
10 min + 20%), configurable in the UI.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/schedule?date=YYYY-MM-DD` | Timeline data: therapists, bookings, travel legs |
| POST | `/api/feasibility` | `{address, start_time, duration_min}` → per-therapist verdicts |
| GET/POST | `/api/bookings` | List (filter by `date`, `therapist_id`) / create |
| PATCH/DELETE | `/api/bookings/:id` | Update (incl. `status`) / delete |
| GET/POST/PATCH | `/api/therapists` | Manage therapists |
| GET/PUT | `/api/settings` | Buffer settings |

Times are local-time strings (`YYYY-MM-DDTHH:MM`) throughout — the tool is
single-timezone by design.

## Tests

```bash
npm test
```

Covers time arithmetic, the mock estimator, all feasibility rules (including
the Sta Rosa → Carmona example from the brief), and an end-to-end API flow.

## Project layout

```
server.js              Express app + API routes
src/db.js              SQLite schema + settings
src/time.js            Local-time helpers
src/feasibility.js     Feasibility rules + schedule travel legs
src/travel/index.js    Provider selection + caching (the only import the app uses)
src/travel/mock.js     Distance-based mock estimator + town gazetteer
src/travel/google.js   Google Routes API computeRouteMatrix client
public/                Frontend (no build step)
scripts/seed.js        Demo data
test/                  Node test-runner tests
```

## Roadmap (from the project brief)

Next up, roughly in order: time-of-day buffer rules (rush-hour multiplier),
start/end session actions that recalculate the day from actual times, map
view with color-coded pins, client notifications, driver view with
navigation links, and booking history (actual vs. estimated) for tuning
buffers.
