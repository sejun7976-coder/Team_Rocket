begin;

-- A project workspace is usable independently from its optional GitHub integration.
create or replace function public.finalize_project_without_repository(
  p_project_id uuid
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

  update public.projects
  set status = 'active',
      github_sync_status = 'not_connected',
      github_error_code = null,
      updated_at = now()
  where id = p_project_id
  returning * into v_project;

  if v_project.id is null then
    raise exception using errcode = 'PGR01', message = 'project not found';
  end if;
  return v_project;
end;
$$;

create or replace function public.mark_project_github_error(
  p_project_id uuid,
  p_error_code text
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

  update public.projects
  set status = 'active',
      github_sync_status = 'error',
      github_error_code = left(coalesce(p_error_code, 'GITHUB_API_FAILED'), 120),
      updated_at = now()
  where id = p_project_id
  returning * into v_project;

  if v_project.id is null then
    raise exception using errcode = 'PGR01', message = 'project not found';
  end if;
  return v_project;
end;
$$;

revoke all on function public.finalize_project_without_repository(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_project_github_error(uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_project_without_repository(uuid)
  to service_role;
grant execute on function public.mark_project_github_error(uuid, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
