import cloudbase from '@cloudbase/js-sdk';

// CloudBase（腾讯云开发）環境 ID。
// vite.config.ts の define 経由で process.env.TCB_ENV_ID に注入される（GEMINI_API_KEY と同じ仕組み）。
const envId = process.env.TCB_ENV_ID;

if (!envId) {
  console.warn(
    '[CloudBase] TCB_ENV_ID が設定されていません。.env に TCB_ENV_ID="<環境ID>" を設定してください。',
  );
}

export const app = cloudbase.init({
  env: envId || '',
});

// 認証インスタンス（メール/パスワード・メール認証コード・匿名ログイン）
export const auth = app.auth();

// データベースインスタンス（ドキュメント型 DB）
export const db = app.database();

export default app;
