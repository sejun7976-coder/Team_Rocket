begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', '20990001@project-manager.local', crypt('fixture', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"user","account_active":true}', '{"student_id":"20990001","name":"Trigger Owner"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', '20990002@project-manager.local', crypt('fixture', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"user","account_active":true}', '{"student_id":"20990002","name":"Trigger Member A"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', '20990003@project-manager.local', crypt('fixture', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"user","account_active":true}', '{"student_id":"20990003","name":"Trigger Member B"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', '20990004@project-manager.local', crypt('fixture', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"user","account_active":true}', '{"student_id":"20990004","name":"Trigger Outsider"}', now(), now());

insert into public.projects(id, name, created_by, github_repository_name, idempotency_key, status)
values ('a2000000-0000-4000-8000-000000000001', 'Trigger Regression', 'a1000000-0000-4000-8000-000000000001', 'trigger-regression', 'a3000000-0000-4000-8000-000000000001', 'active');
insert into public.project_members(project_id, user_id, role, added_by)
values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'member', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'member', 'a1000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"must_change_password":false,"account_active":true,"system_role":"user"}}', true);

select lives_ok(
  $$select public.create_task_atomic('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'No assignee', null, 'todo', 'medium', 0, null, null, array[]::uuid[])$$,
  'normal task creation reaches the task trigger without NEW.user_id failure'
);
select is((select count(*)::integer from public.tasks where id = 'a4000000-0000-4000-8000-000000000001'), 1, 'normal task is committed');
select is((select count(*)::integer from public.activities where subject_id = 'a4000000-0000-4000-8000-000000000001' and action = 'task_created' and actor_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'task creation activity keeps the creator actor');

select lives_ok(
  $$select public.create_task_atomic('a4000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Owner assignee', '{}'::jsonb, 'todo', 'high', 0, null, null, array['a1000000-0000-4000-8000-000000000001']::uuid[])$$,
  'project-owner assignee task creation succeeds with null dates'
);
select is((select count(*)::integer from public.task_assignees where task_id = 'a4000000-0000-4000-8000-000000000002' and user_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'the current project owner is inserted as the assignee');
select is((select count(*)::integer from public.notifications where task_id = 'a4000000-0000-4000-8000-000000000002' and type = 'task_assigned'), 0, 'self-assignment does not create a redundant notification');

select lives_ok(
  $$select public.create_task_atomic('a4000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'Two assignees', null, 'in_progress', 'urgent', 30, current_date, current_date + 2, array['a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003']::uuid[])$$,
  'two-assignee task creation succeeds with valid dates'
);
select is((select count(*)::integer from public.task_assignees where task_id = 'a4000000-0000-4000-8000-000000000003'), 2, 'two assignees are inserted');
select is((select count(*)::integer from public.notifications where task_id = 'a4000000-0000-4000-8000-000000000003'), 4, 'assignment and due-soon notifications are preserved for two assignees');

select lives_ok(
  $$select public.create_task_atomic('a4000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'Duplicate assignee', null, 'todo', 'low', 0, null, null, array['a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002']::uuid[])$$,
  'duplicate assignee IDs are deduplicated'
);
select is((select count(*)::integer from public.task_assignees where task_id = 'a4000000-0000-4000-8000-000000000004'), 1, 'deduplicated task has one assignee row');
select lives_ok($$update public.tasks set status = 'done', progress = 100 where id = 'a4000000-0000-4000-8000-000000000002'$$, 'task updates still record domain activity');
select lives_ok($$update public.tasks set due_date = current_date + 1 where id = 'a4000000-0000-4000-8000-000000000002'$$, 'due-date changes still notify assignees');
select lives_ok($$insert into public.comments(id, task_id, author_id, content_encrypted) values ('a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '{}'::jsonb)$$, 'comment activity trigger remains functional');
select lives_ok($$insert into public.files(id, project_id, task_id, storage_path, original_name_encrypted, original_size, encrypted_size, chunk_count, checksum_encrypted, uploaded_by) values ('a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001/a6000000-0000-4000-8000-000000000001/encrypted.bin', '{}'::jsonb, 1, 1, 1, '{}'::jsonb, 'a1000000-0000-4000-8000-000000000001')$$, 'file activity trigger remains functional');
select lives_ok($$delete from public.task_assignees where task_id = 'a4000000-0000-4000-8000-000000000002' and user_id = 'a1000000-0000-4000-8000-000000000001'$$, 'assignee removal activity remains functional for the project owner');
select throws_ok(
  $$select public.create_task_atomic('a4000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001', 'Invalid assignee', null, 'todo', 'medium', 0, null, null, array['a1000000-0000-4000-8000-000000000004']::uuid[])$$,
  'RT422',
  'INVALID_ASSIGNEE',
  'non-member assignee is rejected with the stable RPC error'
);
select is((select count(*)::integer from public.tasks where id = 'a4000000-0000-4000-8000-000000000005'), 0, 'invalid assignee failure leaves no partial task');

reset role;
select * from finish();
rollback;
