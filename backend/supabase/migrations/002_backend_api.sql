-- IntegrityLens backend hardening and transactional API.
-- Apply after 001_integritylens_design.sql.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

alter table public.documents
  add column if not exists word_count integer not null default 1 check (word_count between 1 and 1200),
  add column if not exists content_sha256 text,
  add column if not exists version integer not null default 1 check (version > 0);

alter table public.analysis_jobs
  add column if not exists started_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists error_message text,
  add column if not exists document_snapshot jsonb not null default '[]'::jsonb;

alter table public.analysis_results
  add column if not exists created_at timestamptz not null default now();

alter table public.cases
  add column if not exists updated_at timestamptz not null default now();

alter table public.reports
  add column if not exists byte_size integer check (byte_size between 1 and 1000000),
  add column if not exists content_type text not null default 'text/html; charset=utf-8';

create unique index if not exists one_case_per_result_idx on public.cases(result_id);
create index if not exists jobs_assignment_created_idx on public.analysis_jobs(assignment_id, created_at desc);
create index if not exists reviewer_profile_idx on public.reviewer_assignments(reviewer_id, case_id);
create index if not exists results_documents_idx on public.analysis_results(document_a, document_b);

create or replace function private.current_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_role() = 'admin'::public.app_role, false);
$$;

create or replace function private.is_course_member(p_course_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.course_members m
    where m.course_id = p_course_id and m.profile_id = (select auth.uid())
  );
$$;

create or replace function private.can_read_assignment(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    private.is_admin()
    or exists (
      select 1 from public.assignments a
      join public.courses c on c.id = a.course_id
      where a.id = p_assignment_id
        and (c.instructor_id = (select auth.uid()) or private.is_course_member(c.id))
    )
  );
$$;

create or replace function private.manages_assignment(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    private.is_admin()
    or exists (
      select 1 from public.assignments a
      join public.courses c on c.id = a.course_id
      where a.id = p_assignment_id and c.instructor_id = (select auth.uid())
    )
  );
$$;

create or replace function private.manages_result(p_result_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.analysis_results r
    join public.analysis_jobs j on j.id = r.job_id
    where r.id = p_result_id and private.manages_assignment(j.assignment_id)
  );
$$;

create or replace function private.reviews_case(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.reviewer_assignments ra
    where ra.case_id = p_case_id and ra.reviewer_id = (select auth.uid())
  );
$$;

create or replace function private.can_read_case(p_case_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.reviews_case(p_case_id) or exists (
    select 1 from public.cases c
    where c.id = p_case_id and private.manages_result(c.result_id)
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.current_role(), private.is_admin(),
  private.is_course_member(uuid), private.can_read_assignment(uuid),
  private.manages_assignment(uuid), private.manages_result(uuid),
  private.reviews_case(uuid), private.can_read_case(uuid)
to authenticated, service_role;

drop policy if exists profile_read on public.profiles;
drop policy if exists profile_admin on public.profiles;
drop policy if exists course_read on public.courses;
drop policy if exists course_manage on public.courses;
drop policy if exists member_read on public.course_members;
drop policy if exists member_admin on public.course_members;
drop policy if exists assignment_read on public.assignments;
drop policy if exists assignment_manage on public.assignments;
drop policy if exists document_read on public.documents;
drop policy if exists document_insert on public.documents;
drop policy if exists template_manage on public.templates;
drop policy if exists job_read on public.analysis_jobs;
drop policy if exists job_insert on public.analysis_jobs;
drop policy if exists result_read on public.analysis_results;
drop policy if exists match_read on public.matches;
drop policy if exists case_read on public.cases;
drop policy if exists case_insert on public.cases;
drop policy if exists reviewer_read on public.reviewer_assignments;
drop policy if exists reviewer_manage on public.reviewer_assignments;
drop policy if exists event_read on public.case_events;
drop policy if exists report_read on public.reports;
drop policy if exists settings_manage on public.settings;

drop function if exists public.reviews_case(uuid);
drop function if exists public.manages_result(uuid);
drop function if exists public.manages_assignment(uuid);
drop function if exists public.is_admin();

revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.profiles, public.courses, public.course_members,
  public.assignments, public.documents, public.templates, public.analysis_jobs,
  public.analysis_results, public.matches, public.cases, public.reviewer_assignments,
  public.case_events, public.reports, public.settings from authenticated;
grant select on public.profiles, public.courses, public.course_members, public.assignments,
  public.documents, public.templates, public.analysis_jobs, public.analysis_results,
  public.matches, public.cases, public.reviewer_assignments, public.case_events,
  public.reports, public.settings to authenticated;

create policy profile_self_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));
create policy course_authorized_read on public.courses for select to authenticated
using ((select private.is_admin()) or instructor_id = (select auth.uid()) or (select private.is_course_member(id)));
create policy member_self_read on public.course_members for select to authenticated
using (profile_id = (select auth.uid()) or (select private.is_admin()));
create policy assignment_authorized_read on public.assignments for select to authenticated
using ((select private.can_read_assignment(id)));
create policy document_authorized_read on public.documents for select to authenticated
using ((select private.manages_assignment(assignment_id)) or owner_id = (select auth.uid()));
create policy template_manager_read on public.templates for select to authenticated
using ((select private.manages_assignment(assignment_id)));
create policy job_manager_read on public.analysis_jobs for select to authenticated
using ((select private.manages_assignment(assignment_id)));
create policy result_manager_read on public.analysis_results for select to authenticated
using ((select private.manages_result(id)));
create policy match_manager_read on public.matches for select to authenticated
using ((select private.manages_result(result_id)));
create policy case_authorized_read on public.cases for select to authenticated
using ((select private.can_read_case(id)));
create policy reviewer_authorized_read on public.reviewer_assignments for select to authenticated
using (reviewer_id = (select auth.uid()) or (select private.can_read_case(case_id)));
create policy event_authorized_read on public.case_events for select to authenticated
using ((select private.can_read_case(case_id)));
create policy report_authorized_read on public.reports for select to authenticated
using ((select private.can_read_case(case_id)));
create policy settings_manager_read on public.settings for select to authenticated
using ((select private.manages_assignment(assignment_id)));

