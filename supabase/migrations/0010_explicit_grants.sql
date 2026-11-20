-- For projects where automatic exposure of new tables is disabled.
-- RLS remains mandatory; a grant alone never authorizes a row.
grant usage on schema public to authenticated, service_role;
revoke all on public.users,public.sources,public.scans,public.opportunities,public.opportunity_versions,public.documents,public.factsheets,public.changes,public.notifications,public.audit_logs,public.source_snapshots,public.scan_sources,public.source_candidates,public.candidate_versions,public.factsheet_jobs from anon,authenticated;
grant select on public.users,public.sources,public.scans,public.opportunities,public.opportunity_versions,public.documents,public.factsheets,public.changes,public.notifications,public.audit_logs,public.source_snapshots,public.scan_sources,public.source_candidates,public.candidate_versions,public.factsheet_jobs to authenticated;
grant all on public.users,public.sources,public.scans,public.opportunities,public.opportunity_versions,public.documents,public.factsheets,public.changes,public.notifications,public.audit_logs,public.source_snapshots,public.scan_sources,public.source_candidates,public.candidate_versions,public.factsheet_jobs to service_role;
