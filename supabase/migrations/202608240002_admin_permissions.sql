begin;

create type public.admin_permission as enum (
  'projects.view',
  'projects.create',
  'projects.delete',
  'users.view',
  'users.create',
  'users.delete',
  'users.change_status',
  'users.reset_password',
  'users.change_role',
  'users.manage_permissions',
  'access_logs.view'
);

create table public.user_admin_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission public.admin_permission not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key (user_id, permission)
);

create index user_admin_permissions_permission_idx
  on public.user_admin_permissions(permission, user_id);

create or replace function public.enforce_admin_permission_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = new.user_id
      and profile.system_role = 'admin'
  ) then
    raise exception using errcode = '23514', message = 'ADMIN_PERMISSION_REQUIRES_ADMIN_ROLE';
  end if;
  return new;
end;
$$;

create trigger user_admin_permissions_admin_only
before insert or update of user_id on public.user_admin_permissions
for each row execute function public.enforce_admin_permission_owner();

create or replace function public.remove_admin_permissions_when_demoted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.system_role = 'admin' and new.system_role = 'user' then
    delete from public.user_admin_permissions permission
    where permission.user_id = new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_remove_permissions_when_demoted
after update of system_role on public.profiles
for each row
when (old.system_role is distinct from new.system_role)
execute function public.remove_admin_permissions_when_demoted();

alter table public.user_admin_permissions enable row level security;
alter table public.user_admin_permissions force row level security;

create policy user_admin_permissions_select_self
on public.user_admin_permissions for select to authenticated
using (user_id = auth.uid() and public.is_system_admin());

revoke all privileges on table public.user_admin_permissions
from public, anon, authenticated;
grant select on table public.user_admin_permissions to authenticated;
grant all privileges on table public.user_admin_permissions to service_role;

revoke all on function public.enforce_admin_permission_owner()
from public, anon, authenticated;
revoke all on function public.remove_admin_permissions_when_demoted()
from public, anon, authenticated;
grant execute on function public.enforce_admin_permission_owner() to service_role;
grant execute on function public.remove_admin_permissions_when_demoted() to service_role;

insert into public.user_admin_permissions(user_id, permission, created_by)
select profile.id, permission.permission, profile.id
from public.profiles profile
cross join unnest(enum_range(null::public.admin_permission)) permission(permission)
where profile.system_role = 'admin'
  and profile.account_status = 'active'
on conflict (user_id, permission) do nothing;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check check (action in (
    'user_created',
    'password_reset',
    'user_deactivated',
    'user_reactivated',
    'user_deleted',
    'user_role_changed',
    'user_permissions_changed'
  ));

