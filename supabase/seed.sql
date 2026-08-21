-- Development-only profile seed. Create users 20260001~20260004 through
-- admin-create-user first; this file intentionally stores no Auth password.
-- Projects are not inserted by SQL because a usable project requires a random
-- client-generated DEK and an owner-specific wrapped project_keys row.
update public.profiles as profile
set name = seed.name,
    github_username = seed.github_username
from (values
  ('20260001', '박세준', 'sejun7976'),
  ('20260002', '이현준', 'hyunjun'),
  ('20260003', '김민수', null),
  ('20260004', '최지훈', null)
) as seed(student_id, name, github_username)
where profile.student_id = seed.student_id;

do $$
begin
  if not exists (select 1 from public.profiles where student_id between '20260001' and '20260004') then
    raise notice 'Profile seed skipped: create development users through /#/admin/users first.';
  end if;
  raise notice 'Create AI Pilot, Microbiome, and Capstone through the UI so each receives a real client-generated project DEK.';
end;
$$;
