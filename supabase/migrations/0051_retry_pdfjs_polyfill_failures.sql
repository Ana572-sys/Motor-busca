-- Retry only current open notice analyses that failed before the PDF.js
-- canvas polyfills were loaded from the externalized native package.
with latest as (
  select distinct on (v.notice_id) v.id as version_id, n.id as notice_id
  from public.radar_notices n
  join public.radar_notice_versions v on v.notice_id = n.id
  where n.status = 'open'
  order by v.notice_id, v.detected_at desc, v.id desc
), reset_jobs as (
  update public.radar_notice_analyses a
  set status = 'pending',
      error_code = null,
      attempt_count = 0,
      started_at = null,
      finished_at = null,
      lease_until = null
  from latest l
  where a.version_id = l.version_id
    and a.status = 'incomplete'
    and a.error_code = 'DOMMatrix is not defined'
  returning a.version_id
)
update public.radar_notices n
set analysis_status = 'pending', updated_at = now()
from reset_jobs r
join latest l on l.version_id = r.version_id
where n.id = l.notice_id;
