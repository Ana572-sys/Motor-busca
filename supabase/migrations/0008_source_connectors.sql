-- Connector selection is stored with the source; changing its display name does not disable the adapter.
alter table public.sources add column connector_key text;
update public.sources set connector_key='pis_listing_v1' where name='Portugal Inovação Social';
create unique index unique_pis_connector on public.sources(connector_key) where connector_key='pis_listing_v1';
