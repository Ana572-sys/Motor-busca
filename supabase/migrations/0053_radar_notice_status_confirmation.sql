-- Preserve uncertainty in source listings instead of treating it as an open call.
alter table public.radar_notices drop constraint if exists radar_notices_status_check;
alter table public.radar_notices add constraint radar_notices_status_check
 check(status in ('open','closed','unconfirmed'));

alter table public.radar_notice_versions drop constraint if exists radar_notice_versions_status_check;
alter table public.radar_notice_versions add constraint radar_notice_versions_status_check
 check(status in ('open','closed','unconfirmed'));

alter table public.radar_notice_sources add column if not exists observed_status text not null default 'unconfirmed';
alter table public.radar_notice_sources drop constraint if exists radar_notice_sources_observed_status_check;
alter table public.radar_notice_sources add constraint radar_notice_sources_observed_status_check
 check(observed_status in ('open','closed','unconfirmed'));

update public.radar_notice_sources s
set observed_status = case
 when lower(coalesce(c.source_state,'')) ~ '(abert|open)' and (c.closing_date is null or c.closing_date >= current_date) then 'open'
 when lower(coalesce(c.source_state,'')) ~ '(fech|encerr|clos)' or (c.closing_date is not null and c.closing_date < current_date) then 'closed'
 else 'unconfirmed'
end
from public.source_candidates c
where s.candidate_id = c.id;

-- A call is open if at least one linked source explicitly confirms it.
-- It is closed only if every linked source reports closure; otherwise it remains unconfirmed.
with source_state as (
 select n.id,
  bool_or(s.observed_status = 'open') as has_open,
  bool_and(s.observed_status = 'closed') as all_closed,
  count(s.id) as source_count
 from public.radar_notices n
 left join public.radar_notice_sources s on s.notice_id = n.id
 group by n.id
)
update public.radar_notices n
set status = case
 when x.has_open and (n.deadline is null or n.deadline >= current_date) then 'open'
 when n.deadline is not null and n.deadline < current_date then 'closed'
 when x.source_count > 0 and x.all_closed then 'closed'
 else 'unconfirmed'
end,
closed_detected_at = case
 when (n.deadline is not null and n.deadline < current_date) or (x.source_count > 0 and x.all_closed)
 then coalesce(n.closed_detected_at, now()) else n.closed_detected_at end,
updated_at = now()
from source_state x
where n.id = x.id;

-- These four source rows explicitly say applications are suspended. Keep their
-- records and history, but do not present them as open or queue them for analysis.
update public.radar_notice_sources
set observed_status = 'unconfirmed', updated_at = now()
 where source_code ~* '[|][[:space:]]*suspensão de candidaturas[[:space:]]*$';

update public.radar_notices n
set status = 'unconfirmed', updated_at = now()
where n.official_code ~* '[|][[:space:]]*suspensão de candidaturas[[:space:]]*$';

update public.radar_notice_analyses a
set status = 'incomplete', error_code = 'application_suspension_status_unconfirmed',
 finished_at = coalesce(a.finished_at, now()), lease_until = null
from public.radar_notice_versions v, public.radar_notices n
where a.version_id = v.id and v.notice_id = n.id
 and n.status = 'unconfirmed' and a.status in ('pending','running');

update public.radar_notices
set analysis_status = 'incomplete', updated_at = now()
where status = 'unconfirmed' and analysis_status = 'pending';

create index if not exists radar_notices_status_updated_idx on public.radar_notices(status, updated_at desc);
