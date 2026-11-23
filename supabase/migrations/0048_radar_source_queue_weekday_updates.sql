-- Queue every active source that declares a connector. Unsupported connectors
-- are recorded as failures by the worker rather than silently skipped.
create or replace function public.create_scan_batch(p_kind text,p_period text,p_actor uuid,p_scheduled_for date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_scan_id uuid; n integer;
begin
 if p_kind not in ('manual','automática') or p_period not in ('último dia','últimos três dias','última semana') then raise exception 'Parâmetros de pesquisa inválidos'; end if;
 if p_kind='manual' and (p_actor is null or not exists(select 1 from public.users where id=p_actor)) then raise exception 'Utilizador não autorizado'; end if;
 if p_kind='automática' and (p_actor is not null or p_scheduled_for is null or p_period<>'última semana') then raise exception 'Agendamento inválido'; end if;
 select count(*) into n from public.sources where active and connector_key is not null;
 if n=0 then raise exception 'Não existem fontes ativas com conector'; end if;
 insert into public.scans(kind,period,status,requested_by,scheduled_for,summary)
 values(p_kind,p_period,'na fila',p_actor,p_scheduled_for,jsonb_build_object('scope','listagens de fontes','note','Os candidatos de listagem ainda não equivalem a análises de elegibilidade.')) returning id into v_scan_id;
 insert into public.scan_sources(scan_id,source_id,status,detail)
 select v_scan_id,id,case when active and connector_key is not null then 'na fila' else 'sem conector' end,
  case when active and connector_key is not null then null else 'Fonte sem conector ativo.' end
 from public.sources where active;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
 values(p_actor,'scan.enqueue','scan',v_scan_id,jsonb_build_object('period',p_period,'kind',p_kind,'sources',n));
 return v_scan_id;
end $$;

create or replace function public.weekly_scan_due(p_now timestamptz) returns boolean language sql stable as $$
 select extract(isodow from p_now at time zone 'Europe/Lisbon') between 1 and 5
  and to_char(p_now at time zone 'Europe/Lisbon','HH24:MI')='08:30'
$$;

alter table public.radar_notice_analyses drop constraint if exists radar_notice_analyses_status_check;
alter table public.radar_notice_analyses add constraint radar_notice_analyses_status_check check(status in ('pending','running','complete','incomplete','failed'));
alter table public.radar_notice_analyses add column if not exists attempt_count integer not null default 0;
alter table public.radar_notice_analyses add column if not exists started_at timestamptz;
alter table public.radar_notice_analyses add column if not exists lease_until timestamptz;
alter table public.radar_notice_analyses add column if not exists finished_at timestamptz;
create index if not exists radar_notice_analyses_queue_idx on public.radar_notice_analyses(status,created_at) where status in ('pending','running');
create index if not exists radar_notice_analyses_retry_idx on public.radar_notice_analyses(finished_at,created_at) where status='failed' and attempt_count<3;

update public.radar_notice_analyses a
set status='incomplete',error_code='notice_closed_before_analysis',finished_at=now(),lease_until=null
from public.radar_notice_versions v,public.radar_notices n
where a.version_id=v.id and v.notice_id=n.id and n.status='closed' and a.status='pending';

create or replace function public.claim_radar_notice_analysis()
returns table(id uuid,version_id uuid)
language plpgsql security definer set search_path=public as $$
begin
 return query
 with next_job as (
  select a.id from public.radar_notice_analyses a
  join public.radar_notice_versions v on v.id=a.version_id
  join public.radar_notices n on n.id=v.notice_id
  where n.status='open' and (
   a.status='pending'
   or (a.status='running' and (a.lease_until is null or a.lease_until<now()))
   or (a.status='failed' and a.attempt_count<3 and a.finished_at<now()-interval '20 hours')
  )
  order by case when a.status='pending' then 0 else 1 end,a.created_at,a.id for update of a skip locked limit 1
 ), claimed as (
  update public.radar_notice_analyses a set status='running',attempt_count=a.attempt_count+1,started_at=now(),lease_until=now()+interval '8 minutes'
  from next_job where a.id=next_job.id returning a.id,a.version_id
 ) select claimed.id,claimed.version_id from claimed;
end $$;
revoke all on function public.claim_radar_notice_analysis() from public,anon,authenticated;
grant execute on function public.claim_radar_notice_analysis() to service_role;
