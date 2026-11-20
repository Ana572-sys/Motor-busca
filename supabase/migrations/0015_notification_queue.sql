alter table public.notifications add column idempotency_key text;
alter table public.notifications add column subject text;
alter table public.notifications add column body text;
alter table public.notifications add column attempts integer not null default 0;
alter table public.notifications add column last_attempt_at timestamptz;
alter table public.notifications add column accepted_at timestamptz;
create unique index notifications_idempotency on public.notifications(idempotency_key);
create function public.claim_notification() returns setof public.notifications language plpgsql security definer set search_path=public as $$
begin
 update public.notifications set status='unknown',error='Execução interrompida; confirmar antes de reenviar.',updated_at=now()
 where status='sending' and last_attempt_at<now()-interval '10 minutes';
 return query with next_item as (
  select id from public.notifications where status='pending' and attempts=0 and idempotency_key is not null and subject is not null and body is not null order by created_at for update skip locked limit 1
 ) update public.notifications n set status='sending',attempts=n.attempts+1,last_attempt_at=now(),updated_at=now()
 from next_item where n.id=next_item.id returning n.*;
end $$;
revoke all on function public.claim_notification() from public,anon,authenticated;
grant execute on function public.claim_notification() to service_role;
