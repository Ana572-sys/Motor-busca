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
