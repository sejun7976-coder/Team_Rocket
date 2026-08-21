begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  '00000000-0000-4000-8000-000000000101',
  'authenticated',
  'authenticated',
  '20260101@project-manager.local',
  crypt('derived-test-value', gen_salt('bf')),
  now(),
  '{"must_change_password":true,"system_role":"user","account_active":true}',
  '{"student_id":"20260101","name":"Recovery User"}',
  now(),
  now()
);

select is(
  (select account_status::text from public.profiles where id = '00000000-0000-4000-8000-000000000101'),
  'password_change_required',
  'fixture begins in pending profile state'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select public.finalize_first_login_profile(
    '00000000-0000-4000-8000-000000000101',
    '{"kty":"EC","crv":"P-256","x":"x","y":"y"}'::jsonb,
    '{"version":1,"algorithm":"AES-256-GCM","iv":"0123456789012345","ciphertext":"ciphertext-value-for-pgtap-test"}'::jsonb,
    '0123456789012345678901',
    310000
  )$$,
  'service role can atomically finalize first login'
);

select is(
  (select account_status::text from public.profiles where id = '00000000-0000-4000-8000-000000000101'),
  'active',
  'profile becomes active'
);
select ok(
  (select encryption_public_key is not null and encrypted_private_key is not null and key_salt is not null
   from public.profiles where id = '00000000-0000-4000-8000-000000000101'),
  'keyring is committed with profile activation'
);

select lives_ok(
  $$select public.finalize_first_login_profile(
    '00000000-0000-4000-8000-000000000101',
    '{"replacement":true}'::jsonb,
    '{"replacement":true}'::jsonb,
    'replacement-salt-value',
    400000
  )$$,
  'same user finalize retry is idempotent'
);
select is(
  (select encryption_public_key ->> 'kty' from public.profiles where id = '00000000-0000-4000-8000-000000000101'),
  'EC',
  'retry preserves the first committed keyring'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select throws_ok(
  $$select public.finalize_first_login_profile(
    '00000000-0000-4000-8000-000000000101', '{}'::jsonb, '{}'::jsonb, '0123456789012345', 310000
  )$$,
  '42501',
  null,
  'authenticated browser role cannot execute finalize RPC'
);

reset role;
update public.profiles set account_status = 'inactive' where id = '00000000-0000-4000-8000-000000000101';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$select public.finalize_first_login_profile(
    '00000000-0000-4000-8000-000000000101', '{}'::jsonb, '{}'::jsonb, '0123456789012345', 310000
  )$$,
  'PFL03',
  'FIRST_LOGIN_ACCOUNT_INACTIVE',
  'inactive profile cannot be finalized'
);

select * from finish();
rollback;
