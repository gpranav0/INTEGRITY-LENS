# IntegrityLens backend

This folder contains the Supabase project under `supabase/`: database migrations, RLS policies, database tests, the authenticated API Edge Function, and the background analysis worker.

Run the local Docker-backed Supabase stack from the repository root:

```sh
npm run supabase:start
```

Useful commands are `npm run supabase:status`, `npm run supabase:reset`, `npm run supabase:stop`, and `npm run supabase:deploy`.
