begin;

create or replace function public.finalize_first_login_profile(
  p_user_id uuid,
  p_encryption_public_key jsonb,
  p_encrypted_private_key jsonb,
  p_key_salt text,
  p_key_kdf_iterations integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_keyring_reused boolean;
  v_was_pending boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'FIRST_LOGIN_SERVICE_ROLE_REQUIRED';
  end if;
  if p_encryption_public_key is null
     or jsonb_typeof(p_encryption_public_key) <> 'object'
     or p_encrypted_private_key is null
     or jsonb_typeof(p_encrypted_private_key) <> 'object'
     or p_key_salt is null
     or char_length(p_key_salt) not between 16 and 256
     or p_key_kdf_iterations not between 310000 and 2000000 then
    raise exception using errcode = 'PFL01', message = 'FIRST_LOGIN_KEYRING_INVALID';
  end if;

  select * into v_profile
  from public.profiles profile
  where profile.id = p_user_id
  for update;

  if v_profile.id is null then
    raise exception using errcode = 'PFL02', message = 'FIRST_LOGIN_PROFILE_NOT_FOUND';
  end if;
  if v_profile.account_status = 'inactive' then
    raise exception using errcode = 'PFL03', message = 'FIRST_LOGIN_ACCOUNT_INACTIVE';
  end if;

  v_was_pending := v_profile.account_status = 'password_change_required';
  v_keyring_reused := not v_was_pending
    and v_profile.encryption_public_key is not null
    and v_profile.encrypted_private_key is not null
    and v_profile.key_salt is not null;

  update public.profiles
  set account_status = 'active',
      first_login_completed_at = coalesce(first_login_completed_at, now()),
      password_changed_at = case
        when v_was_pending then now()
        else coalesce(password_changed_at, now())
      end,
      encryption_public_key = case when v_keyring_reused then encryption_public_key else p_encryption_public_key end,
      encrypted_private_key = case when v_keyring_reused then encrypted_private_key else p_encrypted_private_key end,
      key_salt = case when v_keyring_reused then key_salt else p_key_salt end,
      key_kdf_iterations = case
        when v_keyring_reused then key_kdf_iterations
        else p_key_kdf_iterations
      end
  where id = p_user_id;

  return jsonb_build_object(
    'completed', true,
    'profile_status_before', v_profile.account_status::text,
    'profile_status_after', 'active',
    'keyring_initialized', true,
    'keyring_reused', v_keyring_reused
  );
end;
$$;

revoke all on function public.finalize_first_login_profile(uuid, jsonb, jsonb, text, integer)
from public, anon, authenticated;
grant execute on function public.finalize_first_login_profile(uuid, jsonb, jsonb, text, integer)
to service_role;

commit;
