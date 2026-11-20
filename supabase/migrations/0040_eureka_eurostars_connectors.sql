do $block$
declare d text; old_part text := $old$'eismea_v1')$old$; new_part text := $new$'eismea_v1','eureka_v1','eurostars_v1')$new$;
begin
 select pg_get_functiondef('public.create_scan_batch(text,text,uuid,date)'::regprocedure) into d;
 if position(old_part in d)=0 then raise exception 'Definição inesperada; atualização cancelada'; end if;
 execute replace(d,old_part,new_part);
end $block$;
update public.sources s set url=v.url,connector_key=v.connector,active=true,updated_at=now()
from (values
 ('Eureka','https://www.eureka.dlr.de/en/calls/eureka-network-projects/','eureka_v1'),
 ('Eurostars','https://www.eureka.dlr.de/en/calls/eurostars-calls/','eurostars_v1')
) v(name,url,connector) where s.name=v.name;
