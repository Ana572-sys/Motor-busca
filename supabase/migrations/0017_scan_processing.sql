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
