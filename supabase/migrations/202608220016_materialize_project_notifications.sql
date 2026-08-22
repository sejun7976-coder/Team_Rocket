begin;

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

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.notifications(user_id, project_id, task_id, type, title)
    select assignee.user_id, new.project_id, new.id, 'task_updated',
      left('담당 작업 상태가 변경되었습니다: ' || new.title, 180)
    from public.task_assignees assignee
    where assignee.task_id = new.id and assignee.user_id <> auth.uid();
  end if;

  if tg_op = 'UPDATE' and old.due_date is distinct from new.due_date
     and new.due_date between current_date and current_date + 3 then
    insert into public.notifications(user_id, project_id, task_id, type, title)
    select assignee.user_id, new.project_id, new.id, 'due_soon',
      left('마감이 임박한 작업입니다: ' || new.title, 180)
    from public.task_assignees assignee
    where assignee.task_id = new.id and assignee.user_id <> auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.record_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_task_title text;
begin
  select task.project_id, task.title into v_project_id, v_task_title
  from public.tasks task where task.id = new.task_id;
  insert into public.activities(project_id, actor_id, action, subject_type, subject_id)
  values (v_project_id, new.author_id, 'comment_created', 'comment', new.id);
  insert into public.notifications(user_id, project_id, task_id, type, title)
  select distinct assignee.user_id, v_project_id, new.task_id, 'comment_added',
    left('담당 작업에 새 댓글이 있습니다: ' || v_task_title, 180)
  from public.task_assignees assignee
  where assignee.task_id = new.task_id and assignee.user_id <> new.author_id;
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
  insert into public.notifications(user_id, project_id, task_id, type, title)
  select member.user_id, new.project_id, new.task_id, 'file_uploaded',
    case when new.task_id is null then '프로젝트에 새 파일이 업로드되었습니다.' else '담당 작업에 새 첨부 파일이 업로드되었습니다.' end
  from public.project_members member
  where member.project_id = new.project_id and member.user_id <> new.uploaded_by;
  return new;
end;
$$;

create or replace function public.refresh_due_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null or not public.current_account_ready() then
    raise exception using errcode = '42501', message = 'ready account required';
  end if;
  perform pg_advisory_xact_lock(hashtext('team-rocket:due-notifications:' || auth.uid()::text));
  insert into public.notifications(user_id, project_id, task_id, type, title)
  select auth.uid(), task.project_id, task.id,
    case when task.due_date < current_date then 'overdue'::public.notification_type else 'due_soon'::public.notification_type end,
    left(case when task.due_date < current_date then '마감일이 지난 작업입니다: ' else '마감이 임박한 작업입니다: ' end || task.title, 180)
  from public.tasks task
  join public.task_assignees assignee on assignee.task_id = task.id and assignee.user_id = auth.uid()
  where task.deleted_at is null and task.status <> 'done'
    and task.due_date between current_date - 30 and current_date + 3
    and not exists (
      select 1 from public.notifications existing
      where existing.user_id = auth.uid() and existing.task_id = task.id
        and existing.type = case when task.due_date < current_date then 'overdue'::public.notification_type else 'due_soon'::public.notification_type end
        and existing.created_at >= now() - interval '1 day'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.refresh_due_notifications() from public, anon, authenticated;
grant execute on function public.refresh_due_notifications() to authenticated;
grant execute on function public.refresh_due_notifications() to service_role;
revoke all on function public.record_task_activity() from public, anon, authenticated;
revoke all on function public.record_comment_activity() from public, anon, authenticated;
revoke all on function public.record_file_activity() from public, anon, authenticated;
grant execute on function public.record_task_activity() to service_role;
grant execute on function public.record_comment_activity() to service_role;
grant execute on function public.record_file_activity() to service_role;

notify pgrst, 'reload schema';

commit;
