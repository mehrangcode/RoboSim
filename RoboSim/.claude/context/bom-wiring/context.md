# Context — BOM, wiring guide, exports, .robosim

Status: 2026-10-26 — `pnpm verify` green (turbo --concurrency=2) after fixing 5 web lint errors
(use-bom-data set-state-in-effect / ref-in-render / dynamic delete, bom-panel literal, type import).
Web suite flaked once under parallel load, passes alone 133/133. Browser check of the BOM tabs (FA/EN, print, PNG)
still not done (2026-10-26 guided-projects browser pass covered /learn and the Guide only). Previously: Step 6 open: last full `pnpm verify` run was killed
(system low on memory). Prior run: format + i18n gates fixed; only failure was the existing admin test
"FR-ADM-06 workspaces…" (findByRole timeout under parallel load); admin suite passes alone 12/12 twice.
Browser check (FA/EN, print, PNG export) not done.

Built so far:
- `packages/circuit-canvas/src/bom.ts` (`buildBom`, `priceBom`, `connectorOf`/`jumperOf`) and `wiring.ts`
  (`wiringGuide`, `stepFocus`, `stripOf`); tests `bom.test.ts` (8).
- `variantPropsOf` in `@robosim/catalog/manifests`; part keys/jumper/board keys + contracts in `shared/src/bom-api.ts`.
- Table is `catalog_prices` (not catalog_products); `user_inventory` RLS owner-only. Staff permission `prices`
  (platform_admin, finance, shop_operator).
- API module `apps/api/src/modules/bom`: GET /catalog/prices (public), GET/PUT /me/inventory, admin
  GET /admin/catalog/prices, PUT/DELETE /admin/catalog/prices/:partKey (audited); test/bom.test.ts (6).
- Admin `/prices` page + nav (permission-aware); 2 tests.
- Web: dock tabs "Parts list"/"Wiring" (`apps/web/src/bom/*`), `.robosim` zip via fflate 0.8.2
  (`editor/project-file.ts`), CSV/XLSX/SVG/PNG exports, print sheet + `window.print()` (not a route);
  i18n namespace `bom`; dynamic-key prefixes registered. Docs + ADR-024 written.

User decisions (2026-10-25):
- Prices: admin-editable `catalog_products` price list (price IRR, stock status, "price as of"); shop builds on it later.
- Owned parts: server `user_inventory` per user (RLS) + localStorage for guests, merged on sign-in.
- Wiring guide: mini read-only SVG per step (wire highlighted), printable; click step → highlight on canvas.
- Exports in this slice: `.robosim` zip (fflate), BOM CSV (UTF-8 BOM), BOM XLSX, circuit SVG/PNG. PDF deferred.
- Jumpers: infer from connector kind — socket/terminal take a male end, header a female end, a part's own lead
  (battery, TT motor, stepper, switch) needs no jumper; M-M / M-F / F-F; packs of 10 + 20 % spare.
- UI: editor panel tabs "Parts list" / "Wiring" + print route.
- Subsystems derived from manifest `category` (no new manifest field); power/GND wires first within a group.
- All exports free on every plan (only future PDF needs `export.pdf`).

Facts (from code survey):
- ProjectDocument v4 (`packages/shared/src/project-schema.ts`); wires `{id, from, to, color, points}`; variants = props.
- `CircuitNets` (`packages/circuit-canvas/src/nets.ts`) is engine-free union-find over the doc.
- Catalog: `CATALOG_MANIFESTS`/`findManifest` in `packages/catalog/src/manifests.ts`; names via i18n `components:<nameKey>`.
- Import today: web parses JSON → `POST /projects`; export `downloadJson` in `apps/web/src/editor/project-store.ts`.
- Next migration: `0006_*`.

Blockers: none.
