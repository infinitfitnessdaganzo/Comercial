grant delete on table public.gym_monthly_cancellations to authenticated;
drop policy if exists "Users can delete their own monthly cancellations" on public.gym_monthly_cancellations;
create policy "Users can delete their own monthly cancellations"
  on public.gym_monthly_cancellations
  for delete to authenticated
  using (owner_id = auth.uid());

