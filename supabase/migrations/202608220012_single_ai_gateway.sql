begin;

create table public.ai_gateway_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  base_url text,
  api_key_ciphertext text,
  api_key_iv text,
  encryption_version integer not null default 1 check (encryption_version = 1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((api_key_ciphertext is null) = (api_key_iv is null)),
  check (base_url is null or char_length(base_url) between 8 and 500)
);

insert into public.ai_gateway_settings(singleton) values (true)
on conflict (singleton) do nothing;

create trigger ai_gateway_settings_updated_at
before update on public.ai_gateway_settings
for each row execute function public.set_updated_at();

alter table public.ai_gateway_settings enable row level security;
alter table public.ai_gateway_settings force row level security;
revoke all on table public.ai_gateway_settings from public, anon, authenticated;
grant all on table public.ai_gateway_settings to service_role;

-- Preserve every existing model row while removing the runtime credential
-- relationship to provider-specific settings. family is display grouping only.
alter table public.ai_model_settings drop constraint if exists ai_model_settings_provider_fkey;
drop index if exists public.ai_model_settings_one_default_per_provider_idx;
alter table public.ai_model_settings drop constraint if exists ai_model_settings_provider_model_id_key;
alter table public.ai_model_settings rename column provider to family;
alter table public.ai_model_settings add column is_builtin boolean not null default false;
update public.ai_model_settings set is_default = false where is_default;
alter table public.ai_model_settings add constraint ai_model_settings_model_id_key unique(model_id);
alter table public.ai_model_settings add constraint ai_model_settings_default_enabled_check check (not is_default or enabled);
create unique index ai_model_settings_one_default_idx on public.ai_model_settings((true)) where is_default;
create index ai_model_settings_family_order_idx on public.ai_model_settings(family, sort_order, display_name);

