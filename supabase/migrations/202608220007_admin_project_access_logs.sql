begin;

-- Project creation remains a service-role operation, but the trusted creator
-- UUID must also belong to an active system administrator. This is a second
-- authorization boundary behind create-project's requireSystemAdmin().
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
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_created_by
      and system_role = 'admin'
      and account_status = 'active'
  ) then
    raise exception using errcode = 'PPC01', message = 'project creator must be an active system admin';
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

revoke all on function public.begin_project_creation(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.begin_project_creation(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb)
  to service_role;

create table public.user_access_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('login', 'logout', 'password_changed', 'session_refreshed')),
  ip_address inet,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  created_at timestamptz not null default now()
);

comment on table public.user_access_logs is
  '90-day application access metadata. Never stores credentials, tokens, or caller-supplied network fields.';

create index user_access_logs_user_created_idx
  on public.user_access_logs(user_id, created_at desc);
create index user_access_logs_created_idx
  on public.user_access_logs(created_at);

alter table public.user_access_logs enable row level security;
revoke all privileges on table public.user_access_logs from public, anon, authenticated;
grant select, insert, delete on table public.user_access_logs to service_role;

-- Called only by record-access-event after JWT verification. Network fields are
-- derived from gateway headers by the Edge Function, never from its JSON body.
create or replace function public.record_user_access_event(
  p_user_id uuid,
  p_event_type text,
  p_ip_address text,
  p_country_code text,
  p_user_agent text
)
returns public.user_access_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.user_access_logs;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_event_type not in ('login', 'logout', 'password_changed', 'session_refreshed') then
    raise exception using errcode = 'PAL01', message = 'invalid access event';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception using errcode = 'PAL02', message = 'profile required';
  end if;

  -- A short duplicate window makes client retry safe and limits accidental spam.
  select * into v_log
  from public.user_access_logs
  where user_id = p_user_id
    and event_type = p_event_type
    and created_at >= now() - interval '5 seconds'
  order by created_at desc
  limit 1;

  if v_log.id is null then
    insert into public.user_access_logs(user_id, event_type, ip_address, country_code, user_agent)
    values (
      p_user_id,
      p_event_type,
      case when p_ip_address is null then null else p_ip_address::inet end,
      p_country_code,
      left(p_user_agent, 512)
    )
    returning * into v_log;
  end if;

  -- Free-plan-safe retention: indexed opportunistic cleanup, serialized so
  -- concurrent logins do not run the same delete repeatedly.
  if pg_try_advisory_xact_lock(hashtext('rocket-campus:user-access-log-retention')) then
    delete from public.user_access_logs where created_at < now() - interval '90 days';
  end if;

  return v_log;
end;
$$;

revoke all on function public.record_user_access_event(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_user_access_event(uuid, text, text, text, text)
  to service_role;

-- Supabase Auth Audit Logs are the authoritative authentication-event source
-- when Dashboard > Authentication > Audit Logs > Write audit logs to the
-- database is enabled. The auth schema remains unexposed to the Data API.
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
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if not exists (
    select 1 from public.profiles
    where profiles.id = p_actor_id
      and profiles.system_role = 'admin'
      and profiles.account_status = 'active'
  ) then
    raise exception using errcode = 'PAL03', message = 'system admin required';
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

revoke all on function public.list_auth_audit_logs_admin(uuid, uuid, text, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_auth_audit_logs_admin(uuid, uuid, text, timestamptz, timestamptz, integer, integer)
  to service_role;

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
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if not exists (
    select 1 from public.profiles
    where profiles.id = p_actor_id
      and profiles.system_role = 'admin'
      and profiles.account_status = 'active'
  ) then
    raise exception using errcode = 'PAL03', message = 'system admin required';
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

revoke all on function public.summarize_auth_audit_logins_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.summarize_auth_audit_logins_admin(uuid)
  to service_role;

commit;
