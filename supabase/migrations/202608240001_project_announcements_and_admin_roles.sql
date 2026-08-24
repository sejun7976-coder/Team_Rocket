begin;

create table public.project_announcements (
  project_id uuid primary key references public.projects(id) on delete cascade,
  content_encrypted jsonb not null check (jsonb_typeof(content_encrypted) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_announcements_updated_idx
  on public.project_announcements(updated_at desc);

create trigger project_announcements_updated_at
before update on public.project_announcements
for each row execute function public.set_updated_at();

alter table public.project_announcements enable row level security;
alter table public.project_announcements force row level security;

create policy project_announcements_select_member
on public.project_announcements for select to authenticated
using (public.is_project_member(project_id));

create policy project_announcements_insert_member
on public.project_announcements for insert to authenticated
with check (
  updated_by = auth.uid()
  and public.is_project_member(project_id)
);

create policy project_announcements_update_member
on public.project_announcements for update to authenticated
using (public.is_project_member(project_id))
with check (
  updated_by = auth.uid()
  and public.is_project_member(project_id)
);

revoke all privileges on table public.project_announcements
from public, anon, authenticated;
grant select, insert, update on table public.project_announcements to authenticated;
grant all privileges on table public.project_announcements to service_role;

create or replace function public.record_project_announcement_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (
    new.project_id,
    new.updated_by,
    case when tg_op = 'INSERT' then 'announcement_created' else 'announcement_updated' end,
    'project_announcement',
    new.project_id
  );
  return new;
end;
$$;

create trigger project_announcement_activity_trigger
after insert or update on public.project_announcements
for each row execute function public.record_project_announcement_activity();

revoke all on function public.record_project_announcement_activity()
from public, anon, authenticated;
grant execute on function public.record_project_announcement_activity()
to service_role;

alter publication supabase_realtime add table public.project_announcements;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check check (action in (
    'user_created',
    'password_reset',
    'user_deactivated',
    'user_reactivated',
    'user_deleted',
    'user_role_changed'
  ));

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

  perform pg_catalog.pg_advisory_xact_lock(724202608240001);

  if not exists (
    select 1
    from public.profiles actor
    where actor.id = p_actor_id
      and actor.system_role = 'admin'
      and actor.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'SYSTEM_ADMIN_REQUIRED';
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

create or replace function public.restore_system_role_after_auth_failure(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_expected_role public.system_role,
  p_restore_role public.system_role
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

  perform pg_catalog.pg_advisory_xact_lock(724202608240001);
  update public.profiles
  set system_role = p_restore_role
  where id = p_target_user_id
    and system_role = p_expected_role;

  if not found then
    raise exception using errcode = '40001', message = 'ROLE_ROLLBACK_CONFLICT';
  end if;

  insert into public.admin_audit_logs(actor_id, action, target_user_id, details)
  values (
    p_actor_id,
    'user_role_changed',
    p_target_user_id,
    jsonb_build_object(
      'expected_role', p_expected_role,
      'restored_role', p_restore_role,
      'rolled_back', true
    )
  );
end;
$$;

revoke all on function public.set_managed_system_role(uuid, uuid, public.system_role)
from public, anon, authenticated;
revoke all on function public.restore_system_role_after_auth_failure(uuid, uuid, public.system_role, public.system_role)
from public, anon, authenticated;
grant execute on function public.set_managed_system_role(uuid, uuid, public.system_role)
to service_role;
grant execute on function public.restore_system_role_after_auth_failure(uuid, uuid, public.system_role, public.system_role)
to service_role;

notify pgrst, 'reload schema';
commit;
