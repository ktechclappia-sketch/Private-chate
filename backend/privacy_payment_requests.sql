begin;
create table if not exists privacy_chat.payment_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete restrict,
 reason text not null check (length(trim(reason)) between 5 and 500),
 amount_paise integer not null default 10000 check (amount_paise=10000),
 status text not null default 'requested' check (status in ('requested','pending','approved','rejected')),
 utr_number text,
 screenshot_path text,
 payment_request_id uuid,
 created_at timestamptz not null default now(),
 submitted_at timestamptz,
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id) on delete set null,
 admin_note text
);
alter table privacy_chat.payment_requests enable row level security;
revoke all on privacy_chat.payment_requests from public, anon, authenticated;
create unique index if not exists privacy_payment_requests_one_open_per_user
 on privacy_chat.payment_requests(user_id) where status in ('requested','pending');
create index if not exists privacy_payment_requests_user_recent
 on privacy_chat.payment_requests(user_id, created_at desc);
alter table public.privacy_payments add column if not exists payment_request_id uuid references privacy_chat.payment_requests(id) on delete set null;
create index if not exists privacy_payments_request_idx on public.privacy_payments(payment_request_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('privacy-payment-proofs','privacy-payment-proofs',false,5242880,array['image/jpeg'])
 on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg'];

create or replace function privacy_chat.payment_proof_is_admin()
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
  select 1 from auth.users u
  join privacy_chat.admin_emails a on a.email=lower(u.email)
  left join privacy_chat.people p on p.id=u.id
  where u.id=(select auth.uid()) and u.email_confirmed_at is not null and coalesce(p.enabled,true)
 )
$$;
revoke all on function privacy_chat.payment_proof_is_admin() from public,anon;
grant execute on function privacy_chat.payment_proof_is_admin() to authenticated;

drop policy if exists privacy_payment_proofs_insert_own on storage.objects;
create policy privacy_payment_proofs_insert_own on storage.objects
 for insert to authenticated
 with check (
  bucket_id='privacy-payment-proofs'
  and split_part(name,'/',1)=(select auth.uid())::text
  and cardinality(string_to_array(name,'/'))=3
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
 );
drop policy if exists privacy_payment_proofs_read_own_or_admin on storage.objects;
create policy privacy_payment_proofs_read_own_or_admin on storage.objects
 for select to authenticated
 using (
  bucket_id='privacy-payment-proofs'
  and (split_part(name,'/',1)=(select auth.uid())::text or privacy_chat.payment_proof_is_admin())
 );

create or replace function privacy_chat.sync_payment_request_status()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.payment_request_id is not null and old.status='pending' and new.status in ('approved','rejected') then
  update privacy_chat.payment_requests
    set status=new.status, reviewed_at=coalesce(new.reviewed_at,now()), reviewed_by=(select auth.uid())
    where id=new.payment_request_id and status='pending';
 end if;
 return new;
end
$$;
revoke all on function privacy_chat.sync_payment_request_status() from public,anon,authenticated;
drop trigger if exists privacy_payment_request_status_sync on public.privacy_payments;
create trigger privacy_payment_request_status_sync after update of status on public.privacy_payments
 for each row execute function privacy_chat.sync_payment_request_status();

