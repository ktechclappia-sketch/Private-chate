begin;
create schema if not exists privacy_chat;
revoke all on schema privacy_chat from public, anon;
grant usage on schema privacy_chat to authenticated;
create table if not exists privacy_chat.admin_emails(email text primary key);
create table if not exists privacy_chat.people(id uuid primary key references auth.users on delete cascade);
create table if not exists privacy_chat.rooms(id uuid primary key default gen_random_uuid(), title text not null, kind text not null check(kind in ('personal','group')), owner_id uuid not null references privacy_chat.people, pair text unique);
create table if not exists privacy_chat.members(room_id uuid references privacy_chat.rooms on delete cascade, person uuid references privacy_chat.people, accepted boolean not null default false, primary key(room_id,person));
create table if not exists privacy_chat.messages(id bigint generated always as identity primary key, room_id uuid not null references privacy_chat.rooms on delete cascade, sender uuid not null references privacy_chat.people, body text not null, photo text, sent_at timestamptz not null default now());
create index if not exists privacy_chat_message_thread on privacy_chat.messages(room_id,id desc);
revoke all on all tables in schema privacy_chat from public,anon,authenticated;

create or replace function privacy_chat.handle(op text, args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 me uuid := auth.uid();
 email_address text;
 admin_access boolean;
 entitled boolean;
 sub public.privacy_subscriptions%rowtype;
 r uuid := (args->>'room')::uuid;
 room privacy_chat.rooms%rowtype;
 peer uuid;
 payment public.privacy_payments%rowtype;
 result jsonb;
begin
 select lower(email) into email_address from auth.users where id=me and email_confirmed_at is not null;
 if email_address is null then raise exception 'Verify your email first'; end if;
 insert into privacy_chat.people values(me) on conflict do nothing;
 select exists(select 1 from privacy_chat.admin_emails where email=email_address) into admin_access;
 select * into sub from public.privacy_subscriptions where user_id=me;
 entitled := admin_access or coalesce(now() >= sub.starts_at and now() < sub.ends_at,false);
 if op='access' then
 return jsonb_build_object('active',entitled,'admin',admin_access,'start',sub.starts_at,'end',sub.ends_at,
 'payment',(select status from public.privacy_payments where user_id=me order by created_at desc limit 1));
 end if;
 if not entitled then raise exception 'Subscription required'; end if;
 if op='payments' and admin_access then
 select jsonb_agg(jsonb_build_object('id',p.id,'reference',p.upi_reference,'email',u.email) order by p.created_at) into result from public.privacy_payments p join auth.users u on u.id=p.user_id where p.status='pending';
 elsif op in ('approve','reject') and admin_access then
 select * into strict payment from public.privacy_payments where id=(args->>'id')::uuid and status='pending' for update;
 update public.privacy_payments set status=case when op='approve' then 'approved' else 'rejected' end where id=payment.id;
 if op='approve' then
 insert into public.privacy_subscriptions as s(user_id,starts_at,ends_at) values(payment.user_id,now(),now()+interval '1 month')
 on conflict(user_id) do update set starts_at=case when s.ends_at>now() then s.starts_at else now() end, ends_at=greatest(s.ends_at,now())+interval '1 month';
 end if;
 elsif op='rooms' then
 select jsonb_agg(jsonb_build_object('room',rm.id,'title',case when rm.kind='group' then rm.title else (select u.email from privacy_chat.members other join auth.users u on u.id=other.person where other.room_id=rm.id and other.person<>me limit 1) end,'accepted',m.accepted,'kind',rm.kind,'owner',rm.owner_id=me) order by rm.title) into result from privacy_chat.members m join privacy_chat.rooms rm on rm.id=m.room_id where m.person=me;
 elsif op='group' then
 if length(trim(coalesce(args->>'title',''))) not between 1 and 80 then raise exception 'Group name required'; end if;
 insert into privacy_chat.rooms(title,kind,owner_id) values(trim(args->>'title'),'group',me) returning id into r;
 insert into privacy_chat.members values(r,me,true);
 elsif op='personal' then
 select p.id into peer from privacy_chat.people p join auth.users u on p.id=u.id where lower(u.email)=lower(trim(args->>'email'));
 if peer is null or peer=me then raise exception 'Contact unavailable'; end if;
 insert into privacy_chat.rooms(title,kind,owner_id,pair) values('Personal','personal',me,least(peer,me)::text||greatest(peer,me)::text) returning id into r;
 insert into privacy_chat.members values(r,me,true),(r,peer,false);
 else
 select * into strict room from privacy_chat.rooms where id=r for share;
 if op in ('accept','decline') then
 if not exists(select 1 from privacy_chat.members where room_id=r and person=me and not accepted) then raise exception 'No pending invitation'; end if;
 if op='accept' then update privacy_chat.members set accepted=true where room_id=r and person=me;
 elsif room.kind='personal' then delete from privacy_chat.rooms where id=r;
 else delete from privacy_chat.members where room_id=r and person=me; end if;
 elsif not exists(select 1 from privacy_chat.members where room_id=r and person=me and accepted) then raise exception 'Access denied';
 elsif op in ('invite','remove') and room.kind='group' and room.owner_id=me then
 if op='invite' then
 select p.id into strict peer from privacy_chat.people p join auth.users u on p.id=u.id where lower(u.email)=lower(trim(args->>'email'));
 insert into privacy_chat.members values(r,peer,false);
 else delete from privacy_chat.members where room_id=r and person=(args->>'person')::uuid and person<>me; end if;
 elsif op='members' then
 select jsonb_agg(jsonb_build_object('person',m.person,'email',u.email,'accepted',m.accepted,'removable',room.kind='group' and room.owner_id=me and m.person<>me)) into result from privacy_chat.members m join auth.users u on m.person=u.id where m.room_id=r;
 elsif op='send' then
 if room.kind='personal' and exists(select 1 from privacy_chat.members where room_id=r and not accepted) then raise exception 'Awaiting acceptance'; end if;
 if length(coalesce(args->>'body',''))>4000 or length(coalesce(args->>'photo',''))>500000 or (trim(coalesce(args->>'body',''))='' and coalesce(args->>'photo','')='') then raise exception 'Invalid message'; end if;
 insert into privacy_chat.messages(room_id,sender,body,photo) values(r,me,coalesce(args->>'body',''),args->>'photo');
 elsif op='messages' then
 select jsonb_agg(to_jsonb(t) order by t.id) into result from (select m.id,u.email,m.body,m.photo is not null as photo,m.sent_at from privacy_chat.messages m join auth.users u on m.sender=u.id where m.room_id=r and m.id<coalesce((args->>'before')::bigint,9223372036854775807) order by m.id desc limit 40)t;
 elsif op='photo' then select to_jsonb(photo) into strict result from privacy_chat.messages where room_id=r and id=(args->>'id')::bigint;
 else raise exception 'Action unavailable'; end if;
 end if;
 return coalesce(result,'[]'::jsonb);
end $$;
revoke all on function privacy_chat.handle(text,jsonb) from public,anon;
grant execute on function privacy_chat.handle(text,jsonb) to authenticated;
create or replace function public.privacy_chat_action(op text,args jsonb) returns jsonb language sql security invoker set search_path='' as $$select privacy_chat.handle(op,args)$$;
revoke all on function public.privacy_chat_action(text,jsonb) from public,anon;
grant execute on function public.privacy_chat_action(text,jsonb) to authenticated;
commit;
