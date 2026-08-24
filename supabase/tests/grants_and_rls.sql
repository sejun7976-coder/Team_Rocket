begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(84);

-- Exact browser privilege matrix. Extra privileges fail this test just like missing ones.
with expected(table_name, can_select, can_insert, can_update, can_delete) as (values
  ('profiles', true, false, true, false),
  ('projects', true, false, true, false),
  ('project_members', true, false, false, false),
  ('project_keys', true, false, false, false),
  ('tasks', true, true, true, false),
  ('task_assignees', true, true, false, true),
  ('task_checklist_items', true, true, true, false),
  ('comments', true, true, true, false),
  ('activities', true, false, false, false),
  ('project_announcements', true, true, true, false),
  ('files', true, true, false, true),
  ('file_folders', true, true, false, true),
  ('notifications', true, false, true, false),
  ('github_sync_jobs', true, false, false, false),
  ('admin_audit_logs', false, false, false, false),
  ('system_admin_bootstrap_state', false, false, false, false),
  ('user_access_logs', false, false, false, false),
  ('ai_provider_settings', false, false, false, false),
  ('ai_gateway_settings', false, false, false, false),
  ('ai_model_settings', false, false, false, false),
  ('ai_usage_logs', false, false, false, false)
)
select ok(
  has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') = can_select
  and has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT') = can_insert
  and has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE') = can_update
  and has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') = can_delete
  and not has_table_privilege('authenticated', format('public.%I', table_name), 'TRUNCATE')
  and not has_table_privilege('authenticated', format('public.%I', table_name), 'REFERENCES')
  and not has_table_privilege('authenticated', format('public.%I', table_name), 'TRIGGER'),
  format('authenticated has exact least-privilege GRANTs on public.%I', table_name)
)
from expected;

-- No business table is anonymously accessible, including through a PUBLIC grant.
with business_tables(table_name) as (values
  ('profiles'), ('projects'), ('project_members'), ('project_keys'), ('tasks'),
  ('task_assignees'), ('task_checklist_items'), ('comments'), ('activities'),
  ('project_announcements'), ('files'), ('file_folders'), ('notifications'), ('github_sync_jobs'), ('admin_audit_logs'),
  ('system_admin_bootstrap_state'), ('user_access_logs'), ('ai_provider_settings'), ('ai_gateway_settings'), ('ai_model_settings'), ('ai_usage_logs')
)
select ok(
  not has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
  and not has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
  and not has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
  and not has_table_privilege('anon', format('public.%I', table_name), 'DELETE')
  and not has_table_privilege('anon', format('public.%I', table_name), 'TRUNCATE')
  and not has_table_privilege('anon', format('public.%I', table_name), 'REFERENCES')
  and not has_table_privilege('anon', format('public.%I', table_name), 'TRIGGER'),
  format('anon has no business-table privileges on public.%I', table_name)
)
from business_tables;

-- RLS must remain enabled independently from table privileges.
with business_tables(table_name) as (values
  ('profiles'), ('projects'), ('project_members'), ('project_keys'), ('tasks'),
  ('task_assignees'), ('task_checklist_items'), ('comments'), ('activities'),
  ('project_announcements'), ('files'), ('file_folders'), ('notifications'), ('github_sync_jobs'), ('admin_audit_logs'),
  ('system_admin_bootstrap_state'), ('user_access_logs'), ('ai_provider_settings'), ('ai_gateway_settings'), ('ai_model_settings'), ('ai_usage_logs')
)
select ok(
  coalesce((
    select class.relrowsecurity
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public' and class.relname = table_name
  ), false),
  format('RLS is enabled on public.%I', table_name)
)
from business_tables;

-- Every operation granted to authenticated must have at least one matching policy.
with expected(table_name, can_select, can_insert, can_update, can_delete) as (values
  ('profiles', true, false, true, false),
  ('projects', true, false, true, false),
  ('project_members', true, false, false, false),
  ('project_keys', true, false, false, false),
  ('tasks', true, true, true, false),
  ('task_assignees', true, true, false, true),
  ('task_checklist_items', true, true, true, false),
  ('comments', true, true, true, false),
  ('activities', true, false, false, false),
  ('project_announcements', true, true, true, false),
  ('files', true, true, false, true),
  ('file_folders', true, true, false, true),
  ('notifications', true, false, true, false),
  ('github_sync_jobs', true, false, false, false),
  ('admin_audit_logs', false, false, false, false),
  ('system_admin_bootstrap_state', false, false, false, false),
  ('user_access_logs', false, false, false, false),
  ('ai_provider_settings', false, false, false, false),
  ('ai_gateway_settings', false, false, false, false),
  ('ai_model_settings', false, false, false, false),
  ('ai_usage_logs', false, false, false, false)
)
select ok(
  (not can_select or exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = table_name and cmd in ('SELECT', 'ALL') and ('authenticated' = any(roles) or 'public' = any(roles))))
  and (not can_insert or exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = table_name and cmd in ('INSERT', 'ALL') and ('authenticated' = any(roles) or 'public' = any(roles))))
  and (not can_update or exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = table_name and cmd in ('UPDATE', 'ALL') and ('authenticated' = any(roles) or 'public' = any(roles))))
  and (not can_delete or exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = table_name and cmd in ('DELETE', 'ALL') and ('authenticated' = any(roles) or 'public' = any(roles)))),
  format('every authenticated GRANT has a matching RLS policy on public.%I', table_name)
)
from expected;

select * from finish();
rollback;
