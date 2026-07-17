-- =========================================================
-- NinjaHIIT クラウドスキーマ v1（R2/R3。13_リッチ化設計書.md §3〜§5）
-- 適用方法: Supabaseダッシュボード → SQL Editor → 全文貼り付け → Run
-- 何度実行しても安全（if not exists / or replace）
-- =========================================================

-- ---- プロフィール（忍び名。ランキング表示用） ----
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  ninja_name text not null default '' check (char_length(ninja_name) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- ---- 完走ログ（追記専用。クライアントの history 1件 = 1行） ----
-- 主キー(user_id, client_ts)で冪等アップサート → 二重送信しても壊れない
create table if not exists public.results (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_ts bigint not null,                 -- クライアントの完走時刻(epoch ms)
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),  -- クライアントJSTの日付
  workout_id text not null check (char_length(workout_id) <= 40),
  total_work_sec int not null check (total_work_sec between 1 and 3600),
  bonus_exp int not null default 0 check (bonus_exp between 0 and 1000),
  created_at timestamptz not null default now(),
  primary key (user_id, client_ts)
);
alter table public.results enable row level security;
drop policy if exists "results_insert_own" on public.results;
create policy "results_insert_own" on public.results
  for insert with check (auth.uid() = user_id);
drop policy if exists "results_select_own" on public.results;
create policy "results_select_own" on public.results
  for select using (auth.uid() = user_id);
-- update/delete のポリシーは作らない = クライアントからは追記専用

create index if not exists results_date_idx on public.results (date);

-- ---- 小判台帳（append-only。残高は常にSUM(delta)） ----
create table if not exists public.point_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_seq int not null check (client_seq >= 0),  -- クライアント台帳内の連番（冪等キー）
  delta int not null check (delta between -100000 and 1000),
  source text not null check (source in
    ('workout','mission','week_goal','reward_ad','iap','unlock','adjust')),
  ref text check (char_length(ref) <= 64),
  client_at bigint,
  created_at timestamptz not null default now(),
  unique (user_id, client_seq)
);
alter table public.point_ledger enable row level security;
drop policy if exists "ledger_insert_own" on public.point_ledger;
create policy "ledger_insert_own" on public.point_ledger
  for insert with check (auth.uid() = user_id);
drop policy if exists "ledger_select_own" on public.point_ledger;
create policy "ledger_select_own" on public.point_ledger
  for select using (auth.uid() = user_id);

-- ---- 週間ランキング（R3） ----
-- EXP計算はクライアントと同一式: exp = 100 + round(8.0*60*(sec/3600)*1.05) + bonus_exp
-- 不正対策: 1ユーザー1日20件まで集計、忍び名を設定した人だけ掲載
-- security definer: 他人の行を集計するためRLSを跨ぐ（返すのは忍び名と集計値のみ）
create or replace function public.weekly_ranking(week text default null, limit_n int default 100)
returns table (rank bigint, ninja_name text, weekly_exp bigint, is_me boolean)
language sql
security definer
set search_path = public
as $$
  with capped as (
    select r.user_id, r.date, r.total_work_sec, r.bonus_exp,
           row_number() over (partition by r.user_id, r.date order by r.client_ts) as day_seq
    from results r
    where to_char(r.date::date, 'IYYY-IW') = coalesce(week, to_char((now() at time zone 'Asia/Tokyo')::date, 'IYYY-IW'))
  ),
  per_user as (
    select c.user_id,
           sum(100 + round(8.0 * 60 * (c.total_work_sec / 3600.0) * 1.05)::int + c.bonus_exp) as weekly_exp
    from capped c
    where c.day_seq <= 20
    group by c.user_id
  )
  select rank() over (order by p.weekly_exp desc) as rank,
         pr.ninja_name,
         p.weekly_exp,
         (p.user_id = auth.uid()) as is_me
  from per_user p
  join profiles pr on pr.id = p.user_id and pr.ninja_name <> ''
  order by p.weekly_exp desc
  limit limit_n;
$$;

-- 匿名ユーザー含むログイン済みユーザーだけが呼べる
revoke execute on function public.weekly_ranking from anon;
grant execute on function public.weekly_ranking to authenticated;
