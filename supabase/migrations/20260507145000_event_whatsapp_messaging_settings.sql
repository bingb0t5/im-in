create table if not exists public.event_whatsapp_messaging_settings (
  event_id uuid primary key references public.events(id) on delete cascade,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  platform_target_id uuid null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_whatsapp_messaging_settings_host
  on public.event_whatsapp_messaging_settings (host_user_id, updated_at desc);

create index if not exists idx_event_whatsapp_messaging_settings_target
  on public.event_whatsapp_messaging_settings (platform_target_id);

create table if not exists public.event_whatsapp_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  platform_message_id uuid not null unique,
  platform_target_id uuid not null,
  message_body text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'sent', 'failed', 'cancelled')),
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_whatsapp_scheduled_messages_event
  on public.event_whatsapp_scheduled_messages (event_id, scheduled_for asc);

create index if not exists idx_event_whatsapp_scheduled_messages_host
  on public.event_whatsapp_scheduled_messages (host_user_id, created_at desc);

alter table public.event_whatsapp_messaging_settings enable row level security;
alter table public.event_whatsapp_scheduled_messages enable row level security;

drop policy if exists event_whatsapp_messaging_settings_host_select on public.event_whatsapp_messaging_settings;
create policy event_whatsapp_messaging_settings_host_select
on public.event_whatsapp_messaging_settings
for select to authenticated
using (public.is_event_host(event_id, auth.uid()));

drop policy if exists event_whatsapp_messaging_settings_host_insert on public.event_whatsapp_messaging_settings;
create policy event_whatsapp_messaging_settings_host_insert
on public.event_whatsapp_messaging_settings
for insert to authenticated
with check (
  auth.uid() is not null
  and public.is_event_host(event_id, auth.uid())
  and host_user_id = auth.uid()
);

drop policy if exists event_whatsapp_messaging_settings_host_update on public.event_whatsapp_messaging_settings;
create policy event_whatsapp_messaging_settings_host_update
on public.event_whatsapp_messaging_settings
for update to authenticated
using (public.is_event_host(event_id, auth.uid()))
with check (
  auth.uid() is not null
  and public.is_event_host(event_id, auth.uid())
  and host_user_id = auth.uid()
);

drop policy if exists event_whatsapp_scheduled_messages_host_select on public.event_whatsapp_scheduled_messages;
create policy event_whatsapp_scheduled_messages_host_select
on public.event_whatsapp_scheduled_messages
for select to authenticated
using (public.is_event_host(event_id, auth.uid()));

drop policy if exists event_whatsapp_scheduled_messages_host_insert on public.event_whatsapp_scheduled_messages;
create policy event_whatsapp_scheduled_messages_host_insert
on public.event_whatsapp_scheduled_messages
for insert to authenticated
with check (
  auth.uid() is not null
  and public.is_event_host(event_id, auth.uid())
  and host_user_id = auth.uid()
  and (created_by_user_id is null or created_by_user_id = auth.uid())
);

drop trigger if exists event_whatsapp_messaging_settings_touch_updated_at on public.event_whatsapp_messaging_settings;
create trigger event_whatsapp_messaging_settings_touch_updated_at
before update on public.event_whatsapp_messaging_settings
for each row execute function public.touch_updated_at();

drop trigger if exists event_whatsapp_scheduled_messages_touch_updated_at on public.event_whatsapp_scheduled_messages;
create trigger event_whatsapp_scheduled_messages_touch_updated_at
before update on public.event_whatsapp_scheduled_messages
for each row execute function public.touch_updated_at();
