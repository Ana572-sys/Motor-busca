create table public.source_candidates (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references public.sources(id), external_id text not null,
 code text not null, region text not null, opening_date date not null, closing_date date not null, document_url text not null,
 current_hash text not null, first_observed_at timestamptz not null default now(), last_observed_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_id,external_id)
);
create table public.candidate_versions (
 id uuid primary key default gen_random_uuid(), candidate_id uuid not null references public.source_candidates(id),
 listing_snapshot_id uuid not null references public.source_snapshots(id), content_hash text not null, fields jsonb not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(candidate_id,content_hash)
);
alter table public.source_candidates enable row level security;
alter table public.candidate_versions enable row level security;
create policy "members read candidates" on public.source_candidates for select to authenticated using(public.is_member());
create policy "members read candidate versions" on public.candidate_versions for select to authenticated using(public.is_member());

-- Records all candidates and the scan result in one database transaction.
create function public.finish_pis_diagnostic(p_scan uuid,p_source uuid,p_page_snapshot uuid,p_listing_hash text,p_listing_path text,p_listing_size integer,p_candidates jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare listing_id uuid; item jsonb; v_candidate_id uuid; n integer;
begin
 if jsonb_typeof(p_candidates)<>'array' then raise exception 'Lista inválida'; end if;
 n:=jsonb_array_length(p_candidates);if n<1 or n>=999 then raise exception 'Lista incompleta ou inválida'; end if;
 if not exists(select 1 from public.scans where id=p_scan and kind='manual' and period='diagnóstico' and status='em curso' for update) then raise exception 'Pesquisa indisponível'; end if;
 insert into public.source_snapshots(source_id,content_hash,storage_path,content_type,size_bytes)
 values(p_source,p_listing_hash,p_listing_path,'application/json',p_listing_size)
 on conflict(source_id,content_hash) do update set updated_at=now()
 returning id into listing_id;
 for item in select value from jsonb_array_elements(p_candidates) loop
  insert into public.source_candidates(source_id,external_id,code,region,opening_date,closing_date,document_url,current_hash)
  values(p_source,item->>'external_id',item->>'code',item->>'region',(item->>'opening_date')::date,(item->>'closing_date')::date,item->>'document_url',item->>'content_hash')
  on conflict(source_id,external_id) do update set code=excluded.code,region=excluded.region,opening_date=excluded.opening_date,closing_date=excluded.closing_date,document_url=excluded.document_url,current_hash=excluded.current_hash,last_observed_at=now(),updated_at=now()
  returning id into v_candidate_id;
  insert into public.candidate_versions(candidate_id,listing_snapshot_id,content_hash,fields) values(v_candidate_id,listing_id,item->>'content_hash',item)
  on conflict(candidate_id,content_hash) do nothing;
 end loop;
 perform public.finish_source_diagnostic(p_scan,p_source,'concluída',format('%s candidatos obtidos da listagem; elegibilidade e documentos não verificados.',n),p_page_snapshot);
end $$;
revoke all on function public.finish_pis_diagnostic(uuid,uuid,uuid,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.finish_pis_diagnostic(uuid,uuid,uuid,text,text,integer,jsonb) to service_role;
