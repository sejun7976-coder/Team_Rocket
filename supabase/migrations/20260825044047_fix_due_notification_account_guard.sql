begin;

create or replace function public.refresh_due_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not public.can_access_business_data() then
    raise exception using
      errcode = '42501',
      message = 'ready account required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'team-rocket:due-notifications:' || auth.uid()::text
    )
  );

  insert into public.notifications(
    user_id,
    project_id,
    task_id,
    type,
    title
  )
  select
    auth.uid(),
    task.project_id,
    task.id,
    case
      when task.due_date < current_date
        then 'overdue'::public.notification_type
      else 'due_soon'::public.notification_type
    end,
    left(
      case
        when task.due_date < current_date
          then '마감일이 지난 작업입니다: '
        else '마감이 임박한 작업입니다: '
      end || task.title,
      180
    )
  from public.tasks task
  join public.task_assignees assignee
    on assignee.task_id = task.id
   and assignee.user_id = auth.uid()
  where task.deleted_at is null
    and task.status <> 'done'
    and task.due_date between current_date - 30 and current_date + 3
    and not exists (
      select 1
      from public.notifications existing
      where existing.user_id = auth.uid()
        and existing.task_id = task.id
        and existing.type = case
          when task.due_date < current_date
            then 'overdue'::public.notification_type
          else 'due_soon'::public.notification_type
        end
        and existing.created_at >= now() - interval '1 day'
    );

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.refresh_due_notifications()
from public, anon, authenticated;

grant execute on function public.refresh_due_notifications()
to authenticated;

grant execute on function public.refresh_due_notifications()
to service_role;

notify pgrst, 'reload schema';

commit;