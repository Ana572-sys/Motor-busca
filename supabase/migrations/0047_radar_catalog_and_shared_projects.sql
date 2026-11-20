-- Canonical Radar catalog and shared project access.
-- Additive migration: legacy opportunities, source candidates, factsheets and costs remain intact.

create table public.radar_notices (
 id uuid primary key default gen_random_uuid(),
 canonical_key text not null unique,
 official_code text,
 title text not null,
 program text,
 status text not null default 'open' check(status in ('open','closed')),
 analysis_status text not null default 'pending' check(analysis_status in ('pending','complete','incomplete','failed')),
 opening_date date,
 deadline date,
 eligible_regions text[] not null default '{}',
 beneficiaries jsonb not null default '[]'::jsonb,
 eligible_sectors jsonb not null default '[]'::jsonb,
 eligible_caes text[] not null default '{}',
 investment_minimum numeric(16,2),
 investment_maximum numeric(16,2),
 funding_rate jsonb,
 eligible_expenses jsonb not null default '[]'::jsonb,
 ineligible_expenses jsonb not null default '[]'::jsonb,
 spending_conditions jsonb not null default '[]'::jsonb,
 partnership_required boolean,
 rd_requirement text not null default 'unidentified' check(rd_requirement in ('required','optional','not_supported','unidentified')),
 short_summary text,
 official_url text,
 extraction_confidence numeric(5,4) check(extraction_confidence is null or extraction_confidence between 0 and 1),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 closed_detected_at timestamptz,
 last_analyzed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(investment_minimum is null or investment_maximum is null or investment_minimum <= investment_maximum),
 check(official_url is null or official_url ~ '^https://')
);
create index radar_notices_state_updated_idx on public.radar_notices(status,updated_at desc);
create index radar_notices_deadline_idx on public.radar_notices(deadline) where status='open';
create index radar_notices_regions_idx on public.radar_notices using gin(eligible_regions);
create index radar_notices_caes_idx on public.radar_notices using gin(eligible_caes);

create table public.radar_notice_sources (
 id uuid primary key default gen_random_uuid(),
 notice_id uuid not null references public.radar_notices(id) on delete cascade,
 source_id uuid not null references public.sources(id),
 candidate_id uuid references public.source_candidates(id) on delete set null,
 official_url text,
 document_url text,
 source_title text,
 source_code text,
 last_observed_hash text,
 last_observed_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(source_id,candidate_id),
 check(official_url is null or official_url ~ '^https://'),
 check(document_url is null or document_url ~ '^https://')
);
create index radar_notice_sources_notice_idx on public.radar_notice_sources(notice_id);

create table public.radar_notice_versions (
 id uuid primary key default gen_random_uuid(),
 notice_id uuid not null references public.radar_notices(id) on delete cascade,
 content_hash text not null,
 snapshot jsonb not null,
 status text not null check(status in ('open','closed')),
 detected_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 unique(notice_id,content_hash)
);
create index radar_notice_versions_notice_date_idx on public.radar_notice_versions(notice_id,detected_at desc);

create table public.radar_notice_documents (
 id uuid primary key default gen_random_uuid(),
 version_id uuid not null references public.radar_notice_versions(id) on delete cascade,
 kind text not null check(kind in ('primary','complementary','official_page','other')),
 name text not null,
 official_url text,
 storage_path text,
 content_hash text,
 content_type text,
 size_bytes bigint,
 page_count integer,
 extraction_status text not null default 'pending' check(extraction_status in ('pending','complete','unreadable','unavailable','failed','unsupported')),
 created_at timestamptz not null default now(),
 unique(version_id,content_hash),
 check(official_url is null or official_url ~ '^https://'),
 check(storage_path is null or (storage_path not like '/%' and storage_path not like '%..%'))
);
create index radar_notice_documents_version_idx on public.radar_notice_documents(version_id);

create table public.radar_notice_analyses (
 id uuid primary key default gen_random_uuid(),
 version_id uuid not null unique references public.radar_notice_versions(id) on delete cascade,
 status text not null check(status in ('complete','incomplete','failed')),
 facts jsonb not null default '{}'::jsonb,
 source_references jsonb not null default '[]'::jsonb,
 confidence numeric(5,4) check(confidence is null or confidence between 0 and 1),
 model text,
 input_tokens bigint,
 output_tokens bigint,
 estimated_cost_usd numeric(14,8),
 error_code text,
 analyzed_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);

create table public.radar_update_runs (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('initial','manual','scheduled')),
 status text not null default 'queued' check(status in ('queued','running','completed','partial','failed')),
 requested_by uuid references public.users(id),
 total_sources integer not null default 0,
 completed_sources integer not null default 0,
 failed_sources integer not null default 0,
 new_notices integer not null default 0,
 updated_notices integer not null default 0,
 closed_notices integer not null default 0,
 incomplete_analyses integer not null default 0,
 consolidated_storage_path text,
 started_at timestamptz,
 finished_at timestamptz,
 summary jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table public.radar_update_sources (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.radar_update_runs(id) on delete cascade,
 source_id uuid not null references public.sources(id),
 status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 discovered_count integer not null default 0,
 new_count integer not null default 0,
 updated_count integer not null default 0,
 closed_count integer not null default 0,
 error_code text,
 error_detail text,
 last_successful_at timestamptz,
 started_at timestamptz,
 finished_at timestamptz,
 unique(run_id,source_id)
);

