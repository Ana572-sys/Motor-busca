do $block$
declare d text; old_part text := $old$'regional_norte_v1')$old$; new_part text := $new$'regional_norte_v1','eu_program_horizonte_v1','eu_program_eic_v1','eu_program_cef_v1','eu_program_cerv_v1','eu_program_creative_v1','eu_program_digital_v1','eu_program_eu4health_v1','eu_program_edf_v1','eu_program_life_v1','eu_program_erasmus_v1','eu_program_smp_v1','eu_program_innovation_fund_v1','eu_program_prima_v1')$new$;
begin
 select pg_get_functiondef('public.create_scan_batch(text,text,uuid,date)'::regprocedure) into d;
 if position(old_part in d)=0 then raise exception 'Definição inesperada; atualização cancelada'; end if;
 execute replace(d,old_part,new_part);
end $block$;
update public.sources s set url=v.url,connector_key=v.connector,active=true,updated_at=now()
from (values
 ('Horizonte Europa','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_horizonte_v1'),
 ('European Innovation Council','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_eic_v1'),
 ('Connecting Europe Facility','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_cef_v1'),
 ('CERV','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_cerv_v1'),
 ('Creative Europe','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_creative_v1'),
 ('Digital Europe','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_digital_v1'),
 ('EU4Health','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_eu4health_v1'),
 ('European Defence Fund','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_edf_v1'),
 ('LIFE','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_life_v1'),
 ('Erasmus+','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_erasmus_v1'),
 ('Single Market Programme','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_smp_v1'),
 ('Innovation Fund','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_innovation_fund_v1'),
 ('PRIMA','https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities','eu_program_prima_v1')
) v(name,url,connector) where s.name=v.name;
