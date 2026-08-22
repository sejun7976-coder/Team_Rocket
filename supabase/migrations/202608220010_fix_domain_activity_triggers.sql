begin;

-- The former generic trigger referenced NEW.user_id in a compound condition
-- even when invoked for public.tasks, whose actor column is created_by. Split
-- it into row-type-specific functions so a trigger can never access a field
-- that does not exist on its table.
create or replace function public.record_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_actor_id uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'task_created';
    v_actor_id := new.created_by;
  else
    v_actor_id := auth.uid();
    if old.status is distinct from new.status then
      v_action := 'task_status_changed';
    elsif old.progress is distinct from new.progress then
      v_action := 'task_progress_changed';
    elsif old.due_date is distinct from new.due_date then
      v_action := 'task_due_date_changed';
    else
      return new;
    end if;
  end if;

  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (new.project_id, v_actor_id, v_action, 'task', new.id);

  if tg_op = 'UPDATE' then
    if old.due_date is distinct from new.due_date
       and new.due_date between current_date and current_date + 3 then
      insert into public.notifications(user_id, project_id, task_id, type, title)
      select assignee.user_id, new.project_id, new.id, 'due_soon', '담당 작업의 마감일이 임박했습니다.'
      from public.task_assignees assignee
      where assignee.task_id = new.id and assignee.user_id <> auth.uid();
    end if;
  end if;
  return new;
end;
$$;

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
    select task.project_id into v_project_id from public.tasks task where task.id = new.task_id;
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

  select task.project_id into v_project_id from public.tasks task where task.id = old.task_id;
  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (v_project_id, auth.uid(), 'assignee_removed', 'assignee', old.task_id);
  if old.user_id <> auth.uid() then
    insert into public.notifications(user_id, project_id, task_id, type, title)
    values (old.user_id, v_project_id, old.task_id, 'task_unassigned', '작업 담당에서 제외되었습니다.');
  end if;
  return old;
end;
$$;

create or replace function public.record_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid;
begin
  select task.project_id into v_project_id from public.tasks task where task.id = new.task_id;
  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (v_project_id, new.author_id, 'comment_created', 'comment', new.id);
  return new;
end;
$$;

create or replace function public.record_file_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (new.project_id, new.uploaded_by, 'file_uploaded', 'file', new.id);
  return new;
end;
$$;

drop trigger if exists task_activity_trigger on public.tasks;
drop trigger if exists assignee_activity_trigger on public.task_assignees;
drop trigger if exists comment_activity_trigger on public.comments;
drop trigger if exists file_activity_trigger on public.files;

create trigger task_activity_trigger after insert or update on public.tasks
for each row execute function public.record_task_activity();
create trigger assignee_activity_trigger after insert or delete on public.task_assignees
for each row execute function public.record_assignee_activity();
create trigger comment_activity_trigger after insert on public.comments
for each row execute function public.record_comment_activity();
create trigger file_activity_trigger after insert on public.files
for each row execute function public.record_file_activity();

drop function if exists public.record_domain_activity();

revoke all on function public.record_task_activity() from public, anon, authenticated;
revoke all on function public.record_assignee_activity() from public, anon, authenticated;
revoke all on function public.record_comment_activity() from public, anon, authenticated;
revoke all on function public.record_file_activity() from public, anon, authenticated;
grant execute on function public.record_task_activity() to service_role;
grant execute on function public.record_assignee_activity() to service_role;
grant execute on function public.record_comment_activity() to service_role;
grant execute on function public.record_file_activity() to service_role;

notify pgrst, 'reload schema';
commit;
