create table if not exists public.user_beta_features (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_key text not null,
  enabled boolean not null default false,
  whatsapp_test_number text null,
  notes text null,
  updated_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_beta_features_feature_key_check check (char_length(trim(feature_key)) > 0),
  constraint user_beta_features_whatsapp_test_number_check check (
    whatsapp_test_number is null or whatsapp_test_number ~ '^\+[1-9][0-9]{6,14}$'
  ),
  constraint user_beta_features_user_feature_unique unique (user_id, feature_key)
);

create index if not exists idx_user_beta_features_feature_key_enabled
  on public.user_beta_features (feature_key, enabled);

create index if not exists idx_user_beta_features_user_id
  on public.user_beta_features (user_id);

alter table public.user_beta_features enable row level security;

revoke all on public.user_beta_features from anon, authenticated;

create or replace function public.touch_user_beta_features_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_beta_features_touch_updated_at on public.user_beta_features;

create trigger user_beta_features_touch_updated_at
before update on public.user_beta_features
for each row
execute function public.touch_user_beta_features_updated_at();
