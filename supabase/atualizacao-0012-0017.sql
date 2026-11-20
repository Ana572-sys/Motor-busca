begin;

-- 0012_pessoas_candidates.sql

alter table public.source_candidates add column title text;
alter table public.source_candidates add column source_state text;
alter table public.source_candidates add column source_updated_at text;
alter table public.source_candidates add column document_metadata jsonb not null default '[]';
alter table public.source_candidates add column programs jsonb not null default '[]';
alter table public.source_candidates alter column opening_date drop not null;
alter table public.source_candidates alter column closing_date drop not null;
update public.sources set connector_key='pessoas_2030_v1' where name='Pessoas 2030';
create unique index unique_pessoas_connector on public.sources(connector_key) where connector_key='pessoas_2030_v1';
create function public.finish_pessoas_diagnostic(p_scan uuid,p_source uuid,p_listing_hash text,p_listing_path text,p_listing_size integer,p_candidates jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare listing_id uuid; item jsonb; v_id uuid; n integer;
begin
 if jsonb_typeof(p_candidates)<>'array' then raise exception 'Lista inválida'; end if;
 n:=jsonb_array_length(p_candidates);if n>1000 then raise exception 'Lista demasiado extensa'; end if;
 if not exists(select 1 from public.scans where id=p_scan and kind='manual' and period='diagnóstico' and status='em curso' for update) then raise exception 'Pesquisa indisponível'; end if;
 insert into public.source_snapshots(source_id,content_hash,storage_path,content_type,size_bytes) values(p_source,p_listing_hash,p_listing_path,'application/json',p_listing_size)
 on conflict(source_id,content_hash) do update set updated_at=now() returning id into listing_id;
 for item in select value from jsonb_array_elements(p_candidates) loop
  insert into public.source_candidates(source_id,external_id,code,region,opening_date,closing_date,document_url,current_hash,title,source_state,source_updated_at,document_metadata,programs)
  values(p_source,item->>'externalId',item->>'code','Informação não identificada no aviso.',nullif(left(item->>'startsAt',10),'')::date,nullif(left(item->>'endsAt',10),'')::date,'https://pessoas2030.gov.pt/avisos/',item->>'contentHash',item->>'title',item->>'sourceState',item->>'updatedAt',coalesce(item->'documents','[]'::jsonb),coalesce(item->'programs','[]'::jsonb))
  on conflict(source_id,external_id) do update set code=excluded.code,opening_date=excluded.opening_date,closing_date=excluded.closing_date,current_hash=excluded.current_hash,title=excluded.title,source_state=excluded.source_state,source_updated_at=excluded.source_updated_at,document_metadata=excluded.document_metadata,programs=excluded.programs,last_observed_at=now(),updated_at=now()
  returning id into v_id;
  insert into public.candidate_versions(candidate_id,listing_snapshot_id,content_hash,fields) values(v_id,listing_id,item->>'contentHash',item) on conflict(candidate_id,content_hash) do nothing;
 end loop;
 perform public.finish_source_diagnostic(p_scan,p_source,'concluída',format('%s candidatos abertos obtidos da listagem; documentos e elegibilidade não verificados.',n),listing_id);
end $$;
revoke all on function public.finish_pessoas_diagnostic(uuid,uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finish_pessoas_diagnostic(uuid,uuid,text,text,integer,jsonb) to service_role;


-- 0013_opportunity_events.sql

-- Events are independent of whether applications are currently open or closed.
create table public.opportunity_events (
 id uuid primary key default gen_random_uuid(),
 opportunity_id uuid not null references public.opportunities(id),
 version_id uuid not null references public.opportunity_versions(id),
 kind text not null check(kind in ('novo','alterado','prorrogado','republicado')),
 detected_at timestamptz not null default now(),
 source_url text,
 document_id uuid references public.documents(id),
 details jsonb not null default '{}',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(opportunity_id,version_id,kind)
);
alter table public.opportunity_events enable row level security;
create policy "members read events" on public.opportunity_events for select to authenticated using(public.is_member());
revoke all on public.opportunity_events from anon,authenticated;
grant select on public.opportunity_events to authenticated;
grant all on public.opportunity_events to service_role;


-- 0014_candidate_changes.sql

-- Listing changes are preliminary observations, not validated notice amendments.
create table public.candidate_changes (
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid not null references public.source_candidates(id),
 source_id uuid not null references public.sources(id),
 previous_hash text not null,
 current_hash text not null,
 previous_fields jsonb not null,
 current_fields jsonb not null,
 detected_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.candidate_changes enable row level security;
create policy "members read candidate changes" on public.candidate_changes for select to authenticated using(public.is_member());
revoke all on public.candidate_changes from public,anon,authenticated;
grant select on public.candidate_changes to authenticated;
grant all on public.candidate_changes to service_role;
create function public.record_candidate_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.current_hash is distinct from new.current_hash then
  insert into public.candidate_changes(candidate_id,source_id,previous_hash,current_hash,previous_fields,current_fields)
  values(new.id,new.source_id,old.current_hash,new.current_hash,
   jsonb_build_object('code',old.code,'title',old.title,'region',old.region,'opening_date',old.opening_date,'closing_date',old.closing_date,'document_url',old.document_url,'source_state',old.source_state,'source_updated_at',old.source_updated_at,'document_metadata',old.document_metadata,'programs',old.programs),
   jsonb_build_object('code',new.code,'title',new.title,'region',new.region,'opening_date',new.opening_date,'closing_date',new.closing_date,'document_url',new.document_url,'source_state',new.source_state,'source_updated_at',new.source_updated_at,'document_metadata',new.document_metadata,'programs',new.programs));
 end if;
 return new;
end $$;
revoke all on function public.record_candidate_change() from public,anon,authenticated;
create trigger source_candidate_changed after update on public.source_candidates for each row execute function public.record_candidate_change();


-- 0015_notification_queue.sql

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


-- 0016_scan_queue.sql

-- Durable queue. Enqueuing is not the same as completing a search.
alter table public.scans add column scheduled_for date;
alter table public.scan_sources add column attempts integer not null default 0;
alter table public.scan_sources add column started_at timestamptz;
alter table public.scan_sources add column finished_at timestamptz;
alter table public.scan_sources add column lease_until timestamptz;
create unique index scans_one_scheduled_day on public.scans(scheduled_for) where kind='automática' and scheduled_for is not null;

create function public.create_scan_batch(p_kind text,p_period text,p_actor uuid,p_scheduled_for date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_scan_id uuid; n integer;
begin
 if p_kind not in ('manual','automática') or p_period not in ('último dia','últimos três dias','última semana') then raise exception 'Parâmetros de pesquisa inválidos'; end if;
 if p_kind='manual' and (p_actor is null or not exists(select 1 from public.users where id=p_actor)) then raise exception 'Utilizador não autorizado'; end if;
 if p_kind='automática' and (p_actor is not null or p_scheduled_for is null or p_period<>'última semana') then raise exception 'Agendamento inválido'; end if;
 select count(*) into n from public.sources where active;
 if n=0 then raise exception 'Não existem fontes ativas'; end if;
 insert into public.scans(kind,period,status,requested_by,scheduled_for,summary) values(p_kind,p_period,'na fila',p_actor,p_scheduled_for,jsonb_build_object('scope','candidatos','note','Pesquisa documental e elegibilidade ainda por verificar.')) returning id into v_scan_id;
 insert into public.scan_sources(scan_id,source_id,status,detail)
 select v_scan_id,id,case when connector_key in ('pis_listing_v1','pessoas_2030_v1') then 'na fila' else 'sem conector' end,
  case when connector_key in ('pis_listing_v1','pessoas_2030_v1') then null else 'Conector ainda não disponível.' end from public.sources where active;
 if not exists(select 1 from public.scan_sources where scan_sources.scan_id=v_scan_id and status='na fila') then
  update public.scans set status='erro',finished_at=now(),updated_at=now(),summary=jsonb_build_object('note','Nenhuma fonte ativa tem conector disponível.') where id=v_scan_id;
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(p_actor,'scan.enqueue','scan',v_scan_id,jsonb_build_object('period',p_period,'kind',p_kind));
 return v_scan_id;
end $$;
revoke all on function public.create_scan_batch(text,text,uuid,date) from public,anon,authenticated;
grant execute on function public.create_scan_batch(text,text,uuid,date) to service_role;

create function public.request_manual_scan(p_period text) returns uuid language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.is_member() then raise exception 'Utilizador não autorizado'; end if;
 return public.create_scan_batch('manual',p_period,auth.uid(),null);
end $$;
revoke all on function public.request_manual_scan(text) from public,anon;
grant execute on function public.request_manual_scan(text) to authenticated;

create function public.weekly_scan_due(p_now timestamptz) returns boolean language sql stable as $$
 select extract(isodow from p_now at time zone 'Europe/Lisbon')=1 and to_char(p_now at time zone 'Europe/Lisbon','HH24:MI')='08:30'
$$;
create function public.enqueue_weekly_scan(p_now timestamptz default now()) returns uuid language plpgsql security definer set search_path=public as $$
declare local_day date := (p_now at time zone 'Europe/Lisbon')::date; existing uuid;
begin
 if not public.weekly_scan_due(p_now) then return null; end if;
 select id into existing from public.scans where kind='automática' and scheduled_for=local_day;
 if existing is not null then return existing; end if;
 begin return public.create_scan_batch('automática','última semana',null,local_day);
 exception when unique_violation then select id into existing from public.scans where kind='automática' and scheduled_for=local_day; return existing;
 end;
end $$;
revoke all on function public.enqueue_weekly_scan(timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_weekly_scan(timestamptz) to service_role;

create function public.claim_scan_source() returns setof public.scan_sources language plpgsql security definer set search_path=public as $$
begin
 update public.scan_sources set status='erro',detail='Execução interrompida após o prazo de processamento.',finished_at=now(),updated_at=now()
 where status='em curso' and lease_until<now();
 return query with task as (
  select ss.id from public.scan_sources ss join public.scans s on s.id=ss.scan_id
  where ss.status='na fila' and s.period in ('último dia','últimos três dias','última semana')
  order by ss.created_at for update of ss skip locked limit 1
 ) update public.scan_sources ss set status='em curso',started_at=now(),lease_until=now()+interval '5 minutes',attempts=ss.attempts+1,updated_at=now()
 from task where ss.id=task.id returning ss.*;
end $$;
revoke all on function public.claim_scan_source() from public,anon,authenticated;
grant execute on function public.claim_scan_source() to service_role;


-- 0017_scan_processing.sql

create function public.finalize_scan_if_ready(p_scan uuid) returns void language plpgsql security definer set search_path=public as $$
declare pending integer; failed integer; completed integer;
begin
 -- Serialize completion checks for tasks belonging to the same scan.
 perform 1 from public.scans where id=p_scan for update;
 select count(*) filter(where status in ('na fila','em curso')),count(*) filter(where status in ('erro','sem conector')),count(*) filter(where status='concluída')
 into pending,failed,completed from public.scan_sources where scan_id=p_scan;
 if pending=0 then
  update public.scans set status=case when completed=0 then 'erro' else 'parcial' end,finished_at=now(),updated_at=now(),
   summary=jsonb_build_object('fontes_concluidas',completed,'fontes_com_erro_ou_sem_conector',failed,'note','Listagens preliminares; documentos e elegibilidade não foram verificados.')
  where id=p_scan and status in ('na fila','em curso');
 end if;
end $$;
revoke all on function public.finalize_scan_if_ready(uuid) from public,anon,authenticated;
grant execute on function public.finalize_scan_if_ready(uuid) to service_role;

create function public.finalize_scan_source_change() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.finalize_scan_if_ready(new.scan_id);return new; end $$;
revoke all on function public.finalize_scan_source_change() from public,anon,authenticated;
create trigger scan_source_finalization after update of status on public.scan_sources for each row execute function public.finalize_scan_source_change();

create function public.finish_scan_source(p_task uuid,p_hash text,p_path text,p_size integer,p_candidates jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare task public.scan_sources%rowtype; v_snapshot_id uuid; item jsonb; v_candidate_id uuid; n integer;
begin
 select * into task from public.scan_sources where id=p_task and status='em curso' and lease_until>now() for update;
 if not found then raise exception 'Tarefa indisponível ou expirada'; end if;
 if jsonb_typeof(p_candidates)<>'array' then raise exception 'Lista inválida'; end if;
 n:=jsonb_array_length(p_candidates);if n>1000 then raise exception 'Lista demasiado extensa'; end if;
 insert into public.source_snapshots(source_id,content_hash,storage_path,content_type,size_bytes) values(task.source_id,p_hash,p_path,'application/json',p_size)
 on conflict(source_id,content_hash) do update set updated_at=now() returning id into v_snapshot_id;
 for item in select value from jsonb_array_elements(p_candidates) loop
  insert into public.source_candidates(source_id,external_id,code,region,opening_date,closing_date,document_url,current_hash,title,source_state,source_updated_at,document_metadata,programs)
  values(task.source_id,item->>'externalId',item->>'code',coalesce(nullif(item->>'region',''),'Informação não identificada no aviso.'),nullif(left(item->>'startsAt',10),'')::date,nullif(left(item->>'endsAt',10),'')::date,item->>'documentUrl',item->>'contentHash',item->>'title',item->>'sourceState',item->>'updatedAt',coalesce(item->'documents','[]'::jsonb),coalesce(item->'programs','[]'::jsonb))
  on conflict(source_id,external_id) do update set code=excluded.code,region=excluded.region,opening_date=excluded.opening_date,closing_date=excluded.closing_date,document_url=excluded.document_url,current_hash=excluded.current_hash,title=excluded.title,source_state=excluded.source_state,source_updated_at=excluded.source_updated_at,document_metadata=excluded.document_metadata,programs=excluded.programs,last_observed_at=now(),updated_at=now()
  returning id into v_candidate_id;
  insert into public.candidate_versions(candidate_id,listing_snapshot_id,content_hash,fields) values(v_candidate_id,v_snapshot_id,item->>'contentHash',item) on conflict(candidate_id,content_hash) do nothing;
 end loop;
 update public.sources set last_checked_at=now(),last_status='concluída',last_error=null,updated_at=now() where id=task.source_id;
 update public.scan_sources set status='concluída',detail=format('%s candidatos preliminares; elegibilidade e documentos não verificados.',n),snapshot_id=v_snapshot_id,finished_at=now(),updated_at=now() where id=p_task;
end $$;
revoke all on function public.finish_scan_source(uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finish_scan_source(uuid,text,text,integer,jsonb) to service_role;

create function public.fail_scan_source(p_task uuid,p_detail text) returns void language plpgsql security definer set search_path=public as $$
declare task public.scan_sources%rowtype; message text := left(coalesce(p_detail,'Erro de processamento.'),350);
begin
 select * into task from public.scan_sources where id=p_task and status='em curso' and lease_until>now() for update;
 if not found then raise exception 'Tarefa indisponível ou expirada'; end if;
 update public.sources set last_checked_at=now(),last_status='erro',last_error=message,updated_at=now() where id=task.source_id;
 update public.scan_sources set status='erro',detail=message,finished_at=now(),updated_at=now() where id=p_task;
end $$;
revoke all on function public.fail_scan_source(uuid,text) from public,anon,authenticated;
grant execute on function public.fail_scan_source(uuid,text) to service_role;

commit;
