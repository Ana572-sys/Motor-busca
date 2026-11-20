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
