-- Privacy Chat device registry and RLS hardening.
-- Apply after backend/privacy_chat.sql. Chat data remains RPC-only; no direct client
-- grants or policies are added to the private schema tables.
create table if not exists privacy_chat.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_key text not null check (device_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  device_name text not null check (length(trim(device_name)) between 1 and 80),
  platform text not null check (platform in ('Android','Web')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, device_key)
);
create index if not exists privacy_chat_devices_user_last_seen
  on privacy_chat.devices(user_id, last_seen_at desc);

revoke all on table privacy_chat.devices from public, anon, authenticated;
alter table privacy_chat.devices enable row level security;
alter table privacy_chat.admin_emails enable row level security;
alter table privacy_chat.people enable row level security;
alter table privacy_chat.rooms enable row level security;
alter table privacy_chat.members enable row level security;
alter table privacy_chat.messages enable row level security;

create or replace function privacy_chat.register_device(
  p_device_key text, p_device_name text, p_platform text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  device_row privacy_chat.devices%rowtype;
begin
  if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists (select 1 from auth.users u where u.id=me and u.email_confirmed_at is not null) then
    raise exception 'Verify your email first' using errcode='42501';
  end if;
  if p_device_key is null or p_device_key !~ '^[A-Za-z0-9._:-]{16,128}$' then
    raise exception 'Invalid device identifier' using errcode='22023';
  end if;
  if p_device_name is null or length(trim(p_device_name)) not between 1 and 80 then
    raise exception 'Device name must be 1–80 characters' using errcode='22023';
  end if;
  if p_platform not in ('Android','Web') then
    raise exception 'Unsupported device type' using errcode='22023';
  end if;
  insert into privacy_chat.devices(user_id,device_key,device_name,platform)
  values (me,p_device_key,trim(p_device_name),p_platform)
  on conflict (user_id,device_key) do update
    set device_name=excluded.device_name, platform=excluded.platform, last_seen_at=now()
  returning * into device_row;
  return jsonb_build_object(
    'id',device_row.id,'device_name',device_row.device_name,'platform',device_row.platform,
    'first_seen_at',device_row.first_seen_at,'last_seen_at',device_row.last_seen_at
  );
end;
$$;

create or replace function privacy_chat.list_devices()
returns jsonb language plpgsql security definer stable set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  result jsonb;
begin
  if me is null or not exists (
    select 1 from auth.users u where u.id=me and u.email_confirmed_at is not null
  ) then raise exception 'Verified sign-in required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'device_name',d.device_name,'platform',d.platform,
    'first_seen_at',d.first_seen_at,'last_seen_at',d.last_seen_at
  ) order by d.last_seen_at desc),'[]'::jsonb)
  into result from privacy_chat.devices d where d.user_id=me;
  return result;
end;
$$;

create or replace function public.privacy_chat_register_device(
  p_device_key text, p_device_name text, p_platform text
) returns jsonb language sql security invoker set search_path = ''
as $$ select privacy_chat.register_device(p_device_key,p_device_name,p_platform) $$;
create or replace function public.privacy_chat_list_devices()
returns jsonb language sql security invoker set search_path = ''
as $$ select privacy_chat.list_devices() $$;

revoke all on function privacy_chat.register_device(text,text,text) from public,anon;
revoke all on function privacy_chat.list_devices() from public,anon;
revoke all on function public.privacy_chat_register_device(text,text,text) from public,anon;
revoke all on function public.privacy_chat_list_devices() from public,anon;
grant execute on function privacy_chat.register_device(text,text,text) to authenticated;
grant execute on function privacy_chat.list_devices() to authenticated;
grant execute on function public.privacy_chat_register_device(text,text,text) to authenticated;
grant execute on function public.privacy_chat_list_devices() to authenticated;
