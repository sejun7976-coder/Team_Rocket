begin;

create type public.system_role as enum ('user', 'admin');
create type public.account_status as enum ('password_change_required', 'active', 'inactive');

alter table public.profiles
  add column system_role public.system_role not null default 'user',
  add column account_status public.account_status not null default 'active',
  add column created_by uuid references public.profiles(id) on delete set null,
  add column first_login_completed_at timestamptz,
  add column password_changed_at timestamptz,
  add column key_reset_at timestamptz;

create index profiles_account_status_idx on public.profiles(account_status, student_id);
create index profiles_system_role_idx on public.profiles(system_role) where system_role = 'admin';

create or replace function public.prevent_owner_role_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.role = 'owner' and new.role <> 'owner' then
    raise exception 'project owner role is immutable';
  end if;
  return new;
end;
$$;

create trigger project_owner_role_immutable
before update on public.project_members
for each row execute function public.prevent_owner_role_change();

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('user_created', 'password_reset', 'user_deactivated', 'user_reactivated')),
  target_user_id uuid references public.profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_logs_created_idx on public.admin_audit_logs(created_at desc);
alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_audit_logs from public, anon, authenticated;
grant select, insert on public.admin_audit_logs to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id text;
  v_name text;
  v_system_role public.system_role;
  v_must_change boolean;
begin
  v_student_id := coalesce(
    new.raw_user_meta_data ->> 'student_id',
    substring(new.email from '^([0-9]{6,12})@project-manager\.local$')
  );
  v_name := coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), v_student_id);
  v_system_role := case
    when new.raw_app_meta_data ->> 'system_role' = 'admin' then 'admin'::public.system_role
    else 'user'::public.system_role
  end;
  v_must_change := coalesce((new.raw_app_meta_data ->> 'must_change_password')::boolean, true);

  if v_student_id is null or v_student_id !~ '^[0-9]{6,12}$' then
    raise exception 'valid student_id metadata is required';
  end if;

  insert into public.profiles(id, student_id, name, system_role, account_status)
  values (
    new.id,
    v_student_id,
    v_name,
    v_system_role,
    case when v_must_change then 'password_change_required'::public.account_status else 'active'::public.account_status end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

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

  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin', 'service_role')
     and (
       old.system_role is distinct from new.system_role
       or old.account_status is distinct from new.account_status
       or old.created_by is distinct from new.created_by
       or old.first_login_completed_at is distinct from new.first_login_completed_at
       or old.password_changed_at is distinct from new.password_changed_at
       or old.key_reset_at is distinct from new.key_reset_at
     ) then
    raise exception 'managed profile fields can only be changed by the service role';
  end if;
  return new;
end;
$$;

create or replace function public.can_access_business_data()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'must_change_password', 'true') = 'false'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'account_active', 'true') <> 'false'
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid() and p.account_status = 'active'
    );
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and auth.jwt() -> 'app_metadata' ->> 'system_role' = 'admin'
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.system_role = 'admin'
        and p.account_status = 'active'
    );
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_access_business_data() and exists (
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
  select public.can_access_business_data() and exists (
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
  select p_profile_id = auth.uid() or (
    public.can_access_business_data() and exists (
      select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid() and theirs.user_id = p_profile_id
    )
  );
$$;

create or replace function public.search_profiles(p_query text, p_limit integer default 20)
returns table(id uuid, student_id text, name text, github_username text, avatar_url text, encryption_public_key jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.student_id, p.name, p.github_username, p.avatar_url, p.encryption_public_key
  from public.profiles p
  where public.can_access_business_data()
    and p.account_status <> 'inactive'
    and char_length(trim(p_query)) >= 2
    and (p.student_id ilike '%' || trim(p_query) || '%' or p.name ilike '%' || trim(p_query) || '%')
  order by case when p.student_id = trim(p_query) then 0 else 1 end, p.name
  limit least(greatest(p_limit, 1), 20);
$$;

create or replace function public.rewrap_project_key_atomic(
  p_actor_id uuid,
  p_project_id uuid,
  p_user_id uuid,
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

  select * into v_member from public.project_members
  where project_id = p_project_id and user_id = p_user_id;
  if v_member is null then raise exception 'target is not a project member'; end if;

  insert into public.project_keys(project_id, user_id, wrapped_key, ephemeral_public_key, created_by)
  values (p_project_id, p_user_id, p_wrapped_key, p_ephemeral_public_key, p_actor_id)
  on conflict (project_id, user_id) do update set
    wrapped_key = excluded.wrapped_key,
    ephemeral_public_key = excluded.ephemeral_public_key,
    key_version = public.project_keys.key_version + 1,
    created_at = now(),
    created_by = excluded.created_by;

  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (p_project_id, p_actor_id, 'project_key_rewrapped', 'member', p_user_id);
  return v_member;
end;
$$;

revoke all on function public.rewrap_project_key_atomic(uuid, uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.rewrap_project_key_atomic(uuid, uuid, uuid, jsonb, jsonb) to service_role;

drop policy notifications_select_self on public.notifications;
drop policy notifications_update_self on public.notifications;
drop policy notifications_delete_self on public.notifications;

create policy notifications_select_self on public.notifications for select to authenticated
using (user_id = auth.uid() and public.can_access_business_data());
create policy notifications_update_self on public.notifications for update to authenticated
using (user_id = auth.uid() and public.can_access_business_data())
with check (user_id = auth.uid() and public.can_access_business_data());
create policy notifications_delete_self on public.notifications for delete to authenticated
using (user_id = auth.uid() and public.can_access_business_data());

revoke all on function public.can_access_business_data() from public;
revoke all on function public.is_system_admin() from public;
grant execute on function public.can_access_business_data() to authenticated, service_role;
grant execute on function public.is_system_admin() to authenticated, service_role;

alter publication supabase_realtime add table public.profiles;

commit;
