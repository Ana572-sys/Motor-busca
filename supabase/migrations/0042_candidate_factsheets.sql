-- One shared, on-demand factsheet per observed version of a listing candidate.
create table public.candidate_factsheets (
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid not null references public.source_candidates(id) on delete cascade,
 content_hash text not null,
 scan_id uuid references public.scans(id),
 requested_by uuid not null references public.users(id),
 status text not null check(status in ('running','done','failed')),
 content jsonb,
 model text,
 input_tokens bigint,
 output_tokens bigint,
 estimated_cost_usd numeric(14,8),
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(candidate_id,content_hash)
);
create index candidate_factsheets_scan_cost on public.candidate_factsheets(scan_id) where status='done';
alter table public.candidate_factsheets enable row level security;
create policy "members read candidate factsheets" on public.candidate_factsheets for select to authenticated using(public.is_member());
revoke all on public.candidate_factsheets from public,anon,authenticated;
grant select on public.candidate_factsheets to authenticated;
grant all on public.candidate_factsheets to service_role;