insert into public.ai_model_settings(model_id, display_name, family, enabled, is_default, sort_order, is_builtin)
values
  ('gpt-5.6-luna', 'GPT-5.6 Luna', 'openai', false, false, 10, true),
  ('gpt-5.6-terra', 'GPT-5.6 Terra', 'openai', false, false, 20, true),
  ('gpt-5.6-sol', 'GPT-5.6 Sol', 'openai', true, false, 30, true),
  ('gpt-5.5', 'GPT-5.5', 'openai', false, false, 40, true),
  ('claude-sonnet-5', 'Claude Sonnet 5', 'claude', false, false, 110, true),
  ('claude-opus-5', 'Claude Opus 5', 'claude', false, false, 120, true),
  ('claude-fable-5', 'Claude Fable 5', 'claude', false, false, 130, true),
  ('claude-opus-4-8', 'Claude 4.8 Opus', 'claude', false, false, 140, true),
  ('claude-haiku-4-5-20251001', 'Claude 4.5 Haiku', 'claude', false, false, 150, true),
  ('gemini-3.7-flash', 'Gemini 3.7 Flash', 'gemini', false, false, 210, true),
  ('gemini-3.6-flash', 'Gemini 3.6 Flash', 'gemini', false, false, 220, true),
  ('gemini-3.5-flash', 'Gemini 3.5 Flash', 'gemini', false, false, 230, true),
  ('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'gemini', false, false, 240, true),
  ('gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'gemini', false, false, 250, true),
  ('grok-4.6', 'Grok 4.6', 'grok', false, false, 310, true),
  ('grok-4.5', 'Grok 4.5', 'grok', false, false, 320, true),
  ('grok-4-1-fast', 'Grok 4.1 Fast', 'grok', false, false, 330, true),
  ('google/gemma-4-31B-it', 'Gemma 4', 'gemma', false, false, 410, true),
  ('sonar-pro', 'Sonar Pro', 'perplexity', false, false, 510, true),
  ('sonar-reasoning-pro', 'Sonar Reasoning Pro', 'perplexity', false, false, 520, true),
  ('solar-pro4', 'Solar Pro 4', 'upstage', false, false, 610, true),
  ('LGAI-EXAONE/K-EXAONE-2.0-750B-A37B', 'K-EXAONE 2.0', 'exaone', false, false, 710, true),
  ('qwen3.8-max', 'Qwen 3.8 Max', 'qwen', false, false, 810, true),
  ('qwen3.7-plus', 'Qwen 3.7 Plus', 'qwen', false, false, 820, true),
  ('qwen3.7-max', 'Qwen 3.7 Max', 'qwen', false, false, 830, true),
  ('glm-5.2', 'GLM-5.2', 'glm', false, false, 910, true),
  ('kimi-k3', 'Kimi K3', 'kimi', false, false, 1010, true),
  ('kimi-k2.6', 'Kimi K2.6', 'kimi', false, false, 1020, true),
  ('seed-2-0-pro-260328', 'Seed 2.0 Pro', 'seed', false, false, 1110, true),
  ('seed-2-0-lite-260428', 'Seed 2.0 Lite', 'seed', false, false, 1120, true),
  ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', false, false, 1210, true),
  ('deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', false, false, 1220, true)
on conflict (model_id) do update set
  display_name = excluded.display_name,
  family = excluded.family,
  sort_order = excluded.sort_order,
  is_builtin = true,
  updated_at = now();

update public.ai_model_settings
set enabled = true, is_default = true, updated_at = now()
where model_id = 'gpt-5.6-sol';

create or replace function public.set_ai_model_state(
  p_model_setting_id uuid,
  p_enabled boolean,
  p_make_default boolean default false
)
returns public.ai_model_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ai_model_settings;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = 'AIG01', message = 'service role required'; end if;
  lock table public.ai_model_settings in share row exclusive mode;
  select * into v_model from public.ai_model_settings where id = p_model_setting_id for update;
  if v_model.id is null then raise exception using errcode = 'AIG02', message = 'model not found'; end if;
  if v_model.is_default and not p_enabled and not p_make_default then
    raise exception using errcode = 'AIG03', message = 'default model cannot be disabled';
  end if;
  if p_make_default and not p_enabled then raise exception using errcode = 'AIG04', message = 'default model must be enabled'; end if;
  if p_make_default then
    update public.ai_model_settings set is_default = false, updated_by = auth.uid() where is_default;
  end if;
  update public.ai_model_settings
  set enabled = p_enabled,
      is_default = case when p_make_default then true else is_default end,
      updated_at = now()
  where id = p_model_setting_id
  returning * into v_model;
  return v_model;
end;
$$;

create or replace function public.delete_custom_ai_model(p_model_setting_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_model public.ai_model_settings;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = 'AIG01', message = 'service role required'; end if;
  select * into v_model from public.ai_model_settings where id = p_model_setting_id for update;
  if v_model.id is null then return false; end if;
  if v_model.is_builtin then raise exception using errcode = 'AIG05', message = 'builtin model cannot be deleted'; end if;
  if v_model.is_default then raise exception using errcode = 'AIG06', message = 'default model cannot be deleted'; end if;
  delete from public.ai_model_settings where id = p_model_setting_id;
  return true;
end;
$$;

revoke all on function public.set_ai_model_state(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.delete_custom_ai_model(uuid) from public, anon, authenticated;
grant execute on function public.set_ai_model_state(uuid, boolean, boolean) to service_role;
grant execute on function public.delete_custom_ai_model(uuid) to service_role;

alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_feature_check;
alter table public.ai_usage_logs add constraint ai_usage_logs_feature_check check (feature in (
  'chat', 'create_task', 'split_task', 'project_briefing', 'project_summary',
  'weekly_report', 'project_qa', 'github_summary', 'decompose_tasks', 'briefing'
));

revoke all on table public.ai_model_settings from public, anon, authenticated;
grant all on table public.ai_model_settings to service_role;

notify pgrst, 'reload schema';
commit;
