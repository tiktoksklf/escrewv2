create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_-]{3,30}$'),
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  seller_username text not null,
  title text not null check (char_length(title) between 4 and 120),
  category text not null,
  price numeric(12,2) not null check (price > 0),
  coin text not null check (coin in ('SOL', 'BTC', 'LTC', 'ETH')),
  kind text not null check (kind in ('Service', 'Digital good', 'Physical good')),
  anonymous boolean not null default false,
  description text not null check (char_length(description) between 10 and 4000),
  delivery_notes text not null default '',
  delivery_window text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  buyer_id uuid not null references public.profiles(id),
  seller_id uuid not null references public.profiles(id),
  listing_title text not null,
  price numeric(12,2) not null,
  coin text not null,
  wallet text not null,
  status text not null default 'unpaid' check (status in ('unpaid','paid','in escrow','shipped','delivered','completed','refunded','cancelled','disputed')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.orders enable row level security;

drop policy if exists "Profiles are public" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
drop policy if exists "Active listings are public" on public.listings;
drop policy if exists "Owners and admins view listings" on public.listings;
drop policy if exists "Users create own listings" on public.listings;
drop policy if exists "Users update own listings" on public.listings;
drop policy if exists "Order participants can view" on public.orders;
drop policy if exists "Buyers create orders" on public.orders;

create policy "Profiles are public" on public.profiles for select using (true);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Owners and admins view listings" on public.listings for select using (
  auth.uid() = seller_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "Users create own listings" on public.listings for insert with check (auth.uid() = seller_id);
create policy "Users update own listings" on public.listings for update using (auth.uid() = seller_id);
create policy "Order participants can view" on public.orders for select using (auth.uid() = buyer_id or auth.uid() = seller_id);

create or replace function public.get_public_listings()
returns table (
  id uuid, seller_username text, title text, category text, price numeric,
  coin text, kind text, anonymous boolean, description text,
  delivery_window text, created_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select l.id,
    case when l.anonymous then 'Anonymous' else l.seller_username end,
    l.title, l.category, l.price, l.coin, l.kind, l.anonymous,
    l.description, l.delivery_window, l.created_at
  from public.listings l
  where l.active = true
  order by l.created_at desc;
$$;

create or replace function public.create_market_order(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  selected public.listings;
  new_id uuid;
  destination text;
begin
  if auth.uid() is null then raise exception 'Log in first'; end if;
  select * into selected from public.listings where id = p_listing_id and active = true;
  if selected.id is null then raise exception 'Listing unavailable'; end if;
  if selected.seller_id = auth.uid() then raise exception 'You cannot buy your own listing'; end if;
  destination := case selected.coin
    when 'SOL' then 'AE6vaxpfmPDtJNd1e5oboN5uZFqVYJMuwDyqykrCADvY'
    when 'BTC' then 'bc1q4h9qnd5slacywkl87umlzxe9zxnpjjjzrjyed2'
    when 'LTC' then 'LKhmv1GteaCj2eNREN9iMYdZNzbzDo2Gap'
    when 'ETH' then '0xb446020017eCb21F3ffE3DED59c770cFA0A1A96F'
  end;
  insert into public.orders (listing_id, buyer_id, seller_id, listing_title, price, coin, wallet)
  values (selected.id, auth.uid(), selected.seller_id, selected.title, selected.price, selected.coin, destination)
  returning id into new_id;
  return new_id;
end;
$$;

grant execute on function public.get_public_listings() to anon, authenticated;
grant execute on function public.create_market_order(uuid) to authenticated;
