-- Family Recipes + Grocery List — Supabase schema
-- Run this once in Supabase SQL Editor (Project > SQL Editor > New query > Run)

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  servings text,
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  description text not null,
  amount text,
  sort_order int not null default 0
);

create table if not exists sub_recipes (
  id uuid primary key default gen_random_uuid(),
  parent_recipe_id uuid not null references recipes(id) on delete cascade,
  child_recipe_id uuid not null references recipes(id) on delete cascade,
  sort_order int not null default 0,
  constraint no_self_ref check (parent_recipe_id <> child_recipe_id),
  constraint uniq_parent_child unique (parent_recipe_id, child_recipe_id)
);

create table if not exists grocery_items (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount text,
  source_recipe_name text,
  is_checked boolean not null default false,
  added_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ingredients_recipe on recipe_ingredients(recipe_id);
create index if not exists idx_subrecipes_parent on sub_recipes(parent_recipe_id);
create index if not exists idx_subrecipes_child on sub_recipes(child_recipe_id);
create index if not exists idx_grocery_checked on grocery_items(is_checked);

-- ---------- Row Level Security ----------
-- Only signed-in users (you + your wife, created as Auth users) can read/write.
-- The public anon key alone (embedded in the app's JS) grants nothing.

alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table sub_recipes enable row level security;
alter table grocery_items enable row level security;

drop policy if exists household_all on recipes;
create policy household_all on recipes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists household_all on recipe_ingredients;
create policy household_all on recipe_ingredients for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists household_all on sub_recipes;
create policy household_all on sub_recipes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists household_all on grocery_items;
create policy household_all on grocery_items for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- Realtime (so both phones see changes live) ----------

alter publication supabase_realtime add table recipes;
alter publication supabase_realtime add table recipe_ingredients;
alter publication supabase_realtime add table sub_recipes;
alter publication supabase_realtime add table grocery_items;
