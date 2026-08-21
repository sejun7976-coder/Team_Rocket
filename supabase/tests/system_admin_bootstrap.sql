begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.prepare_system_admin_bootstrap('a0000000-0000-4000-8000-000000000001', '20990001') ->> 'status',
  'ready',
  'service role prepares a new bootstrap claim'
);
select is(
  (select requested_student_id from public.system_admin_bootstrap_state where singleton = true),
  '20990001',
  'the recovery claim records the intended student ID'
);

reset role;
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  'a0000000-0000-4000-8000-000000000010',
  'authenticated',
  'authenticated',
  '20990001@project-manager.local',
  crypt('derived-credential-fixture', gen_salt('bf')),
  now(),
  '{"must_change_password":true,"system_role":"admin","account_active":true}',
  '{"student_id":"20990001","name":"Bootstrap Admin"}',
  now(),
  now()
);
select is(
  (select system_role::text from public.profiles where id = 'a0000000-0000-4000-8000-000000000010'),
  'admin',
  'the Auth trigger creates an administrator profile'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select public.finalize_system_admin_bootstrap_recovery(
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000010',
    '20990001',
    'Bootstrap Admin'
  )$$,
  'service role finalizes the claimed administrator'
);
select is(
  (select status from public.system_admin_bootstrap_state where singleton = true),
  'completed',
  'bootstrap latch is permanently completed'
);
select is(
  public.prepare_system_admin_bootstrap('a0000000-0000-4000-8000-000000000002', '20990001') ->> 'status',
  'completed',
  'retrying the completed identity is idempotent'
);
select throws_ok(
  $$select public.prepare_system_admin_bootstrap('a0000000-0000-4000-8000-000000000003', '20990002')$$,
  'PBA01',
  'BOOTSTRAP_ALREADY_COMPLETED_FOR_OTHER_USER',
  'a different administrator remains permanently blocked'
);

reset role;
delete from public.system_admin_bootstrap_state;
delete from auth.users where id = 'a0000000-0000-4000-8000-000000000010';
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  'a0000000-0000-4000-8000-000000000020',
  'authenticated',
  'authenticated',
  '20990002@project-manager.local',
  crypt('derived-credential-fixture', gen_salt('bf')),
  now(),
  '{"must_change_password":true,"system_role":"admin","account_active":true}',
  '{"student_id":"20990002","name":"Auth Only Admin"}',
  now(),
  now()
);
delete from public.profiles where id = 'a0000000-0000-4000-8000-000000000020';

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.prepare_system_admin_bootstrap('a0000000-0000-4000-8000-000000000021', '20990002') ->> 'user_id',
  'a0000000-0000-4000-8000-000000000020',
  'an Auth-only partial bootstrap reuses the existing UUID'
);
select lives_ok(
  $$select public.finalize_system_admin_bootstrap_recovery(
    'a0000000-0000-4000-8000-000000000021',
    'a0000000-0000-4000-8000-000000000020',
    '20990002',
    'Auth Only Admin'
  )$$,
  'finalize repairs an Auth-only partial bootstrap'
);
select is(
  (select system_role::text from public.profiles where id = 'a0000000-0000-4000-8000-000000000020'),
  'admin',
  'Auth-only recovery recreates the administrator profile'
);

reset role;
delete from public.system_admin_bootstrap_state;
delete from auth.users where id = 'a0000000-0000-4000-8000-000000000020';
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  'a0000000-0000-4000-8000-000000000030',
  'authenticated',
  'authenticated',
  'different-address@project-manager.local',
  crypt('derived-credential-fixture', gen_salt('bf')),
  now(),
  '{"must_change_password":true,"system_role":"admin","account_active":true}',
  '{"student_id":"20990003","name":"Profile Without Matching Auth"}',
  now(),
  now()
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$select public.prepare_system_admin_bootstrap('a0000000-0000-4000-8000-000000000031', '20990003')$$,
  'PBA04',
  'BOOTSTRAP_PROFILE_WITHOUT_MATCHING_AUTH_USER',
  'a profile without the matching internal-email Auth identity is not mutated'
);

reset role;
delete from public.system_admin_bootstrap_state;
delete from auth.users where id = 'a0000000-0000-4000-8000-000000000030';
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  'a0000000-0000-4000-8000-000000000040',
  'authenticated',
  'authenticated',
  '20990004@project-manager.local',
  crypt('derived-credential-fixture', gen_salt('bf')),
  now(),
  '{"must_change_password":true,"system_role":"user","account_active":true}',
  '{"student_id":"20990004","name":"Existing User"}',
  now(),
  now()
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$select public.prepare_system_admin_bootstrap('a0000000-0000-4000-8000-000000000041', '20990004')$$,
  'PBA03',
  'BOOTSTRAP_EXISTING_AUTH_USER_NOT_RECOVERABLE',
  'an existing normal user is never promoted by bootstrap'
);

reset role;
delete from public.system_admin_bootstrap_state;
delete from auth.users where id = 'a0000000-0000-4000-8000-000000000040';
insert into public.system_admin_bootstrap_state(singleton, claim_id, status, claimed_at, requested_student_id)
values (true, 'a0000000-0000-4000-8000-000000000050', 'claimed', now(), null);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.prepare_system_admin_bootstrap('a0000000-0000-4000-8000-000000000051', '20990005') ->> 'status',
  'ready',
  'a legacy incomplete claim without an Auth user is immediately recoverable'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000099","role":"authenticated"}', true);
select throws_ok(
  $$select public.prepare_system_admin_bootstrap('a0000000-0000-4000-8000-000000000060', '20990006')$$,
  '42501',
  null,
  'authenticated cannot execute the recovery RPC'
);

select * from finish();
rollback;
