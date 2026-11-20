-- Official notices pages verified during initial setup; remain inactive until adapters are tested.
update public.sources set url=case name
 when 'Portugal 2030' then 'https://portugal2030.pt/avisos/'
 when 'COMPETE 2030' then 'https://www.compete2030.gov.pt/avisos/'
 when 'Pessoas 2030' then 'https://pessoas2030.gov.pt/avisos/'
 end,updated_at=now()
where name in ('Portugal 2030','COMPETE 2030','Pessoas 2030') and url is null;