create or replace function privacy_chat.payment_request_action(op text,args jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 me uuid := (select auth.uid());
 mail text;
 is_admin boolean;
 target uuid;
 request_id uuid;
 reason_text text;
 utr text;
 object_path text;
 request_row privacy_chat.payment_requests%rowtype;
 new_payment uuid;
 result jsonb;
 enabled boolean;
begin
 select lower(email) into mail from auth.users where id=me and email_confirmed_at is not null;
 if mail is null then raise exception 'Verify your email first' using errcode='42501'; end if;
 select exists(select 1 from privacy_chat.admin_emails where email=mail) into is_admin;
 select coalesce(p.enabled,true) into enabled from privacy_chat.people p where p.id=me;
 if enabled is false then raise exception 'Account deactivated' using errcode='42501'; end if;

 if op='create_request' then
  if not is_admin then raise exception 'Admin required' using errcode='42501'; end if;
  target := (args->>'user_id')::uuid;
  reason_text := trim(coalesce(args->>'reason',''));
  if length(reason_text) not between 5 and 500 then raise exception 'Add a reason (5–500 characters)' using errcode='22023'; end if;
  if not exists(select 1 from auth.users u left join privacy_chat.people p on p.id=u.id
     where u.id=target and u.email_confirmed_at is not null and coalesce(p.enabled,true)
       and (p.id is not null or u.raw_user_meta_data->>'registration_app'='privacy_chat')
       and not exists(select 1 from privacy_chat.admin_emails a where a.email=lower(u.email))) then
    raise exception 'Privacy Chat user not found or disabled' using errcode='22023';
  end if;
  if exists(select 1 from public.privacy_payments p where p.user_id=target and p.status='pending') then
    raise exception 'This user already has a payment awaiting review' using errcode='22023';
  end if;
  insert into privacy_chat.payment_requests(user_id,created_by,reason)
   values(target,me,reason_text) returning id into request_id;
  return jsonb_build_object('id',request_id,'status','requested');

 elsif op='my_requests' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'reason',r.reason,'amount_paise',r.amount_paise,
     'status',r.status,'created_at',r.created_at,'submitted_at',r.submitted_at,'reviewed_at',r.reviewed_at,
     'utr_number',r.utr_number,'admin_note',r.admin_note) order by r.created_at desc),'[]'::jsonb)
   into result from privacy_chat.payment_requests r where r.user_id=me;
  return result;

 elsif op='submit_proof' then
  target := me;
  request_id := (args->>'request_id')::uuid;
  utr := trim(coalesce(args->>'utr_number',''));
  object_path := trim(coalesce(args->>'screenshot_path',''));
  if length(utr) not between 8 and 80 or utr !~ '^[A-Za-z0-9/-]{8,80}$' then
    raise exception 'Enter a valid UTR number (8–80 letters or digits)' using errcode='22023';
  end if;
  if object_path !~ ('^'||me::text||'/'||request_id::text||'/[0-9a-f-]{36}\.jpg$') then
    raise exception 'Invalid payment screenshot path' using errcode='22023';
  end if;
  select * into request_row from privacy_chat.payment_requests
   where id=request_id and user_id=me and status in ('requested','rejected') for update;
  if not found then raise exception 'No payment request is awaiting your proof' using errcode='22023'; end if;
  if exists(select 1 from public.privacy_payments p where p.user_id=me and p.status='pending') then
    raise exception 'A payment is already awaiting admin review' using errcode='22023';
  end if;
  if exists(select 1 from public.privacy_payments p where lower(p.upi_reference)=lower(utr)) then
    raise exception 'This UTR number has already been submitted' using errcode='23505';
  end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='privacy-payment-proofs' and o.name=object_path) then
    raise exception 'Payment screenshot upload was not found' using errcode='22023';
  end if;
  insert into public.privacy_payments(user_id,amount_paise,upi_reference,status,payment_request_id)
   values(me,request_row.amount_paise,utr,'pending',request_id) returning id into new_payment;
  update privacy_chat.payment_requests set status='pending',utr_number=utr,screenshot_path=object_path,
    submitted_at=now(),reviewed_at=null,reviewed_by=null,admin_note=null where id=request_id;
  return jsonb_build_object('id',new_payment,'status','pending');

 elsif op='admin_pending' then
  if not is_admin then raise exception 'Admin required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'email',u.email,'reference',p.upi_reference,
     'utr_number',coalesce(r.utr_number,p.upi_reference),'amount',p.amount_paise,'status',p.status,
     'date',p.created_at,'request_reason',r.reason,'screenshot_path',r.screenshot_path)
     order by p.created_at desc,p.id),'[]'::jsonb)
   into result from public.privacy_payments p join auth.users u on u.id=p.user_id
   left join privacy_chat.payment_requests r on r.id=p.payment_request_id
   where p.status='pending';
  return result;
 else
  raise exception 'Action unavailable' using errcode='22023';
 end if;
end
$$;
revoke all on function privacy_chat.payment_request_action(text,jsonb) from public,anon;
grant execute on function privacy_chat.payment_request_action(text,jsonb) to authenticated;
create or replace function public.privacy_payment_request_action(op text,args jsonb)
returns jsonb language sql security invoker set search_path=''
as $$select privacy_chat.payment_request_action(op,args)$$;
revoke all on function public.privacy_payment_request_action(text,jsonb) from public,anon;
grant execute on function public.privacy_payment_request_action(text,jsonb) to authenticated;
commit;