-- Ensure documents, results, and templates never cross assignment boundaries.
create or replace function private.check_template_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.documents d
    where d.id = new.document_id and d.assignment_id = new.assignment_id and d.kind = 'template'
  ) then raise exception 'template document must belong to the assignment and have template kind'; end if;
  return new;
end;
$$;

create or replace function private.check_result_assignment()
returns trigger language plpgsql set search_path = '' as $$
declare v_assignment uuid;
begin
  select j.assignment_id into v_assignment from public.analysis_jobs j where j.id = new.job_id;
  if not exists (select 1 from public.documents d where d.id = new.document_a and d.assignment_id = v_assignment)
     or not exists (select 1 from public.documents d where d.id = new.document_b and d.assignment_id = v_assignment)
  then raise exception 'analysis result documents must belong to the job assignment'; end if;
  return new;
end;
$$;

drop trigger if exists template_assignment_guard on public.templates;
create trigger template_assignment_guard before insert or update on public.templates
for each row execute function private.check_template_assignment();
drop trigger if exists result_assignment_guard on public.analysis_results;
create trigger result_assignment_guard before insert or update on public.analysis_results
for each row execute function private.check_result_assignment();

-- Service-only procedures keep state changes and history atomic.
create or replace function public.backend_open_case(p_result_id uuid, p_actor_id uuid)
returns public.cases
language plpgsql security definer set search_path = '' as $$
declare v_case public.cases;
begin
  if not exists (
    select 1 from public.analysis_results r
    join public.analysis_jobs j on j.id = r.job_id
    join public.assignments a on a.id = j.assignment_id
    join public.courses co on co.id = a.course_id
    join public.profiles p on p.id = p_actor_id
    where r.id = p_result_id and (p.role = 'admin' or co.instructor_id = p_actor_id)
  ) then raise exception 'actor may not open this case'; end if;
  insert into public.cases(result_id, created_by)
  values(p_result_id, p_actor_id)
  on conflict(result_id) do update set updated_at = public.cases.updated_at
  returning * into v_case;
  if not exists(select 1 from public.case_events e where e.case_id = v_case.id) then
    insert into public.case_events(case_id, actor_id, event_type, note)
    values(v_case.id, p_actor_id, 'opened', 'Case opened for contextual human review.');
  end if;
  return v_case;
end;
$$;

create or replace function public.backend_add_case_note(p_case_id uuid, p_actor_id uuid, p_note text)
returns public.case_events
language plpgsql security definer set search_path = '' as $$
declare v_event public.case_events;
begin
  if length(trim(coalesce(p_note,''))) = 0 or length(p_note) > 10000 then
    raise exception 'note must contain 1 to 10000 characters';
  end if;
  if not exists (
    select 1 from public.cases c
    join public.analysis_results r on r.id = c.result_id
    join public.analysis_jobs j on j.id = r.job_id
    join public.assignments a on a.id = j.assignment_id
    join public.courses co on co.id = a.course_id
    join public.profiles p on p.id = p_actor_id
    left join public.reviewer_assignments ra on ra.case_id = c.id and ra.reviewer_id = p_actor_id
    where c.id = p_case_id and (p.role = 'admin' or co.instructor_id = p_actor_id or ra.reviewer_id is not null)
  ) then raise exception 'actor may not update this case'; end if;
  insert into public.case_events(case_id, actor_id, event_type, note)
  values(p_case_id, p_actor_id, 'note', trim(p_note)) returning * into v_event;
  update public.cases set updated_at = now() where id = p_case_id;
  return v_event;