create or replace function public.set_admin_permissions(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_permissions text[]
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
  v_previous_permissions text[];
  v_next_permissions text[];
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(724202608240002);

  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions actor_permission
      on actor_permission.user_id = actor.id
     and actor_permission.permission = 'users.manage_permissions'
    where actor.id = p_actor_id
      and actor.system_role = 'admin'
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_PERMISSION_REQUIRED';
  end if;

  select * into v_target
  from public.profiles target
  where target.id = p_target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;
  if v_target.system_role <> 'admin' then
    raise exception using errcode = '23514', message = 'TARGET_ADMIN_REQUIRED';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_permissions, array[]::text[])) requested(permission)
    where not exists (
      select 1
      from unnest(enum_range(null::public.admin_permission)) allowed(permission)
      where allowed.permission::text = requested.permission
    )
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_PERMISSION';
  end if;

  select coalesce(array_agg(permission.permission::text order by permission.permission::text), array[]::text[])
  into v_previous_permissions
  from public.user_admin_permissions permission
  where permission.user_id = p_target_user_id;

  select coalesce(array_agg(distinct requested.permission order by requested.permission), array[]::text[])
  into v_next_permissions
  from unnest(coalesce(p_permissions, array[]::text[])) requested(permission);

  if v_target.account_status = 'active'
     and 'users.manage_permissions' = any(v_previous_permissions)
     and not ('users.manage_permissions' = any(v_next_permissions))
     and not exists (
       select 1
       from public.profiles other_admin
       join public.user_admin_permissions manager_permission
         on manager_permission.user_id = other_admin.id
        and manager_permission.permission = 'users.manage_permissions'
       where other_admin.id <> p_target_user_id
         and other_admin.system_role = 'admin'
         and other_admin.account_status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'LAST_PERMISSION_ADMIN';
  end if;

  delete from public.user_admin_permissions permission
  where permission.user_id = p_target_user_id;

  insert into public.user_admin_permissions(user_id, permission, created_by)
  select p_target_user_id, requested.permission::public.admin_permission, p_actor_id
  from unnest(v_next_permissions) requested(permission);

  insert into public.admin_audit_logs(actor_id, action, target_user_id, details)
  values (
    p_actor_id,
    'user_permissions_changed',
    p_target_user_id,
    jsonb_build_object(
      'previous_permissions', to_jsonb(v_previous_permissions),
      'new_permissions', to_jsonb(v_next_permissions)
    )
  );

  return v_next_permissions;
end;
$$;

create or replace function public.set_managed_system_role(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_new_role public.system_role
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
  v_previous_role public.system_role;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(724202608240002);

  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions actor_permission
      on actor_permission.user_id = actor.id
     and actor_permission.permission = 'users.change_role'
    where actor.id = p_actor_id
      and actor.system_role = 'admin'
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_PERMISSION_REQUIRED';
  end if;

  select * into v_target
  from public.profiles target
  where target.id = p_target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  v_previous_role := v_target.system_role;
  if v_previous_role = p_new_role then
    return v_target;
  end if;

  if v_previous_role = 'admin' and p_new_role = 'user' and not exists (
    select 1
    from public.profiles other_admin
    where other_admin.id <> p_target_user_id
      and other_admin.system_role = 'admin'
      and other_admin.account_status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'LAST_SYSTEM_ADMIN';
  end if;

  if v_previous_role = 'admin'
     and p_new_role = 'user'
     and v_target.account_status = 'active'
     and exists (
       select 1 from public.user_admin_permissions permission
       where permission.user_id = p_target_user_id
         and permission.permission = 'users.manage_permissions'
     )
     and not exists (
       select 1
       from public.profiles other_admin
       join public.user_admin_permissions manager_permission
         on manager_permission.user_id = other_admin.id
        and manager_permission.permission = 'users.manage_permissions'
       where other_admin.id <> p_target_user_id
         and other_admin.system_role = 'admin'
         and other_admin.account_status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'LAST_PERMISSION_ADMIN';
  end if;

  update public.profiles
  set system_role = p_new_role
  where id = p_target_user_id
  returning * into v_target;

  insert into public.admin_audit_logs(actor_id, action, target_user_id, details)
  values (
    p_actor_id,
    'user_role_changed',
    p_target_user_id,
    jsonb_build_object('previous_role', v_previous_role, 'new_role', p_new_role)
  );

  return v_target;
end;
$$;

create or replace function public.restore_system_role_and_permissions_after_auth_failure(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_expected_role public.system_role,
  p_restore_role public.system_role,
  p_restore_permissions text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(724202608240002);

  if exists (
    select 1
    from unnest(coalesce(p_restore_permissions, array[]::text[])) requested(permission)
    where not exists (
      select 1
      from unnest(enum_range(null::public.admin_permission)) allowed(permission)
      where allowed.permission::text = requested.permission
    )
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_PERMISSION';
  end if;

  update public.profiles
  set system_role = p_restore_role
  where id = p_target_user_id
    and system_role = p_expected_role;

  if not found then
    raise exception using errcode = '40001', message = 'ROLE_ROLLBACK_CONFLICT';
  end if;

  delete from public.user_admin_permissions permission
  where permission.user_id = p_target_user_id;

  if p_restore_role = 'admin' then
    insert into public.user_admin_permissions(user_id, permission, created_by)
    select p_target_user_id, requested.permission::public.admin_permission, p_actor_id
    from (
      select distinct permission
      from unnest(coalesce(p_restore_permissions, array[]::text[])) restored(permission)
    ) requested;
  end if;

  insert into public.admin_audit_logs(actor_id, action, target_user_id, details)
  values (
    p_actor_id,
    'user_role_changed',
    p_target_user_id,
    jsonb_build_object(
      'expected_role', p_expected_role,
      'restored_role', p_restore_role,
      'restored_permissions', to_jsonb(coalesce(p_restore_permissions, array[]::text[])),
      'rolled_back', true
    )
  );
end;
$$;

create or replace function public.set_managed_account_status(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_next_status public.account_status
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(724202608240002);

  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions actor_permission
      on actor_permission.user_id = actor.id
     and actor_permission.permission = 'users.change_status'
    where actor.id = p_actor_id
      and actor.system_role = 'admin'
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_PERMISSION_REQUIRED';
  end if;

  select * into v_target
  from public.profiles target
  where target.id = p_target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  if p_next_status = 'inactive'
     and v_target.system_role = 'admin'
     and v_target.account_status = 'active'
     and not exists (
       select 1
       from public.profiles other_admin
       where other_admin.id <> p_target_user_id
         and other_admin.system_role = 'admin'
         and other_admin.account_status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'LAST_SYSTEM_ADMIN';
  end if;

  if p_next_status = 'inactive'
     and v_target.system_role = 'admin'
     and v_target.account_status = 'active'
     and exists (
       select 1 from public.user_admin_permissions permission
       where permission.user_id = p_target_user_id
         and permission.permission = 'users.manage_permissions'
     )
     and not exists (
       select 1
       from public.profiles other_admin
       join public.user_admin_permissions manager_permission
         on manager_permission.user_id = other_admin.id
        and manager_permission.permission = 'users.manage_permissions'
       where other_admin.id <> p_target_user_id
         and other_admin.system_role = 'admin'
         and other_admin.account_status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'LAST_PERMISSION_ADMIN';
  end if;

  update public.profiles
  set account_status = p_next_status
  where id = p_target_user_id
  returning * into v_target;

  return v_target;
end;
$$;

revoke all on function public.set_admin_permissions(uuid, uuid, text[])
from public, anon, authenticated;
revoke all on function public.set_managed_system_role(uuid, uuid, public.system_role)
from public, anon, authenticated;
revoke all on function public.restore_system_role_and_permissions_after_auth_failure(uuid, uuid, public.system_role, public.system_role, text[])
from public, anon, authenticated;
revoke all on function public.set_managed_account_status(uuid, uuid, public.account_status)
from public, anon, authenticated;
grant execute on function public.set_admin_permissions(uuid, uuid, text[])
to service_role;
grant execute on function public.set_managed_system_role(uuid, uuid, public.system_role)
to service_role;
grant execute on function public.restore_system_role_and_permissions_after_auth_failure(uuid, uuid, public.system_role, public.system_role, text[])
to service_role;
grant execute on function public.set_managed_account_status(uuid, uuid, public.account_status)
to service_role;

notify pgrst, 'reload schema';
commit;
