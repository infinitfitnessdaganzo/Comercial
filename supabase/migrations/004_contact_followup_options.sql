-- Allow Hot and Warm follow-ups to be enabled for any contact type.
-- Existing visit records keep their previous follow-up behavior.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_contacts' and column_name = 'hot_enabled'
  ) then
    alter table public.gym_contacts add column hot_enabled boolean not null default false;
    update public.gym_contacts set hot_enabled = (visit_date is not null);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_contacts' and column_name = 'warm_enabled'
  ) then
    alter table public.gym_contacts add column warm_enabled boolean not null default false;
    update public.gym_contacts set warm_enabled = (visit_date is not null);
  end if;
end
$$;

alter table public.gym_contacts drop constraint if exists hot_requires_visit;
alter table public.gym_contacts drop constraint if exists warm_requires_visit;

