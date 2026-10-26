# Plan — BOM, wiring guide, exports, .robosim (FR-BOM-01/02 thin/03/04/05 partial, FR-PRJ-06)

Goal: from any project the user gets a parts list (priced from an admin price list, minus owned parts), an
ordered wiring guide grouped by subsystem with a mini diagram per step (printable), BOM CSV/XLSX, circuit SVG/PNG,
and `.robosim` zip import/export. All free on every plan. No shop/cart (FR-BOM-06), no PDF (needs export service).

## Steps
- [x] 1. Shared pure core (`packages/shared` or a new engine-free spot next to catalog/circuit-canvas):
      `buildBom(doc, catalog)` (parts by type+variant props, breadboards, inferred M-M / M-F jumpers in packs
      of 10 + 20 % spare, batteries), `wiringGuide(doc)` (CircuitNets, subsystem from manifest category,
      power/GND first, stable order), BOM/inventory/price zod contracts.
- [x] 2. Migration `0006_bom`: `catalog_prices` (part type + variant key → price_irr, stock_status,
      updated_at; read-only to app role) and `user_inventory` (user, part key, qty; RLS owner only).
- [x] 3. API: `GET /catalog/prices`, admin `GET/PUT /admin/catalog/prices` (audited), `GET/PUT /me/inventory`.
- [x] 4. Admin app: Prices page (list catalogue parts, edit price/stock).
- [x] 5. Web: editor panel tabs "Parts list" (owned toggles, totals, price-as-of, CSV/XLSX) and "Wiring"
      (steps with mini SVG per step, click → highlight wire on canvas); print route; guest inventory in
      localStorage merged on sign-in; circuit SVG/PNG export; `.robosim` zip export/import (fflate), legacy
      `.robosim.json` import kept. FA/EN, RTL.
- [ ] 6. Tests (shared unit, API HTTP, web, admin) and `pnpm verify` green.
- [x] 7. Docs: PRD/TD/API-Spec/Release-Plan/decisions, CLAUDE.md/README sync.

## Acceptance
- Line-follower demo: BOM lists Uno, L298N, 2× TT motor, chassis, line sensor, battery, breadboard if any,
  jumpers split M-M / M-F in packs; totals priced from the admin list; marking a part owned removes it from totals
  and persists (server when signed in, local for guests, merged on sign-in).
- Wiring guide: every wire appears exactly once, grouped Power → Motors & actuators → Sensors → …, each with
  "From → To, colour" text (FA/EN) and a diagram; printable.
- `.robosim` export → import round-trips the document (schema migrated/validated); old `.robosim.json` still imports.
- CSV opens in Excel with Persian intact; XLSX opens; SVG/PNG match the canvas.
- `pnpm verify` green.
