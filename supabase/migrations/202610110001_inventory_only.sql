-- Private LTE warehouse. This migration is independent of the member portal:
-- there are no member balances, subscriptions, or member profiles here.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists private.lte_inventory_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
revoke all on private.lte_inventory_admins from public, anon, authenticated;

create or replace function private.is_lte_inventory_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select exists (
    select 1 from private.lte_inventory_admins a where a.user_id = auth.uid()
  );
$$;
revoke all on function private.is_lte_inventory_admin() from public, anon;
grant execute on function private.is_lte_inventory_admin() to authenticated;

create table if not exists public.lte_inventory_items (
  id bigint generated always as identity primary key,
  name text not null unique check (length(trim(name)) between 1 and 100),
  category text not null default 'Sonstiges' check (length(category) between 1 and 50),
  quantity_on_hand bigint not null default 0 check (quantity_on_hand >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.lte_inventory_movements (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.lte_inventory_items(id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  quantity bigint not null check (quantity > 0),
  quantity_after bigint not null check (quantity_after >= 0),
  player_name text check (player_name is null or length(player_name) <= 40),
  note text not null check (length(trim(note)) between 1 and 240),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.lte_inventory_items enable row level security;
alter table public.lte_inventory_movements enable row level security;
revoke all on public.lte_inventory_items, public.lte_inventory_movements from public, anon, authenticated;
grant select on public.lte_inventory_items, public.lte_inventory_movements to authenticated;

create policy "only LTE inventory admins read item stock"
  on public.lte_inventory_items for select to authenticated
  using (private.is_lte_inventory_admin());
create policy "only LTE inventory admins read movement history"
  on public.lte_inventory_movements for select to authenticated
  using (private.is_lte_inventory_admin());

create or replace function public.is_lte_inventory_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$ select private.is_lte_inventory_admin(); $$;
revoke all on function public.is_lte_inventory_admin() from public, anon;
grant execute on function public.is_lte_inventory_admin() to authenticated;

create or replace function public.admin_create_inventory_item(
  p_name text,
  p_category text,
  p_opening_quantity bigint default 0
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_item_id bigint;
begin
  if not private.is_lte_inventory_admin() then raise exception 'Adminrechte erforderlich'; end if;
  if length(trim(p_name)) not between 1 and 100 then raise exception 'Ungültiger Itemname'; end if;
  if length(coalesce(trim(p_category), '')) > 50 then raise exception 'Kategorie ist zu lang'; end if;
  if p_opening_quantity < 0 then raise exception 'Bestand darf nicht negativ sein'; end if;
  insert into public.lte_inventory_items(name, category, quantity_on_hand)
  values (trim(p_name), coalesce(nullif(trim(p_category), ''), 'Sonstiges'), p_opening_quantity)
  returning id into v_item_id;
  if p_opening_quantity > 0 then
    insert into public.lte_inventory_movements(item_id, direction, quantity, quantity_after, note, created_by)
    values (v_item_id, 'in', p_opening_quantity, p_opening_quantity, 'Anfangsbestand', auth.uid());
  end if;
  return v_item_id;
end;
$$;

create or replace function public.admin_record_inventory_movement(
  p_item_id bigint,
  p_direction text,
  p_quantity bigint,
  p_player_name text,
  p_note text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_quantity_after bigint;
begin
  if not private.is_lte_inventory_admin() then raise exception 'Adminrechte erforderlich'; end if;
  if p_direction not in ('in', 'out') then raise exception 'Bewegung muss Eingang oder Ausgang sein'; end if;
  if p_quantity <= 0 then raise exception 'Menge muss größer als null sein'; end if;
  if length(coalesce(p_player_name, '')) > 40 then raise exception 'Spielername ist zu lang'; end if;
  if length(trim(p_note)) not between 1 and 240 then raise exception 'Bitte einen Buchungsgrund angeben'; end if;

  update public.lte_inventory_items
     set quantity_on_hand = case when p_direction = 'in' then quantity_on_hand + p_quantity else quantity_on_hand - p_quantity end,
         updated_at = now()
   where id = p_item_id
     and (p_direction = 'in' or quantity_on_hand >= p_quantity)
   returning quantity_on_hand into v_quantity_after;
  if not found then raise exception 'Item nicht gefunden oder Bestand reicht für diese Ausgabe nicht aus'; end if;

  insert into public.lte_inventory_movements(item_id, direction, quantity, quantity_after, player_name, note, created_by)
  values (p_item_id, p_direction, p_quantity, v_quantity_after, nullif(trim(p_player_name), ''), trim(p_note), auth.uid());
  return v_quantity_after;
end;
$$;

revoke all on function public.admin_create_inventory_item(text, text, bigint),
  public.admin_record_inventory_movement(bigint, text, bigint, text, text) from public, anon;
grant execute on function public.admin_create_inventory_item(text, text, bigint),
  public.admin_record_inventory_movement(bigint, text, bigint, text, text) to authenticated;

insert into public.lte_inventory_items(name, category, quantity_on_hand)
values ('Diamanterz-Blöcke', 'Erze', 3000)
on conflict (name) do nothing;
insert into public.lte_inventory_movements(item_id, direction, quantity, quantity_after, note)
select i.id, 'in', 3000, 3000, 'Anfangsbestand bei Einrichtung'
from public.lte_inventory_items i
where i.name = 'Diamanterz-Blöcke' and i.quantity_on_hand = 3000
  and not exists (select 1 from public.lte_inventory_movements m where m.item_id = i.id);
