begin;

-- The hosted project uses "Automatically expose new tables = OFF". Revoke first
-- so this migration is deterministic even when earlier Dashboard defaults differ.
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
  public.github_sync_jobs,
  public.admin_audit_logs
from public, anon, authenticated;

-- Browser client: only operations used by src/services and src/stores.
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

-- Edge Functions use a service-role client after verifying the caller JWT.
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
  public.github_sync_jobs,
  public.admin_audit_logs
to service_role;

-- Fail closed for all current and future business tables.
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
alter table public.admin_audit_logs enable row level security;

alter default privileges in schema public revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- Prevent helper functions from becoming anonymous Data API RPC endpoints.
revoke all on function public.is_project_member(uuid) from public, anon, authenticated;
revoke all on function public.has_project_role(uuid, public.project_role[]) from public, anon, authenticated;
revoke all on function public.can_view_profile(uuid) from public, anon, authenticated;
revoke all on function public.task_project_id(uuid) from public, anon, authenticated;
revoke all on function public.storage_project_id(text) from public, anon, authenticated;
revoke all on function public.can_access_business_data() from public, anon, authenticated;
revoke all on function public.is_system_admin() from public, anon, authenticated;

grant execute on function public.is_project_member(uuid) to authenticated, service_role;
grant execute on function public.has_project_role(uuid, public.project_role[]) to authenticated, service_role;
grant execute on function public.can_view_profile(uuid) to authenticated, service_role;
grant execute on function public.task_project_id(uuid) to authenticated, service_role;
grant execute on function public.storage_project_id(text) to authenticated, service_role;
grant execute on function public.can_access_business_data() to authenticated, service_role;
grant execute on function public.is_system_admin() to authenticated, service_role;

commit;
