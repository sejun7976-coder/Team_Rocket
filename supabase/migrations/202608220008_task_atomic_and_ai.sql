begin;

-- Task creation is a single database transaction. Ciphertext is still produced in the browser.
create or replace function public.create_task_atomic(
  p_task_id uuid,
  p_project_id uuid,
  p_title text,
  p_description_encrypted jsonb default null,
  p_status public.task_status default 'todo',
  p_priority public.task_priority default 'medium',
  p_progress integer default 0,
  p_start_date date default null,
  p_due_date date default null,
  p_assignee_ids uuid[] default array[]::uuid[]
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_assignee uuid;
begin
  if auth.uid() is null or not public.can_access_business_data() then
    raise exception using errcode = 'RT401', message = 'TASK_PERMISSION_DENIED';
  end if;
  if not public.has_project_role(p_project_id, array['owner', 'admin', 'member']::public.project_role[]) then
    raise exception using errcode = 'RT403', message = 'TASK_PERMISSION_DENIED';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 240
     or p_progress not between 0 and 100
     or (p_start_date is not null and p_due_date is not null and p_due_date < p_start_date) then
    raise exception using errcode = 'RT400', message = 'TASK_INPUT_INVALID';
  end if;

  for v_assignee in select distinct unnest(coalesce(p_assignee_ids, array[]::uuid[])) loop
    if not exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id and pm.user_id = v_assignee
    ) then
      raise exception using errcode = 'RT422', message = 'INVALID_ASSIGNEE';
    end if;
  end loop;

  insert into public.tasks(
    id, project_id, title, description_encrypted, status, priority, progress,
    start_date, due_date, created_by
  ) values (
    p_task_id, p_project_id, trim(p_title), p_description_encrypted, p_status, p_priority,
    p_progress, p_start_date, p_due_date, auth.uid()
  ) returning * into v_task;

  insert into public.task_assignees(task_id, user_id, assigned_by)
  select p_task_id, assignee_id, auth.uid()
  from (select distinct unnest(coalesce(p_assignee_ids, array[]::uuid[])) as assignee_id) deduplicated;

  return v_task;
end;
$$;

revoke all on function public.create_task_atomic(uuid, uuid, text, jsonb, public.task_status, public.task_priority, integer, date, date, uuid[]) from public, anon;
grant execute on function public.create_task_atomic(uuid, uuid, text, jsonb, public.task_status, public.task_priority, integer, date, date, uuid[]) to authenticated, service_role;

-- Existing file delete RLS was not usable through the Data API without a table DELETE grant.
grant delete on table public.files to authenticated;
-- Task deletion goes through delete-task so Storage objects are removed before FK cascade.
revoke delete on table public.tasks from authenticated;

create table public.ai_provider_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  provider text not null default 'openai' check (provider = 'openai'),
  model text not null check (char_length(model) between 1 and 100),
  api_key_ciphertext text,
  api_key_iv text,
  encryption_version integer not null default 1 check (encryption_version = 1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((api_key_ciphertext is null) = (api_key_iv is null))
);

create table public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  feature text not null check (feature in ('create_task', 'decompose_tasks', 'briefing', 'project_summary', 'weekly_report', 'project_qa', 'github_summary')),
  provider text not null,
  model text not null,
  success boolean not null,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now()
);

create index ai_usage_logs_user_created_idx on public.ai_usage_logs(user_id, created_at desc);
create index ai_usage_logs_project_created_idx on public.ai_usage_logs(project_id, created_at desc) where project_id is not null;

alter table public.ai_provider_settings enable row level security;
alter table public.ai_provider_settings force row level security;
alter table public.ai_usage_logs enable row level security;
alter table public.ai_usage_logs force row level security;

-- Both tables are intentionally inaccessible through anon/authenticated Data API.
revoke all on table public.ai_provider_settings, public.ai_usage_logs from public, anon, authenticated;
grant all on table public.ai_provider_settings, public.ai_usage_logs to service_role;

commit;
