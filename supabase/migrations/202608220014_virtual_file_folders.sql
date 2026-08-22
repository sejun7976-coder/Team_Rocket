begin;

create table public.file_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name_encrypted jsonb not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.files
  add column folder_id uuid references public.file_folders(id) on delete set null;

create index file_folders_project_created_idx on public.file_folders(project_id, created_at);
create index files_project_folder_created_idx on public.files(project_id, folder_id, created_at desc)
  where deleted_at is null;

create trigger file_folders_updated_at
before update on public.file_folders
for each row execute function public.set_updated_at();

create or replace function public.enforce_file_folder_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.file_folders folder
    where folder.id = new.folder_id and folder.project_id = new.project_id
  ) then
    raise exception using errcode = '23514', message = 'folder must belong to file project';
  end if;
  return new;
end;
$$;

create trigger file_folder_project_guard
before insert or update of folder_id, project_id on public.files
for each row execute function public.enforce_file_folder_project();

alter table public.file_folders enable row level security;
alter table public.file_folders force row level security;

create policy file_folders_select_member on public.file_folders for select to authenticated
using (public.is_project_member(project_id));
create policy file_folders_insert_contributor on public.file_folders for insert to authenticated
with check (
  created_by = auth.uid()
  and public.has_project_role(project_id, array['owner', 'admin', 'member']::public.project_role[])
);
create policy file_folders_delete_creator_or_admin on public.file_folders for delete to authenticated
using (
  created_by = auth.uid()
  or public.has_project_role(project_id, array['owner', 'admin']::public.project_role[])
);

revoke all on table public.file_folders from public, anon, authenticated;
grant select, insert, delete on table public.file_folders to authenticated;
grant all on table public.file_folders to service_role;
grant update(folder_id) on table public.files to authenticated;

revoke all on function public.enforce_file_folder_project() from public, anon, authenticated;
grant execute on function public.enforce_file_folder_project() to service_role;

notify pgrst, 'reload schema';
commit;
