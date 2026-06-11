-- ============================================================
--  Social Patas Hybrid — Esquema de base de datos (Supabase)
--  Pega TODO esto en:  Supabase -> SQL Editor -> New query -> Run
-- ============================================================

-- ---------- TABLAS ----------

create table if not exists public.plans (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author  text not null,
  date    date not null,
  time    text,
  type    text not null,
  place   text,
  notes   text,
  created timestamptz not null default now()
);

create table if not exists public.plan_joins (
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name    text not null,
  primary key (plan_id, user_id)
);

create table if not exists public.logs (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author  text not null,
  type    text not null,
  content text not null,
  created timestamptz not null default now()
);

create table if not exists public.routes (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author  text not null,
  name    text not null,
  type    text not null,
  dist    text,
  notes   text,
  created timestamptz not null default now()
);

-- ---------- SEGURIDAD (Row Level Security) ----------
-- Todos los usuarios logueados VEN todo (es un tablero compartido),
-- pero cada quien solo puede CREAR/BORRAR lo suyo.

alter table public.plans      enable row level security;
alter table public.plan_joins enable row level security;
alter table public.logs       enable row level security;
alter table public.routes     enable row level security;

-- PLANS
create policy "plans_select" on public.plans for select to authenticated using (true);
create policy "plans_insert" on public.plans for insert to authenticated with check (auth.uid() = user_id);
create policy "plans_delete" on public.plans for delete to authenticated using (auth.uid() = user_id);

-- PLAN_JOINS (apuntarse / bajarse)
create policy "joins_select" on public.plan_joins for select to authenticated using (true);
create policy "joins_insert" on public.plan_joins for insert to authenticated with check (auth.uid() = user_id);
create policy "joins_delete" on public.plan_joins for delete to authenticated using (auth.uid() = user_id);

-- LOGS (bitácora)
create policy "logs_select" on public.logs for select to authenticated using (true);
create policy "logs_insert" on public.logs for insert to authenticated with check (auth.uid() = user_id);
create policy "logs_delete" on public.logs for delete to authenticated using (auth.uid() = user_id);

-- ROUTES (rutas)
create policy "routes_select" on public.routes for select to authenticated using (true);
create policy "routes_insert" on public.routes for insert to authenticated with check (auth.uid() = user_id);
create policy "routes_delete" on public.routes for delete to authenticated using (auth.uid() = user_id);

-- ---------- TIEMPO REAL ----------
-- Permite que los cambios de unos aparezcan solos en la pantalla de los demás.
alter publication supabase_realtime add table public.plans;
alter publication supabase_realtime add table public.plan_joins;
alter publication supabase_realtime add table public.logs;
alter publication supabase_realtime add table public.routes;
