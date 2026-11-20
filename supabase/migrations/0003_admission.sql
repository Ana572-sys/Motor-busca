-- Unverified opportunities do not appear in the open-opportunities dashboard.
alter table public.opportunities add column admission text not null default 'not_explicit' check (admission in ('portugal_explicit','multiple_countries_explicit','not_explicit','excluded'));
