begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', '20261111@project-manager.local', crypt('derived', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"user","account_active":true}', '{"student_id":"20261111","name":"일반 사용자"}', now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', '20262222@project-manager.local', crypt('derived', gen_salt('bf')), now(), '{"must_change_password":false,"system_role":"admin","account_active":true}', '{"student_id":"20262222","name":"시스템 관리자"}', now(), now());

update public.profiles
set account_status = 'active',
    system_role = case when id = 'a0000000-0000-4000-8000-000000000002' then 'admin'::public.system_role else 'user'::public.system_role end
where id in ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.begin_project_creation('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'blocked', null, 'blocked', 'private', 'c0000000-0000-4000-8000-000000000001', '{}'::jsonb, '{}'::jsonb)$$,
  '42501',
  null,
  'authenticated callers cannot execute the service-role project RPC'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$select public.begin_project_creation('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'blocked', null, 'blocked', 'private', 'c0000000-0000-4000-8000-000000000002', '{}'::jsonb, '{}'::jsonb)$$,
  'PPC01',
  null,
  'service role still cannot create a project for a normal user UUID'
);
select lives_ok(
  $$select public.begin_project_creation('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'allowed', null, 'allowed', 'private', 'c0000000-0000-4000-8000-000000000003', '{}'::jsonb, '{}'::jsonb)$$,
  'active system admin can create a project'
);
select is(
  (select count(*)::integer from public.projects where id = 'b0000000-0000-4000-8000-000000000003' and created_by = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'created project is bound to the verified admin UUID'
);

select * from finish();
rollback;
