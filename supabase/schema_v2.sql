-- =========================================================
-- NinjaHIIT クラウドスキーマ v2 — なかま（友達）＆つつき（手裏剣）
-- 適用方法: Supabaseダッシュボード → SQL Editor → 全文貼り付け → Run
-- 何度実行しても安全（if not exists / or replace）。v1(schema.sql)適用済みが前提
-- =========================================================

-- ---- 忍びコード（友達追加用の6文字コード） ----
alter table public.profiles add column if not exists friend_code text unique;

-- 紛らわしい文字(0/O/1/I/L)を除いた6文字コードを採番
create or replace function public.gen_friend_code() returns text
language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  tries int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
    tries := tries + 1;
    exit when tries > 20;
  end loop;
  return code;
end $$;

-- 既存プロフィールにコードを付与＋新規は自動採番
update public.profiles set friend_code = public.gen_friend_code() where friend_code is null;

create or replace function public.set_friend_code() returns trigger
language plpgsql as $$
begin
  if new.friend_code is null then new.friend_code := public.gen_friend_code(); end if;
  return new;
end $$;
drop trigger if exists profiles_friend_code on public.profiles;
create trigger profiles_friend_code before insert on public.profiles
  for each row execute function public.set_friend_code();

-- ---- なかま（相互フォロー。成立時に双方向2行を挿入） ----
create table if not exists public.friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
alter table public.friends enable row level security;
drop policy if exists "friends_select_own" on public.friends;
create policy "friends_select_own" on public.friends
  for select using (auth.uid() = user_id);
drop policy if exists "friends_delete_own" on public.friends;
create policy "friends_delete_own" on public.friends
  for delete using (auth.uid() = user_id);
-- insertはRPC経由のみ（コード検証つき）

-- ---- つつき（手裏剣）。msg_idxはアプリ内の定型文の番号 ----
create table if not exists public.pokes (
  id bigint generated always as identity primary key,
  from_id uuid not null references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  msg_idx int not null default 0 check (msg_idx between 0 and 9),
  jst_date text not null,   -- 送信日(JST) — 1日1回/相手 の制約キー
  seen boolean not null default false,
  created_at timestamptz not null default now(),
  unique (from_id, to_id, jst_date)
);
alter table public.pokes enable row level security;
drop policy if exists "pokes_select_mine" on public.pokes;
create policy "pokes_select_mine" on public.pokes
  for select using (auth.uid() = to_id or auth.uid() = from_id);
drop policy if exists "pokes_mark_seen" on public.pokes;
create policy "pokes_mark_seen" on public.pokes
  for update using (auth.uid() = to_id) with check (auth.uid() = to_id);
-- insertはRPC経由のみ（友達関係の検証つき）

-- ---- RPC: コードでなかま追加（相互成立） ----
create or replace function public.add_friend_by_code(code text)
returns table (ok boolean, friend_name text)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  target record;
begin
  if me is null then return query select false, ''::text; return; end if;
  select id, ninja_name into target from profiles
    where friend_code = upper(trim(code)) and id <> me;
  if target.id is null then return query select false, ''::text; return; end if;
  insert into friends (user_id, friend_id) values (me, target.id) on conflict do nothing;
  insert into friends (user_id, friend_id) values (target.id, me) on conflict do nothing;
  return query select true, coalesce(nullif(target.ninja_name, ''), '名無しの忍び');
end $$;
revoke execute on function public.add_friend_by_code from anon;
grant execute on function public.add_friend_by_code to authenticated;

-- ---- RPC: なかまの今週ボード ----
create or replace function public.friends_board()
returns table (friend_id uuid, ninja_name text, weekly_exp bigint, done_today boolean)
language sql security definer set search_path = public as $$
  with my_friends as (
    select f.friend_id from friends f where f.user_id = auth.uid()
  ),
  wk as (
    select r.user_id,
           sum(100 + round(8.0 * 60 * (r.total_work_sec / 3600.0) * 1.05)::int + r.bonus_exp) as weekly_exp,
           bool_or(r.date = to_char((now() at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD')) as done_today
    from results r
    where to_char(r.date::date, 'IYYY-IW') = to_char((now() at time zone 'Asia/Tokyo')::date, 'IYYY-IW')
      and r.user_id in (select friend_id from my_friends)
    group by r.user_id
  )
  select mf.friend_id,
         coalesce(nullif(pr.ninja_name, ''), '名無しの忍び') as ninja_name,
         coalesce(w.weekly_exp, 0) as weekly_exp,
         coalesce(w.done_today, false) as done_today
  from my_friends mf
  join profiles pr on pr.id = mf.friend_id
  left join wk w on w.user_id = mf.friend_id
  order by weekly_exp desc;
$$;
revoke execute on function public.friends_board from anon;
grant execute on function public.friends_board to authenticated;

-- ---- RPC: 手裏剣を投げる（1日1回/相手） ----
create or replace function public.send_poke(target uuid, msg int default 0)
returns text  -- 'ok' | 'not_friend' | 'already_today' | 'error'
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  today text := to_char((now() at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD');
begin
  if me is null then return 'error'; end if;
  if not exists (select 1 from friends where user_id = me and friend_id = target) then
    return 'not_friend';
  end if;
  begin
    insert into pokes (from_id, to_id, msg_idx, jst_date) values (me, target, msg, today);
  exception when unique_violation then
    return 'already_today';
  end;
  return 'ok';
end $$;
revoke execute on function public.send_poke from anon;
grant execute on function public.send_poke to authenticated;

-- ---- RPC: 未読の手裏剣（送り主の忍び名つき）を取得 ----
create or replace function public.unseen_pokes()
returns table (poke_id bigint, from_name text, msg_idx int, created_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, coalesce(nullif(pr.ninja_name, ''), '名無しの忍び'), p.msg_idx, p.created_at
  from pokes p
  join profiles pr on pr.id = p.from_id
  where p.to_id = auth.uid() and p.seen = false
  order by p.created_at;
$$;
revoke execute on function public.unseen_pokes from anon;
grant execute on function public.unseen_pokes to authenticated;
