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
 select v_scan_id,id,case when connector_key in ('pis_listing_v1','pessoas_2030_v1','portugal_2030_v1','compete_2030_v1','eu_grants_v1','prr_v1','fct_v1','fundo_v1','interreg_v1','eit_v1','dgartes_v1','pepac_v1') then 'na fila' else 'sem conector' end,
  case when connector_key in ('pis_listing_v1','pessoas_2030_v1','portugal_2030_v1','compete_2030_v1','eu_grants_v1','prr_v1','fct_v1','fundo_v1','interreg_v1','eit_v1','dgartes_v1','pepac_v1') then null else 'Conector ainda não disponível.' end from public.sources where active;
 if not exists(select 1 from public.scan_sources where scan_sources.scan_id=v_scan_id and status='na fila') then
  update public.scans set status='erro',finished_at=now(),updated_at=now(),summary=jsonb_build_object('note','Nenhuma fonte ativa tem conector disponível.') where id=v_scan_id;
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(p_actor,'scan.enqueue','scan',v_scan_id,jsonb_build_object('period',p_period,'kind',p_kind));
 return v_scan_id;
end $$;









update public.sources set url='https://pepacc.pt/concursos/',connector_key='pepac_v1',active=true,updated_at=now() where name='PEPAC';

