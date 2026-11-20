-- Database updates are atomic. Object storage is content-addressed and may be safely retried.
create function public.finish_source_diagnostic(p_scan uuid,p_source uuid,p_status text,p_detail text,p_snapshot uuid)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid; finished timestamptz := now();
begin
 if p_status not in ('concluída','erro') then raise exception 'Estado inválido'; end if;
 select requested_by into actor from public.scans where id=p_scan and kind='manual' and period='diagnóstico' and status='em curso' for update;
 if not found then raise exception 'Pesquisa indisponível'; end if;
 insert into public.scan_sources(scan_id,source_id,status,detail,snapshot_id) values(p_scan,p_source,p_status,p_detail,p_snapshot);
 update public.sources set last_checked_at=finished,last_status=p_status,last_error=case when p_status='erro' then p_detail else null end,updated_at=finished where id=p_source;
 if not found then raise exception 'Fonte indisponível'; end if;
 update public.scans set status=p_status,finished_at=finished,updated_at=finished,summary=jsonb_build_object('kind','source_diagnostic','source',p_source,'detail',p_detail,'opportunities_identified',false) where id=p_scan;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(actor,'source.diagnostic','scan',p_scan,jsonb_build_object('source_id',p_source,'status',p_status));
end $$;
revoke all on function public.finish_source_diagnostic(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.finish_source_diagnostic(uuid,uuid,text,text,uuid) to service_role;
