alter table public.source_candidates add column title text;
alter table public.source_candidates add column source_state text;
alter table public.source_candidates add column source_updated_at text;
alter table public.source_candidates add column document_metadata jsonb not null default '[]';
alter table public.source_candidates add column programs jsonb not null default '[]';
alter table public.source_candidates alter column opening_date drop not null;
alter table public.source_candidates alter column closing_date drop not null;
update public.sources set connector_key='pessoas_2030_v1' where name='Pessoas 2030';
create unique index unique_pessoas_connector on public.sources(connector_key) where connector_key='pessoas_2030_v1';
create function public.finish_pessoas_diagnostic(p_scan uuid,p_source uuid,p_listing_hash text,p_listing_path text,p_listing_size integer,p_candidates jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare listing_id uuid; item jsonb; v_id uuid; n integer;
begin
 if jsonb_typeof(p_candidates)<>'array' then raise exception 'Lista inválida'; end if;
 n:=jsonb_array_length(p_candidates);if n>1000 then raise exception 'Lista demasiado extensa'; end if;
 if not exists(select 1 from public.scans where id=p_scan and kind='manual' and period='diagnóstico' and status='em curso' for update) then raise exception 'Pesquisa indisponível'; end if;
 insert into public.source_snapshots(source_id,content_hash,storage_path,content_type,size_bytes) values(p_source,p_listing_hash,p_listing_path,'application/json',p_listing_size)
 on conflict(source_id,content_hash) do update set updated_at=now() returning id into listing_id;
 for item in select value from jsonb_array_elements(p_candidates) loop
  insert into public.source_candidates(source_id,external_id,code,region,opening_date,closing_date,document_url,current_hash,title,source_state,source_updated_at,document_metadata,programs)
  values(p_source,item->>'externalId',item->>'code','Informação não identificada no aviso.',nullif(left(item->>'startsAt',10),'')::date,nullif(left(item->>'endsAt',10),'')::date,'https://pessoas2030.gov.pt/avisos/',item->>'contentHash',item->>'title',item->>'sourceState',item->>'updatedAt',coalesce(item->'documents','[]'::jsonb),coalesce(item->'programs','[]'::jsonb))
  on conflict(source_id,external_id) do update set code=excluded.code,opening_date=excluded.opening_date,closing_date=excluded.closing_date,current_hash=excluded.current_hash,title=excluded.title,source_state=excluded.source_state,source_updated_at=excluded.source_updated_at,document_metadata=excluded.document_metadata,programs=excluded.programs,last_observed_at=now(),updated_at=now()
  returning id into v_id;
  insert into public.candidate_versions(candidate_id,listing_snapshot_id,content_hash,fields) values(v_id,listing_id,item->>'contentHash',item) on conflict(candidate_id,content_hash) do nothing;
 end loop;
 perform public.finish_source_diagnostic(p_scan,p_source,'concluída',format('%s candidatos abertos obtidos da listagem; documentos e elegibilidade não verificados.',n),listing_id);
end $$;
revoke all on function public.finish_pessoas_diagnostic(uuid,uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finish_pessoas_diagnostic(uuid,uuid,text,text,integer,jsonb) to service_role;
