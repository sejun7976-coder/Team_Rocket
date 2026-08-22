begin;

-- Expand the original singleton OpenAI setting without ever exposing or
-- decrypting the existing ciphertext during migration.
alter table public.ai_provider_settings rename to ai_provider_settings_legacy;

create table public.ai_provider_settings (
  provider text primary key check (provider in ('openai', 'anthropic', 'google')),
  enabled boolean not null default false,
  api_key_ciphertext text,
  api_key_iv text,
  encryption_version integer not null default 1 check (encryption_version = 1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((api_key_ciphertext is null) = (api_key_iv is null))
);

insert into public.ai_provider_settings(
  provider, enabled, api_key_ciphertext, api_key_iv, encryption_version, updated_by, updated_at
)
select provider, enabled, api_key_ciphertext, api_key_iv, encryption_version, updated_by, updated_at
from public.ai_provider_settings_legacy;

insert into public.ai_provider_settings(provider)
values ('openai'), ('anthropic'), ('google')
on conflict (provider) do nothing;

create table public.ai_model_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.ai_provider_settings(provider) on delete cascade,
  model_id text not null check (char_length(trim(model_id)) between 1 and 160),
  display_name text not null check (char_length(trim(display_name)) between 1 and 100),
  enabled boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, model_id)
);

create unique index ai_model_settings_one_default_per_provider_idx
  on public.ai_model_settings(provider) where is_default;
create index ai_model_settings_enabled_order_idx
  on public.ai_model_settings(enabled, sort_order, display_name);

insert into public.ai_model_settings(provider, model_id, display_name, enabled, is_default, updated_at)
select provider, model, model, enabled, true, updated_at
from public.ai_provider_settings_legacy
where nullif(trim(model), '') is not null;

drop table public.ai_provider_settings_legacy;

create trigger ai_provider_settings_updated_at
before update on public.ai_provider_settings
for each row execute function public.set_updated_at();
create trigger ai_model_settings_updated_at
before update on public.ai_model_settings
for each row execute function public.set_updated_at();

alter table public.ai_provider_settings enable row level security;
alter table public.ai_provider_settings force row level security;
alter table public.ai_model_settings enable row level security;
alter table public.ai_model_settings force row level security;
revoke all on table public.ai_provider_settings, public.ai_model_settings from public, anon, authenticated;
grant all on table public.ai_provider_settings, public.ai_model_settings to service_role;

-- Preserve authored business records while allowing an ordinary account to be
-- removed. Project owners are rejected by the Edge Function before deletion.
alter table public.project_members alter column added_by drop not null;
alter table public.project_members drop constraint project_members_added_by_fkey;
alter table public.project_members add constraint project_members_added_by_fkey foreign key (added_by) references public.profiles(id) on delete set null;
alter table public.project_keys alter column created_by drop not null;
alter table public.project_keys drop constraint project_keys_created_by_fkey;
alter table public.project_keys add constraint project_keys_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.tasks alter column created_by drop not null;
alter table public.tasks drop constraint tasks_created_by_fkey;
alter table public.tasks add constraint tasks_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.task_assignees alter column assigned_by drop not null;
alter table public.task_assignees drop constraint task_assignees_assigned_by_fkey;
alter table public.task_assignees add constraint task_assignees_assigned_by_fkey foreign key (assigned_by) references public.profiles(id) on delete set null;
alter table public.task_checklist_items alter column created_by drop not null;
alter table public.task_checklist_items drop constraint task_checklist_items_created_by_fkey;
alter table public.task_checklist_items add constraint task_checklist_items_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.comments alter column author_id drop not null;
alter table public.comments drop constraint comments_author_id_fkey;
alter table public.comments add constraint comments_author_id_fkey foreign key (author_id) references public.profiles(id) on delete set null;
alter table public.files alter column uploaded_by drop not null;
alter table public.files drop constraint files_uploaded_by_fkey;
alter table public.files add constraint files_uploaded_by_fkey foreign key (uploaded_by) references public.profiles(id) on delete set null;

alter table public.user_access_logs
  add column student_id_snapshot text,
  add column display_name_snapshot text;
update public.user_access_logs logs
set student_id_snapshot = profiles.student_id,
    display_name_snapshot = profiles.name
