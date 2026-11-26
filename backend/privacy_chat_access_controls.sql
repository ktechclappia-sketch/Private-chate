-- Source-synced Privacy Chat admin access migration.
-- This records the access-control schema/functions already deployed to KTech IT Hub.
-- It is additive and idempotent; it does not touch other application schemas.
begin;

alter table privacy_chat.people
  add column if not exists enabled boolean not null default true,
  add column if not exists free_testing boolean not null default false;

CREATE OR REPLACE FUNCTION privacy_chat.handle(op text, args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 me uuid := auth.uid();
 email_address text;
 admin_access boolean;
 entitled boolean;
 member_enabled boolean;
 tester boolean;
 target uuid;
 sub public.privacy_subscriptions%rowtype;
 r uuid := (args->>'room')::uuid;
 room privacy_chat.rooms%rowtype;
 peer uuid;
 payment public.privacy_payments%rowtype;
 result jsonb;
begin
 select lower(email) into email_address from auth.users where id=me and email_confirmed_at is not null;
 if email_address is null then raise exception 'Verify your email first'; end if;
 insert into privacy_chat.people(id) values(me) on conflict do nothing;
 select exists(select 1 from privacy_chat.admin_emails where email=email_address) into admin_access;
 select * into sub from public.privacy_subscriptions where user_id=me;
 select enabled,free_testing into strict member_enabled,tester from privacy_chat.people where id=me;
 entitled := member_enabled and (admin_access or tester or coalesce(now() >= sub.starts_at and now() < sub.ends_at,false));
 if op='access' then
 return jsonb_build_object('active',entitled,'admin',admin_access,'enabled',member_enabled,'free_testing',tester,'start',sub.starts_at,'end',sub.ends_at,
 'payment',(select status from public.privacy_payments where user_id=me order by created_at desc limit 1));
 end if;
 if not member_enabled then raise exception 'Account deactivated' using errcode='42501'; end if;
 if not entitled then raise exception 'Subscription required' using errcode='42501'; end if;
 if op in ('payments','approve','reject','set_free_testing','set_user_enabled') and not admin_access then
   raise exception 'Admin required' using errcode='42501';
 end if;
 if op in ('set_free_testing','set_user_enabled') then
   if jsonb_typeof(args->'value') is distinct from 'boolean' then
     raise exception 'A boolean value is required' using errcode='22023';
   end if;
   target := (args->>'user_id')::uuid;
   if not exists (
     select 1 from auth.users u where u.id=target and (
       u.raw_user_meta_data->>'registration_app'='privacy_chat'
       or exists(select 1 from privacy_chat.people p where p.id=u.id)
     )
   ) then raise exception 'Unknown Privacy Chat user' using errcode='22023'; end if;
   if exists (
     select 1 from auth.users u join privacy_chat.admin_emails a on a.email=lower(u.email) where u.id=target
   ) then raise exception 'Admin account is protected' using errcode='42501'; end if;
   insert into privacy_chat.people(id) values(target) on conflict do nothing;
   if op='set_user_enabled' then
     update privacy_chat.people set enabled=(args->>'value')::boolean where id=target;
   else
     update privacy_chat.people set free_testing=(args->>'value')::boolean where id=target;
   end if;
   return jsonb_build_object('updated',true);
 end if;
 if op='payments' and admin_access then
 select jsonb_agg(jsonb_build_object('id',p.id,'reference',p.upi_reference,'email',u.email) order by p.created_at) into result from public.privacy_payments p join auth.users u on u.id=p.user_id where p.status='pending';
 elsif op in ('approve','reject') and admin_access then
 select * into payment from public.privacy_payments where id=(args->>'id')::uuid and status='pending' for update;
 if not found then raise exception 'Payment is no longer pending' using errcode='22023'; end if;
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
end $function$

revoke all on function privacy_chat.handle(text,jsonb) from public, anon;
grant execute on function privacy_chat.handle(text,jsonb) to authenticated;

create or replace function public.privacy_chat_action(op text,args jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select privacy_chat.handle(op,args) $$;
revoke all on function public.privacy_chat_action(text,jsonb) from public, anon;
grant execute on function public.privacy_chat_action(text,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION privacy_chat.admin_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare report jsonb;
begin
 if not exists (
   select 1 from auth.users u join privacy_chat.admin_emails a on a.email=lower(u.email)
   left join privacy_chat.people p on p.id=u.id
   where u.id=(select auth.uid()) and u.email_confirmed_at is not null and coalesce(p.enabled,true)
 ) then raise exception 'Admin required' using errcode='42501'; end if;

 with app_users as (
   select id from privacy_chat.people
   union select id from auth.users where raw_user_meta_data->>'registration_app'='privacy_chat'
 ), users as (
   select u.id,u.email,s.starts_at as start,s.ends_at as "end",u.email_confirmed_at is not null as email_confirmed,
     coalesce(p.enabled,true) as enabled,coalesce(p.free_testing,false) as free_testing,
     a.email is not null as is_admin,
     case when p.enabled=false then 'Deactivated'
          when u.email_confirmed_at is null then 'Inactive'
          when a.email is not null then 'Admin free'
          when p.free_testing then 'Free testing'
          when s.ends_at<=now() then 'Expired'
          when s.starts_at<=now() and now()<s.ends_at then 'Active'
          else 'Inactive' end as status
   from app_users x join auth.users u on u.id=x.id
   left join privacy_chat.people p on p.id=u.id
   left join public.privacy_subscriptions s on s.user_id=u.id
   left join privacy_chat.admin_emails a on a.email=lower(u.email)
 ), payments as (
   select p.id,u.email,p.amount_paise as amount,p.upi_reference as reference,
     p.status,p.created_at as date,p.reviewed_at,
     case when p.status='approved' then coalesce(p.reviewed_at,p.created_at) end as collected_at
   from public.privacy_payments p join auth.users u on u.id=p.user_id
 ), monthly as (
   select to_char(collected_at at time zone 'Asia/Kolkata','YYYY-MM') as month,
     sum(amount) as amount_paise,count(*) as count from payments where status='approved' group by 1
 )
 select jsonb_build_object(
   'summary',jsonb_build_object(
     'registered',count(*),'active',count(*) filter(where status in ('Active','Free testing','Admin free')),
     'expired',count(*) filter(where status='Expired'),
     'free_testing',count(*) filter(where status in ('Free testing','Admin free')),
     'deactivated',count(*) filter(where status='Deactivated'),
     'total_collection_paise',(select coalesce(sum(amount),0) from payments where status='approved')
   ),
   'users',coalesce((select jsonb_agg(to_jsonb(u) order by lower(u.email),u.id) from users u),'[]'::jsonb),
   'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.date desc,p.id) from payments p),'[]'::jsonb),
   'monthly',coalesce((select jsonb_agg(to_jsonb(m) order by m.month desc) from monthly m),'[]'::jsonb)
 ) into report from users;
 return report;
end $function$

revoke all on function privacy_chat.admin_report() from public, anon;
grant execute on function privacy_chat.admin_report() to authenticated;

create or replace function public.privacy_admin_report()
returns jsonb language sql security invoker set search_path = ''
as $$ select privacy_chat.admin_report() $$;
revoke all on function public.privacy_admin_report() from public, anon;
grant execute on function public.privacy_admin_report() to authenticated;

commit;
