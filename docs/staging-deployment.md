# Hosted Supabase staging deployment

Use a dedicated staging project with fictional data. Do not run destructive database
tests, resets, or seed scripts against production.

## Validate and link

Run from the repository root in PowerShell:

```powershell
Set-Location 'D:\dsa3\IntegrityLens'
npm install
npm run typecheck
npm run lint
npm test
npm run check:backend
npm run check:migrations
npm run build

npx supabase login
$ProjectRef = Read-Host 'Dedicated staging project ref'
npx supabase --workdir backend link --project-ref $ProjectRef
Get-Content -LiteralPath 'backend\supabase\.temp\project-ref'
```

The printed reference must equal the staging project reference. Stop if it identifies
production.

Preview migrations separately from applying them:

```powershell
npx supabase --workdir backend db push --linked --dry-run
```

Review the complete preview. Apply it only after confirming the linked staging project:

```powershell
npx supabase --workdir backend db push --linked
```

## Configure and deploy functions

Set the exact deployed frontend origins. Use a comma-separated value when staging has
more than one origin. Do not use `*` for a hosted review environment.

```powershell
npx supabase --workdir backend secrets set INTEGRITYLENS_ALLOWED_ORIGINS=https://staging.example.edu
npm run prepare:supabase
npx supabase --workdir backend functions deploy integrity-worker --use-api --no-verify-jwt
npx supabase --workdir backend functions deploy integrity-api --use-api
```

`integrity-api` retains gateway JWT verification. `integrity-worker` disables gateway
verification because it performs its own constant-time service-key check and is never a
browser endpoint. Supabase injects its URL, anonymous key, and service-role key; do not
set or print those values manually.

## Provision the first instructor and assignment

Create the first user in **Authentication > Users** in the staging dashboard. Confirm
the address, then run the following in the staging SQL editor after replacing only the
email placeholder:

```sql
begin;

update public.profiles as profile
set role = 'instructor'
from auth.users as account
where profile.id = account.id
  and lower(account.email) = lower('INSTRUCTOR_EMAIL_HERE')
returning profile.id, profile.display_name, profile.role;

commit;
```

The update must return exactly one row. Role promotion is an administrative operation;
it is intentionally absent from the frontend.

Sign in as that instructor and create a course and assignment through the authenticated
API, or provision the minimal staging records in the SQL editor:

```sql
insert into public.courses (title, instructor_id)
select 'IntegrityLens staging course', profile.id
from public.profiles as profile
join auth.users as account on account.id = profile.id
where lower(account.email) = lower('INSTRUCTOR_EMAIL_HERE')
  and profile.role = 'instructor'
returning id, title;

insert into public.assignments (course_id, title)
values ('COURSE_UUID_RETURNED_ABOVE', 'IntegrityLens staging assignment')
returning id, title;
```

Set `VITE_SUPABASE_ASSIGNMENT_ID` to the returned assignment UUID only after both records
exist and the signed-in instructor owns the course.

## Build the hosted frontend

Create `frontend/.env.local` from the safe example and set the public staging URL,
publishable/anonymous key, and assignment ID. Vite embeds these values at build time:

```powershell
npm run build
```

Rebuild and redeploy the frontend whenever a public Vite value changes.
