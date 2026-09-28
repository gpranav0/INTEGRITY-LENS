begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'documents', 'documents exists');
select has_table('public', 'analysis_jobs', 'analysis jobs exist');
select has_table('public', 'analysis_results', 'analysis results exist');
select has_table('public', 'matches', 'matches exist');
select has_table('public', 'cases', 'cases exist');
select has_table('public', 'case_events', 'case events exist');
select has_table('public', 'reports', 'reports exist');
select has_column('public', 'documents', 'content_sha256', 'document hashes are stored');
select has_column('public', 'analysis_jobs', 'document_snapshot', 'jobs snapshot document versions');
select has_column('public', 'cases', 'updated_at', 'cases track server update time');
select has_function('public', 'backend_open_case', array['uuid','uuid'], 'atomic open-case procedure exists');
select has_function('public', 'backend_add_case_note', array['uuid','uuid','text'], 'atomic note procedure exists');
select has_function('public', 'backend_transition_case', array['uuid','uuid','case_status','text'], 'atomic transition procedure exists');
select has_function('public', 'backend_cancel_job', array['uuid','uuid'], 'atomic cancellation procedure exists');
select is((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'documents'), true, 'documents enable RLS');
select is((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'analysis_results'), true, 'results enable RLS');
select is((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'cases'), true, 'cases enable RLS');
select is((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'case_events'), true, 'events enable RLS');
select is((select public from storage.buckets where id = 'integritylens-private'), false, 'document bucket is private');

select * from finish();
rollback;
