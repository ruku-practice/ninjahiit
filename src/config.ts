// クラウド接続設定（13_リッチ化設計書.md §3）。
// 空文字のままならアプリは今まで通り完全ローカルで動く（ローカルファースト原則）。
// Supabaseプロジェクト作成後にURL/anonKeyを入れ、@supabase/supabase-js を導入して有効化する。
// anonKeyは公開前提の鍵（RLSで守る）なのでリポジトリに入れてよい。

export const SUPABASE = {
  url: "",      // 例: "https://xxxx.supabase.co"
  anonKey: "",
};

export const cloudEnabled = () => !!(SUPABASE.url && SUPABASE.anonKey);
