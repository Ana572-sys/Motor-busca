-- Events are independent of whether applications are currently open or closed.
create table public.opportunity_events (
 id uuid primary key default gen_random_uuid(),
 opportunity_id uuid not null references public.opportunities(id),
 version_id uuid not null references public.opportunity_versions(id),
 kind text not null check(kind in ('novo','alterado','prorrogado','republicado')),
 detected_at timestamptz not null default now(),
 source_url text,
 document_id uuid references public.documents(id),
 details jsonb not null default '{}',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(opportunity_id,version_id,kind)
);
alter table public.opportunity_events enable row level security;
create policy "members read events" on public.opportunity_events for select to authenticated using(public.is_member());
revoke all on public.opportunity_events from anon,authenticated;
grant select on public.opportunity_events to authenticated;
grant all on public.opportunity_events to service_role;
