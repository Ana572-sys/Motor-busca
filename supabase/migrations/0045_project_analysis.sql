-- Project profiles, saved analyses, structured notice facts and audited AI use.
create table public.project_profiles (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.users(id) on delete cascade,
 internal_name text,
 description text not null,
 sector text,
 technology_area text,
 main_objective text,
 current_stage text,
 innovation_level text,
 has_prototype boolean,
 has_partners boolean,
 needs_rd boolean,
 needs_internationalization boolean,
 needs_hiring boolean,
 needs_partners boolean,
 entity_type text not null,
 country text not null default 'Portugal',
 region text not null,
 application_mode text not null check(application_mode in ('individual','partnership','either')),
 partner_countries jsonb not null default '[]'::jsonb,
 total_investment numeric(16,2),
 duration_months integer,
 planned_start date,
 planned_end date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.project_cost_items (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.project_profiles(id) on delete cascade,
 category text not null check(category in ('resources-humanos','equipamentos','software','servicos-id','consultoria','construcao','formacao','marketing','energia','propriedade-intelectual','ensaios-certificacao','outros')),
 amount numeric(16,2) not null check(amount>=0),
 description text,
 position integer not null default 0,
 created_at timestamptz not null default now()
);
create table public.project_analysis_settings (
 id boolean primary key default true check(id),
 max_notices_per_run integer not null default 10 check(max_notices_per_run between 1 and 100),
 max_project_cost_usd numeric(12,4) not null default 1.0000 check(max_project_cost_usd>0),
 max_monthly_cost_usd numeric(12,2) not null default 25.00 check(max_monthly_cost_usd>0),
 updated_by uuid references public.users(id),
 updated_at timestamptz not null default now()
);
insert into public.project_analysis_settings(id) values(true) on conflict(id) do nothing;
create table public.project_search_sessions (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.project_profiles(id) on delete cascade,
 owner_id uuid not null references public.users(id) on delete cascade,
 project_snapshot jsonb not null,
 filters jsonb not null default '{}'::jsonb,
 max_notices integer not null default 10 check(max_notices between 1 and 100),
 status text not null default 'queued' check(status in ('queued','running','completed','partial','failed')),
 potential_notice_count integer not null default 0,
 analyzed_notice_count integer not null default 0,
 excluded_notice_count integer not null default 0,
 analysis_initialized boolean not null default false,
 lease_until timestamptz,
 error_code text,
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.notice_facts (
 id uuid primary key default gen_random_uuid(),
 candidate_version_id uuid references public.candidate_versions(id) on delete cascade,
 opportunity_version_id uuid references public.opportunity_versions(id) on delete cascade,
 version_hash text not null,
 language text,
 facts jsonb not null,
 source_references jsonb not null default '[]'::jsonb,
 search_text text not null default '',
 model text,
 input_tokens bigint,
 output_tokens bigint,
 estimated_cost_usd numeric(14,8),
 created_by uuid references public.users(id),
 created_at timestamptz not null default now(),
 check(num_nonnulls(candidate_version_id,opportunity_version_id)=1)
);
create unique index notice_facts_candidate_version on public.notice_facts(candidate_version_id) where candidate_version_id is not null;
create unique index notice_facts_opportunity_version on public.notice_facts(opportunity_version_id) where opportunity_version_id is not null;
create index notice_facts_json_idx on public.notice_facts using gin(facts jsonb_path_ops);
create index notice_facts_search_idx on public.notice_facts using gin(to_tsvector('simple',search_text));
create table public.notice_documents (
 id uuid primary key default gen_random_uuid(),
 candidate_version_id uuid references public.candidate_versions(id) on delete cascade,
 opportunity_version_id uuid references public.opportunity_versions(id) on delete cascade,
 kind text not null check(kind in ('webpage','notice','annex','other')),
 name text not null,
 official_url text,
 storage_path text,
 content_hash text,
 content_type text,
 size_bytes bigint,
 page_count integer,
 extracted_text text,
 extraction_status text not null default 'pending' check(extraction_status in ('pending','complete','unreadable','failed','unsupported')),
 language text,
 created_at timestamptz not null default now(),
 check(num_nonnulls(candidate_version_id,opportunity_version_id)=1),
 check(official_url is null or official_url ~ '^https://'),
 check(storage_path is null or storage_path not like '/%' and storage_path not like '%..%')
);
create index notice_documents_candidate_version_idx on public.notice_documents(candidate_version_id);
create index notice_documents_opportunity_version_idx on public.notice_documents(opportunity_version_id);
create unique index notice_documents_candidate_hash on public.notice_documents(candidate_version_id,content_hash) where candidate_version_id is not null and content_hash is not null;
create unique index notice_documents_opportunity_hash on public.notice_documents(opportunity_version_id,content_hash) where opportunity_version_id is not null and content_hash is not null;
create unique index notice_documents_candidate_url on public.notice_documents(candidate_version_id,official_url) where candidate_version_id is not null and official_url is not null;
create unique index notice_documents_opportunity_url on public.notice_documents(opportunity_version_id,official_url) where opportunity_version_id is not null and official_url is not null;
create table public.project_notice_analyses (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.project_search_sessions(id) on delete cascade,
 candidate_id uuid references public.source_candidates(id) on delete set null,
 opportunity_id uuid references public.opportunities(id) on delete set null,
 notice_version_hash text not null,
 notice_snapshot jsonb not null,
 status text not null default 'not-selected' check(status in ('not-selected','queued','analyzing','completed','excluded','insufficient','failed')),
 relevance text check(relevance is null or relevance in ('elevated','medium','low','insufficient')),
 rank integer,
 deterministic_score numeric(8,4),
 exclusion_reason text,
 analysis jsonb,
 notice_facts_id uuid references public.notice_facts(id) on delete set null,
 analyzed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(num_nonnulls(candidate_id,opportunity_id)=1)
);
create unique index project_candidate_analysis_unique on public.project_notice_analyses(session_id,candidate_id) where candidate_id is not null;
create unique index project_opportunity_analysis_unique on public.project_notice_analyses(session_id,opportunity_id) where opportunity_id is not null;
create index project_notice_analysis_session_status on public.project_notice_analyses(session_id,status,rank);
create table public.project_ai_usage (
 id uuid primary key default gen_random_uuid(),
 session_id uuid references public.project_search_sessions(id) on delete cascade,
 analysis_id uuid references public.project_notice_analyses(id) on delete set null,
 user_id uuid not null references public.users(id),
 operation text not null check(operation in ('project-interpretation','notice-structuring','project-match','chat','other')),
 model text not null,
 input_tokens bigint,
 output_tokens bigint,
 estimated_cost_usd numeric(14,8),
 status text not null check(status in ('completed','failed','unknown')),
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index project_ai_usage_session_idx on public.project_ai_usage(session_id,created_at desc);
create index project_ai_usage_user_month_idx on public.project_ai_usage(user_id,created_at desc);
create table public.project_chat_messages (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.project_search_sessions(id) on delete cascade,
 role text not null check(role in ('user','assistant')),
 content text not null,
 citations jsonb not null default '[]'::jsonb,
 usage_id uuid references public.project_ai_usage(id) on delete set null,
 created_at timestamptz not null default now()
);
create index project_chat_session_idx on public.project_chat_messages(session_id,created_at);

alter table public.project_profiles enable row level security;
alter table public.project_cost_items enable row level security;
alter table public.project_analysis_settings enable row level security;
alter table public.project_search_sessions enable row level security;
alter table public.notice_facts enable row level security;
alter table public.notice_documents enable row level security;
alter table public.project_notice_analyses enable row level security;
alter table public.project_ai_usage enable row level security;
alter table public.project_chat_messages enable row level security;

create policy "project owners and admins read profiles" on public.project_profiles for select to authenticated using(owner_id=auth.uid() or exists(select 1 from public.users u where u.id=auth.uid() and u.role::text='admin'));
create policy "project owners and admins read cost items" on public.project_cost_items for select to authenticated using(exists(select 1 from public.project_profiles p where p.id=project_id and (p.owner_id=auth.uid() or exists(select 1 from public.users u where u.id=auth.uid() and u.role::text='admin'))));
create policy "members read project settings" on public.project_analysis_settings for select to authenticated using(public.is_member());
create policy "admins update project settings" on public.project_analysis_settings for update to authenticated using(exists(select 1 from public.users u where u.id=auth.uid() and u.role::text='admin')) with check(exists(select 1 from public.users u where u.id=auth.uid() and u.role::text='admin'));
create policy "project owners and admins read sessions" on public.project_search_sessions for select to authenticated using(owner_id=auth.uid() or exists(select 1 from public.users u where u.id=auth.uid() and u.role::text='admin'));
create policy "members read notice facts" on public.notice_facts for select to authenticated using(public.is_member());
create policy "members read notice documents" on public.notice_documents for select to authenticated using(public.is_member());
create policy "project owners and admins read notice analyses" on public.project_notice_analyses for select to authenticated using(exists(select 1 from public.project_search_sessions s where s.id=session_id and (s.owner_id=auth.uid() or exists(select 1 from public.users u where u.id=auth.uid() and u.role::text='admin'))));
create policy "project owners and admins read AI usage" on public.project_ai_usage for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.project_search_sessions s where s.id=session_id and s.owner_id=auth.uid()) or exists(select 1 from public.users u where u.id=auth.uid() and u.role::text='admin'));
create policy "project owners and admins read chat" on public.project_chat_messages for select to authenticated using(exists(select 1 from public.project_search_sessions s where s.id=session_id and (s.owner_id=auth.uid() or exists(select 1 from public.users u where u.id=auth.uid() and u.role::text='admin'))));

revoke all on public.project_profiles,public.project_cost_items,public.project_analysis_settings,public.project_search_sessions,public.notice_facts,public.notice_documents,public.project_notice_analyses,public.project_ai_usage,public.project_chat_messages from anon,authenticated;
grant select on public.project_profiles,public.project_cost_items,public.project_search_sessions,public.notice_facts,public.notice_documents,public.project_notice_analyses,public.project_ai_usage,public.project_chat_messages to authenticated;
grant select,update on public.project_analysis_settings to authenticated;
grant all on public.project_profiles,public.project_cost_items,public.project_analysis_settings,public.project_search_sessions,public.notice_facts,public.notice_documents,public.project_notice_analyses,public.project_ai_usage,public.project_chat_messages to service_role;

create or replace function public.claim_project_analysis_step(p_session uuid,p_owner uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.project_search_sessions%rowtype;
begin
 select * into s from public.project_search_sessions where id=p_session for update;
 if not found or s.owner_id<>p_owner then return null; end if;
 if s.status in ('completed','partial','failed') then return to_jsonb(s)||jsonb_build_object('busy',false); end if;
 if s.lease_until is not null and s.lease_until>now() then return to_jsonb(s)||jsonb_build_object('busy',true); end if;
 update public.project_search_sessions set status='running',lease_until=now()+interval '90 seconds',updated_at=now() where id=p_session returning * into s;
 return to_jsonb(s)||jsonb_build_object('busy',false);
end $$;
create or replace function public.release_project_analysis_step(p_session uuid) returns void
language sql security definer set search_path=public as $$
 update public.project_search_sessions set lease_until=null,updated_at=now() where id=p_session
$$;
revoke all on function public.claim_project_analysis_step(uuid,uuid) from public,anon,authenticated;
revoke all on function public.release_project_analysis_step(uuid) from public,anon,authenticated;
grant execute on function public.claim_project_analysis_step(uuid,uuid) to service_role;
grant execute on function public.release_project_analysis_step(uuid) to service_role;

-- Vercel Hobby Schedules may start within 15 minutes of 08:30; accept that window,
-- while keeping the run restricted to Monday morning in Lisbon and unique per local day.
create or replace function public.weekly_scan_due(p_now timestamptz) returns boolean
language sql stable as $$
 select extract(isodow from p_now at time zone 'Europe/Lisbon')=1
    and extract(hour from p_now at time zone 'Europe/Lisbon')=8
    and extract(minute from p_now at time zone 'Europe/Lisbon') between 30 and 59
$$;
revoke all on function public.weekly_scan_due(timestamptz) from public,anon,authenticated;
grant execute on function public.weekly_scan_due(timestamptz) to service_role;
