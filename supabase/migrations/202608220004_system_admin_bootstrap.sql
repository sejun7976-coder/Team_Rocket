begin;

create table public.system_admin_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  claim_id uuid not null unique,
  status text not null check (status in ('claimed', 'completed')),
  user_id uuid references public.profiles(id) on delete restrict,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (status = 'claimed' and user_id is null and completed_at is null)
    or (status = 'completed' and user_id is not null and completed_at is not null)
  )
);

alter table public.system_admin_bootstrap_state enable row level security;
revoke all privileges on table public.system_admin_bootstrap_state from public, anon, authenticated;
grant select, insert, update, delete on table public.system_admin_bootstrap_state to service_role;

create or replace function public.claim_system_admin_bootstrap(p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.system_admin_bootstrap_state;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(724202608220004);

  if exists (select 1 from public.profiles where system_role = 'admin') then
    return false;
  end if;

  select * into v_state
  from public.system_admin_bootstrap_state
  where singleton = true
  for update;

  if found and (
    v_state.status = 'completed'
    or v_state.claimed_at > now() - interval '15 minutes'
  ) then
    return false;
  end if;

  insert into public.system_admin_bootstrap_state(singleton, claim_id, status, claimed_at)
  values (true, p_claim_id, 'claimed', now())
  on conflict (singleton) do update set
    claim_id = excluded.claim_id,
    status = 'claimed',
    user_id = null,
    claimed_at = excluded.claimed_at,
    completed_at = null;
  return true;
end;
$$;

create or replace function public.release_system_admin_bootstrap(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(724202608220004);
  delete from public.system_admin_bootstrap_state state
  where state.singleton = true
    and state.claim_id = p_claim_id
    and state.status = 'claimed'
    and not exists (select 1 from public.profiles where system_role = 'admin');
end;
$$;

create or replace function public.finalize_system_admin_bootstrap(p_claim_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(724202608220004);

  if not exists (
    select 1
    from public.system_admin_bootstrap_state state
    where state.singleton = true
      and state.claim_id = p_claim_id
      and state.status = 'claimed'
  ) then
    raise exception 'bootstrap claim is not active';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_user_id
      and profile.system_role = 'admin'
      and profile.account_status = 'password_change_required'
  ) then
    raise exception 'bootstrap administrator profile is invalid';
  end if;

  update public.system_admin_bootstrap_state
  set status = 'completed', user_id = p_user_id, completed_at = now()
  where singleton = true and claim_id = p_claim_id;

  insert into public.admin_audit_logs(actor_id, action, target_user_id, details)
  values (p_user_id, 'user_created', p_user_id, '{"bootstrap":true}'::jsonb);
end;
$$;

revoke all on function public.claim_system_admin_bootstrap(uuid) from public, anon, authenticated;
revoke all on function public.release_system_admin_bootstrap(uuid) from public, anon, authenticated;
revoke all on function public.finalize_system_admin_bootstrap(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_system_admin_bootstrap(uuid) to service_role;
grant execute on function public.release_system_admin_bootstrap(uuid) to service_role;
grant execute on function public.finalize_system_admin_bootstrap(uuid, uuid) to service_role;

commit;
