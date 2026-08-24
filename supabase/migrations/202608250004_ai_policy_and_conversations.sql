begin;

create table public.ai_runtime_settings (
  singleton boolean primary key default true check (singleton),
  guard_model_id text references public.ai_model_settings(model_id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.ai_user_policy_status (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  warning_count smallint not null default 0 check (warning_count between 0 and 3),
  suspended boolean not null default false,
  suspended_at timestamptz,
  suspension_reason text check (suspension_reason is null or char_length(suspension_reason) <= 160),
  last_warning_at timestamptz,
  last_ai_used_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (suspended and warning_count = 3 and suspended_at is not null)
    or (not suspended and suspended_at is null and suspension_reason is null)
  )
);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  model_id text not null check (char_length(model_id) between 1 and 160),
  user_name_snapshot text not null check (char_length(user_name_snapshot) between 1 and 80),
  project_name_snapshot text not null check (char_length(project_name_snapshot) between 1 and 120),
  last_scope_decision text check (last_scope_decision is null or last_scope_decision in ('ALLOW', 'UNCERTAIN', 'VIOLATION', 'BYPASS')),
  last_policy_status text not null default 'normal' check (last_policy_status in (
    'normal', 'uncertain', 'warning', 'bypass', 'output_blocked', 'suspended', 'guard_error', 'unsupported'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  scope_decision text check (scope_decision is null or scope_decision in ('ALLOW', 'UNCERTAIN', 'VIOLATION', 'BYPASS')),
  scope_category text check (scope_category is null or char_length(scope_category) between 1 and 80),
  scope_reason text check (scope_reason is null or char_length(scope_reason) between 1 and 500),
  scope_confidence numeric(4, 3) check (scope_confidence is null or scope_confidence between 0 and 1),
  warning_number smallint check (warning_number is null or warning_number between 1 and 3),
  policy_status text not null default 'normal' check (policy_status in (
    'normal', 'uncertain', 'warning', 'bypass', 'output_blocked', 'suspended', 'guard_error', 'unsupported'
  )),
  created_at timestamptz not null default now()
);

create table public.ai_policy_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  user_name_snapshot text not null check (char_length(user_name_snapshot) between 1 and 80),
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('warning', 'suspension', 'reset', 'output_blocked', 'project_data_injection')),
  warning_number smallint check (warning_number is null or warning_number between 1 and 3),
  scope_decision text check (scope_decision is null or scope_decision in ('ALLOW', 'UNCERTAIN', 'VIOLATION', 'BYPASS')),
  scope_category text check (scope_category is null or char_length(scope_category) between 1 and 80),
  scope_reason text check (scope_reason is null or char_length(scope_reason) between 1 and 500),
  scope_confidence numeric(4, 3) check (scope_confidence is null or scope_confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create index ai_conversations_user_created_idx on public.ai_conversations(user_id, created_at desc);
create index ai_conversations_project_created_idx on public.ai_conversations(project_id, created_at desc);
create index ai_conversations_status_created_idx on public.ai_conversations(last_policy_status, created_at desc);
create index ai_messages_conversation_created_idx on public.ai_messages(conversation_id, created_at);
create index ai_policy_events_user_created_idx on public.ai_policy_events(user_id, created_at desc);

insert into public.ai_runtime_settings(singleton, guard_model_id)
values (
  true,
  (
    select model.model_id
    from public.ai_model_settings model
    where model.enabled
    order by model.is_default desc, model.sort_order, model.display_name
    limit 1
  )
)
on conflict (singleton) do nothing;

insert into public.ai_user_policy_status(user_id)
select profile.id from public.profiles profile
on conflict (user_id) do nothing;

insert into public.user_admin_permissions(user_id, permission, created_by)
select profile.id, 'ai.use'::public.admin_permission, profile.id
from public.profiles profile
where profile.account_status = 'active'
on conflict (user_id, permission) do nothing;

insert into public.user_admin_permissions(user_id, permission, created_by)
select profile.id, 'ai.logs.view'::public.admin_permission, profile.id
from public.profiles profile
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
    'ai_model_settings_changed',
    'ai_guard_model_changed',
    'ai_suspension_reset'
  ));

