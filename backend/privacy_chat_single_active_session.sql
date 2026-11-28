-- Apply after privacy_chat_devices_rls.sql and privacy_chat_access_controls.sql.
begin;

create table privacy_chat.active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  started_at timestamptz not null
);
alter table privacy_chat.active_sessions enable row level security;
revoke all on privacy_chat.active_sessions from public, anon, authenticated;

alter function privacy_chat.register_device(text,text,text) rename to record_device;
revoke all on function privacy_chat.record_device(text,text,text) from public, anon, authenticated;

create function privacy_chat.register_device(p_device_key text,p_device_name text,p_platform text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid := auth.uid();
  login_session uuid := (auth.jwt()->>'session_id')::uuid;
  login_started timestamptz;
begin
  select s.created_at into login_started from auth.sessions s
  where s.id=login_session and s.user_id=account_id
    and (s.not_after is null or s.not_after > now());
  if login_started is null then
    raise exception 'Sign in again to register this device' using errcode='42501';
  end if;

  insert into privacy_chat.active_sessions as active (user_id,session_id,started_at)
  values (account_id,login_session,login_started)
  on conflict (user_id) do update
    set session_id=excluded.session_id, started_at=excluded.started_at
    where active.session_id=excluded.session_id
       or (active.started_at,active.session_id) < (excluded.started_at,excluded.session_id);
  if not found then
    raise exception 'This device session was replaced. Sign in again.' using errcode='PT409';
  end if;

  return privacy_chat.record_device(p_device_key,p_device_name,p_platform);
end;
$$;
revoke all on function privacy_chat.register_device(text,text,text) from public, anon;
grant execute on function privacy_chat.register_device(text,text,text) to authenticated;

alter function privacy_chat.handle(text,jsonb) rename to handle_authorized;
revoke all on function privacy_chat.handle_authorized(text,jsonb) from public, anon, authenticated;

create function privacy_chat.handle(op text,args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- These management operations retain the existing verified-email and Admin checks.
  if op is null or op not in ('payments','approve','reject','set_free_testing','set_user_enabled') then
    perform 1 from privacy_chat.active_sessions a
      join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
      where a.user_id=auth.uid() and a.session_id=(auth.jwt()->>'session_id')::uuid
        and (s.not_after is null or s.not_after > now())
      for share of a;
    if not found then
      raise exception 'This device session is inactive. Sign in again.' using errcode='PT409';
    end if;
  end if;
  return privacy_chat.handle_authorized(op,args);
end;
$$;
revoke all on function privacy_chat.handle(text,jsonb) from public, anon;
grant execute on function privacy_chat.handle(text,jsonb) to authenticated;

-- Rebind the existing RPC wrappers to the guarded entry points.
create or replace function public.privacy_chat_action(op text,args jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select privacy_chat.handle(op,args) $$;

create or replace function public.privacy_chat_register_device(
  p_device_key text,p_device_name text,p_platform text
) returns jsonb language sql security invoker set search_path = ''
as $$ select privacy_chat.register_device(p_device_key,p_device_name,p_platform) $$;

commit;
