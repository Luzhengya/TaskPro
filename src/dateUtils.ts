/** 日付ユーティリティ（遅延シフト・表示整形の共有ロジック）。 */

/** YYYY-MM-DD を YYYY/MM/DD 表示へ。空なら "—"。 */
export function fmtDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return dateStr.replace(/-/g, '/');
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
