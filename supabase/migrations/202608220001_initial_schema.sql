begin;

create extension if not exists pgcrypto with schema extensions;

create type public.project_status as enum ('creating', 'active', 'error', 'archived');
create type public.project_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.task_status as enum ('todo', 'in_progress', 'review', 'done');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.progress_mode as enum ('manual', 'checklist');
create type public.github_sync_status as enum ('pending', 'synced', 'error', 'not_connected');
create type public.notification_type as enum (
  'project_added', 'task_assigned', 'task_unassigned', 'mention', 'due_soon'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  student_id text not null unique check (student_id ~ '^[0-9]{6,12}$'),
  name text not null check (char_length(name) between 1 and 80),
  github_username text check (github_username is null or github_username ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'),
  avatar_url text,
  encryption_public_key jsonb,
  encrypted_private_key jsonb,
  key_salt text,
  key_kdf_iterations integer not null default 310000 check (key_kdf_iterations >= 310000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keyring_complete check (
    (encryption_public_key is null and encrypted_private_key is null and key_salt is null)
    or
    (encryption_public_key is not null and encrypted_private_key is not null and key_salt is not null)
  )
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  note_encrypted jsonb,
  created_by uuid not null references public.profiles(id),
  status public.project_status not null default 'creating',
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  github_repository_id bigint,
  github_owner text,
  github_repository_name text not null check (github_repository_name ~ '^[A-Za-z0-9._-]{1,100}$'),
  github_repository_url text,
  github_sync_status public.github_sync_status not null default 'pending',
  github_error_code text,
  github_auto_sync boolean not null default true,
  idempotency_key uuid not null,
  revision integer not null default 1 check (revision > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, idempotency_key),
  unique (github_repository_id)
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.project_role not null default 'member',
  github_sync_status public.github_sync_status not null default 'pending',
  github_error_code text,
  created_at timestamptz not null default now(),
  added_by uuid not null references public.profiles(id),
  primary key (project_id, user_id)
);

create table public.project_keys (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  wrapped_key jsonb not null,
  ephemeral_public_key jsonb not null,
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  primary key (project_id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  description_encrypted jsonb,
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  progress integer not null default 0 check (progress between 0 and 100),
  progress_mode public.progress_mode not null default 'manual',
  start_date date,
  due_date date,
  created_by uuid not null default auth.uid() references public.profiles(id),
  revision integer not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  content_encrypted jsonb not null,
  completed boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  content_encrypted jsonb not null,
  revision integer not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  subject_type text not null check (subject_type in ('project', 'member', 'task', 'assignee', 'comment', 'file')),
  subject_id uuid,
  payload_encrypted jsonb,
  created_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  storage_path text not null unique,
  original_name_encrypted jsonb not null,
  mime_type text not null default 'application/octet-stream',
  original_size bigint not null check (original_size between 0 and 52428800),
  encrypted_size bigint not null check (encrypted_size > 0 and encrypted_size <= 62914560),
  chunk_count integer not null check (chunk_count between 1 and 32),
  checksum_encrypted jsonb not null,
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (storage_path = project_id::text || '/' || id::text || '/encrypted.bin')
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  type public.notification_type not null,
  title text not null check (char_length(title) between 1 and 180),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.github_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  action text not null check (action in ('add_collaborator', 'remove_collaborator', 'create_repository', 'delete_repository')),
  status public.github_sync_status not null default 'pending',
  error_code text,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, user_id, action)
);

create index projects_created_by_idx on public.projects(created_by);
create index project_members_user_idx on public.project_members(user_id, project_id);
create index project_members_project_role_idx on public.project_members(project_id, role);
create index tasks_project_status_idx on public.tasks(project_id, status) where deleted_at is null;
create index tasks_due_date_idx on public.tasks(due_date) where deleted_at is null;
create index task_assignees_user_idx on public.task_assignees(user_id, task_id);
create index checklist_task_position_idx on public.task_checklist_items(task_id, position);
create index comments_task_created_idx on public.comments(task_id, created_at) where deleted_at is null;
create index activities_project_created_idx on public.activities(project_id, created_at desc);
create index files_project_created_idx on public.files(project_id, created_at desc) where deleted_at is null;
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index github_sync_jobs_pending_idx on public.github_sync_jobs(status, updated_at) where status in ('pending', 'error');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks
for each row execute function public.set_updated_at();
create trigger checklist_updated_at before update on public.task_checklist_items
for each row execute function public.set_updated_at();
create trigger comments_updated_at before update on public.comments
for each row execute function public.set_updated_at();
create trigger github_sync_jobs_updated_at before update on public.github_sync_jobs
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id text;
  v_name text;
begin
  v_student_id := coalesce(new.raw_user_meta_data ->> 'student_id', substring(new.email from 'student\.([0-9]{6,12})@'));
  v_name := coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), v_student_id);
  if v_student_id is null or v_student_id !~ '^[0-9]{6,12}$' then
    raise exception 'valid student_id metadata is required';
  end if;
  insert into public.profiles(id, student_id, name)
  values (new.id, v_student_id, v_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.protect_profile_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.id <> new.id or old.student_id <> new.student_id then
    raise exception 'profile identity is immutable';
  end if;
  return new;
end;
$$;

create trigger protect_profile_identity_trigger before update on public.profiles
for each row execute function public.protect_profile_identity();

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = auth.uid()
  );
