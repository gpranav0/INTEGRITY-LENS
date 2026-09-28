# Supabase backend

The Supabase backend is implemented in migrations and two Edge Functions. It has been checked locally without Docker: both functions pass `deno check`, and both migrations apply in an in-process PostgreSQL runtime that exercises triggers, transactional procedures, grants, RLS visibility, case transitions, and append-only event permissions. A live Supabase project is still required to verify hosted Auth, Storage, API gateway behavior, and production policy behavior.

## Components

- `001_integritylens_design.sql` creates the core academic-review relations and private Storage bucket.
- `002_backend_api.sql` adds document versions/hashes, analysis snapshots, job error/cancellation state, private RLS helpers, strict grants, consistency triggers, Auth profile provisioning, service-only transactional procedures, and the final policies.
- `integrity-api` is the browser-facing authenticated function. Supabase gateway JWT verification stays enabled, and the function validates the user again before any work.
- `integrity-worker` accepts only the injected service key, processes three document pairs per invocation, saves monotonic progress, checks cancellation between pairs, and chains the next batch with `EdgeRuntime.waitUntil`. Its gateway JWT check is disabled because it is a service-to-service function; its own constant-time key check is mandatory.
- `SupabaseBackendClient` is the typed browser client. It obtains the real Supabase session and calls operation-specific endpoints. Demo roles never become authentication credentials.

Dependencies are pinned exactly in each function's `deno.json`. The browser package also pins `@supabase/supabase-js`.

## Deploy without Docker

Install dependencies and run every offline check first:

```sh
npm install
npm run lint
npm test
npm run check:backend
npm run check:migrations
npm run build
```

The exact staged deployment sequence, including a separate migration preview, is in
[`staging-deployment.md`](staging-deployment.md). Do not deploy from the combined
`supabase:deploy` convenience script until the preview has been reviewed.

Authenticate and link the CLI to a dedicated Supabase development project:

```sh
npx supabase login
npx supabase --workdir backend link --project-ref YOUR_PROJECT_REF
npx supabase --workdir backend secrets set INTEGRITYLENS_ALLOWED_ORIGINS=https://your-app.example
npm run supabase:deploy
```

`supabase:deploy` runs `db push` and deploys the worker before the authenticated API. Function deployment uses `--use-api`; it does not require Docker. The built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. Never copy the service-role key into a Vite variable, browser bundle, log, or committed file.

The committed `backend/supabase/.env.example` contains only the optional allowed-origin setting. Use a comma-separated list for multiple application origins. When configured, disallowed browser origins receive no matching CORS allow-origin value. Authentication and authorization remain the security boundary; CORS is an additional browser control.

## Provision the first instructor

New Auth users receive a profile with the `student` role. Promote the initial trusted account in the Supabase SQL editor or another server-admin channel:

```sql
update public.profiles
set role = 'instructor'
where id = 'AUTH_USER_UUID';
```

Do not expose role promotion to ordinary clients. Admin and instructor course operations are available after promotion. A course instructor can enroll members and assign profiles whose stored role is `reviewer` to review cases.

## Browser configuration

Set only public values in `frontend/.env.local`:

```env
VITE_DATA_ADAPTER=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_SUPABASE_ASSIGNMENT_ID=AN_ASSIGNMENT_UUID
```

Supabase mode presents an email/password sign-in screen, restores existing sessions,
refreshes expired sessions where possible, and signs out through the existing Supabase
client. The role displayed in hosted mode comes from the authenticated `/me` response;
demo-role selection is never used as authentication or authorization.

The hydrated analysis workspace uses the instructor/admin `/workspace` endpoint.
Dedicated hosted workspaces are wired for reviewers and students. Reviewers receive their
assigned blind-review cases, evidence, notes, and permitted transitions. Students receive
an own-submission list, upload, and signed download flow. Database RLS remains the
authorization boundary; verify every role through both the UI and API during staging.

The current `Repository` bridge loads an instructor workspace but refuses whole-snapshot writes. Server mutations must call `SupabaseBackendClient` methods so authorization, state transitions, evidence persistence, and history remain transactional. Demo mode remains the default and makes no Supabase request.

