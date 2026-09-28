# IntegrityLens

A local academic integrity review workspace that explains textual overlap through passage evidence and interactive algorithm traces. Similarity does not establish intent or authorship. This app does not detect AI-generated text.

## Run immediately

Requires Node.js 22.12+ (verified with Node 24) and npm. From this folder:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. No Docker, Supabase credentials, external services, or login are required. Demo mode is the default. The first visit starts with fictional documents and no fabricated analysis results; choose **Run analysis** to compute them.

```sh
npm run build
npm test
npm run typecheck
npm run lint
npx playwright install chromium
npm run test:browser
```

Production assets are written to `frontend/dist`. A static host must route unmatched page requests to `index.html` for React Router.

## Run with Docker

Docker Compose builds a production Nginx image in demo mode by default:

```sh
docker compose up --build -d
```

Open **http://127.0.0.1:8080**. Stop it with `docker compose down`.

For Vite hot reload inside a development container:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

To connect the production image to Supabase, copy `docker.env.example` to `.env`, set `VITE_DATA_ADAPTER=supabase` plus the public URL, anonymous key, and assignment ID, then rebuild with `docker compose up --build -d`. Vite embeds these public settings at image build time. Never put a Supabase service-role key in this file.

In Supabase mode, the application requires a real email/password Auth session, restores
it on reload, and reads the trusted application role from the backend. Demo-role controls
appear only in local demo mode. Missing hosted configuration is reported before any
backend request is attempted.

For a fully local backend, run `npm run supabase:start` first. It starts the official Supabase Docker services from `backend/supabase`; use `http://127.0.0.1:54321` as `VITE_SUPABASE_URL`, then build the web image. Hosted Supabase also works and does not require the local backend containers.

## Working flows

- Paste text or import individually validated UTF-8 `.txt` files as submissions, references, or assignment templates.
- Compare documents in a cancellable Web Worker with measured pair progress; inspect exact, shingle, and fuzzy components.
- Use side-by-side evidence, linked passage highlights, scroll synchronization, minimaps, word-level LCS differences, and J/K passage navigation.
- Inspect quote/reference/template exclusions; adjust discounts and score weights, then recompute.
- Explore a Cytoscape network, connected components, a minimum spanning forest, and shortest paths derived from real results.
- Record reviewer notes and move cases through New → Under review → Needs discussion → Resolved → Closed. Every transition needs a note; resolution requires justification.
- Print evidence/reports or download escaped standalone HTML including score settings, passages, exclusions, notes, and limitations.
- Step through eleven actual engine implementations in Algorithm Lab. Use light, dark, or system theme, responsive navigation, and a guided tour.

## Storage and safety of interpretation

Documents, cases, and completed results live in this browser's IndexedDB. Only small preferences use localStorage. Data may disappear when site storage is cleared. Reset requires confirmation and affects only IntegrityLens. Use one workspace tab at a time; concurrent tabs are not synchronized.

All built-in content is fictional. Demo roles illustrate workflows and are **not security boundaries**. Reviewer mode hides author labels, but local data remains inspectable. Case history is mutable browser storage, not an immutable audit trail. Quotations, citations, templates, and permitted collaboration always require human context.

## Architecture and bounds

React + TypeScript + Vite + React Router, plain CSS tokens, Cytoscape.js, and npm workspaces. `frontend` contains the UI, adapters, browser worker, and teaching corpus. `backend/supabase` contains the database and Edge Functions. `packages/engine` is browser-independent TypeScript, and `packages/shared` contains contracts used by both sides. Engine restrictions are enforced by lint and an AST checker.

Imports are capped at 20 KB, 1,200 words, and 30 documents. Analysis considers up to 60 passages per document, 128 tokens per fuzzy comparison, and 80 matches per pair. Results disclose truncation. The English-oriented tokenizer, lexical thresholds, conservative exclusions, asymmetric candidate selection, and weighted coverage are documented in [architecture](docs/architecture.md). Identical documents need not score 100 because only the exact component contributes. Scores are never misconduct probabilities.

## Supabase backend

`backend/supabase/migrations` contains the schema, hardened grants and RLS, private bucket, consistency triggers, Auth profile provisioning, and service-only transactional procedures. Two deployable Edge Functions provide the authenticated API and a cancellable, chained analysis worker. Reports and document downloads use short-lived signed URLs; browser clients never receive service-role credentials.

The backend passes Deno type checking and a Docker-free PostgreSQL migration/RLS smoke harness. It has not been deployed to or verified against a real Supabase project because no project credentials were provided. See [backend integration](docs/backend-integration.md) for deployment, endpoints, initial instructor provisioning, browser configuration, role boundaries, and the required hosted verification matrix.

See [implementation checklist](docs/checklist.md) and [verification](docs/verification.md).
For hosted staging, follow [staging deployment](docs/staging-deployment.md), then record
the results in the [hosted verification checklist](docs/hosted-verification.md).
