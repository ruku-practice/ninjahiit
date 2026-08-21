-- =========================================================
-- NinjaHIIT 統計用スキーマ v1（tools/stats/ninjahiit_stats.py 用）
-- 適用方法: Supabaseダッシュボード → SQL Editor → 全文貼り付け → Run
-- 何度実行しても安全（or replace / revoke・grant のみ。データを消す文は無い）
--
-- 目的: auth.users（匿名サインインで自動作成されるアカウント）は PostgREST から
--       直接読めない（public スキーマしか公開されない）ため、集計に必要な列だけを
--       返す関数を public に置く。呼べるのは service_role のみ＝アプリの公開鍵からは呼べない。
-- 返す情報にメールアドレス・トークン等は一切含めない。
-- =========================================================

create or replace function public.admin_auth_users()
returns table (
  user_id uuid,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_anonymous boolean,
  provider text
)
language sql
security definer
set search_path = public
as $$
  select
    u.id as user_id,
    u.created_at,
    u.last_sign_in_at,
    -- 古いバージョンに is_anonymous 列が無くても壊れないよう jsonb 経由で読む
    coalesce((to_jsonb(u) ->> 'is_anonymous')::boolean, false) as is_anonymous,
    coalesce(u.raw_app_meta_data ->> 'provider', 'anonymous') as provider
  from auth.users u
  order by u.created_at;
$$;

-- 公開鍵（anon）・ログイン済みユーザー（authenticated）からは呼べないようにする。
-- 呼べるのは service_role＝ローカルの集計スクリプトだけ。
revoke all on function public.admin_auth_users() from public;
revoke all on function public.admin_auth_users() from anon;
revoke all on function public.admin_auth_users() from authenticated;
grant execute on function public.admin_auth_users() to service_role;

-- ---- 適用できたかの確認（任意・同じSQL Editorに貼って Run） ----
-- select count(*) as アカウント数 from public.admin_auth_users();
