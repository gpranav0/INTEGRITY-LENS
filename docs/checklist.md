# Implementation checklist

- [x] New isolated IntegrityLens folder; npm workspaces; no existing project modified
- [x] React/TypeScript/Vite/Router and reusable plain-CSS tokens
- [x] Persistent Local demo indicator, fictional corpus, role selector without authentication claims
- [x] Landing, actual-data dashboard, document library and validated paste/file import
- [x] Worker analysis, measured progress, cancellation, saved settings snapshot
- [x] Engine ranking/search, component scores, formula and evidence counts
- [x] Evidence explorer, linked highlighting, scroll synchronization, toggles, minimaps, LCS differences, J/K, print
- [x] Quote/reference/template exclusion spans and engine recomputation
- [x] Real network, components, spanning forest, shortest paths, accessible node summaries
- [x] Sequential case lifecycle, notes, required resolution justification, timestamps and blind labels
- [x] Actual-data reports, browser print, escaped HTML download
- [x] Eleven engine-driven lab traces with editing/play/pause/steps/reset/speed
- [x] Theme preferences, help, guided tour, limits, confirmed app-only reset
- [x] IndexedDB persistence and small localStorage preferences
- [x] Custom engine structures and algorithms, scoped lint plus AST restriction checker
- [x] Typed demo and authenticated Supabase clients, service interfaces, and placeholder env files
- [x] Hardened schema, grants, RLS, private bucket, Auth provisioning, and assignment-consistency triggers
- [x] Authenticated Edge API, chained analysis worker, blind reviewer evidence, signed downloads, case RPCs, and append-only application history
- [x] Docker-free Deno checks and PostgreSQL migration/RLS smoke harness
- [ ] Live Supabase migration, Auth, gateway, Storage, and multi-role verification (requires a development project)
- [ ] Institutional SSO/MFA, retention, backups, monitoring, and project-owner audit controls (deployment work)
- [ ] Docker (explicitly excluded from this phase)

Verification outcomes are recorded in `verification.md`: lint, type checking, 28 unit tests, 7 browser tests, Edge Function checks, migration/RLS smoke checks, production build, WCAG scans, and dependency audit all pass.
