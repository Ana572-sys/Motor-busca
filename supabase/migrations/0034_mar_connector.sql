do $block$
declare d text; old_part text := $old$'regional_fami_v1')$old$; new_part text := $new$'regional_fami_v1','mar_v1')$new$;
begin
 select pg_get_functiondef('public.create_scan_batch(text,text,uuid,date)'::regprocedure) into d;
 if position(old_part in d)=0 then raise exception 'Definição inesperada; atualização cancelada'; end if;
 execute replace(d,old_part,new_part);
end $block$;
update public.sources set url='https://mar2030.pt/avisos/',connector_key='mar_v1',active=true,updated_at=now() where name='Mar 2030';
