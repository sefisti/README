# Serenova Wellness — Marketing Landing Page

A self-contained, single-file landing page (`index.html`) for Serenova Wellness,
the customer-facing counterpart to the internal booking dashboard in this repo.
No build step, no dependencies, no external requests — fonts are embedded, so it
works offline and can be dropped onto any static host (Netlify, Vercel, GitHub
Pages, Hostinger) as-is.

## Design system

### Color

| Token          | Hex       | Use                                                  |
| -------------- | --------- | ---------------------------------------------------- |
| `--forest`     | `#0F251D` | Primary page background                              |
| `--forest-deep`| `#0A1B15` | Sticky bar, "How It Works" & Trust bands, scrolled header |
| `--card`       | `#132E24` | Service cards, glass booking panel base              |
| `--gold`       | `#C5A059` | CTAs, borders, prices, icons — the only accent       |
| `--cream`      | `#EAE5D9` | Headlines and primary body text                      |
| `--sage`       | `#96AB9E` | Secondary/supporting text                            |

Gold is used exclusively for action and emphasis (buttons, prices, borders,
eyebrows) so it keeps its pull. Secondary text is muted sage rather than grey
to stay inside the green world.

### Typography

- **Display:** Cormorant Garamond 500/600 (+ italic) — headlines, service names,
  prices, step numbers. Chosen over Playfair for its taller, finer strokes that
  match the SERENOVA wordmark on the existing social cards.
- **Body/UI:** Montserrat 400–600 — body copy, buttons, labels. Uppercase
  labels get `letter-spacing: 0.12–0.24em`, echoing the card layouts.
- Both faces are subset (latin) and inlined as base64 `@font-face` data URIs.

### Page structure & conversion logic

1. **Sticky location bar** — "Now delivering wellness to Cabuyao • Sta. Rosa •
   Calamba • Biñan" — qualifies leads before they scroll.
2. **Header** — transparent over the hero, frosted dark green after 40px of
   scroll; persistent gold **Book Now** button.
3. **Hero** — "A Premium Spa Experience, At Your Doorstep." + same-day CTA,
   service-area subline, and three proof chips (from ₱499 / same-day /
   everything provided).
4. **Services** — two bordered series (Relaxation ×3, Therapeutic Relief ×4) in
   a 2-column grid. Dark slate-green cards, thin gold border that brightens and
   lifts on hover. Every card's **Book this →** pre-selects that service in the
   booking form and scrolls to it.
5. **How It Works** — 3-step strip on the deeper green band.
6. **Booking engine** — glassmorphism panel (blurred translucent green, gold
   border): Name, Contact, Preferred Massage (grouped by series, with prices),
   City (4 options), Date (min = today), Time slots. Submit composes the request
   and opens WhatsApp (`wa.me/639628570087`) pre-filled — zero-backend lead
   capture. Secondary Messenger / WhatsApp buttons for chat-first customers.
7. **Trust & Safety** — certified/vetted therapists, per-session sanitation,
   professional-conduct code, transparent pricing.
8. **Footer** + persistent **floating Messenger FAB** (bottom-right).

### Behavior

- Scroll-reveal via `IntersectionObserver`; fully disabled under
  `prefers-reduced-motion` (as are smooth scrolling and hover transforms).
- Single-theme by design: the dark forest-green world *is* the brand, so the
  page does not switch with OS light/dark mode.
- Responsive: grids collapse at 980/860/760/520px; no horizontal scroll at
  390px.

## Wiring it up later

- **Form to a real backend:** replace the `submit` handler at the bottom of
  `index.html` — it currently builds a WhatsApp message. Point it at
  `POST /api/bookings` on the dashboard server (or any form service) when ready.
- **Messenger handle:** links use the placeholder `m.me/SerenovaWellness`;
  update to the page's real username once confirmed.
