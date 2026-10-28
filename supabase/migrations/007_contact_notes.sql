alter table public.gym_contacts
  add column if not exists notes text not null default '';

