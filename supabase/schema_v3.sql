-- =========================================================
-- NinjaHIIT クラウドスキーマ v3 — ウィジェット用の公開ステータスRPC
-- 適用方法: Supabaseダッシュボード → SQL Editor → 全文貼り付け → Run
-- 何度実行しても安全。v1/v2適用済みが前提
--
-- 背景: 無料のApple IDではApp Groups(アプリ⇄ウィジェットのデータ共有)が
-- 使えないため、ウィジェットは「忍びコード」を設定に入れてもらい、
-- このRPCから連続日数・今日の実施状況を直接取得する。
-- 返すのは なかま にも見えている情報（今週EXP・今日の実施）＋連続日数のみ。
-- =========================================================

create or replace function public.widget_state(code text)
returns table (streak int, done_today boolean, weekly_exp bigint)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  today date := (now() at time zone 'Asia/Tokyo')::date;
  d date;
  s int := 0;
begin
  select id into uid from profiles where friend_code = upper(trim(code));
  if uid is null then return; end if;

  -- 連続日数：今日未実施なら昨日を起点に遡る（アプリ側streakDays()と同じ考え方。
  -- お守りで守った日はローカルのみの情報のためサーバー値には含まれない）
  d := today;
  if not exists (select 1 from results r where r.user_id = uid and r.date = to_char(today, 'YYYY-MM-DD')) then
    d := today - 1;
  end if;
  while exists (select 1 from results r where r.user_id = uid and r.date = to_char(d, 'YYYY-MM-DD')) loop
    s := s + 1;
    d := d - 1;
    exit when s > 3650;
  end loop;

  return query select
    s,
    exists (select 1 from results r where r.user_id = uid and r.date = to_char(today, 'YYYY-MM-DD')),
    coalesce((
      select sum(100 + round(8.0 * 60 * (r.total_work_sec / 3600.0) * 1.05)::int + r.bonus_exp)
      from results r
      where r.user_id = uid
        and to_char(r.date::date, 'IYYY-IW') = to_char(today, 'IYYY-IW')
    ), 0)::bigint;
end $$;

-- ウィジェットはサインインできないため anon にも許可（コードを知っている人だけが引ける）
grant execute on function public.widget_state to anon;
grant execute on function public.widget_state to authenticated;
