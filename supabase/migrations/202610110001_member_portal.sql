-- LTE member portal: Discord identities, admin-reviewed membership, wallet,
-- subscriptions, and a manually audited item warehouse.
-- Run this migration in the Supabase SQL editor before enabling the portal.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.admin_users from public, anon, authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select exists (
    select 1 from private.admin_users a
    where a.user_id = auth.uid()
  );
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create table if not exists public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minecraft_name text not null check (minecraft_name ~ '^[A-Za-z0-9_]{3,16}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists member_profiles_minecraft_name_unique
  on public.member_profiles (lower(minecraft_name));

create table if not exists public.wallet_accounts (
  member_id uuid primary key references public.member_profiles(user_id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.member_profiles(user_id) on delete cascade,
  amount bigint not null check (amount <> 0),
  reason text not null check (length(reason) between 1 and 240),
  kind text not null check (kind in ('admin_credit', 'subscription_purchase')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_plans (
  id text primary key,
  title text not null,
  duration_days integer not null check (duration_days in (7, 30, 90, 365)),
  price bigint check (price is null or price > 0),
  active boolean not null default true
);

insert into public.subscription_plans (id, title, duration_days, price) values
  ('week', '7 Tage', 7, null),
  ('month', '1 Monat', 30, 500000),
  ('quarter', '3 Monate', 90, null),
  ('year', '1 Jahr', 365, null)
on conflict (id) do nothing;

create table if not exists public.member_subscriptions (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.member_profiles(user_id) on delete cascade,
  plan_id text not null references public.subscription_plans(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.inventory_items (
  id bigint generated always as identity primary key,
  name text not null unique,
  description text not null default '',
  available_quantity integer not null default 0 check (available_quantity >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.item_loans (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.member_profiles(user_id) on delete restrict,
  item_id bigint not null references public.inventory_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  borrowed_at timestamptz not null default now(),
  due_at timestamptz not null,
  returned_at timestamptz,
  returned_by uuid references auth.users(id),
  check (due_at > borrowed_at)
);

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.inventory_items(id) on delete restrict,
  quantity_change integer not null check (quantity_change <> 0),
  reason text not null check (length(reason) between 1 and 240),
  loan_id bigint references public.item_loans(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.member_profiles enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.member_subscriptions enable row level security;
alter table public.inventory_items enable row level security;
alter table public.item_loans enable row level security;
alter table public.stock_movements enable row level security;

revoke all on public.member_profiles, public.wallet_accounts, public.wallet_transactions,
  public.subscription_plans, public.member_subscriptions, public.inventory_items,
  public.item_loans, public.stock_movements from public, anon, authenticated;

grant select on public.member_profiles, public.wallet_accounts, public.wallet_transactions,
  public.subscription_plans, public.member_subscriptions, public.inventory_items,
  public.item_loans, public.stock_movements to authenticated;
grant insert (user_id, minecraft_name), update (minecraft_name) on public.member_profiles to authenticated;

create policy "member profile is private" on public.member_profiles for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
create policy "member can register own profile" on public.member_profiles for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "member can edit own Minecraft name" on public.member_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "member reads own wallet" on public.wallet_accounts for select to authenticated
  using (member_id = auth.uid() or private.is_admin());
create policy "member reads own wallet history" on public.wallet_transactions for select to authenticated
  using (member_id = auth.uid() or private.is_admin());
create policy "plans are visible to members" on public.subscription_plans for select to authenticated
  using (active or private.is_admin());
create policy "member reads own subscriptions" on public.member_subscriptions for select to authenticated
  using (member_id = auth.uid() or private.is_admin());
create policy "warehouse list is visible to members" on public.inventory_items for select to authenticated
  using (true);
create policy "member reads own loans" on public.item_loans for select to authenticated
  using (member_id = auth.uid() or private.is_admin());
create policy "admin reads stock audit" on public.stock_movements for select to authenticated
  using (private.is_admin());

create or replace function private.create_wallet_for_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.wallet_accounts (member_id) values (new.user_id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.create_wallet_for_member() from public, anon, authenticated;
drop trigger if exists member_profile_wallet on public.member_profiles;
create trigger member_profile_wallet after insert on public.member_profiles
  for each row execute function private.create_wallet_for_member();

-- Admins must grant the first administrator manually in the SQL editor after
-- that Discord account has signed in once. Never infer admin status from a
-- browser-editable profile field or Discord username.
create or replace function public.admin_approve_member(p_member_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not private.is_admin() then raise exception 'Adminrechte erforderlich'; end if;
  update public.member_profiles
     set status = case when p_approved then 'approved' else 'rejected' end,
         updated_at = now()
   where user_id = p_member_id;
  if not found then raise exception 'Mitglied nicht gefunden'; end if;
end;
$$;

create or replace function public.admin_credit_wallet(p_member_id uuid, p_amount bigint, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_balance bigint;
begin
  if not private.is_admin() then raise exception 'Adminrechte erforderlich'; end if;
  if p_amount <= 0 or p_amount > 1000000000000 then raise exception 'Ungültiger Betrag'; end if;
  if length(trim(p_reason)) not between 1 and 240 then raise exception 'Bitte einen Buchungsgrund angeben'; end if;
  if not exists (select 1 from public.member_profiles where user_id = p_member_id and status = 'approved') then
    raise exception 'Mitglied ist nicht freigeschaltet';
  end if;
  update public.wallet_accounts set balance = balance + p_amount, updated_at = now()
   where member_id = p_member_id returning balance into v_balance;
  if not found then raise exception 'Guthabenkonto fehlt'; end if;
  insert into public.wallet_transactions(member_id, amount, reason, kind, created_by)
    values (p_member_id, p_amount, trim(p_reason), 'admin_credit', auth.uid());
  return v_balance;
end;
$$;

create or replace function public.admin_set_plan_price(p_plan_id text, p_price bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not private.is_admin() then raise exception 'Adminrechte erforderlich'; end if;
  if p_price is not null and p_price <= 0 then raise exception 'Preis muss größer als null sein'; end if;
  update public.subscription_plans set price = p_price where id = p_plan_id;
  if not found then raise exception 'Abo nicht gefunden'; end if;
end;
$$;

create or replace function public.purchase_subscription(p_plan_id text)
returns public.member_subscriptions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.member_profiles;
  v_plan public.subscription_plans;
  v_balance bigint;
  v_start timestamptz;
  v_subscription public.member_subscriptions;
begin
  if v_uid is null then raise exception 'Bitte zuerst anmelden'; end if;
  select * into v_profile from public.member_profiles where user_id = v_uid for update;
  if not found or v_profile.status <> 'approved' then raise exception 'Dein Konto ist noch nicht freigeschaltet'; end if;
  select * into v_plan from public.subscription_plans where id = p_plan_id and active;
  if not found or v_plan.price is null then raise exception 'Dieses Abo ist noch nicht verfügbar'; end if;
  select balance into v_balance from public.wallet_accounts where member_id = v_uid for update;
  if v_balance < v_plan.price then raise exception 'Dein Guthaben reicht dafür nicht aus'; end if;
  select greatest(now(), coalesce(max(ends_at), now())) into v_start
    from public.member_subscriptions where member_id = v_uid and ends_at > now();
  update public.wallet_accounts set balance = balance - v_plan.price, updated_at = now() where member_id = v_uid;
  insert into public.wallet_transactions(member_id, amount, reason, kind, created_by)
    values (v_uid, -v_plan.price, 'Abo: ' || v_plan.title, 'subscription_purchase', v_uid);
  insert into public.member_subscriptions(member_id, plan_id, starts_at, ends_at)
    values (v_uid, v_plan.id, v_start, v_start + make_interval(days => v_plan.duration_days))
    returning * into v_subscription;
  return v_subscription;
end;
$$;

create or replace function public.admin_adjust_stock(p_item_id bigint, p_delta integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_quantity integer;
begin
  if not private.is_admin() then raise exception 'Adminrechte erforderlich'; end if;
  if p_delta = 0 or length(trim(p_reason)) not between 1 and 240 then raise exception 'Ungültige Lagerbuchung'; end if;
  update public.inventory_items set available_quantity = available_quantity + p_delta, updated_at = now()
   where id = p_item_id and available_quantity + p_delta >= 0 returning available_quantity into v_quantity;
  if not found then raise exception 'Artikel fehlt oder der Bestand würde negativ'; end if;
  insert into public.stock_movements(item_id, quantity_change, reason, created_by)
    values (p_item_id, p_delta, trim(p_reason), auth.uid());
  return v_quantity;
end;
$$;

create or replace function public.admin_add_inventory_item(p_name text, p_description text, p_quantity integer)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_item_id bigint;
begin
  if not private.is_admin() then raise exception 'Adminrechte erforderlich'; end if;
  if length(trim(p_name)) not between 1 and 100 or p_quantity < 0 then raise exception 'Ungültiger Artikel'; end if;
  insert into public.inventory_items(name, description, available_quantity)
    values (trim(p_name), coalesce(p_description, ''), p_quantity) returning id into v_item_id;
  if p_quantity > 0 then
    insert into public.stock_movements(item_id, quantity_change, reason, created_by)
      values (v_item_id, p_quantity, 'Anfangsbestand', auth.uid());
  end if;
  return v_item_id;
end;
$$;

create or replace function public.borrow_item(p_item_id bigint, p_quantity integer)
returns public.item_loans
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_due timestamptz;
  v_item public.inventory_items;
  v_loan public.item_loans;
begin
  if v_uid is null then raise exception 'Bitte zuerst anmelden'; end if;
  if p_quantity <= 0 then raise exception 'Menge muss größer als null sein'; end if;
  if not exists (select 1 from public.member_profiles where user_id = v_uid and status = 'approved') then
    raise exception 'Dein Konto ist noch nicht freigeschaltet';
  end if;
  select max(ends_at) into v_due from public.member_subscriptions
    where member_id = v_uid and starts_at <= now() and ends_at > now();
  if v_due is null then raise exception 'Zum Ausleihen brauchst du ein aktives Abo'; end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found or v_item.available_quantity < p_quantity then raise exception 'Nicht genug Bestand verfügbar'; end if;
  update public.inventory_items set available_quantity = available_quantity - p_quantity, updated_at = now()
    where id = p_item_id;
  insert into public.item_loans(member_id, item_id, quantity, due_at)
    values (v_uid, p_item_id, p_quantity, v_due) returning * into v_loan;
  insert into public.stock_movements(item_id, quantity_change, reason, loan_id, created_by)
    values (p_item_id, -p_quantity, 'Verleih an Mitglied', v_loan.id, v_uid);
  return v_loan;
end;
$$;

create or replace function public.admin_return_loan(p_loan_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_loan public.item_loans;
begin
  if not private.is_admin() then raise exception 'Adminrechte erforderlich'; end if;
  select * into v_loan from public.item_loans where id = p_loan_id for update;
  if not found or v_loan.returned_at is not null then raise exception 'Ausleihe fehlt oder ist bereits zurückgebucht'; end if;
  update public.inventory_items set available_quantity = available_quantity + v_loan.quantity, updated_at = now()
    where id = v_loan.item_id;
  update public.item_loans set returned_at = now(), returned_by = auth.uid() where id = v_loan.id;
  insert into public.stock_movements(item_id, quantity_change, reason, loan_id, created_by)
    values (v_loan.item_id, v_loan.quantity, 'Rückgabe verbucht', v_loan.id, auth.uid());
end;
$$;

revoke all on function public.admin_approve_member(uuid, boolean),
  public.admin_credit_wallet(uuid, bigint, text), public.admin_set_plan_price(text, bigint),
  public.purchase_subscription(text), public.admin_adjust_stock(bigint, integer, text),
  public.admin_add_inventory_item(text, text, integer), public.borrow_item(bigint, integer),
  public.admin_return_loan(bigint) from public, anon;
grant execute on function public.admin_approve_member(uuid, boolean),
  public.admin_credit_wallet(uuid, bigint, text), public.admin_set_plan_price(text, bigint),
  public.purchase_subscription(text), public.admin_adjust_stock(bigint, integer, text),
  public.admin_add_inventory_item(text, text, integer), public.borrow_item(bigint, integer),
  public.admin_return_loan(bigint) to authenticated;

create or replace function public.is_lte_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$ select private.is_admin(); $$;
revoke all on function public.is_lte_admin() from public, anon;
grant execute on function public.is_lte_admin() to authenticated;

insert into public.inventory_items(name, description, available_quantity)
values ('Diamanterz-Blöcke', 'Lagerbestand der Gilde', 3000)
on conflict (name) do nothing;
