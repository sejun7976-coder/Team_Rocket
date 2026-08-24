begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('d1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', '20991001@project-manager.local', crypt('fixture', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"admin","account_active":true}', '{"student_id":"20991001","name":"Permission Admin A"}', now(), now()),
  ('d1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', '20991002@project-manager.local', crypt('fixture', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"admin","account_active":true}', '{"student_id":"20991002","name":"Permission Admin B"}', now(), now()),
  ('d1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', '20991003@project-manager.local', crypt('fixture', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"admin","account_active":true}', '{"student_id":"20991003","name":"Permission Admin C"}', now(), now()),
  ('d1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', '20991004@project-manager.local', crypt('fixture', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"user","account_active":true}', '{"student_id":"20991004","name":"Permission User"}', now(), now());

update public.profiles
set account_status = 'active',
    system_role = case
      when id = 'd1000000-0000-4000-8000-000000000004' then 'user'::public.system_role
      else 'admin'::public.system_role
    end
where id in (
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000003',
  'd1000000-0000-4000-8000-000000000004'
);

insert into public.user_admin_permissions(user_id, permission, created_by)
values
  ('d1000000-0000-4000-8000-000000000001', 'users.manage_permissions', 'd1000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000001', 'users.change_role', 'd1000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000002', 'users.manage_permissions', 'd1000000-0000-4000-8000-000000000001');

select is(
  (select count(*)::integer from unnest(enum_range(null::public.admin_permission))),
  14,
  'the permission registry contains the existing and three AI keys'
);

select lives_ok(
  $$insert into public.user_admin_permissions(user_id, permission) values ('d1000000-0000-4000-8000-000000000004', 'projects.create')$$,
  'a User can hold a capability independently of role'
);
select is(
  (select count(*)::integer from public.user_admin_permissions where user_id = 'd1000000-0000-4000-8000-000000000004'),
  2,
  'the User capability and system-default ai.use are persisted in the single permission table'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select lives_ok(
  $$select public.set_user_permissions('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', array['projects.create','projects.delete'])$$,
  'a permission manager can replace another users permission list'
);
select is(
  (select count(*)::integer from public.user_admin_permissions where user_id = 'd1000000-0000-4000-8000-000000000003'),
  2,
  'the requested permission set is persisted exactly'
);
select throws_ok(
  $$select public.set_user_permissions('d1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', array['projects.create'])$$,
  '42501',
  'PERMISSION_REQUIRED',
  'role Admin does not bypass users.manage_permissions'
);

select lives_ok(
  $$select public.set_user_permissions('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', array['projects.create','users.view','users.change_role','users.manage_permissions','ai.manage'])$$,
  'an Admin permission manager can grant management capabilities to a User'
);
select lives_ok(
  $$select public.set_user_permissions('d1000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000003', array['ai.manage'])$$,
  'a User with users.manage_permissions can manage an Admin permission list'
);
select lives_ok(
  $$select public.set_ai_model_state_by_actor('d1000000-0000-4000-8000-000000000004', 'gpt-5.6-sol', true, true)$$,
  'a User with ai.manage can update the AI model state'
);

select lives_ok(
  $$select public.set_user_permissions('d1000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000002', array[]::text[])$$,
  'one permission manager can remove another while alternatives remain'
);
select lives_ok(
  $$select public.set_user_permissions('d1000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000001', array['users.change_role'])$$,
  'the Admin manager can be removed while an active User manager remains'
);
select throws_ok(
  $$select public.set_user_permissions('d1000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004', array['projects.create','users.view','users.change_role','ai.manage'])$$,
  'P0001',
  'LAST_PERMISSION_MANAGER',
  'the last active permission manager cannot remove its own management capability'
);

update public.profiles
set account_status = 'inactive'
where id in ('d1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003');

select throws_ok(
  $$select public.set_managed_system_role('d1000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000001', 'user')$$,
  'P0001',
  'LAST_SYSTEM_ADMIN',
  'the last active system Admin remains independently protected'
);

select * from finish();
rollback;
