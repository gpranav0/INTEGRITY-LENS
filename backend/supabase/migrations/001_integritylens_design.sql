-- FUTURE INTEGRATION DESIGN. Not executed or verified against Supabase.
-- Apply only in a dedicated development project after policy review and tests.
create type public.app_role as enum ('admin','instructor','reviewer','student');
create type public.document_kind as enum ('submission','reference','template');
create type public.case_status as enum ('New','Under review','Needs discussion','Resolved','Closed');
create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 display_name text not null,
 role public.app_role not null default 'student'
);
create table public.courses (
 id uuid primary key default gen_random_uuid(), title text not null,
 instructor_id uuid not null references public.profiles,
 created_at timestamptz not null default now()
);
create table public.course_members (
 course_id uuid references public.courses on delete cascade,
 profile_id uuid references public.profiles on delete cascade,
 primary key(course_id,profile_id)
);
create table public.assignments (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses on delete cascade,
 title text not null, due_at timestamptz, created_at timestamptz not null default now()
);
create table public.documents (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments on delete cascade,
 owner_id uuid not null references public.profiles, identifier text not null, title text not null,
 kind public.document_kind not null, storage_path text not null unique,
 byte_size integer not null check(byte_size between 1 and 20000),
 created_at timestamptz not null default now(), unique(assignment_id,identifier)
);
create table public.templates (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments on delete cascade,
 document_id uuid not null references public.documents on delete cascade,
 created_at timestamptz not null default now(), unique(assignment_id,document_id)
);
create table public.analysis_jobs (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments on delete cascade,
 requested_by uuid not null references public.profiles,
 status text not null default 'queued' check(status in ('queued','running','cancelled','complete','failed')),
 settings jsonb not null, engine_version text not null,
 completed_pairs integer not null default 0, total_pairs integer not null default 0,
 created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.analysis_results (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.analysis_jobs on delete cascade,
 document_a uuid not null references public.documents, document_b uuid not null references public.documents,
 score double precision not null check(score between 0 and 100), components jsonb not null,
 exclusions_a jsonb not null default '[]', exclusions_b jsonb not null default '[]', truncated boolean not null default false,
 check(document_a<>document_b), unique(job_id,document_a,document_b)
);
create table public.matches (
 id uuid primary key default gen_random_uuid(), result_id uuid not null references public.analysis_results on delete cascade,
 kind text not null check(kind in ('exact','shingle','fuzzy')),
 a_start integer not null check(a_start>=0), a_end integer not null,
 b_start integer not null check(b_start>=0), b_end integer not null,
 similarity double precision not null check(similarity between 0 and 1),
 excluded boolean not null default false, reasons jsonb not null default '[]',
 check(a_end>a_start), check(b_end>b_start)
);
create table public.cases (
 id uuid primary key default gen_random_uuid(), result_id uuid not null references public.analysis_results,
 created_by uuid not null references public.profiles, status public.case_status not null default 'New',
 resolution_justification text, created_at timestamptz not null default now(),
 check(status not in ('Resolved','Closed') or length(trim(resolution_justification))>0)
);
create table public.reviewer_assignments (
 case_id uuid references public.cases on delete cascade, reviewer_id uuid references public.profiles,
 assigned_by uuid not null references public.profiles, created_at timestamptz not null default now(),
 primary key(case_id,reviewer_id)
);
create table public.case_events (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.cases on delete cascade,
 actor_id uuid not null references public.profiles, event_type text not null,
 note text not null check(length(trim(note))>0), created_at timestamptz not null default now()
);
create table public.reports (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.cases,
 created_by uuid not null references public.profiles, storage_path text not null,
 created_at timestamptz not null default now(), engine_version text not null
);
create table public.settings (
 assignment_id uuid primary key references public.assignments on delete cascade,
 weights jsonb not null, fairness jsonb not null, updated_by uuid not null references public.profiles,
 updated_at timestamptz not null default now()
);
create index documents_assignment_idx on public.documents(assignment_id);
create index results_job_idx on public.analysis_results(job_id);
create index matches_result_idx on public.matches(result_id);
create index events_case_idx on public.case_events(case_id,created_at);
-- Every relation is deny-by-default until explicit policies below apply.
do $$ declare t text; begin
 foreach t in array array['profiles','courses','course_members','assignments','documents','templates','analysis_jobs','analysis_results','matches','cases','reviewer_assignments','case_events','reports','settings'] loop
 execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;

-- Security-definer helpers avoid policy recursion. Fixed search_path; no writable SQL.
create function public.is_admin() returns boolean language sql stable security definer
set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
create function public.manages_assignment(aid uuid) returns boolean language sql stable security definer
set search_path=public as $$ select public.is_admin() or exists(select 1 from public.assignments a join public.courses c on c.id=a.course_id where a.id=aid and c.instructor_id=auth.uid()); $$;
create function public.manages_result(rid uuid) returns boolean language sql stable security definer
set search_path=public as $$ select exists(select 1 from public.analysis_results r join public.analysis_jobs j on j.id=r.job_id where r.id=rid and public.manages_assignment(j.assignment_id)); $$;
create function public.reviews_case(cid uuid) returns boolean language sql stable security definer
set search_path=public as $$ select exists(select 1 from public.reviewer_assignments where case_id=cid and reviewer_id=auth.uid()); $$;
revoke all on function public.is_admin(),public.manages_assignment(uuid),public.manages_result(uuid),public.reviews_case(uuid) from public;
grant execute on function public.is_admin(),public.manages_assignment(uuid),public.manages_result(uuid),public.reviews_case(uuid) to authenticated;

-- Roles are set by a privileged provisioning path only; no self-role updates.
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy profile_admin on public.profiles for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy course_read on public.courses for select to authenticated using(public.is_admin() or instructor_id=auth.uid() or exists(select 1 from public.course_members m where m.course_id=id and m.profile_id=auth.uid()));
create policy course_manage on public.courses for all to authenticated using(public.is_admin() or instructor_id=auth.uid()) with check(public.is_admin() or (instructor_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and role='instructor')));
create policy member_read on public.course_members for select to authenticated using(profile_id=auth.uid() or public.is_admin());
-- Membership mutation is privileged; instructor enrollment RPC must be authorized separately.
create policy member_admin on public.course_members for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy assignment_read on public.assignments for select to authenticated using(public.manages_assignment(id) or exists(select 1 from public.course_members m where m.course_id=assignments.course_id and m.profile_id=auth.uid()));
create policy assignment_manage on public.assignments for all to authenticated using(public.manages_assignment(id)) with check(public.is_admin() or exists(select 1 from public.courses c where c.id=course_id and c.instructor_id=auth.uid()));
create policy document_read on public.documents for select to authenticated using(public.manages_assignment(assignment_id) or owner_id=auth.uid());
create policy document_insert on public.documents for insert to authenticated with check(public.manages_assignment(assignment_id) or (owner_id=auth.uid() and kind='submission' and exists(select 1 from public.assignments a join public.course_members m on m.course_id=a.course_id where a.id=assignment_id and m.profile_id=auth.uid())));
create policy template_manage on public.templates for all to authenticated using(public.manages_assignment(assignment_id)) with check(public.manages_assignment(assignment_id));
create policy job_read on public.analysis_jobs for select to authenticated using(public.manages_assignment(assignment_id));
create policy job_insert on public.analysis_jobs for insert to authenticated with check(public.manages_assignment(assignment_id) and requested_by=auth.uid());
-- Result and match writes are reserved to validated server workers, not clients.
create policy result_read on public.analysis_results for select to authenticated using(public.manages_result(id));
create policy match_read on public.matches for select to authenticated using(public.manages_result(result_id));
create policy case_read on public.cases for select to authenticated using(public.manages_result(result_id) or public.reviews_case(id));
create policy case_insert on public.cases for insert to authenticated with check(public.manages_result(result_id) and created_by=auth.uid() and status='New');
-- No direct client updates: transitions + required justification + events need one server transaction.
create policy reviewer_read on public.reviewer_assignments for select to authenticated using(reviewer_id=auth.uid() or exists(select 1 from public.cases c where c.id=case_id and public.manages_result(c.result_id)));
create policy reviewer_manage on public.reviewer_assignments for all to authenticated using(exists(select 1 from public.cases c where c.id=case_id and public.manages_result(c.result_id))) with check(assigned_by=auth.uid() and exists(select 1 from public.cases c where c.id=case_id and public.manages_result(c.result_id)));
create policy event_read on public.case_events for select to authenticated using(public.reviews_case(case_id) or exists(select 1 from public.cases c where c.id=case_id and public.manages_result(c.result_id)));
-- No UPDATE/DELETE/INSERT policies for events. Future audited RPC inserts actor/time server-side.
create policy report_read on public.reports for select to authenticated using(public.reviews_case(case_id) or exists(select 1 from public.cases c where c.id=case_id and public.manages_result(c.result_id)));
create policy settings_manage on public.settings for all to authenticated using(public.manages_assignment(assignment_id)) with check(public.manages_assignment(assignment_id) and updated_by=auth.uid());

-- Private bucket. No object policies are granted by this design migration.
-- Future server endpoints validate document/case access and issue short-lived signed URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('integritylens-private','integritylens-private',false,20000,array['text/plain','text/html'])
on conflict(id) do nothing;