## API

All browser endpoints live under `/functions/v1/integrity-api` and require a valid user bearer token.

| Method and path | Purpose | Authorization |
|---|---|---|
| `GET /me` | Current application profile | Signed-in user |
| `POST /courses` | Create a course | Instructor or admin |
| `POST /courses/:id/members` | Enroll a profile | Course instructor or admin |
| `POST /assignments` | Create an assignment | Course instructor or admin |
| `PUT /assignments/:id/settings` | Save score/fairness settings | Assignment instructor or admin |
| `GET /workspace?assignmentId=` | Hydrate documents, latest completed results, cases, and events | Assignment instructor or admin |
| `POST /documents` | Validate, hash, store, and register text | Manager; enrolled student for own submission only |
| `GET /documents/:id/download` | Create a 120-second signed URL | Row-authorized owner or assignment manager |
| `POST /analysis-jobs` | Snapshot document versions and queue analysis | Assignment instructor or admin |
| `GET /analysis-jobs/:id` | Read measured progress/error state | Assignment instructor or admin through RLS |
| `GET /analysis-jobs/:id/results` | Read hydrated evidence | Assignment instructor or admin |
| `POST /analysis-jobs/:id/cancel` | Atomically cancel queued/running work | Assignment instructor or admin |
| `GET /cases` | List cases visible through RLS | Assigned reviewer, instructor, or admin |
| `GET /cases/:id` | Blind evidence bundle with author labels removed | Assigned reviewer, instructor, or admin |
| `POST /cases` | Open one case per result | Assignment instructor or admin |
| `POST /cases/:id/notes` | Append a timestamped event | Assigned reviewer, instructor, or admin |
| `POST /cases/:id/transition` | Perform the next lifecycle transition with justification | Assigned reviewer, instructor, or admin |
| `POST /cases/:id/reviewers` | Assign a reviewer-role profile | Assignment instructor or admin |
| `POST /cases/:id/reports` | Render escaped HTML and return a 300-second signed URL | Assigned reviewer, instructor, or admin |

Requests are capped at 30 KB. Documents remain capped at 20,000 UTF-8 bytes, 1,200 words, and 30 records per assignment. Identifiers, UUIDs, settings, roles, case states, and notes are validated at the API boundary. Storage writes are rolled back when database creation fails.

## Authorization design

- **Admin:** broad server-managed institutional access. Role changes stay outside client APIs.
- **Instructor:** manages only courses they instruct and their assignments, evidence, jobs, cases, reviewers, reports, and settings.
- **Reviewer:** reads only explicitly assigned cases through the blind case endpoint. It returns document text and evidence without author names or owner/storage metadata.
- **Student:** reads only their own document row and may upload a submission only while enrolled. Students cannot read results, matches, cases, events, reports, peer documents, or Storage objects.

All browser table writes are revoked. The Edge API uses the service role only after explicit authorization. Case opening, notes, lifecycle transitions, and cancellation use service-only PostgreSQL procedures. Case events have no authenticated insert, update, or delete grant. Database history is consequently append-only for application users, though project owners and service-role holders remain administrative trust boundaries.

The private bucket has no authenticated `storage.objects` policy. Downloads are authorized against database rows before the service client issues short-lived signed URLs. Signed URLs remain usable until their short expiry.

## Verification

```sh
npm run check:backend
npm run check:migrations
npm test
```

`check:backend` Deno type-checks both deployable functions. `check:migrations` applies the SQL and exercises structure, triggers, procedures, and RLS. `backend/supabase/tests/database/backend_structure.test.sql` also supplies pgTAP checks for a linked or local Supabase database. Run it against a dedicated linked development project with `npx supabase --workdir backend test db --linked`. Do not run policy tests against production data.

Before production use, complete the practical matrix in
[`hosted-verification.md`](hosted-verification.md) under separate admin, instructor,
reviewer, student, and unauthenticated identities. Hosted verification is not claimed
until those checks run against the real staging project.
