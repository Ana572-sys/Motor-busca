-- Listing changes are preliminary observations, not validated notice amendments.
create table public.candidate_changes (
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid not null references public.source_candidates(id),
 source_id uuid not null references public.sources(id),
 previous_hash text not null,
 current_hash text not null,
 previous_fields jsonb not null,
 current_fields jsonb not null,
 detected_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.candidate_changes enable row level security;
create policy "members read candidate changes" on public.candidate_changes for select to authenticated using(public.is_member());
revoke all on public.candidate_changes from public,anon,authenticated;
grant select on public.candidate_changes to authenticated;
grant all on public.candidate_changes to service_role;
create function public.record_candidate_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.current_hash is distinct from new.current_hash then
  insert into public.candidate_changes(candidate_id,source_id,previous_hash,current_hash,previous_fields,current_fields)
  values(new.id,new.source_id,old.current_hash,new.current_hash,
   jsonb_build_object('code',old.code,'title',old.title,'region',old.region,'opening_date',old.opening_date,'closing_date',old.closing_date,'document_url',old.document_url,'source_state',old.source_state,'source_updated_at',old.source_updated_at,'document_metadata',old.document_metadata,'programs',old.programs),
   jsonb_build_object('code',new.code,'title',new.title,'region',new.region,'opening_date',new.opening_date,'closing_date',new.closing_date,'document_url',new.document_url,'source_state',new.source_state,'source_updated_at',new.source_updated_at,'document_metadata',new.document_metadata,'programs',new.programs));
 end if;
 return new;
end $$;
revoke all on function public.record_candidate_change() from public,anon,authenticated;
create trigger source_candidate_changed after update on public.source_candidates for each row execute function public.record_candidate_change();
