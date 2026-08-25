begin;

-- Announcement activity actions already satisfy the existing length-only
-- activities.action check. Extend only the subject-type allowlist used by the
-- project announcement audit trigger, while preserving every existing value.
alter table public.activities
  drop constraint if exists activities_subject_type_check;

alter table public.activities
  add constraint activities_subject_type_check
  check (
    subject_type in (
      'project',
      'member',
      'task',
      'assignee',
      'comment',
      'file',
      'project_announcement'
    )
  ) not valid;

alter table public.activities
  validate constraint activities_subject_type_check;

notify pgrst, 'reload schema';

commit;
