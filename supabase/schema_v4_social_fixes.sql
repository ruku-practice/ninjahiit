-- =========================================================
-- NinjaHIIT クラウドスキーマ v4 — 審査前ソーシャル安全対応（2026-07-21）
-- 適用方法: Supabaseダッシュボード → SQL Editor → 全文貼り付け → Run
-- 何度実行しても安全。v1/v2/v3適用済みが前提
--
-- 内容:
--   1) FIX-1 なかま解除: remove_friend(target) RPC。双方向のfriends行を
--      security definerで削除する（friends_delete_ownポリシーは自分が
--      user_id側の行しか消せず、相手側の行を消せないため直接DELETEでは
--      片方向しか切れない。RPC側で両方向を消して初めて「縁を切る」になる）。
--      これにより以後の send_poke も not_friend で弾かれる＝つつき受信も止まる。
--   2) FIX-2 忍び名の非表示（ローカル）用: weekly_ranking に ninja_id を追加。
--      改名しても同一人物を非表示にし続けられるよう、忍び名の文字列ではなく
--      安定したID基準でクライアント側のhiddenリストを作れるようにする。
--      注意: あえて friend_code ではなく auth.users.id を返す。friend_code は
--      「知っていれば即なかま成立」に使われる値なので、番付（不特定多数に見える
--      画面）に載せると意図せず友達申請の起点を全員へ公開してしまうため避けた。
-- =========================================================

-- ---- 1) なかま解除（双方向） ----
create or replace function public.remove_friend(target uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return false; end if;
  delete from friends
    where (user_id = me and friend_id = target)
       or (user_id = target and friend_id = me);
  return true;
end $$;
revoke execute on function public.remove_friend from anon;
grant execute on function public.remove_friend to authenticated;

-- ---- 2) 週間ランキングに ninja_id（= auth.users.id）を追加 ----
-- 戻り値の型（列構成）が変わるため、まずdropしてから作り直す
drop function if exists public.weekly_ranking(text, int);

create or replace function public.weekly_ranking(week text default null, limit_n int default 100)
returns table (rank bigint, ninja_name text, weekly_exp bigint, is_me boolean, ninja_id uuid)
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
         (p.user_id = auth.uid()) as is_me,
         p.user_id as ninja_id
  from per_user p
  join profiles pr on pr.id = p.user_id and pr.ninja_name <> ''
  order by p.weekly_exp desc
  limit limit_n;
$$;

-- 匿名ユーザー含むログイン済みユーザーだけが呼べる（元のweekly_rankingと同じ権限方針）
revoke execute on function public.weekly_ranking from anon;
grant execute on function public.weekly_ranking to authenticated;
