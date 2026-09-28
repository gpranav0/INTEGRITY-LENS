# Verification record

## 2026-09-24 hosted-readiness pass

Locally verified after adding Supabase authentication and hosted operation wiring:

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run lint` | Passed ESLint and the engine restriction checker |
| `npm test` | 5 files, 37 tests passed, including mocked session/sign-in/sign-out/expiry cases |
| `npm run check:backend` | Both Edge Functions passed Deno type checking |
| `npm run check:migrations` | Migrations and RLS smoke checks passed in PGlite |
| `npm run build` | Production Vite build passed |
| `npm run test:browser` | 7 demo-mode Playwright tests passed |
| `docker compose config` | Production Compose configuration valid |
| `docker compose -f compose.yaml -f compose.dev.yaml config` | Development configuration valid on port 5173 |
| `docker compose build` | Production Nginx image built successfully |
| `curl.exe http://127.0.0.1:8080/health` | Returned `ok`; container then stopped without deleting data |

The browser bundle contains no `SUPABASE_SERVICE_ROLE_KEY` identifier. No remote
migration, secret, function deployment, Auth mutation, or hosted-data operation was run.
Complete `hosted-verification.md` against a dedicated staging project before production.

Verified on 2026-09-21 with Node.js 24.14.1 and npm 11.11.0 on Windows.

| Command | Result |
|---|---|
| `npm install` | Completed successfully from the workspace root |
| `npm run lint` | Passed ESLint and the engine TypeScript-AST restriction checker |
| `npm test` | 4 files, 28 tests passed |
| `npm run build` | Passed TypeScript checking and the Vite production build |
| `npm run test:browser` | 7 Playwright tests passed in Chromium |
| `npm run check:backend` | Both Supabase Edge Functions passed Deno type checking |
| `npm run check:migrations` | Both migrations passed syntax, dependency, trigger, procedure, and RLS smoke checks in PostgreSQL |
| `npm audit --audit-level=moderate` | 0 known vulnerabilities |

The unit suite covers exact matchers against naive reference implementations, Z values, Aho–Corasick overlaps, LCS/edit-distance reference results and reconstructed alignment, fairness exclusions, score recomputation, deterministic corpus analysis, result limits, graph components/paths/forest/max-flow, custom data structures, real trace output, strict imports, IndexedDB persistence/reset, Supabase request validation, lifecycle ordering, and escaped local/server HTML reports.

The browser suite covers the full import → analysis → evidence → review decision → report-download lifecycle, reload persistence, individual invalid-file handling, confirmed app-only reset, all eleven Algorithm Lab implementations, the Cytoscape graph and accessible relationship list, light/dark/system themes, worker cancellation without partial result replacement, J/K evidence navigation, blind-review labels, required resolution justification, mobile navigation and horizontal-overflow checks at 360 px, keyboard focus, and every populated page under automated WCAG 2 A/AA and 2.1 AA checks in both light and dark themes.

Desktop and 360 px screenshots were inspected in `docs/screenshots`. The layouts remained readable and usable, and the final color pass removed the automated contrast findings. Browser printing is implemented with print-specific styles; standalone reports use escaped HTML.

The Vite build produced separate application, React, Cytoscape graph, and analysis-worker assets. React Router emits benign build-time notices about ignored `"use client"` directives; the build exits successfully.

The Supabase schema, hardened RLS/grants, private Storage model, authenticated API, analysis worker, blind case evidence, signed URLs, and append-only application history are implemented. Hosted Auth, API gateway, Storage, and multi-role behavior remain unverified until deployed to a real development project. Docker was not installed, started, reset, or required.