$$;

create or replace function public.has_project_role(p_project_id uuid, p_roles public.project_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.role = any(p_roles)
  );
$$;

create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = auth.uid() or exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = p_profile_id
  );
$$;

create or replace function public.task_project_id(p_task_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.project_id
  from public.tasks t
  where t.id = p_task_id
    and public.is_project_member(t.project_id);
$$;

create or replace function public.storage_project_id(p_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_first text := split_part(p_name, '/', 1);
begin
  if v_first ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_first::uuid;
  end if;
  return null;
end;
$$;

create or replace function public.prevent_project_move()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.project_id <> new.project_id then raise exception 'project_id is immutable'; end if;
  return new;
end;
$$;

create trigger task_project_immutable before update on public.tasks
for each row execute function public.prevent_project_move();
create trigger file_project_immutable before update on public.files
for each row execute function public.prevent_project_move();

create or replace function public.search_profiles(p_query text, p_limit integer default 20)
returns table(id uuid, student_id text, name text, github_username text, avatar_url text, encryption_public_key jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.student_id, p.name, p.github_username, p.avatar_url, p.encryption_public_key
  from public.profiles p
  where auth.uid() is not null
    and char_length(trim(p_query)) >= 2
    and (p.student_id ilike '%' || trim(p_query) || '%' or p.name ilike '%' || trim(p_query) || '%')
  order by case when p.student_id = trim(p_query) then 0 else 1 end, p.name
  limit least(greatest(p_limit, 1), 20);
$$;

revoke all on function public.search_profiles(text, integer) from public;
grant execute on function public.search_profiles(text, integer) to authenticated;

create or replace function public.notify_mentions(p_task_id uuid, p_student_ids text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid := public.task_project_id(p_task_id);
  v_count integer;
begin
  if not public.has_project_role(v_project_id, array['owner', 'admin', 'member']::public.project_role[]) then
    raise exception 'project contribution denied';
  end if;
  insert into public.notifications(user_id, project_id, task_id, type, title)
  select distinct p.id, v_project_id, p_task_id, 'mention', '댓글에서 회원님을 언급했습니다.'
  from public.profiles p
  join public.project_members pm on pm.user_id = p.id and pm.project_id = v_project_id
  where p.student_id = any(p_student_ids) and p.id <> auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_mentions(uuid, text[]) from public;
grant execute on function public.notify_mentions(uuid, text[]) to authenticated;

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
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  insert into public.projects(
    id, name, description, created_by, status, visibility,
    github_repository_name, idempotency_key, github_sync_status
  ) values (
    p_project_id, p_name, p_description, p_created_by, 'creating', p_visibility,
    p_repository_name, p_idempotency_key, 'pending'
  )
  on conflict (created_by, idempotency_key) do nothing;

  select * into v_project from public.projects
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

create or replace function public.finalize_project_creation(
  p_project_id uuid,
  p_repository_id bigint,
  p_owner text,
  p_repository_name text,
  p_repository_url text
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare v_project public.projects;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.projects set
    status = 'active', github_repository_id = p_repository_id, github_owner = p_owner,
    github_repository_name = p_repository_name, github_repository_url = p_repository_url,
    github_sync_status = 'synced', github_error_code = null, revision = revision + 1
  where id = p_project_id
  returning * into v_project;
  return v_project;
end;
$$;

create or replace function public.mark_project_creation_error(p_project_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.projects set status = 'error', github_sync_status = 'error',
    github_error_code = left(p_error_code, 80), revision = revision + 1
  where id = p_project_id;
end;
$$;

create or replace function public.add_project_member_atomic(
  p_actor_id uuid,
  p_project_id uuid,
  p_user_id uuid,
  p_role public.project_role,
  p_wrapped_key jsonb,
  p_ephemeral_public_key jsonb
)
returns public.project_members
language plpgsql
security definer
set search_path = ''
as $$
declare v_member public.project_members;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_actor_id and role in ('owner', 'admin')
  ) then raise exception 'insufficient project role'; end if;
  if p_role = 'owner' then raise exception 'owner role cannot be assigned'; end if;

  insert into public.project_members(project_id, user_id, role, added_by, github_sync_status)
  values (p_project_id, p_user_id, p_role, p_actor_id, 'pending')
  on conflict (project_id, user_id) do update set role = excluded.role
  returning * into v_member;

  insert into public.project_keys(project_id, user_id, wrapped_key, ephemeral_public_key, created_by)
  values (p_project_id, p_user_id, p_wrapped_key, p_ephemeral_public_key, p_actor_id)
  on conflict (project_id, user_id) do update set
    wrapped_key = excluded.wrapped_key,
    ephemeral_public_key = excluded.ephemeral_public_key,
    key_version = public.project_keys.key_version + 1,
    created_at = now(), created_by = excluded.created_by;

  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (p_project_id, p_actor_id, 'member_added', 'member', p_user_id);
  insert into public.notifications(user_id, project_id, type, title)
  select p_user_id, p_project_id, 'project_added', '새 프로젝트에 추가되었습니다.'
  where p_user_id <> p_actor_id;
  return v_member;
end;
$$;

create or replace function public.remove_project_member_atomic(
  p_actor_id uuid,
  p_project_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_actor_id and role in ('owner', 'admin')
  ) then raise exception 'insufficient project role'; end if;
  if exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id and role = 'owner'
  ) then raise exception 'project owner cannot be removed'; end if;

  delete from public.task_assignees ta
  using public.tasks t
  where ta.task_id = t.id and t.project_id = p_project_id and ta.user_id = p_user_id;
  delete from public.project_keys where project_id = p_project_id and user_id = p_user_id;
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (p_project_id, p_actor_id, 'member_removed', 'member', p_user_id);
end;
$$;

create or replace function public.record_domain_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_action text;
  v_subject_type text;
  v_subject_id uuid;
begin
  if tg_table_name = 'tasks' then
    v_project_id := new.project_id;
    v_subject_type := 'task';
    v_subject_id := new.id;
    if tg_op = 'INSERT' then v_action := 'task_created';
    elsif old.status is distinct from new.status then v_action := 'task_status_changed';
    elsif old.progress is distinct from new.progress then v_action := 'task_progress_changed';
    elsif old.due_date is distinct from new.due_date then v_action := 'task_due_date_changed';
    else return new;
    end if;
  elsif tg_table_name = 'task_assignees' then
    if tg_op = 'INSERT' then
      v_project_id := public.task_project_id(new.task_id);
      v_subject_id := new.task_id;
    else
      v_project_id := public.task_project_id(old.task_id);
      v_subject_id := old.task_id;
    end if;
    v_subject_type := 'assignee';
    v_action := case when tg_op = 'INSERT' then 'assignee_added' else 'assignee_removed' end;
  elsif tg_table_name = 'comments' then
    v_project_id := public.task_project_id(new.task_id);
    v_subject_type := 'comment';
    v_subject_id := new.id;
    v_action := 'comment_created';
  elsif tg_table_name = 'files' then
    v_project_id := new.project_id;
    v_subject_type := 'file';
    v_subject_id := new.id;
    v_action := 'file_uploaded';
  else
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (v_project_id, auth.uid(), v_action, v_subject_type, v_subject_id);

  if tg_table_name = 'task_assignees' and tg_op = 'INSERT' and new.user_id <> auth.uid() then
    insert into public.notifications(user_id, project_id, task_id, type, title)
    values (new.user_id, v_project_id, new.task_id, 'task_assigned', '새 작업의 담당자로 추가되었습니다.');
    insert into public.notifications(user_id, project_id, task_id, type, title)
    select new.user_id, v_project_id, new.task_id, 'due_soon', '담당 작업의 마감일이 임박했습니다.'
    from public.tasks t
    where t.id = new.task_id and t.due_date between current_date and current_date + 3;
  elsif tg_table_name = 'task_assignees' and tg_op = 'DELETE' and old.user_id <> auth.uid() then
    insert into public.notifications(user_id, project_id, task_id, type, title)
    values (old.user_id, v_project_id, old.task_id, 'task_unassigned', '작업 담당에서 제외되었습니다.');
  end if;

  if tg_table_name = 'tasks' and tg_op = 'UPDATE' and old.due_date is distinct from new.due_date
    and new.due_date between current_date and current_date + 3 then
    insert into public.notifications(user_id, project_id, task_id, type, title)
    select ta.user_id, new.project_id, new.id, 'due_soon', '담당 작업의 마감일이 임박했습니다.'
    from public.task_assignees ta where ta.task_id = new.id and ta.user_id <> auth.uid();
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger task_activity_trigger after insert or update on public.tasks
for each row execute function public.record_domain_activity();
create trigger assignee_activity_trigger after insert or delete on public.task_assignees
for each row execute function public.record_domain_activity();
create trigger comment_activity_trigger after insert on public.comments
for each row execute function public.record_domain_activity();
create trigger file_activity_trigger after insert on public.files
for each row execute function public.record_domain_activity();

revoke all on function public.begin_project_creation(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_project_creation(uuid, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_project_creation_error(uuid, text) from public, anon, authenticated;
revoke all on function public.add_project_member_atomic(uuid, uuid, uuid, public.project_role, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.remove_project_member_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_project_creation(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb) to service_role;
grant execute on function public.finalize_project_creation(uuid, bigint, text, text, text) to service_role;
grant execute on function public.mark_project_creation_error(uuid, text) to service_role;
grant execute on function public.add_project_member_atomic(uuid, uuid, uuid, public.project_role, jsonb, jsonb) to service_role;
grant execute on function public.remove_project_member_atomic(uuid, uuid, uuid) to service_role;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_keys enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.comments enable row level security;
alter table public.activities enable row level security;
alter table public.files enable row level security;
alter table public.notifications enable row level security;
alter table public.github_sync_jobs enable row level security;

create policy profiles_select_visible on public.profiles for select to authenticated
using (public.can_view_profile(id));
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy projects_select_member on public.projects for select to authenticated
using (public.is_project_member(id));
create policy projects_update_admin on public.projects for update to authenticated
using (public.has_project_role(id, array['owner', 'admin']::public.project_role[]))
with check (public.has_project_role(id, array['owner', 'admin']::public.project_role[]));

create policy project_members_select_member on public.project_members for select to authenticated
using (public.is_project_member(project_id));

create policy project_keys_select_self on public.project_keys for select to authenticated
using (user_id = auth.uid() and public.is_project_member(project_id));

create policy tasks_select_member on public.tasks for select to authenticated
using (public.is_project_member(project_id));
create policy tasks_insert_contributor on public.tasks for insert to authenticated
with check (
  created_by = auth.uid()
  and public.has_project_role(project_id, array['owner', 'admin', 'member']::public.project_role[])
);
create policy tasks_update_contributor on public.tasks for update to authenticated
using (public.has_project_role(project_id, array['owner', 'admin', 'member']::public.project_role[]))
with check (public.has_project_role(project_id, array['owner', 'admin', 'member']::public.project_role[]));
create policy tasks_delete_contributor on public.tasks for delete to authenticated
using (public.has_project_role(project_id, array['owner', 'admin', 'member']::public.project_role[]));

create policy assignees_select_member on public.task_assignees for select to authenticated
using (public.is_project_member(public.task_project_id(task_id)));
create policy assignees_insert_contributor on public.task_assignees for insert to authenticated
with check (
  assigned_by = auth.uid()
  and public.has_project_role(public.task_project_id(task_id), array['owner', 'admin', 'member']::public.project_role[])
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = public.task_project_id(task_id) and pm.user_id = user_id
  )
);
create policy assignees_delete_contributor on public.task_assignees for delete to authenticated
using (public.has_project_role(public.task_project_id(task_id), array['owner', 'admin', 'member']::public.project_role[]));

create policy checklist_select_member on public.task_checklist_items for select to authenticated
using (public.is_project_member(public.task_project_id(task_id)));
create policy checklist_insert_contributor on public.task_checklist_items for insert to authenticated
with check (
  created_by = auth.uid()
  and public.has_project_role(public.task_project_id(task_id), array['owner', 'admin', 'member']::public.project_role[])
);
create policy checklist_update_contributor on public.task_checklist_items for update to authenticated
using (public.has_project_role(public.task_project_id(task_id), array['owner', 'admin', 'member']::public.project_role[]))
with check (public.has_project_role(public.task_project_id(task_id), array['owner', 'admin', 'member']::public.project_role[]));
create policy checklist_delete_contributor on public.task_checklist_items for delete to authenticated
using (public.has_project_role(public.task_project_id(task_id), array['owner', 'admin', 'member']::public.project_role[]));

create policy comments_select_member on public.comments for select to authenticated
using (public.is_project_member(public.task_project_id(task_id)));
create policy comments_insert_member on public.comments for insert to authenticated
with check (
  author_id = auth.uid()
  and public.has_project_role(public.task_project_id(task_id), array['owner', 'admin', 'member']::public.project_role[])
);
create policy comments_update_author on public.comments for update to authenticated
using (author_id = auth.uid() and public.is_project_member(public.task_project_id(task_id)))
with check (author_id = auth.uid() and public.is_project_member(public.task_project_id(task_id)));
create policy comments_delete_author_or_admin on public.comments for delete to authenticated
using (
  author_id = auth.uid()
  or public.has_project_role(public.task_project_id(task_id), array['owner', 'admin']::public.project_role[])
);

create policy activities_select_member on public.activities for select to authenticated
using (public.is_project_member(project_id));

create policy files_select_member on public.files for select to authenticated
using (public.is_project_member(project_id));
create policy files_insert_contributor on public.files for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.has_project_role(project_id, array['owner', 'admin', 'member']::public.project_role[])
  and (task_id is null or public.task_project_id(task_id) = project_id)
);
create policy files_update_owner_or_uploader on public.files for update to authenticated
using (
  uploaded_by = auth.uid()
  or public.has_project_role(project_id, array['owner', 'admin']::public.project_role[])
)
with check (public.is_project_member(project_id));
create policy files_delete_owner_or_uploader on public.files for delete to authenticated
using (
  uploaded_by = auth.uid()
  or public.has_project_role(project_id, array['owner', 'admin']::public.project_role[])
);

create policy notifications_select_self on public.notifications for select to authenticated
using (user_id = auth.uid());
create policy notifications_update_self on public.notifications for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete_self on public.notifications for delete to authenticated
using (user_id = auth.uid());

create policy github_sync_jobs_select_admin on public.github_sync_jobs for select to authenticated
using (public.has_project_role(project_id, array['owner', 'admin']::public.project_role[]));

-- Data API privileges are explicit because automatic table exposure is disabled.
-- RLS is still required: table privileges only determine which operations may reach a policy.
revoke all privileges on table
  public.profiles,
  public.projects,
  public.project_members,
  public.project_keys,
  public.tasks,
  public.task_assignees,
  public.task_checklist_items,
  public.comments,
  public.activities,
  public.files,
  public.notifications,
  public.github_sync_jobs
from public, anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select, update on table public.projects to authenticated;
grant select on table public.project_members to authenticated;
grant select on table public.project_keys to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, delete on table public.task_assignees to authenticated;
grant select, insert, update on table public.task_checklist_items to authenticated;
grant select, insert, update on table public.comments to authenticated;
grant select on table public.activities to authenticated;
grant select, insert on table public.files to authenticated;
grant select, update on table public.notifications to authenticated;
grant select on table public.github_sync_jobs to authenticated;

grant all privileges on table
  public.profiles,
  public.projects,
  public.project_members,
  public.project_keys,
  public.tasks,
  public.task_assignees,
  public.task_checklist_items,
  public.comments,
  public.activities,
  public.files,
  public.notifications,
  public.github_sync_jobs
to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 62914560, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy project_files_select_member on storage.objects for select to authenticated
using (bucket_id = 'project-files' and public.is_project_member(public.storage_project_id(name)));
create policy project_files_insert_contributor on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-files'
  and public.has_project_role(public.storage_project_id(name), array['owner', 'admin', 'member']::public.project_role[])
  and owner_id = auth.uid()::text
);
create policy project_files_update_owner on storage.objects for update to authenticated
using (
  bucket_id = 'project-files'
  and owner_id = auth.uid()::text
  and public.is_project_member(public.storage_project_id(name))
)
with check (bucket_id = 'project-files' and owner_id = auth.uid()::text);
create policy project_files_delete_owner_or_admin on storage.objects for delete to authenticated
using (
  bucket_id = 'project-files'
  and (
    owner_id = auth.uid()::text
    or public.has_project_role(public.storage_project_id(name), array['owner', 'admin']::public.project_role[])
  )
);

alter publication supabase_realtime add table
  public.projects,
  public.project_members,
  public.tasks,
  public.task_assignees,
  public.task_checklist_items,
  public.comments,
  public.activities,
  public.files,
  public.notifications;
alter publication supabase_realtime add table public.github_sync_jobs;

commit;
