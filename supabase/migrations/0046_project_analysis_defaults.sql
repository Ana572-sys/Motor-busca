alter table public.project_analysis_settings
 alter column max_notices_per_run set default 10;

alter table public.project_search_sessions
 alter column max_notices set default 10;

update public.project_analysis_settings
 set max_notices_per_run=10,updated_at=now()
 where id=true;
