create extension if not exists pgcrypto;

create table if not exists public.gym_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  member_number text,
  contact_type text not null check (contact_type in ('Web/Email', 'Visita física', 'Teléfono', 'WhatsApp', 'Visita sin comercial', 'Invitación')),
  contact_date date not null,
  visit_date date,
  hot_done boolean not null default false,
  warm_done boolean not null default false,
  is_alta boolean not null default false,
  alta_date date,
  import_warnings text[] not null default '{}',
  legacy_source_key text,
  created_at timestamptz not null default now(),
  constraint alta_requires_date check (not is_alta or alta_date is not null or cardinality(import_warnings) > 0),
  constraint warm_requires_visit check (not warm_done or visit_date is not null),
  constraint hot_requires_visit check (not hot_done or visit_date is not null)
);

create unique index if not exists gym_contacts_legacy_source_key_uq
  on public.gym_contacts(owner_id, legacy_source_key);
create index if not exists gym_contacts_owner_contact_date_idx on public.gym_contacts(owner_id, contact_date desc);
create index if not exists gym_contacts_owner_visit_date_idx on public.gym_contacts(owner_id, visit_date);
create index if not exists gym_contacts_owner_alta_date_idx on public.gym_contacts(owner_id, alta_date);

alter table public.gym_contacts enable row level security;

create policy "Users can read their own gym contacts" on public.gym_contacts
  for select to authenticated using (owner_id = auth.uid());
create policy "Users can add their own gym contacts" on public.gym_contacts
  for insert to authenticated with check (owner_id = auth.uid());
create policy "Users can edit their own gym contacts" on public.gym_contacts
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Users can delete their own gym contacts" on public.gym_contacts
  for delete to authenticated using (owner_id = auth.uid());

grant select, insert, update, delete on public.gym_contacts to authenticated;

