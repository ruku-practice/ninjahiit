// クラウド接続設定（13_リッチ化設計書.md §3）。
// 空文字のままならアプリは今まで通り完全ローカルで動く（ローカルファースト原則）。
// Supabaseプロジェクト作成後にURL/anonKeyを入れ、@supabase/supabase-js を導入して有効化する。
// anonKeyは公開前提の鍵（RLSで守る）なのでリポジトリに入れてよい。

export const SUPABASE = {
  url: "https://uaopmxqqjjwfwgpglsyj.supabase.co",
  // Publishable key（公開可・RLSが実際の守り）。Secret keyは絶対にここへ書かない
  anonKey: "sb_publishable_d3VVWMU84CQs4l1Fpp03tw_DrWEnMrP",
};

export const cloudEnabled = () => !!(SUPABASE.url && SUPABASE.anonKey);

// supabase-jsがセッションを保存するlocalStorageキー（ネイティブのPreferencesバックアップ対象）
export const authStorageKey = () =>
  `sb-${new URL(SUPABASE.url).hostname.split(".")[0]}-auth-token`;
