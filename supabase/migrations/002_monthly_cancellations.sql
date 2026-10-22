create extension if not exists pgcrypto;

create table if not exists public.gym_monthly_cancellations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month_start date not null check (extract(day from month_start) = 1),
  cancellation_count integer not null check (cancellation_count >= 0),
  created_at timestamptz not null default now(),
  constraint gym_monthly_cancellations_owner_month_uq unique (owner_id, month_start)
);

alter table public.gym_monthly_cancellations enable row level security;

drop policy if exists "Users can read their own monthly cancellations" on public.gym_monthly_cancellations;
create policy "Users can read their own monthly cancellations" on public.gym_monthly_cancellations
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "Users can add their own monthly cancellations" on public.gym_monthly_cancellations;
create policy "Users can add their own monthly cancellations" on public.gym_monthly_cancellations
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "Users can edit their own monthly cancellations" on public.gym_monthly_cancellations;
create policy "Users can edit their own monthly cancellations" on public.gym_monthly_cancellations
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update on public.gym_monthly_cancellations to authenticated;

