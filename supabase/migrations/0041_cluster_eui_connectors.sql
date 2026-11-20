do $block$
declare d text; old_part text := $old$'eureka_v1','eurostars_v1')$old$; new_part text := $new$'eureka_v1','eurostars_v1','cluster_calls_v1','eui_calls_v1')$new$;
begin
 select pg_get_functiondef('public.create_scan_batch(text,text,uuid,date)'::regprocedure) into d;
 if position(old_part in d)=0 then raise exception 'Definição inesperada; atualização cancelada'; end if;
 execute replace(d,old_part,new_part);
end $block$;
update public.sources s set url=v.url,connector_key=v.connector,active=true,updated_at=now()
from (values
 ('European Cluster Collaboration Platform','https://www.clustercollaboration.eu/funding-and-tenders','cluster_calls_v1'),
 ('European Urban Initiative','https://www.urban-initiative.eu/','eui_calls_v1')
) v(name,url,connector) where s.name=v.name;
