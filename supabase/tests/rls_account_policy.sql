begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', '20260001@project-manager.local', crypt('1234', gen_salt('bf')), now(), '{"must_change_password":true,"system_role":"user","account_active":true}', '{"student_id":"20260001","name":"최초사용자"}', now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', '20260002@project-manager.local', crypt('7281', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"user","account_active":true}', '{"student_id":"20260002","name":"활성사용자"}', now(), now()),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', '20260003@project-manager.local', crypt('9999', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"user","account_active":true}', '{"student_id":"20260003","name":"외부사용자"}', now(), now());

update public.profiles
set account_status = case when id = '00000000-0000-4000-8000-000000000001' then 'password_change_required'::public.account_status else 'active'::public.account_status end
where id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003'
);

insert into public.projects(id, name, created_by, github_repository_name, idempotency_key, status)
values ('10000000-0000-4000-8000-000000000001', 'RLS Test', '00000000-0000-4000-8000-000000000002', 'rls-test', '20000000-0000-4000-8000-000000000001', 'active');
insert into public.project_members(project_id, user_id, role, added_by)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'member', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'owner', '00000000-0000-4000-8000-000000000002');

insert into public.project_keys(project_id, user_id, wrapped_key, ephemeral_public_key, created_by)
values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '{}'::jsonb, '{}'::jsonb, '00000000-0000-4000-8000-000000000002');
insert into public.tasks(id, project_id, title, created_by)
values ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Protected task', '00000000-0000-4000-8000-000000000002');
insert into public.task_assignees(task_id, user_id, assigned_by)
values ('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002');
insert into public.task_checklist_items(id, task_id, content_encrypted, created_by)
values ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '{}'::jsonb, '00000000-0000-4000-8000-000000000002');
insert into public.comments(id, task_id, author_id, content_encrypted)
values ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '{}'::jsonb);
insert into public.activities(id, project_id, actor_id, action, subject_type, subject_id)
values ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'test_activity', 'task', '50000000-0000-4000-8000-000000000001');
insert into public.files(id, project_id, storage_path, original_name_encrypted, original_size, encrypted_size, chunk_count, checksum_encrypted, uploaded_by)
values ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001/encrypted.bin', '{}'::jsonb, 1, 1, 1, '{}'::jsonb, '00000000-0000-4000-8000-000000000002');
insert into public.notifications(id, user_id, project_id, task_id, type, title)
values ('80000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'task_assigned', 'Protected notification');
insert into public.github_sync_jobs(id, project_id, user_id, action, status)
values ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'add_collaborator', 'pending');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"must_change_password":true,"account_active":true,"system_role":"user"}}', true);
select is(public.can_access_business_data(), false, 'pending user is not business-ready');
select is((select count(*)::integer from public.projects), 0, 'pending user cannot select a member project');
select throws_ok(
  $$insert into public.tasks(project_id, title, created_by) values ('10000000-0000-4000-8000-000000000001', 'blocked', '00000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'pending user cannot insert project data'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"must_change_password":false,"account_active":true,"system_role":"user"}}', true);
select is(public.can_access_business_data(), true, 'active password-changed user is business-ready');
select is((select count(*)::integer from public.projects), 1, 'ready member can select the project');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"must_change_password":false,"account_active":true,"system_role":"user"}}', true);
select is((select count(*)::integer from public.projects), 0, 'non-member cannot select the project');
select is((select count(*)::integer from public.tasks), 0, 'non-member cannot select project tasks');
select is(public.task_project_id('50000000-0000-4000-8000-000000000001')::text, null::text, 'non-member cannot resolve a known task UUID through the policy helper RPC');
select is((select count(*)::integer from public.profiles where id = '00000000-0000-4000-8000-000000000002'), 0, 'non-member cannot select another profile by UUID');
select is((select count(*)::integer from public.project_members where project_id = '10000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select project_members by project UUID');
select is((select count(*)::integer from public.project_keys where project_id = '10000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select project_keys by project UUID');
select is((select count(*)::integer from public.task_assignees where task_id = '50000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select task_assignees by task UUID');
select is((select count(*)::integer from public.task_checklist_items where task_id = '50000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select checklist items by task UUID');
select is((select count(*)::integer from public.comments where task_id = '50000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select comments by task UUID');
select is((select count(*)::integer from public.activities where project_id = '10000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select activities by project UUID');
select is((select count(*)::integer from public.files where project_id = '10000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select file metadata by project UUID');
select is((select count(*)::integer from public.notifications where id = '80000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select another user notification by UUID');
select is((select count(*)::integer from public.github_sync_jobs where project_id = '10000000-0000-4000-8000-000000000001'), 0, 'non-member cannot select GitHub jobs by project UUID');
select throws_ok(
  $$insert into public.tasks(id, project_id, title, created_by) values ('50000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 'attack', '00000000-0000-4000-8000-000000000003')$$,
  '42501',
  null,
  'non-member cannot insert a task with a known project UUID'
);
select is((with changed as (update public.projects set name = 'attacked' where id = '10000000-0000-4000-8000-000000000001' returning 1) select count(*)::integer from changed), 0, 'non-member cannot update a project by UUID');
select is((with changed as (update public.tasks set title = 'attacked' where id = '50000000-0000-4000-8000-000000000001' returning 1) select count(*)::integer from changed), 0, 'non-member cannot update a task by UUID');
select is((with removed as (delete from public.tasks where id = '50000000-0000-4000-8000-000000000001' returning 1) select count(*)::integer from removed), 0, 'non-member cannot delete a task by UUID');
select throws_ok(
  $$insert into public.comments(id, task_id, author_id, content_encrypted) values ('60000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '{}'::jsonb)$$,
  '42501',
  null,
  'non-member cannot insert a comment with a known task UUID'
);
select throws_ok(
  $$insert into public.files(id, project_id, storage_path, original_name_encrypted, original_size, encrypted_size, chunk_count, checksum_encrypted, uploaded_by) values ('70000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000009/encrypted.bin', '{}'::jsonb, 1, 1, 1, '{}'::jsonb, '00000000-0000-4000-8000-000000000003')$$,
  '42501',
  null,
  'non-member cannot insert file metadata with a known project UUID'
);

reset role;
update public.profiles set account_status = 'inactive' where id = '00000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"must_change_password":false,"account_active":true,"system_role":"user"}}', true);
select is((select count(*)::integer from public.projects), 0, 'DB status blocks a stale JWT after deactivation or reset');

select * from finish();
rollback;
