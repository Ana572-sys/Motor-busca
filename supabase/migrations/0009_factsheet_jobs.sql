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
