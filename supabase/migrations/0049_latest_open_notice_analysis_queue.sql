-- Preserve historic versions, but stop queueing their obsolete analysis jobs.
insert into public.radar_notice_analyses(version_id,status,facts,source_references)
select latest.id,'pending','{}'::jsonb,'[]'::jsonb
from public.radar_notices n
join lateral (
 select v.id from public.radar_notice_versions v
 where v.notice_id=n.id
 order by v.detected_at desc,v.id desc
 limit 1
) latest on true
left join public.radar_notice_analyses a on a.version_id=latest.id
where n.status='open' and a.id is null
on conflict(version_id) do nothing;

update public.radar_notice_analyses a
set status='incomplete',error_code='superseded_version_not_current',finished_at=now(),lease_until=null
from public.radar_notice_versions old
join public.radar_notices n on n.id=old.notice_id
where a.version_id=old.id and n.status='open' and a.status in ('pending','running')
 and exists(
  select 1 from public.radar_notice_versions newer
  where newer.notice_id=old.notice_id
   and (newer.detected_at>old.detected_at or (newer.detected_at=old.detected_at and newer.id>old.id))
 );

update public.radar_notices n
set analysis_status=coalesce((
 select a.status
 from public.radar_notice_versions latest
 join public.radar_notice_analyses a on a.version_id=latest.id
 where latest.notice_id=n.id
 order by latest.detected_at desc,latest.id desc
 limit 1
),'pending')
where n.status='open';

create or replace function public.claim_radar_notice_analysis()
returns table(id uuid,version_id uuid)
language plpgsql security definer set search_path=public as $$
begin
 return query
 with next_job as (
  select a.id from public.radar_notice_analyses a
  join public.radar_notice_versions v on v.id=a.version_id
  join public.radar_notices n on n.id=v.notice_id
  where n.status='open'
   and v.id=(select latest.id from public.radar_notice_versions latest where latest.notice_id=n.id order by latest.detected_at desc,latest.id desc limit 1)
   and (
    a.status='pending'
    or (a.status='running' and (a.lease_until is null or a.lease_until<now()))
    or (a.status='failed' and a.attempt_count<3 and a.finished_at<now()-interval '20 hours')
   )
  order by case when a.status='pending' then 0 else 1 end,a.created_at,a.id
  for update of a skip locked limit 1
 ), claimed as (
  update public.radar_notice_analyses a set status='running',attempt_count=a.attempt_count+1,started_at=now(),lease_until=now()+interval '8 minutes'
  from next_job where a.id=next_job.id returning a.id,a.version_id
 ) select claimed.id,claimed.version_id from claimed;
end $$;

revoke all on function public.claim_radar_notice_analysis() from public,anon,authenticated;
grant execute on function public.claim_radar_notice_analysis() to service_role;