create table public.ai_usage (
 id uuid primary key default gen_random_uuid(),
 operation text not null check(operation in ('notice-analysis','notice-update','project-analysis','project-match','other')),
 notice_id uuid references public.radar_notices(id) on delete set null,
 notice_version_id uuid references public.radar_notice_versions(id) on delete set null,
 project_id uuid references public.project_profiles(id) on delete set null,
 project_session_id uuid references public.project_search_sessions(id) on delete set null,
 user_id uuid references public.users(id),
 model text not null,
 input_tokens bigint,
 output_tokens bigint,
 estimated_cost_usd numeric(14,8),
 status text not null check(status in ('completed','failed','unknown')),
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index ai_usage_created_idx on public.ai_usage(created_at desc);
create index ai_usage_notice_idx on public.ai_usage(notice_id,created_at desc);
create index ai_usage_project_idx on public.ai_usage(project_id,created_at desc);

alter table public.project_profiles add column if not exists cae text;
alter table public.project_cost_items alter column amount drop not null;
alter table public.project_cost_items drop constraint if exists project_cost_items_amount_check;
alter table public.project_cost_items add constraint project_cost_items_amount_nonnegative check(amount is null or amount>=0);
create table public.project_profile_versions (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.project_profiles(id) on delete cascade,
 version_number integer not null,
 snapshot jsonb not null,
 created_by uuid references public.users(id),
 created_at timestamptz not null default now(),
 unique(project_id,version_number)
);
create table public.project_activity_log (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.project_profiles(id) on delete cascade,
 actor_id uuid references public.users(id),
 action text not null check(action in ('created','edited','analysis_updated')),
 changes jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.project_search_sessions add column if not exists project_version_id uuid references public.project_profile_versions(id) on delete set null;
alter table public.project_search_sessions add column if not exists analysis_version integer not null default 1;
alter table public.project_search_sessions drop constraint if exists project_search_sessions_max_notices_check;
alter table public.project_search_sessions drop column if exists max_notices;
alter table public.project_notice_analyses add column if not exists radar_notice_id uuid references public.radar_notices(id) on delete set null;
alter table public.project_notice_analyses add column if not exists radar_notice_version_id uuid references public.radar_notice_versions(id) on delete set null;
alter table public.project_notice_analyses add column if not exists compatibility_pct numeric(5,2) check(compatibility_pct is null or compatibility_pct between 0 and 100);
alter table public.project_notice_analyses add column if not exists confidence_level text check(confidence_level is null or confidence_level in ('high','medium','low'));
alter table public.project_notice_analyses add column if not exists gate_results jsonb not null default '{}'::jsonb;
alter table public.project_notice_analyses drop constraint if exists project_notice_analyses_check;
alter table public.project_notice_analyses add constraint project_notice_analyses_one_notice_reference check(num_nonnulls(candidate_id,opportunity_id,radar_notice_id)=1);
drop index if exists public.project_radar_notice_analysis_unique;
create unique index project_radar_notice_analysis_unique on public.project_notice_analyses(session_id,radar_notice_id);

do $$ declare t text; begin
 foreach t in array array['radar_notices','radar_notice_sources','radar_notice_versions','radar_notice_documents','radar_notice_analyses','radar_update_runs','radar_update_sources','ai_usage','project_profile_versions','project_activity_log'] loop
  execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;

do $$ declare t text; begin
 foreach t in array array['radar_notices','radar_notice_sources','radar_notice_versions','radar_notice_documents','radar_notice_analyses','radar_update_runs','radar_update_sources','ai_usage','project_profile_versions','project_activity_log'] loop
  execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', 'members read '||t, t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- Project work is shared by the four-member team. Writes remain server-side through service_role actions.
drop policy if exists "project owners and admins read profiles" on public.project_profiles;
create policy "members read project profiles" on public.project_profiles for select to authenticated using(public.is_member());
drop policy if exists "project owners and admins read cost items" on public.project_cost_items;
create policy "members read project cost items" on public.project_cost_items for select to authenticated using(public.is_member());
drop policy if exists "project owners and admins read sessions" on public.project_search_sessions;
create policy "members read project sessions" on public.project_search_sessions for select to authenticated using(public.is_member());
drop policy if exists "project owners and admins read notice analyses" on public.project_notice_analyses;
create policy "members read project notice analyses" on public.project_notice_analyses for select to authenticated using(public.is_member());
drop policy if exists "project owners and admins read AI usage" on public.project_ai_usage;
create policy "members read project AI usage" on public.project_ai_usage for select to authenticated using(public.is_member());
drop policy if exists "project owners and admins read chat" on public.project_chat_messages;
create policy "members read project chat history" on public.project_chat_messages for select to authenticated using(public.is_member());
drop table if exists public.project_analysis_settings;

grant select on public.project_profile_versions,public.project_activity_log to authenticated;
grant all on public.project_profile_versions,public.project_activity_log to service_role;
