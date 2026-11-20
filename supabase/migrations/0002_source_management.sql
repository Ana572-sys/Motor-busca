-- The operation and its audit record are committed together, under the caller's identity.
create or replace function public.update_source(p_id uuid, p_name text, p_url text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare before_row public.sources%rowtype; clean_name text := trim(p_name); clean_url text := nullif(trim(p_url), '');
begin
 if auth.uid() is null or not exists(select 1 from public.users where id = auth.uid() and role = 'admin') then
   raise exception 'Operação não autorizada' using errcode = '42501';
 end if;
 if clean_name is null or length(clean_name) not between 1 and 150 then raise exception 'Nome inválido'; end if;
 if clean_url is not null and (length(clean_url) > 2048 or clean_url !~* '^https://[^[:space:]]+$') then raise exception 'O endereço deve usar HTTPS'; end if;
 if p_active and clean_url is null then raise exception 'Uma fonte ativa precisa de um endereço'; end if;
 select * into before_row from public.sources where id=p_id for update;
 if not found then raise exception 'Fonte não encontrada'; end if;
 update public.sources set name=clean_name, url=clean_url, active=p_active, updated_at=now() where id=p_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
 values(auth.uid(),'source.update','source',p_id,jsonb_build_object('before',jsonb_build_object('name',before_row.name,'url',before_row.url,'active',before_row.active),'after',jsonb_build_object('name',clean_name,'url',clean_url,'active',p_active)));
end $$;
revoke all on function public.update_source(uuid,text,text,boolean) from public;
grant execute on function public.update_source(uuid,text,text,boolean) to authenticated;
