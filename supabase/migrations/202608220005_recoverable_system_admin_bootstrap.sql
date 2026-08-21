begin;

alter table public.system_admin_bootstrap_state
  add column if not exists requested_student_id text;

alter table public.system_admin_bootstrap_state
  drop constraint if exists system_admin_bootstrap_state_requested_student_id_check;
alter table public.system_admin_bootstrap_state
  add constraint system_admin_bootstrap_state_requested_student_id_check
  check (requested_student_id is null or requested_student_id ~ '^[0-9]{6,12}$');

create or replace function public.prepare_system_admin_bootstrap(
  p_claim_id uuid,
  p_student_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_state public.system_admin_bootstrap_state;
  v_auth_id uuid;
  v_auth_role text;
  v_auth_student_id text;
  v_auth_must_change boolean;
  v_profile_id uuid;
  v_profile_role public.system_role;
  v_completed_student_id text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'BOOTSTRAP_SERVICE_ROLE_REQUIRED';
  end if;
  if p_student_id is null or p_student_id !~ '^[0-9]{6,12}$' then
    raise exception using errcode = 'PBA10', message = 'BOOTSTRAP_INVALID_STUDENT_ID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(724202608220004);
  v_email := p_student_id || '@project-manager.local';

  select * into v_state
  from public.system_admin_bootstrap_state state
  where state.singleton = true
  for update;

  select profile.student_id into v_completed_student_id
  from public.profiles profile
  where v_state.status = 'completed' and profile.id = v_state.user_id;

  if v_state.status = 'completed' then
    if v_completed_student_id = p_student_id
       and exists (
         select 1
         from auth.users auth_user
         join public.profiles profile on profile.id = auth_user.id
         where auth_user.id = v_state.user_id
           and lower(auth_user.email) = lower(v_email)
           and auth_user.raw_app_meta_data ->> 'system_role' = 'admin'
           and profile.system_role = 'admin'
       ) then
      return jsonb_build_object(
        'status', 'completed',
        'user_id', v_state.user_id,
        'auth_user_exists', true,
        'profile_exists', true,
        'must_change_password', (
          select coalesce(auth_user.raw_app_meta_data ->> 'must_change_password', 'true') = 'true'
          from auth.users auth_user
          where auth_user.id = v_state.user_id
        )
      );
    end if;
    if v_completed_student_id is null then
      raise exception using errcode = 'PBA02', message = 'BOOTSTRAP_COMPLETED_STATE_INVALID';
    end if;
    if v_completed_student_id <> p_student_id then
      raise exception using errcode = 'PBA01', message = 'BOOTSTRAP_ALREADY_COMPLETED_FOR_OTHER_USER';
    end if;
    raise exception using errcode = 'PBA02', message = 'BOOTSTRAP_COMPLETED_STATE_INVALID';
  end if;

  select
    auth_user.id,
    auth_user.raw_app_meta_data ->> 'system_role',
    auth_user.raw_user_meta_data ->> 'student_id',
    coalesce(auth_user.raw_app_meta_data ->> 'must_change_password', 'true') = 'true'
  into v_auth_id, v_auth_role, v_auth_student_id, v_auth_must_change
  from auth.users auth_user
  where lower(auth_user.email) = lower(v_email)
  order by auth_user.created_at
  limit 1;

  select profile.id, profile.system_role
  into v_profile_id, v_profile_role
  from public.profiles profile
  where profile.student_id = p_student_id;

  if v_profile_id is not null and (v_auth_id is null or v_profile_id <> v_auth_id) then
    raise exception using errcode = 'PBA04', message = 'BOOTSTRAP_PROFILE_WITHOUT_MATCHING_AUTH_USER';
  end if;

  if v_auth_id is not null and (v_auth_role is distinct from 'admin' or v_auth_student_id is distinct from p_student_id) then
    raise exception using errcode = 'PBA03', message = 'BOOTSTRAP_EXISTING_AUTH_USER_NOT_RECOVERABLE';
  end if;

  if exists (
    select 1 from auth.users auth_user
    where auth_user.raw_app_meta_data ->> 'system_role' = 'admin'
      and (v_auth_id is null or auth_user.id <> v_auth_id)
  ) or exists (
    select 1 from public.profiles profile
    where profile.system_role = 'admin'
      and (v_auth_id is null or profile.id <> v_auth_id)
  ) then
    raise exception using errcode = 'PBA05', message = 'BOOTSTRAP_ANOTHER_ADMIN_EXISTS';
  end if;

  if v_state.status = 'claimed'
     and v_state.claim_id <> p_claim_id
     and v_state.claimed_at > now() - interval '15 minutes'
     and v_state.requested_student_id is not null
     and v_auth_id is null then
    raise exception using errcode = 'PBA06', message = 'BOOTSTRAP_CLAIM_IN_PROGRESS';
  end if;

  insert into public.system_admin_bootstrap_state(
    singleton,
    claim_id,
    status,
    user_id,
    claimed_at,
    completed_at,
    requested_student_id
  )
  values (true, p_claim_id, 'claimed', null, now(), null, p_student_id)
  on conflict (singleton) do update set
    claim_id = excluded.claim_id,
    status = 'claimed',
    user_id = null,
    claimed_at = excluded.claimed_at,
    completed_at = null,
    requested_student_id = excluded.requested_student_id;

  return jsonb_build_object(
    'status', 'ready',
    'user_id', v_auth_id,
    'auth_user_exists', v_auth_id is not null,
    'profile_exists', v_profile_id is not null,
    'must_change_password', case when v_auth_id is null then null else v_auth_must_change end,
    'profile_role', case when v_profile_role is null then null else v_profile_role::text end
  );
end;
$$;

create or replace function public.finalize_system_admin_bootstrap_recovery(
  p_claim_id uuid,
  p_user_id uuid,
  p_student_id text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.system_admin_bootstrap_state;
  v_auth_email text;
  v_auth_role text;
  v_auth_student_id text;
  v_auth_must_change text;
  v_auth_active text;
  v_profile public.profiles;
  v_profile_created boolean := false;
  v_audit_logged boolean := true;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'BOOTSTRAP_SERVICE_ROLE_REQUIRED';
  end if;
  if p_student_id is null or p_student_id !~ '^[0-9]{6,12}$' then
    raise exception using errcode = 'PBA10', message = 'BOOTSTRAP_INVALID_STUDENT_ID';
  end if;
  if p_name is null or char_length(p_name) not between 1 and 80 then
    raise exception using errcode = 'PBA11', message = 'BOOTSTRAP_INVALID_NAME';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(724202608220004);

  select * into v_state
  from public.system_admin_bootstrap_state state
  where state.singleton = true
  for update;

  if v_state.status = 'completed' then
    if v_state.user_id = p_user_id
       and coalesce(v_state.requested_student_id, p_student_id) = p_student_id then
      return jsonb_build_object(
        'status', 'completed',
        'user_id', p_user_id,
        'profile_created', false,
        'audit_logged', true
      );
    end if;
    raise exception using errcode = 'PBA01', message = 'BOOTSTRAP_ALREADY_COMPLETED_FOR_OTHER_USER';
  end if;

  if v_state.status is distinct from 'claimed'
     or v_state.claim_id is distinct from p_claim_id
     or v_state.requested_student_id is distinct from p_student_id then
    raise exception using errcode = 'PBA07', message = 'BOOTSTRAP_CLAIM_NOT_ACTIVE';
  end if;

  select
    auth_user.email,
    auth_user.raw_app_meta_data ->> 'system_role',
    auth_user.raw_user_meta_data ->> 'student_id',
    auth_user.raw_app_meta_data ->> 'must_change_password',
    auth_user.raw_app_meta_data ->> 'account_active'
  into v_auth_email, v_auth_role, v_auth_student_id, v_auth_must_change, v_auth_active
  from auth.users auth_user
  where auth_user.id = p_user_id;

  if v_auth_email is null
     or lower(v_auth_email) <> lower(p_student_id || '@project-manager.local')
     or v_auth_role is distinct from 'admin'
     or v_auth_student_id is distinct from p_student_id
     or v_auth_active = 'false' then
    raise exception using errcode = 'PBA08', message = 'BOOTSTRAP_AUTH_USER_INVALID';
  end if;

  if exists (
    select 1 from auth.users auth_user
    where lower(auth_user.email) = lower(p_student_id || '@project-manager.local')
      and auth_user.id <> p_user_id
  ) or exists (
    select 1 from auth.users auth_user
    where auth_user.raw_app_meta_data ->> 'system_role' = 'admin'
      and auth_user.id <> p_user_id
  ) or exists (
    select 1 from public.profiles profile
    where profile.student_id = p_student_id and profile.id <> p_user_id
  ) or exists (
    select 1 from public.profiles profile
    where profile.system_role = 'admin' and profile.id <> p_user_id
  ) then
    raise exception using errcode = 'PBA09', message = 'BOOTSTRAP_IDENTITY_CONFLICT';
  end if;

  select * into v_profile
  from public.profiles profile
  where profile.id = p_user_id
  for update;

  if v_profile.id is null then
    insert into public.profiles(id, student_id, name, system_role, account_status)
    values (
      p_user_id,
      p_student_id,
      p_name,
      'admin',
      case
        when coalesce(v_auth_must_change, 'true') = 'true' then 'password_change_required'::public.account_status
        else 'active'::public.account_status
      end
    );
    v_profile_created := true;
  else
    if v_profile.student_id <> p_student_id or v_profile.account_status = 'inactive' then
      raise exception using errcode = 'PBA12', message = 'BOOTSTRAP_PROFILE_INVALID';
    end if;
    update public.profiles
    set system_role = 'admin',
        account_status = case
          when coalesce(v_auth_must_change, 'true') = 'true' then 'password_change_required'::public.account_status
          else 'active'::public.account_status
        end
    where id = p_user_id;
  end if;

  update public.system_admin_bootstrap_state
  set status = 'completed',
      user_id = p_user_id,
      completed_at = now(),
      requested_student_id = p_student_id
  where singleton = true and claim_id = p_claim_id;

  begin
    if not exists (
      select 1 from public.admin_audit_logs audit
      where audit.target_user_id = p_user_id
        and audit.action = 'user_created'
        and audit.details @> '{"bootstrap":true}'::jsonb
    ) then
      insert into public.admin_audit_logs(actor_id, action, target_user_id, details)
      values (p_user_id, 'user_created', p_user_id, '{"bootstrap":true,"recovery_version":2}'::jsonb);
    end if;
  exception when others then
    v_audit_logged := false;
  end;

  return jsonb_build_object(
    'status', 'completed',
    'user_id', p_user_id,
    'profile_created', v_profile_created,
    'audit_logged', v_audit_logged
  );
end;
$$;

create or replace function public.release_system_admin_bootstrap_recovery(p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_count bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'BOOTSTRAP_SERVICE_ROLE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(724202608220004);

  delete from public.system_admin_bootstrap_state state
  where state.singleton = true
    and state.claim_id = p_claim_id
    and state.status = 'claimed'
    and not exists (select 1 from public.profiles profile where profile.system_role = 'admin')
    and not exists (
      select 1 from auth.users auth_user
      where auth_user.raw_app_meta_data ->> 'system_role' = 'admin'
    );
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

revoke all on function public.prepare_system_admin_bootstrap(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_system_admin_bootstrap_recovery(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_system_admin_bootstrap_recovery(uuid) from public, anon, authenticated;
grant execute on function public.prepare_system_admin_bootstrap(uuid, text) to service_role;
grant execute on function public.finalize_system_admin_bootstrap_recovery(uuid, uuid, text, text) to service_role;
grant execute on function public.release_system_admin_bootstrap_recovery(uuid) to service_role;

revoke execute on function public.claim_system_admin_bootstrap(uuid) from service_role;
revoke execute on function public.finalize_system_admin_bootstrap(uuid, uuid) from service_role;
revoke execute on function public.release_system_admin_bootstrap(uuid) from service_role;

commit;
