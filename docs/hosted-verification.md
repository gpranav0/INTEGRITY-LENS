# Hosted verification checklist

Record the project reference, deployment commit, tester, UTC time, observed response,
and evidence for every item. Perform this only in staging with fictional documents.

- [ ] An unauthenticated browser sees sign-in and cannot load workspace data by calling tables, Storage, or `integrity-api` directly.
- [ ] A valid instructor can sign in, restore a session after reload, and sign out.
- [ ] Invalid credentials, network failure, and expired refresh sessions show bounded errors without tokens or internal details.
- [ ] An instructor can access only courses and assignments they manage.
- [ ] A second-course instructor is denied the first instructor's assignment, documents, jobs, cases, reports, and files.
- [ ] A reviewer sees only explicitly assigned cases and blind evidence without author, owner, or Storage metadata.
- [ ] Removing a reviewer assignment immediately revokes case and event access.
- [ ] A student sees only their own document rows and cannot read peer submissions, results, matches, cases, events, or reports.
- [ ] Valid UTF-8 text uploads succeed; empty, binary, oversized, overlong, duplicate, and unsafe identifiers fail independently.
- [ ] Private documents cannot be listed or downloaded directly; an authorized signed URL works and fails after its 120-second expiry.
- [ ] An analysis job snapshots document versions, reports measured progress, completes, and exposes results only to an authorized manager.
- [ ] Cancellation prevents a queued/running job from later becoming complete.
- [ ] Repeated job requests do not create conflicting duplicate work or corrupt existing results.
- [ ] Case creation is unique per result; transitions follow the lifecycle and require justification.
- [ ] Case events cannot be inserted, updated, or deleted by an ordinary authenticated client.
- [ ] Report HTML is escaped, authorized, stored privately, and its 300-second signed URL expires.
- [ ] A request from an origin outside `INTEGRITYLENS_ALLOWED_ORIGINS` is rejected and receives no usable CORS authorization.
- [ ] Worker calls without the exact service key are rejected; the worker cannot be invoked successfully from browser credentials.
- [ ] Temporary worker/API failures produce recoverable job state and bounded user messages.
- [ ] Function, Auth, database, Storage, and frontend logs contain no passwords, access/refresh tokens, service keys, document contents, or signed URLs.

Passing local tests does not complete this checklist. Hosted verification remains pending
until these checks are executed against the linked staging project.
