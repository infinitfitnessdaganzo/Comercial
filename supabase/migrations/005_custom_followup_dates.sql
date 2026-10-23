-- Store optional custom dates for Hot and Warm follow-ups.
-- When a column is null, the application calculates its usual automatic date.
alter table public.gym_contacts
  add column if not exists hot_due_date date;

alter table public.gym_contacts
  add column if not exists warm_due_date date;

