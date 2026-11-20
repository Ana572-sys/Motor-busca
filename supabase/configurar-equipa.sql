-- Associa apenas as contas confirmadas aos perfis de membro.
-- Contas não criadas ou não confirmadas não são adicionadas.
insert into public.users(id,email,role)
select id,email,'member'::public.app_role
from auth.users
where lower(email) in ('sara.fernandes@crowe.pt','raquel.lusquinos@crowe.pt','nuno.vieira@crowe.pt')
  and email_confirmed_at is not null
on conflict(id) do nothing
returning email,role;
