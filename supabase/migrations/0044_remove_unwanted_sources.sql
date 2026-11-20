-- Desativa as fontes pedidas nas pesquisas futuras sem apagar o histórico.
update public.sources
set active = false,
    updated_at = now()
where lower(trim(name)) in ('aicep', 'cordis', 'iapmei', 'enterprise europe network')
  and active is distinct from false;