from public.profiles profiles
where profiles.id = logs.user_id;
alter table public.user_access_logs alter column user_id drop not null;
alter table public.user_access_logs drop constraint user_access_logs_user_id_fkey;
alter table public.user_access_logs add constraint user_access_logs_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null;

alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check
  check (action in ('user_created', 'password_reset', 'user_deactivated', 'user_reactivated', 'user_deleted'));

create or replace function public.record_user_access_event(
  p_user_id uuid, p_event_type text, p_ip_address text, p_country_code text, p_user_agent text
)
returns public.user_access_logs
language plpgsql security definer set search_path = ''
as $$
declare
  v_log public.user_access_logs;
  v_student_id text;
  v_display_name text;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  if p_event_type not in ('login', 'logout', 'password_changed', 'session_refreshed') then raise exception using errcode = 'PAL01', message = 'invalid access event'; end if;
  select student_id, name into v_student_id, v_display_name from public.profiles where id = p_user_id;
  if v_student_id is null then raise exception using errcode = 'PAL02', message = 'profile required'; end if;
  select * into v_log from public.user_access_logs
    where user_id = p_user_id and event_type = p_event_type and created_at >= now() - interval '5 seconds'
    order by created_at desc limit 1;
  if v_log.id is null then
    insert into public.user_access_logs(user_id, student_id_snapshot, display_name_snapshot, event_type, ip_address, country_code, user_agent)
    values (p_user_id, v_student_id, v_display_name, p_event_type,
      case when p_ip_address is null then null else p_ip_address::inet end,
      p_country_code, left(p_user_agent, 512)) returning * into v_log;
  end if;
  if pg_try_advisory_xact_lock(hashtext('rocket-campus:user-access-log-retention')) then
    delete from public.user_access_logs where created_at < now() - interval '90 days';
  end if;
  return v_log;
end;
$$;
revoke all on function public.record_user_access_event(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_user_access_event(uuid, text, text, text, text) to service_role;

-- Re-publish the exact task RPC contract and explicitly refresh PostgREST's
-- schema cache. This keeps encrypted descriptions and assignees atomic.
create or replace function public.create_task_atomic(
  p_task_id uuid, p_project_id uuid, p_title text,
  p_description_encrypted jsonb default null,
  p_status public.task_status default 'todo',
  p_priority public.task_priority default 'medium', p_progress integer default 0,
  p_start_date date default null, p_due_date date default null,
  p_assignee_ids uuid[] default array[]::uuid[]
)
returns public.tasks language plpgsql security definer set search_path = ''
as $$
declare v_task public.tasks; v_assignee uuid;
begin
  if auth.uid() is null or not public.can_access_business_data() then raise exception using errcode = 'RT401', message = 'TASK_PERMISSION_DENIED'; end if;
  if not public.has_project_role(p_project_id, array['owner','admin','member']::public.project_role[]) then raise exception using errcode = 'RT403', message = 'TASK_PERMISSION_DENIED'; end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 240 or p_progress not between 0 and 100
     or (p_start_date is not null and p_due_date is not null and p_due_date < p_start_date)
  then raise exception using errcode = 'RT400', message = 'TASK_INPUT_INVALID'; end if;
  for v_assignee in select distinct unnest(coalesce(p_assignee_ids, array[]::uuid[])) loop
    if not exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = v_assignee)
    then raise exception using errcode = 'RT422', message = 'INVALID_ASSIGNEE'; end if;
  end loop;
  insert into public.tasks(id, project_id, title, description_encrypted, status, priority, progress, start_date, due_date, created_by)
  values (p_task_id, p_project_id, trim(p_title), p_description_encrypted, p_status, p_priority, p_progress, p_start_date, p_due_date, auth.uid())
  returning * into v_task;
  insert into public.task_assignees(task_id, user_id, assigned_by)
  select p_task_id, assignee_id, auth.uid() from (select distinct unnest(coalesce(p_assignee_ids, array[]::uuid[])) assignee_id) ids;
  return v_task;
end;
$$;
revoke all on function public.create_task_atomic(uuid, uuid, text, jsonb, public.task_status, public.task_priority, integer, date, date, uuid[]) from public, anon;
grant execute on function public.create_task_atomic(uuid, uuid, text, jsonb, public.task_status, public.task_priority, integer, date, date, uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
