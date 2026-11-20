begin;
create extension if not exists pgcrypto;
create type public.app_role as enum ('admin','member');
create table public.users (id uuid primary key references auth.users(id) on delete cascade, email text not null unique, role public.app_role not null default 'member', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.sources (id uuid primary key default gen_random_uuid(), name text not null unique, url text, active boolean not null default false, last_checked_at timestamptz, last_status text, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.scans (id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('manual','automática')), requested_by uuid references public.users(id), period text, status text not null, started_at timestamptz not null default now(), finished_at timestamptz, summary jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.opportunities (id uuid primary key default gen_random_uuid(), source_id uuid references public.sources(id), external_id text, title text not null, program text, country text, status text not null default 'informação incompleta', deadline timestamptz, published_at timestamptz, official_url text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_id,external_id));
create table public.opportunity_versions (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities(id), content_hash text not null, snapshot jsonb not null default '{}', detected_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(opportunity_id,content_hash));
create table public.documents (id uuid primary key default gen_random_uuid(), version_id uuid not null references public.opportunity_versions(id), source_url text, storage_path text, sha256 text, media_type text, size_bytes bigint, extraction_status text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.factsheets (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities(id), version_id uuid not null references public.opportunity_versions(id), created_by uuid references public.users(id), content jsonb not null, model text, input_tokens bigint, output_tokens bigint, estimated_cost numeric, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.changes (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities(id), old_version_id uuid references public.opportunity_versions(id), new_version_id uuid references public.opportunity_versions(id), field text, previous_value text, current_value text, source_url text, document_id uuid references public.documents(id), detected_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), scan_id uuid references public.scans(id), recipient text not null, kind text not null, status text not null, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references public.users(id), action text not null, entity_type text, entity_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create function public.is_member() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.users where id=auth.uid()) $$;
revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;
alter table public.users enable row level security;
create policy "read own profile" on public.users for select to authenticated using (id=auth.uid());
do $$ declare t text; begin foreach t in array array['sources','scans','opportunities','opportunity_versions','documents','factsheets','changes','notifications','audit_logs'] loop execute format('alter table public.%I enable row level security',t); execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())',t); end loop; end $$;
-- Writes are deliberately not granted to browsers until the corresponding server operations exist.
insert into storage.buckets (id,name,public) values ('radar-documents','radar-documents',false) on conflict (id) do nothing;
create policy "members read documents" on storage.objects for select to authenticated using (bucket_id='radar-documents' and public.is_member());

insert into public.sources (name) select unnest(array['Portugal 2030','COMPETE 2030','Pessoas 2030','Sustentável 2030','Mar 2030','FAMI 2030','Norte 2030','Centro 2030','Lisboa 2030','Alentejo 2030','Algarve 2030','Açores 2030','Madeira 2030','ANI','IEFP','PRR / Recuperar Portugal','Fundo Ambiental','Banco Português de Fomento','Turismo de Portugal','FCT','DGARTES','PEPAC','Portugal Inovação Social','Funding & Tenders Portal','Horizonte Europa','European Innovation Council','EISMEA','Digital Europe','LIFE','EU4Health','Creative Europe','Erasmus+','CERV','Single Market Programme','European Defence Fund','Connecting Europe Facility','Innovation Fund','InvestEU','Eurostars','Eureka','Interreg','PRIMA','EIT','European Cluster Collaboration Platform','European Urban Initiative']);

-- The operation and its audit record are committed together, under the caller's identity.
create or replace function public.update_source(p_id uuid, p_name text, p_url text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare before_row public.sources%rowtype; clean_name text := trim(p_name); clean_url text := nullif(trim(p_url), '');
begin
 if auth.uid() is null or not exists(select 1 from public.users where id = auth.uid() and role = 'admin') then
   raise exception 'Operação não autorizada' using errcode = '42501';
 end if;
 if clean_name is null or length(clean_name) not between 1 and 150 then raise exception 'Nome inválido'; end if;
 if clean_url is not null and (length(clean_url) > 2048 or clean_url !~* '^https://[^[:space:]]+$') then raise exception 'O endereço deve usar HTTPS'; end if;
 if p_active and clean_url is null then raise exception 'Uma fonte ativa precisa de um endereço'; end if;
 select * into before_row from public.sources where id=p_id for update;
 if not found then raise exception 'Fonte não encontrada'; end if;
 update public.sources set name=clean_name, url=clean_url, active=p_active, updated_at=now() where id=p_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
 values(auth.uid(),'source.update','source',p_id,jsonb_build_object('before',jsonb_build_object('name',before_row.name,'url',before_row.url,'active',before_row.active),'after',jsonb_build_object('name',clean_name,'url',clean_url,'active',p_active)));
end $$;
revoke all on function public.update_source(uuid,text,text,boolean) from public;
grant execute on function public.update_source(uuid,text,text,boolean) to authenticated;

-- Unverified opportunities do not appear in the open-opportunities dashboard.
alter table public.opportunities add column admission text not null default 'not_explicit' check (admission in ('portugal_explicit','multiple_countries_explicit','not_explicit','excluded'));

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.users where id=auth.uid() and role='admin') $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
create policy "administrators read profiles" on public.users for select to authenticated using (public.is_admin());

-- Source-page snapshots are separate from opportunity versions: a changed page is not itself an amended notice.
create table public.source_snapshots (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references public.sources(id),
 content_hash text not null, storage_path text not null, content_type text not null, size_bytes integer not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(source_id,content_hash)
);
create table public.scan_sources (
 id uuid primary key default gen_random_uuid(), scan_id uuid not null references public.scans(id), source_id uuid not null references public.sources(id),
 status text not null, detail text, snapshot_id uuid references public.source_snapshots(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(scan_id,source_id)
);
alter table public.source_snapshots enable row level security;
alter table public.scan_sources enable row level security;
create policy "members read source snapshots" on public.source_snapshots for select to authenticated using(public.is_member());
create policy "members read scan sources" on public.scan_sources for select to authenticated using(public.is_member());
-- Restrict an initial experiment to the verified official listing; activation remains an administrator decision.
update public.sources set url='https://pis.portugal2030.pt/concursos-pagina/', updated_at=now() where name='Portugal Inovação Social' and url is null;
create unique index scans_one_running_diagnostic on public.scans ((kind)) where kind='manual' and period='diagnóstico' and status='em curso';

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

-- Connector selection is stored with the source; changing its display name does not disable the adapter.
alter table public.sources add column connector_key text;
update public.sources set connector_key='pis_listing_v1' where name='Portugal Inovação Social';
create unique index unique_pis_connector on public.sources(connector_key) where connector_key='pis_listing_v1';

alter table public.opportunity_versions add column materials_complete boolean not null default false;
alter table public.documents add column material_kind text not null default 'other' check(material_kind in ('page','notice','annex','other'));
alter table public.documents add column extracted_text text;
alter table public.documents add column required_for_analysis boolean not null default true;
create table public.factsheet_jobs (
 id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities(id), version_id uuid not null references public.opportunity_versions(id),
 requested_by uuid not null references public.users(id), status text not null check(status in ('running','done','failed')), error text,
 api_calls integer not null default 0, model text, input_tokens bigint, output_tokens bigint, estimated_cost numeric,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index factsheet_one_running on public.factsheet_jobs(version_id) where status='running';
alter table public.factsheet_jobs enable row level security;
create policy "members read factsheet jobs" on public.factsheet_jobs for select to authenticated using(public.is_member());
create function public.claim_factsheet(p_opportunity uuid,p_version uuid,p_actor uuid,p_regenerate boolean) returns uuid
language plpgsql security definer set search_path=public as $$
declare job_id uuid;
begin
 if not exists(select 1 from public.users where id=p_actor) then raise exception 'Utilizador não autorizado'; end if;
 perform 1 from public.opportunity_versions where id=p_version and opportunity_id=p_opportunity and materials_complete for update;
 if not found then raise exception 'Documentos incompletos'; end if;
 if exists(select 1 from public.opportunity_versions where opportunity_id=p_opportunity and (detected_at,id)>(select detected_at,id from public.opportunity_versions where id=p_version)) then raise exception 'Versão desatualizada'; end if;
 if not exists(select 1 from public.documents where version_id=p_version and material_kind='page' and required_for_analysis) or not exists(select 1 from public.documents where version_id=p_version and material_kind='notice' and required_for_analysis) or exists(select 1 from public.documents where version_id=p_version and required_for_analysis and (storage_path is null or extraction_status is distinct from 'complete' or nullif(trim(extracted_text),'') is null)) then raise exception 'Extração documental incompleta'; end if;
 if not p_regenerate and exists(select 1 from public.factsheets where opportunity_id=p_opportunity and version_id=p_version) then return null; end if;
 update public.factsheet_jobs set status='failed',error='Execução interrompida',updated_at=now() where version_id=p_version and status='running' and created_at<now()-interval '10 minutes';
 insert into public.factsheet_jobs(opportunity_id,version_id,requested_by,status) values(p_opportunity,p_version,p_actor,'running') returning id into job_id;
 return job_id;
end $$;
create function public.finish_factsheet(p_job uuid,p_content jsonb,p_model text,p_input bigint,p_output bigint,p_cost numeric) returns void
language plpgsql security definer set search_path=public as $$
declare job public.factsheet_jobs%rowtype; sheet_id uuid;
begin
 select * into job from public.factsheet_jobs where id=p_job and status='running' for update;
 if not found then raise exception 'Geração indisponível'; end if;
 insert into public.factsheets(opportunity_id,version_id,created_by,content,model,input_tokens,output_tokens,estimated_cost) values(job.opportunity_id,job.version_id,job.requested_by,p_content,p_model,p_input,p_output,p_cost) returning id into sheet_id;
 update public.factsheet_jobs set status='done',model=p_model,input_tokens=p_input,output_tokens=p_output,estimated_cost=p_cost,updated_at=now() where id=p_job;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(job.requested_by,'factsheet.generate','factsheet',sheet_id,jsonb_build_object('version_id',job.version_id,'job_id',p_job));
end $$;
revoke all on function public.claim_factsheet(uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.finish_factsheet(uuid,jsonb,text,bigint,bigint,numeric) from public,anon,authenticated;
grant execute on function public.claim_factsheet(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.finish_factsheet(uuid,jsonb,text,bigint,bigint,numeric) to service_role;

-- For projects where automatic exposure of new tables is disabled.
-- RLS remains mandatory; a grant alone never authorizes a row.
grant usage on schema public to authenticated, service_role;
revoke all on public.users,public.sources,public.scans,public.opportunities,public.opportunity_versions,public.documents,public.factsheets,public.changes,public.notifications,public.audit_logs,public.source_snapshots,public.scan_sources,public.source_candidates,public.candidate_versions,public.factsheet_jobs from anon,authenticated;
grant select on public.users,public.sources,public.scans,public.opportunities,public.opportunity_versions,public.documents,public.factsheets,public.changes,public.notifications,public.audit_logs,public.source_snapshots,public.scan_sources,public.source_candidates,public.candidate_versions,public.factsheet_jobs to authenticated;
grant all on public.users,public.sources,public.scans,public.opportunities,public.opportunity_versions,public.documents,public.factsheets,public.changes,public.notifications,public.audit_logs,public.source_snapshots,public.scan_sources,public.source_candidates,public.candidate_versions,public.factsheet_jobs to service_role;

-- Official notices pages verified during initial setup; remain inactive until adapters are tested.
update public.sources set url=case name
 when 'Portugal 2030' then 'https://portugal2030.pt/avisos/'
 when 'COMPETE 2030' then 'https://www.compete2030.gov.pt/avisos/'
 when 'Pessoas 2030' then 'https://pessoas2030.gov.pt/avisos/'
 end,updated_at=now()
where name in ('Portugal 2030','COMPETE 2030','Pessoas 2030') and url is null;

commit;