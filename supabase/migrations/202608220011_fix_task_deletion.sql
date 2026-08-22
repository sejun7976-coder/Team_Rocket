begin;

-- Manual assignee removal must keep its activity/notification behavior. During
-- ON DELETE CASCADE from tasks, however, the parent task is already gone and
-- inserting child activity/notification rows would either lose project_id or
-- recreate a reference to the task being deleted. Treat that cascade path as
-- lifecycle cleanup and return without producing new child rows.
create or replace function public.record_assignee_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  if tg_op = 'INSERT' then
    select task.project_id into v_project_id
    from public.tasks task
    where task.id = new.task_id;

    insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
    values (v_project_id, new.assigned_by, 'assignee_added', 'assignee', new.task_id);

    if new.user_id <> auth.uid() then
      insert into public.notifications(user_id, project_id, task_id, type, title)
      values (new.user_id, v_project_id, new.task_id, 'task_assigned', '새 작업의 담당자로 추가되었습니다.');
      insert into public.notifications(user_id, project_id, task_id, type, title)
      select new.user_id, v_project_id, new.task_id, 'due_soon', '담당 작업의 마감일이 임박했습니다.'
      from public.tasks task
      where task.id = new.task_id and task.due_date between current_date and current_date + 3;
    end if;
    return new;
  end if;

  select task.project_id into v_project_id
  from public.tasks task
  where task.id = old.task_id;

  if v_project_id is null then
    return old;
  end if;

  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (v_project_id, auth.uid(), 'assignee_removed', 'assignee', old.task_id);
  if old.user_id <> auth.uid() then
    insert into public.notifications(user_id, project_id, task_id, type, title)
    values (old.user_id, v_project_id, old.task_id, 'task_unassigned', '작업 담당에서 제외되었습니다.');
  end if;
  return old;
end;
$$;

revoke all on function public.record_assignee_activity() from public, anon, authenticated;
grant execute on function public.record_assignee_activity() to service_role;

notify pgrst, 'reload schema';
commit;
