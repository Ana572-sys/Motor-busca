-- Integrate the tested Portugal 2030 listing and claim tasks only for the requested scan.
create or replace function public.create_scan_batch(p_kind text,p_period text,p_actor uuid,p_scheduled_for date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_scan_id uuid; n integer;
begin
 if p_kind not in ('manual','automática') or p_period not in ('último dia','últimos três dias','última semana') then raise exception 'Parâmetros de pesquisa inválidos'; end if;
 if p_kind='manual' and (p_actor is null or not exists(select 1 from public.users where id=p_actor)) then raise exception 'Utilizador não autorizado'; end if;
 if p_kind='automática' and (p_actor is not null or p_scheduled_for is null or p_period<>'última semana') then raise exception 'Agendamento inválido'; end if;
 select count(*) into n from public.sources where active;
 if n=0 then raise exception 'Não existem fontes ativas'; end if;
 insert into public.scans(kind,period,status,requested_by,scheduled_for,summary) values(p_kind,p_period,'na fila',p_actor,p_scheduled_for,jsonb_build_object('scope','candidatos','note','O período ainda não é aplicado. Documentos e elegibilidade por verificar.')) returning id into v_scan_id;
 insert into public.scan_sources(scan_id,source_id,status,detail)
 select v_scan_id,id,case when connector_key in ('pis_listing_v1','pessoas_2030_v1','portugal_2030_v1') then 'na fila' else 'sem conector' end,
  case when connector_key in ('pis_listing_v1','pessoas_2030_v1','portugal_2030_v1') then null else 'Conector ainda não disponível.' end from public.sources where active;
 if not exists(select 1 from public.scan_sources where scan_sources.scan_id=v_scan_id and status='na fila') then
  update public.scans set status='erro',finished_at=now(),updated_at=now(),summary=jsonb_build_object('note','Nenhuma fonte ativa tem conector disponível.') where id=v_scan_id;
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(p_actor,'scan.enqueue','scan',v_scan_id,jsonb_build_object('period',p_period,'kind',p_kind));
 return v_scan_id;
end $$;
create function public.claim_scan_source_for_scan(p_scan uuid) returns setof public.scan_sources language plpgsql security definer set search_path=public as $$
begin
 update public.scan_sources set status='erro',detail='Execução interrompida após o prazo de processamento.',finished_at=now(),updated_at=now()
 where scan_id=p_scan and status='em curso' and lease_until<now();
 return query with task as (
  select ss.id from public.scan_sources ss where ss.scan_id=p_scan and ss.status='na fila'
  order by ss.created_at,ss.id for update skip locked limit 1
 ) update public.scan_sources ss set status='em curso',started_at=now(),lease_until=now()+interval '5 minutes',attempts=ss.attempts+1,updated_at=now()
 from task where ss.id=task.id returning ss.*;
end $$;
revoke all on function public.claim_scan_source_for_scan(uuid) from public,anon,authenticated;
grant execute on function public.claim_scan_source_for_scan(uuid) to service_role;
