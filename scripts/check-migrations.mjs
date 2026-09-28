import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const database = new PGlite();
const setup = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    instance_id uuid,
    aud text,
    role text,
    email text,
    encrypted_password text,
    email_confirmed_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    confirmation_token text default '',
    recovery_token text default '',
    email_change_token_new text default '',
    email_change text default '',
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text not null,
    name text not null, owner_id text
  );
  create function storage.foldername(path text) returns text[] language sql immutable
  as $$ select string_to_array(path, '/') $$;
`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await database.exec(setup);
for (const file of [
  "backend/supabase/migrations/001_integritylens_design.sql",
  "backend/supabase/migrations/002_backend_api.sql",
]) {
  await database.exec(await readFile(file, "utf8"));
}

const structural = await database.query(`
  select
    (select count(*)::int from pg_tables where schemaname = 'public') as table_count,
    (select count(*)::int from pg_policies where schemaname = 'public') as policy_count,
    (select count(*)::int from pg_trigger where not tgisinternal) as trigger_count,
    (select public from storage.buckets where id = 'integritylens-private') as bucket_public,
    to_regprocedure('public.is_admin()') is null as old_helper_removed,
    not has_function_privilege('authenticated', 'public.backend_transition_case(uuid,uuid,public.case_status,text)', 'execute') as transition_service_only
`);
const structure = structural.rows[0];
assert(structure.table_count === 14, "Expected all 14 public backend tables.");
assert(structure.policy_count >= 14, "Expected least-privilege RLS policies.");
assert(structure.trigger_count >= 3, "Expected Auth and consistency triggers.");
assert(
  structure.bucket_public === false,
  "The storage bucket must stay private.",
);
assert(
  structure.old_helper_removed === true,
  "Exposed legacy helper functions must be removed.",
);
assert(
  structure.transition_service_only === true,
  "Case procedures must be service-role only.",
);

const instructor = "10000000-0000-4000-8000-000000000001";
const student = "20000000-0000-4000-8000-000000000002";
const reviewer = "21000000-0000-4000-8000-000000000002";
const course = "30000000-0000-4000-8000-000000000003";
const assignment = "40000000-0000-4000-8000-000000000004";
const left = "50000000-0000-4000-8000-000000000005";
const right = "60000000-0000-4000-8000-000000000006";
const job = "70000000-0000-4000-8000-000000000007";
const result = "80000000-0000-4000-8000-000000000008";

await database.exec(`
  insert into auth.users(id,email,raw_user_meta_data) values
    ('${instructor}','instructor@example.test','{"display_name":"Instructor"}'),
    ('${student}','student@example.test','{"display_name":"Student"}'),
    ('${reviewer}','reviewer@example.test','{"display_name":"Reviewer"}');
  update public.profiles set role = 'instructor' where id = '${instructor}';
  update public.profiles set role = 'reviewer' where id = '${reviewer}';
  insert into public.courses(id,title,instructor_id) values('${course}','Test course','${instructor}');
  insert into public.course_members(course_id,profile_id) values('${course}','${student}');
  insert into public.assignments(id,course_id,title) values('${assignment}','${course}','Test assignment');
  insert into public.documents(id,assignment_id,owner_id,identifier,title,kind,storage_path,byte_size,word_count)
  values
    ('${left}','${assignment}','${student}','SUB-001','Submission','submission','assignments/${assignment}/documents/${left}.txt',40,6),
    ('${right}','${assignment}','${instructor}','REF-001','Reference','reference','assignments/${assignment}/documents/${right}.txt',40,6);
  insert into public.analysis_jobs(id,assignment_id,requested_by,status,settings,engine_version,total_pairs,completed_pairs)
  values('${job}','${assignment}','${instructor}','complete','{"weights":{"exact":1,"shingle":0,"fuzzy":0}}','1.0.0',1,1);
  insert into public.analysis_results(id,job_id,document_a,document_b,score,components)
  values('${result}','${job}','${left}','${right}',25,'{"exact":50,"shingle":0,"fuzzy":0}');
