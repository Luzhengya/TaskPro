/** 日付ユーティリティ（遅延シフト・表示整形の共有ロジック）。 */

/** YYYY-MM-DD を YYYY/MM/DD 表示へ。空なら "—"。 */
export function fmtDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return dateStr.replace(/-/g, '/');
}

/**
 * 「今日」の日付を **北京時間（CST, UTC+8）固定**で YYYY-MM-DD 文字列として返す。
 *
 *  - 端末のタイムゾーンには依存しない（JST=UTC+9 / PST=UTC-8 / どこから見ても同じ基準）。
 *  - 実装は「現在 UTC ミリ秒 + 8 時間 → その値を UTC 分量として読み出す」方式。
 *    Date オブジェクトをタイムゾーン付きでは扱えない JS の制約を吸収する常套手段。
 *  - `Date.toISOString()` をそのまま使うと UTC 日付になり、北京/東京ではまだ
 *    当日でも UTC 上は前日 → 「定例作業の自動表示」「日報の既定日」が 1 日ずれる。
 *    これを避けるための統一ユーティリティ。
 */
export function todayBeijing(): string {
  const beijingMs = Date.now() + 8 * 60 * 60 * 1000;
  const d = new Date(beijingMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * YYYY-M-D を YYYY-MM-DD へゼロ埋めする（文字列比較で日付の前後を正しく判定するため）。
 * インポート由来の "2026-6-9" と <input type="date"> の "2026-06-09" を揃える。
 */
export function normalizeDate(d?: string): string {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  const [y, m, day] = parts;
  return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * 日付文字列に営業日（土日を飛ばす）を加算する。
 * 遅延の影響日数シフトに使用。空・不正な日付・0日以下はそのまま返す。
 */
export function addBusinessDays(dateStr: string | undefined, days: number): string {
  if (!dateStr) return dateStr ?? '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++; // 日曜(0)・土曜(6)を飛ばす
  }
  return d.toISOString().split('T')[0];
}