create or replace function public.initialize_ai_user_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ai_user_policy_status(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  if new.account_status <> 'inactive' then
    insert into public.user_admin_permissions(user_id, permission, created_by)
    values (new.id, 'ai.use', new.created_by)
    on conflict (user_id, permission) do nothing;
  end if;
  return new;
end;
$$;

create trigger profiles_initialize_ai_user_defaults
after insert or update of account_status on public.profiles
for each row execute function public.initialize_ai_user_defaults();

create or replace function public.enforce_active_ai_use_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_user_id uuid;
  v_new_user_id uuid;
begin
  if tg_op <> 'INSERT' then v_old_user_id := old.user_id; end if;
  if tg_op <> 'DELETE' then v_new_user_id := new.user_id; end if;
  if exists (
    select 1
    from (values (v_old_user_id), (v_new_user_id)) affected(user_id)
    join public.profiles profile on profile.id = affected.user_id
    where profile.account_status <> 'inactive'
      and affected.user_id is not null
      and not exists (
        select 1
        from public.user_admin_permissions permission
        where permission.user_id = affected.user_id
          and permission.permission = 'ai.use'
      )
  ) then
    raise exception using errcode = '23514', message = 'ACTIVE_USER_REQUIRES_AI_USE';
  end if;
  return null;
end;
$$;

create constraint trigger user_permissions_require_active_ai_use
after insert or update or delete on public.user_admin_permissions
deferrable initially deferred
for each row execute function public.enforce_active_ai_use_permission();

create or replace function public.touch_ai_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_conversations conversation
  set updated_at = new.created_at,
      last_scope_decision = coalesce(new.scope_decision, conversation.last_scope_decision),
      last_policy_status = new.policy_status
  where conversation.id = new.conversation_id;
  return new;
end;
$$;

create trigger ai_messages_touch_conversation
after insert on public.ai_messages
for each row execute function public.touch_ai_conversation_from_message();

create or replace function public.ensure_active_ai_guard_model()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.enabled and not new.enabled then
    update public.ai_runtime_settings runtime
    set guard_model_id = (
          select model.model_id
          from public.ai_model_settings model
          where model.enabled
          order by model.is_default desc, model.sort_order, model.display_name
          limit 1
        ),
        updated_at = now()
    where runtime.singleton
      and runtime.guard_model_id = new.model_id;
  end if;
  return new;
end;
$$;

create trigger ai_model_settings_ensure_guard_model
after update of enabled on public.ai_model_settings
for each row execute function public.ensure_active_ai_guard_model();

create or replace function public.record_ai_policy_violation(
  p_user_id uuid,
  p_conversation_id uuid,
  p_content text,
  p_decision text,
  p_category text,
  p_reason text,
  p_confidence numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.ai_user_policy_status;
  v_warning_count smallint;
  v_suspended boolean;
  v_message_id uuid;
  v_user_name text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null
     or p_conversation_id is null
     or p_content is null
     or p_decision is null
     or p_category is null
     or p_reason is null
     or p_confidence is null
     or p_decision not in ('VIOLATION', 'BYPASS')
     or char_length(trim(p_content)) not between 1 and 4000
     or char_length(trim(p_category)) not between 1 and 80
     or char_length(trim(p_reason)) not between 1 and 500
     or p_confidence < 0 or p_confidence > 1 then
    raise exception using errcode = '22023', message = 'AI_POLICY_INPUT_INVALID';
  end if;
  if not exists (
    select 1 from public.ai_conversations conversation
    where conversation.id = p_conversation_id
      and conversation.user_id = p_user_id
  ) then
    raise exception using errcode = '42501', message = 'AI_CONVERSATION_FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 20260825));
  insert into public.ai_user_policy_status(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
  select * into v_status
  from public.ai_user_policy_status status
  where status.user_id = p_user_id
  for update;

  if v_status.suspended then
    return jsonb_build_object('warningCount', 3, 'suspended', true, 'messageId', null);
  end if;

  v_warning_count := least(3, v_status.warning_count + 1);
  v_suspended := v_warning_count = 3;
  update public.ai_user_policy_status
  set warning_count = v_warning_count,
      suspended = v_suspended,
      suspended_at = case when v_suspended then now() else null end,
      suspension_reason = case when v_suspended then left(p_category, 160) else null end,
      last_warning_at = now(),
      last_ai_used_at = now(),
      updated_at = now()
  where user_id = p_user_id;

  insert into public.ai_messages(
    conversation_id, role, content, scope_decision, scope_category,
    scope_reason, scope_confidence, warning_number, policy_status
  ) values (
    p_conversation_id, 'user', trim(p_content), p_decision, trim(p_category),
    trim(p_reason), p_confidence, v_warning_count,
    case when p_decision = 'BYPASS' then 'bypass' else 'warning' end
  ) returning id into v_message_id;

  select profile.name into v_user_name
  from public.profiles profile where profile.id = p_user_id;
  insert into public.ai_policy_events(
    user_id, user_name_snapshot, conversation_id, event_type, warning_number,
    scope_decision, scope_category, scope_reason, scope_confidence
  ) values (
    p_user_id, coalesce(v_user_name, '삭제된 사용자'), p_conversation_id,
    case when v_suspended then 'suspension' else 'warning' end,
    v_warning_count, p_decision, trim(p_category), trim(p_reason), p_confidence
  );

  return jsonb_build_object(
    'warningCount', v_warning_count,
    'suspended', v_suspended,
    'messageId', v_message_id
  );
end;
$$;

create or replace function public.set_ai_guard_model_by_actor(
  p_actor_id uuid,
  p_model_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_actor_id is null or p_model_id is null or char_length(trim(p_model_id)) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'AI_GUARD_MODEL_INPUT_INVALID';
  end if;
  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions permission
      on permission.user_id = actor.id and permission.permission = 'ai.manage'
    where actor.id = p_actor_id and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.ai_model_settings model
    where model.model_id = p_model_id and model.enabled
  ) then
    raise exception using errcode = 'P0002', message = 'AI_GUARD_MODEL_UNAVAILABLE';
  end if;

  insert into public.ai_runtime_settings(singleton, guard_model_id, updated_by)
  values (true, p_model_id, p_actor_id)
  on conflict (singleton) do update
  set guard_model_id = excluded.guard_model_id,
      updated_by = excluded.updated_by,
      updated_at = now();

  insert into public.admin_audit_logs(actor_id, action, details)
  values (p_actor_id, 'ai_guard_model_changed', jsonb_build_object('model_id', p_model_id));
  return p_model_id;
end;
$$;

create or replace function public.reset_ai_user_policy_by_actor(
  p_actor_id uuid,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_count smallint;
  v_target_name text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_actor_id is null or p_target_user_id is null then
    raise exception using errcode = '22023', message = 'AI_POLICY_RESET_INPUT_INVALID';
  end if;
  if not exists (
    select 1
    from public.profiles actor
    join public.user_admin_permissions permission
      on permission.user_id = actor.id and permission.permission = 'ai.manage'
    where actor.id = p_actor_id and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_REQUIRED';
  end if;
  select profile.name into v_target_name
  from public.profiles profile where profile.id = p_target_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_target_user_id::text, 20260825));
  insert into public.ai_user_policy_status(user_id)
  values (p_target_user_id)
  on conflict (user_id) do nothing;
  select status.warning_count into v_previous_count
  from public.ai_user_policy_status status
  where status.user_id = p_target_user_id
  for update;

  update public.ai_user_policy_status
  set warning_count = 0,
      suspended = false,
      suspended_at = null,
      suspension_reason = null,
      updated_at = now()
  where user_id = p_target_user_id;

  insert into public.ai_policy_events(user_id, user_name_snapshot, actor_id, event_type)
  values (p_target_user_id, v_target_name, p_actor_id, 'reset');
  insert into public.admin_audit_logs(actor_id, action, target_user_id, details)
  values (
    p_actor_id,
    'ai_suspension_reset',
    p_target_user_id,
    jsonb_build_object('previous_warning_count', v_previous_count)
  );
  return jsonb_build_object('warningCount', 0, 'suspended', false);
end;
$$;

alter table public.ai_runtime_settings enable row level security;
alter table public.ai_runtime_settings force row level security;
alter table public.ai_user_policy_status enable row level security;
alter table public.ai_user_policy_status force row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_conversations force row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_messages force row level security;
alter table public.ai_policy_events enable row level security;
alter table public.ai_policy_events force row level security;

revoke all on table public.ai_runtime_settings, public.ai_user_policy_status,
  public.ai_conversations, public.ai_messages, public.ai_policy_events
from public, anon, authenticated;
grant all on table public.ai_runtime_settings, public.ai_user_policy_status,
  public.ai_conversations, public.ai_messages, public.ai_policy_events
to service_role;

revoke all on function public.initialize_ai_user_defaults() from public, anon, authenticated;
revoke all on function public.enforce_active_ai_use_permission() from public, anon, authenticated;
revoke all on function public.touch_ai_conversation_from_message() from public, anon, authenticated;
revoke all on function public.ensure_active_ai_guard_model() from public, anon, authenticated;
revoke all on function public.record_ai_policy_violation(uuid, uuid, text, text, text, text, numeric) from public, anon, authenticated;
revoke all on function public.set_ai_guard_model_by_actor(uuid, text) from public, anon, authenticated;
revoke all on function public.reset_ai_user_policy_by_actor(uuid, uuid) from public, anon, authenticated;

grant execute on function public.initialize_ai_user_defaults() to service_role;
grant execute on function public.enforce_active_ai_use_permission() to service_role;
grant execute on function public.touch_ai_conversation_from_message() to service_role;
grant execute on function public.ensure_active_ai_guard_model() to service_role;
grant execute on function public.record_ai_policy_violation(uuid, uuid, text, text, text, text, numeric) to service_role;
grant execute on function public.set_ai_guard_model_by_actor(uuid, text) to service_role;
grant execute on function public.reset_ai_user_policy_by_actor(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