end;
$$;

create or replace function public.backend_transition_case(
  p_case_id uuid, p_actor_id uuid, p_status public.case_status, p_justification text
)
returns public.cases
language plpgsql security definer set search_path = '' as $$
declare v_case public.cases; v_expected public.case_status;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'case not found'; end if;
  if not exists (
    select 1 from public.analysis_results r
    join public.analysis_jobs j on j.id = r.job_id
    join public.assignments a on a.id = j.assignment_id
    join public.courses co on co.id = a.course_id
    join public.profiles p on p.id = p_actor_id
    left join public.reviewer_assignments ra on ra.case_id = v_case.id and ra.reviewer_id = p_actor_id
    where r.id = v_case.result_id and (p.role = 'admin' or co.instructor_id = p_actor_id or ra.reviewer_id is not null)
  ) then raise exception 'actor may not transition this case'; end if;
  v_expected := case v_case.status
    when 'New' then 'Under review'::public.case_status
    when 'Under review' then 'Needs discussion'::public.case_status
    when 'Needs discussion' then 'Resolved'::public.case_status
    when 'Resolved' then 'Closed'::public.case_status
    else null end;
  if p_status is distinct from v_expected then raise exception 'invalid case transition'; end if;
  if length(trim(coalesce(p_justification,''))) = 0 or length(p_justification) > 10000 then
    raise exception 'a justification of 1 to 10000 characters is required';
  end if;
  update public.cases set status = p_status,
    resolution_justification = case when p_status in ('Resolved','Closed') then trim(p_justification) else resolution_justification end,
    updated_at = now()
  where id = p_case_id returning * into v_case;
  insert into public.case_events(case_id, actor_id, event_type, note)
  values(p_case_id, p_actor_id, 'status_changed', 'Status changed to ' || p_status::text || '. ' || trim(p_justification));
  return v_case;
end;
$$;

create or replace function public.backend_cancel_job(p_job_id uuid, p_actor_id uuid)
returns public.analysis_jobs
language plpgsql security definer set search_path = '' as $$
declare v_job public.analysis_jobs;
begin
  if not exists (
    select 1 from public.analysis_jobs j
    join public.assignments a on a.id = j.assignment_id
    join public.courses co on co.id = a.course_id
    join public.profiles p on p.id = p_actor_id
    where j.id = p_job_id and (p.role = 'admin' or co.instructor_id = p_actor_id)
  ) then raise exception 'actor may not cancel this job'; end if;
  update public.analysis_jobs set status = 'cancelled', cancelled_at = now()
  where id = p_job_id and status in ('queued','running') returning * into v_job;
  if v_job.id is null then raise exception 'job cannot be cancelled in its current state'; end if;
  return v_job;
end;
$$;

revoke all on function public.backend_open_case(uuid,uuid),
  public.backend_add_case_note(uuid,uuid,text),
  public.backend_transition_case(uuid,uuid,public.case_status,text),
  public.backend_cancel_job(uuid,uuid) from public, anon, authenticated;
grant execute on function public.backend_open_case(uuid,uuid),
  public.backend_add_case_note(uuid,uuid,text),
  public.backend_transition_case(uuid,uuid,public.case_status,text),
  public.backend_cancel_job(uuid,uuid) to service_role;

-- No authenticated storage.objects policy is created. All uploads, downloads,
-- replacements, and deletes go through the Edge API. It authorizes the database
-- row first, then uses the service role to issue a short-lived signed URL. This
-- prevents enrolled students from discovering or reading peer object paths.

-- New Auth users receive the least-privileged application role. Admin/instructor
-- promotion remains an explicit server-side administrative operation.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name, role)
  values(
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'User'), '@', 1)), 120),
    'student'
  ) on conflict(id) do nothing;
  return new;
end;
$$;

insert into public.profiles(id, display_name, role)
select u.id,
  left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(u.email, 'User'), '@', 1)), 120),
  'student'::public.app_role
from auth.users u
on conflict(id) do nothing;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();
