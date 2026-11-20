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
