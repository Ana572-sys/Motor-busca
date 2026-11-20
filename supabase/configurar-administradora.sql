-- Execute somente depois de a conta ana.oliveira@crowe.pt existir e ter o e-mail confirmado no Supabase Auth.
-- Se a consulta devolver zero linhas, não foi criada nem alterada qualquer conta.
insert into public.users(id,email,role)
select id,email,'admin'::public.app_role from auth.users
where lower(email)='ana.oliveira@crowe.pt' and email_confirmed_at is not null
on conflict(id) do update set role='admin',updated_at=now()
returning email,role;