`);

const triggerProfile = await database.query(
  `select display_name, role from public.profiles where id = '${student}'`,
);
assert(
  triggerProfile.rows[0]?.display_name === "Student",
  "Auth trigger must provision profiles.",
);
assert(
  triggerProfile.rows[0]?.role === "student",
  "Auth trigger must grant the least-privileged role.",
);

const opened = await database.query(
  `select (public.backend_open_case('${result}','${instructor}')).id as id`,
);
const caseId = opened.rows[0]?.id;
assert(typeof caseId === "string", "Opening a case must return a case ID.");
for (const status of [
  "Under review",
  "Needs discussion",
  "Resolved",
  "Closed",
]) {
  await database.query(
    `select public.backend_transition_case('${caseId}','${instructor}','${status}'::public.case_status,'Test justification for ${status}.')`,
  );
}
const history = await database.query(
  `select count(*)::int as count from public.case_events where case_id = '${caseId}'`,
);
assert(
  history.rows[0]?.count === 5,
  "Case open and transitions must append five history events.",
);
await database.exec(
  `insert into public.reviewer_assignments(case_id,reviewer_id,assigned_by) values('${caseId}','${reviewer}','${instructor}');`,
);

await database.exec(
  `set role authenticated; select set_config('request.jwt.claim.sub','${student}',false);`,
);
const studentVisibility = await database.query(`
  select
    (select count(*)::int from public.documents) as documents,
    (select count(*)::int from public.analysis_results) as results,
    (select count(*)::int from public.cases) as cases
`);
assert(
  studentVisibility.rows[0]?.documents === 1,
  "Students must see only their own document.",
);
assert(
  studentVisibility.rows[0]?.results === 0,
  "Students must not see analysis results.",
);
assert(
  studentVisibility.rows[0]?.cases === 0,
  "Students must not see review cases.",
);

let directEventWriteDenied = false;
try {
  await database.exec(
    `insert into public.case_events(case_id,actor_id,event_type,note) values('${caseId}','${student}','note','forged');`,
  );
} catch {
  directEventWriteDenied = true;
}
assert(
  directEventWriteDenied,
  "Authenticated clients must not write case history directly.",
);

await database.exec(
  `reset role; select set_config('request.jwt.claim.sub','',false);`,
);
await database.exec(
  `set role authenticated; select set_config('request.jwt.claim.sub','${reviewer}',false);`,
);
const reviewerVisibility = await database.query(`
  select
    (select count(*)::int from public.documents) as documents,
    (select count(*)::int from public.analysis_results) as results,
    (select count(*)::int from public.cases) as cases,
    (select count(*)::int from public.case_events) as events
`);
assert(
  reviewerVisibility.rows[0]?.documents === 0,
  "Reviewers must not read document rows directly.",
);
assert(
  reviewerVisibility.rows[0]?.results === 0,
  "Reviewers must not read result rows directly.",
);
assert(
  reviewerVisibility.rows[0]?.cases === 1,
  "Assigned reviewers must see their case.",
);
assert(
  reviewerVisibility.rows[0]?.events === 5,
  "Assigned reviewers must see case history.",
);

await database.exec(
  `reset role; select set_config('request.jwt.claim.sub','',false);`,
);
await database.exec(
  `set role authenticated; select set_config('request.jwt.claim.sub','${instructor}',false);`,
);
const instructorVisibility = await database.query(`
  select
    (select count(*)::int from public.documents) as documents,
    (select count(*)::int from public.analysis_results) as results,
    (select count(*)::int from public.cases) as cases
`);
assert(
  instructorVisibility.rows[0]?.documents === 2,
  "The instructor must see assignment documents.",
);
assert(
  instructorVisibility.rows[0]?.results === 1,
  "The instructor must see analysis results.",
);
assert(
  instructorVisibility.rows[0]?.cases === 1,
  "The instructor must see review cases.",
);

await database.exec(
  `reset role; select set_config('request.jwt.claim.sub','',false);`,
);
let anonymousReadDenied = false;
try {
  await database.exec("set role anon; select * from public.documents;");
} catch {
  anonymousReadDenied = true;
}
assert(
  anonymousReadDenied,
  "Anonymous users must have no document table access.",
);
await database.exec("reset role;");
await database.close();
console.log(
  "Supabase migrations passed syntax, structure, trigger, transaction, and RLS smoke checks.",
);
