do $$
declare
  owner_count integer;
  target_owner uuid;
begin
  select count(distinct owner_id), min(owner_id::text)::uuid
    into owner_count, target_owner
    from public.gym_contacts
    where owner_id is not null;

  if owner_count <> 1 then
    raise exception 'Se esperaba un único usuario con contactos para importar las bajas; se encontraron %.', owner_count;
  end if;

  insert into public.gym_monthly_cancellations (owner_id, month_start, cancellation_count)
  values
    (target_owner, date '2025-11-01', 36),
    (target_owner, date '2025-12-01', 16),
    (target_owner, date '2026-01-01', 31),
    (target_owner, date '2026-02-01', 27),
    (target_owner, date '2026-03-01', 21),
    (target_owner, date '2026-04-01', 19),
    (target_owner, date '2026-05-01', 22),
    (target_owner, date '2026-06-01', 29),
    (target_owner, date '2026-07-01', 26),
    (target_owner, date '2026-08-01', 27),
    (target_owner, date '2026-09-01', 28),
    (target_owner, date '2026-10-01', 25)
  on conflict (owner_id, month_start) do update
    set cancellation_count = excluded.cancellation_count,
        updated_at = now();
end;
$$;

