begin;

-- Keep the existing table as the single permission source of truth, but remove
-- the old role coupling. system_role is now classification only.
drop trigger if exists user_admin_permissions_admin_only on public.user_admin_permissions;
drop trigger if exists profiles_remove_permissions_when_demoted on public.profiles;

drop policy if exists user_admin_permissions_select_self on public.user_admin_permissions;
create policy user_admin_permissions_select_self
on public.user_admin_permissions for select to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.account_status = 'active'
  )
);

insert into public.user_admin_permissions(user_id, permission, created_by)
select profile.id, permission.permission, profile.id
from public.profiles profile
cross join unnest(array['ai.use', 'ai.manage']::public.admin_permission[]) permission(permission)
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
    'user_permissions_changed',
    'ai_model_settings_changed'
  ));

create or replace function public.set_user_permissions(
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
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_REQUIRED';
  end if;

  select * into v_target
  from public.profiles target
  where target.id = p_target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
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
    raise exception using errcode = '22023', message = 'INVALID_PERMISSION';
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
       from public.profiles other_user
       join public.user_admin_permissions manager_permission
         on manager_permission.user_id = other_user.id
        and manager_permission.permission = 'users.manage_permissions'
       where other_user.id <> p_target_user_id
         and other_user.account_status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'LAST_PERMISSION_MANAGER';
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

-- Backward-compatible service-role entry point for any older deployed caller.
create or replace function public.set_admin_permissions(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_permissions text[]
)
returns text[]
language sql
security definer
set search_path = ''
as $$
  select public.set_user_permissions(p_actor_id, p_target_user_id, p_permissions);
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
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_REQUIRED';
  end if;

  select * into v_target
  from public.profiles target
  where target.id = p_target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  v_previous_role := v_target.system_role;
  if v_previous_role = p_new_role then return v_target; end if;

  if v_previous_role = 'admin'
     and p_new_role = 'user'
     and v_target.account_status = 'active'
     and not exists (
       select 1 from public.profiles other_admin
       where other_admin.id <> p_target_user_id
         and other_admin.system_role = 'admin'
         and other_admin.account_status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'LAST_SYSTEM_ADMIN';
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

  update public.profiles
  set system_role = p_restore_role
  where id = p_target_user_id
    and system_role = p_expected_role;
  if not found then
    raise exception using errcode = '40001', message = 'ROLE_ROLLBACK_CONFLICT';
  end if;

  delete from public.user_admin_permissions permission
  where permission.user_id = p_target_user_id;

  insert into public.user_admin_permissions(user_id, permission, created_by)
  select p_target_user_id, requested.permission::public.admin_permission, p_actor_id
  from (
    select distinct permission
    from unnest(coalesce(p_restore_permissions, array[]::text[])) restored(permission)
  ) requested;

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
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_REQUIRED';
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
       select 1 from public.profiles other_admin
       where other_admin.id <> p_target_user_id
         and other_admin.system_role = 'admin'
         and other_admin.account_status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'LAST_SYSTEM_ADMIN';
  end if;

  if p_next_status = 'inactive'
     and v_target.account_status = 'active'
     and exists (
       select 1 from public.user_admin_permissions permission
       where permission.user_id = p_target_user_id
         and permission.permission = 'users.manage_permissions'
     )
     and not exists (
       select 1
       from public.profiles other_user
       join public.user_admin_permissions manager_permission
         on manager_permission.user_id = other_user.id
        and manager_permission.permission = 'users.manage_permissions'
       where other_user.id <> p_target_user_id
         and other_user.account_status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'LAST_PERMISSION_MANAGER';
  end if;

  update public.profiles
  set account_status = p_next_status
  where id = p_target_user_id
  returning * into v_target;
  return v_target;
end;
$$;

create or replace function public.protect_last_permission_manager_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.account_status = 'active'
     and exists (
       select 1 from public.user_admin_permissions permission
       where permission.user_id = old.id
         and permission.permission = 'users.manage_permissions'
     ) then
    perform pg_catalog.pg_advisory_xact_lock(724202608240002);
    if not exists (
      select 1
      from public.profiles other_user
      join public.user_admin_permissions manager_permission
        on manager_permission.user_id = other_user.id
       and manager_permission.permission = 'users.manage_permissions'
      where other_user.id <> old.id
        and other_user.account_status = 'active'
    ) then
      raise exception using errcode = 'P0001', message = 'LAST_PERMISSION_MANAGER';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_protect_last_permission_manager on public.profiles;
create trigger profiles_protect_last_permission_manager
before delete on public.profiles
for each row execute function public.protect_last_permission_manager_on_profile_delete();

create or replace function public.begin_project_creation(
  p_project_id uuid,
  p_created_by uuid,
  p_name text,
  p_description text,
  p_repository_name text,
  p_visibility text,
  p_idempotency_key uuid,
  p_wrapped_key jsonb,
  p_ephemeral_public_key jsonb
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions permission
      on permission.user_id = actor.id
     and permission.permission = 'projects.create'
    where actor.id = p_created_by
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = 'PPC01', message = 'PERMISSION_REQUIRED';
  end if;

  insert into public.projects(
    id, name, description, created_by, status, visibility,
    github_repository_name, idempotency_key, github_sync_status
  ) values (
    p_project_id, p_name, p_description, p_created_by, 'creating', p_visibility,
    p_repository_name, p_idempotency_key, 'pending'
  )
  on conflict (created_by, idempotency_key) do nothing;

  select * into v_project
  from public.projects
  where created_by = p_created_by and idempotency_key = p_idempotency_key;

  insert into public.project_members(project_id, user_id, role, added_by, github_sync_status)
  values (v_project.id, p_created_by, 'owner', p_created_by, 'synced')
  on conflict (project_id, user_id) do nothing;

  insert into public.project_keys(project_id, user_id, wrapped_key, ephemeral_public_key, created_by)
  values (v_project.id, p_created_by, p_wrapped_key, p_ephemeral_public_key, p_created_by)
  on conflict (project_id, user_id) do nothing;

  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (v_project.id, p_created_by, 'project_created', 'project', v_project.id)
  on conflict do nothing;

  return v_project;
end;
$$;

-- The Auth audit schema remains service-role-only. These RPCs now authorize by
-- capability so a User with access_logs.view has the same scoped result as an
-- Admin with that permission; role classification never grants access itself.
create or replace function public.list_auth_audit_logs_admin(
  p_actor_id uuid,
  p_user_id uuid,
  p_event_type text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id text,
  user_id uuid,
  event_type text,
  ip_address text,
  user_agent text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions actor_permission
      on actor_permission.user_id = actor.id
     and actor_permission.permission = 'access_logs.view'
    where actor.id = p_actor_id
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_REQUIRED';
  end if;
  if p_limit < 1 or p_limit > 501 or p_offset < 0 then
    raise exception using errcode = 'PAL04', message = 'invalid pagination';
  end if;

  return query
  with normalized as (
    select
      audit.id::text as id,
      case
        when coalesce(audit.payload ->> 'user_id', audit.payload ->> 'actor_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then coalesce(audit.payload ->> 'user_id', audit.payload ->> 'actor_id')::uuid
        else null
      end as user_id,
      audit.payload ->> 'action' as event_type,
      nullif(coalesce(to_jsonb(audit) ->> 'ip_address', audit.payload ->> 'ip_address'), '') as ip_address,
      nullif(audit.payload ->> 'user_agent', '') as user_agent,
      audit.created_at
    from auth.audit_log_entries as audit
  )
  select normalized.id, normalized.user_id, normalized.event_type,
    normalized.ip_address, normalized.user_agent, normalized.created_at
  from normalized
  where normalized.user_id = p_user_id
    and normalized.event_type in ('login', 'logout', 'user_updated_password', 'token_refreshed')
    and (p_event_type is null or normalized.event_type = p_event_type)
    and (p_from is null or normalized.created_at >= p_from)
    and (p_to is null or normalized.created_at <= p_to)
  order by normalized.created_at desc
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.summarize_auth_audit_logins_admin(p_actor_id uuid)
returns table (
  user_id uuid,
  login_count_30_days bigint,
  recent_ip_address text,
  recent_user_agent text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions actor_permission
      on actor_permission.user_id = actor.id
     and actor_permission.permission = 'users.view'
    where actor.id = p_actor_id
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_REQUIRED';
  end if;

  return query
  with logins as (
    select
      case
        when coalesce(audit.payload ->> 'user_id', audit.payload ->> 'actor_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then coalesce(audit.payload ->> 'user_id', audit.payload ->> 'actor_id')::uuid
        else null
      end as user_id,
      nullif(coalesce(to_jsonb(audit) ->> 'ip_address', audit.payload ->> 'ip_address'), '') as ip_address,
      nullif(audit.payload ->> 'user_agent', '') as user_agent,
      audit.created_at
    from auth.audit_log_entries as audit
    where audit.payload ->> 'action' = 'login'
      and audit.created_at >= now() - interval '30 days'
  )
  select
    logins.user_id,
    count(*) as login_count_30_days,
    (array_agg(logins.ip_address order by logins.created_at desc))[1] as recent_ip_address,
    (array_agg(logins.user_agent order by logins.created_at desc))[1] as recent_user_agent
  from logins
  where logins.user_id is not null
  group by logins.user_id;
end;
$$;

-- Reconcile the historical dormant registry with the requested central catalog.
insert into public.ai_model_settings(model_id, display_name, family, enabled, is_default, sort_order, is_builtin)
values
  ('gpt-5.6-luna', 'GPT-5.6 Luna', 'openai', false, false, 10, true),
  ('gpt-5.6-terra', 'GPT-5.6 Terra', 'openai', false, false, 20, true),
  ('gpt-5.6-sol', 'GPT-5.6 Sol', 'openai', true, false, 30, true),
  ('gpt-5.5', 'GPT-5.5', 'openai', false, false, 40, true),
  ('claude-sonnet-5', 'Claude Sonnet 5', 'claude', false, false, 110, true),
  ('claude-opus-5', 'Claude Opus 5', 'claude', false, false, 120, true),
  ('claude-fable-5', 'Claude Fable 5', 'claude', false, false, 130, true),
  ('claude-opus-4-8', 'Claude 4.8 Opus', 'claude', false, false, 140, true),
  ('claude-haiku-4-5-20251001', 'Claude 4.5 Haiku', 'claude', false, false, 150, true),
  ('gemini-3.7-flash', 'Gemini 3.7 Flash', 'gemini', false, false, 210, true),
  ('gemini-3.6-flash', 'Gemini 3.6 Flash', 'gemini', false, false, 220, true),
  ('gemini-3.5-flash', 'Gemini 3.5 Flash', 'gemini', false, false, 230, true),
  ('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'gemini', false, false, 240, true),
  ('gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'gemini', false, false, 250, true),
  ('grok-4.6', 'Grok 4.6', 'grok', false, false, 310, true),
  ('grok-4.5', 'Grok 4.5', 'grok', false, false, 320, true),
  ('grok-4-1-fast', 'Grok 4.1 Fast', 'grok', false, false, 330, true),
  ('google/gemma-4-31B-it', 'Gemma 4', 'gemma', false, false, 410, true),
  ('sonar-pro', 'Sonar Pro', 'perplexity', false, false, 510, true),
  ('sonar-reasoning-pro', 'Sonar Reasoning Pro', 'perplexity', false, false, 520, true),
  ('solar-pro4', 'Solar Pro 4', 'upstage', false, false, 610, true),
  ('LGAI-EXAONE/K-EXAONE-2.0-750B-A37B', 'K-EXAONE 2.0', 'exaone', false, false, 710, true),
  ('qwen3.8-max', 'Qwen 3.8 Max', 'qwen', false, false, 810, true),
  ('qwen3.7-plus', 'Qwen 3.7 Plus', 'qwen', false, false, 820, true),
  ('qwen3.7-max', 'Qwen 3.7 Max', 'qwen', false, false, 830, true),
  ('glm-5.2', 'GLM-5.2', 'glm', false, false, 910, true),
  ('kimi-k3', 'Kimi K3', 'kimi', false, false, 1010, true),
  ('kimi-k2.6', 'Kimi K2.6', 'kimi', false, false, 1020, true),
  ('seed-2-0-pro-260328', 'Seed 2.0 Pro', 'seed', false, false, 1110, true),
  ('seed-2-0-lite-260428', 'Seed 2.0 Lite', 'seed', false, false, 1120, true),
  ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', false, false, 1210, true),
  ('deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', false, false, 1220, true)
on conflict (model_id) do update set
  display_name = excluded.display_name,
  family = excluded.family,
  sort_order = excluded.sort_order,
  is_builtin = true,
  updated_at = now();

do $$
begin
  if not exists (select 1 from public.ai_model_settings where is_default and enabled) then
    update public.ai_model_settings
    set enabled = true, is_default = true, updated_at = now()
    where model_id = coalesce(
      (select model_id from public.ai_model_settings where enabled order by sort_order limit 1),
      'gpt-5.6-sol'
    );
  end if;
end;
$$;

create or replace function public.set_ai_model_state_by_actor(
  p_actor_id uuid,
  p_model_id text,
  p_enabled boolean,
  p_make_default boolean default false
)
returns public.ai_model_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ai_model_settings;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(724202608250002);
  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions actor_permission
      on actor_permission.user_id = actor.id
     and actor_permission.permission = 'ai.manage'
    where actor.id = p_actor_id
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_REQUIRED';
  end if;

  select * into v_model
  from public.ai_model_settings
  where model_id = p_model_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'AI_MODEL_NOT_FOUND';
  end if;

  if p_make_default then
    update public.ai_model_settings
    set is_default = false, updated_by = p_actor_id
    where is_default;
  end if;

  update public.ai_model_settings
  set enabled = case when p_make_default then true else p_enabled end,
      is_default = case
        when p_make_default then true
        when not p_enabled then false
        else is_default
      end,
      updated_by = p_actor_id,
      updated_at = now()
  where model_id = p_model_id
  returning * into v_model;

  if not exists (select 1 from public.ai_model_settings where is_default and enabled) then
    update public.ai_model_settings
    set is_default = true, updated_by = p_actor_id, updated_at = now()
    where id = (
      select id from public.ai_model_settings
      where enabled
      order by sort_order, display_name
      limit 1
    );
  end if;

  insert into public.admin_audit_logs(actor_id, action, details)
  values (
    p_actor_id,
    'ai_model_settings_changed',
    jsonb_build_object(
      'model_id', p_model_id,
      'enabled', case when p_make_default then true else p_enabled end,
      'make_default', p_make_default
    )
  );
  return v_model;
end;
$$;

revoke all on function public.set_user_permissions(uuid, uuid, text[])
from public, anon, authenticated;
revoke all on function public.set_admin_permissions(uuid, uuid, text[])
from public, anon, authenticated;
revoke all on function public.set_managed_system_role(uuid, uuid, public.system_role)
from public, anon, authenticated;
revoke all on function public.restore_system_role_and_permissions_after_auth_failure(uuid, uuid, public.system_role, public.system_role, text[])
from public, anon, authenticated;
revoke all on function public.set_managed_account_status(uuid, uuid, public.account_status)
from public, anon, authenticated;
revoke all on function public.protect_last_permission_manager_on_profile_delete()
from public, anon, authenticated;
revoke all on function public.begin_project_creation(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.set_ai_model_state_by_actor(uuid, text, boolean, boolean)
from public, anon, authenticated;
revoke all on function public.list_auth_audit_logs_admin(uuid, uuid, text, timestamptz, timestamptz, integer, integer)
from public, anon, authenticated;
revoke all on function public.summarize_auth_audit_logins_admin(uuid)
from public, anon, authenticated;

grant execute on function public.set_user_permissions(uuid, uuid, text[]) to service_role;
grant execute on function public.set_admin_permissions(uuid, uuid, text[]) to service_role;
grant execute on function public.set_managed_system_role(uuid, uuid, public.system_role) to service_role;
grant execute on function public.restore_system_role_and_permissions_after_auth_failure(uuid, uuid, public.system_role, public.system_role, text[]) to service_role;
grant execute on function public.set_managed_account_status(uuid, uuid, public.account_status) to service_role;
grant execute on function public.protect_last_permission_manager_on_profile_delete() to service_role;
grant execute on function public.begin_project_creation(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb) to service_role;
grant execute on function public.set_ai_model_state_by_actor(uuid, text, boolean, boolean) to service_role;
grant execute on function public.list_auth_audit_logs_admin(uuid, uuid, text, timestamptz, timestamptz, integer, integer) to service_role;
grant execute on function public.summarize_auth_audit_logins_admin(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
