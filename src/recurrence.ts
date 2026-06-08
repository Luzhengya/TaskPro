/**
 * 定例作業（繰り返しタスク）のルール判定・整形ユーティリティ。
 *
 *  - matchesRecurrence : 指定日（YYYY-MM-DD）がルールに該当するか
 *  - formatRecurrence  : ルールを日本語ラベルへ（例「毎週 月・水」）
 *
 * 日付は「カレンダー上の年月日」だけを見る（タイムゾーン非依存）。
 * todayBeijing() などで得た YYYY-MM-DD をそのまま渡せばよい。
 */

import { RecurrenceRule } from './types';

/** 曜日ラベル（0=日 … 6=土）。JS の Date.getDay() と同じ並び。 */
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** YYYY-MM-DD をローカル Date（その暦日の 0:00）に変換。タイムゾーン非依存に年月日を読むため。 */
function ymdToLocalDate(ymd: string): Date | null {
  const parts = ymd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}

/** 指定日（YYYY-MM-DD）が繰り返しルールに該当するか。 */
export function matchesRecurrence(rule: RecurrenceRule, ymd: string): boolean {
  const date = ymdToLocalDate(ymd);
  if (!date) return false;
  switch (rule.kind) {
    case 'daily':
      return true;
    case 'weekly':
      return rule.weekdays.includes(date.getDay());
    case 'monthly':
      return rule.days.includes(date.getDate());
  }
}

/** ルールを日本語ラベルへ。空配列など不正値はフォールバックする。 */
export function formatRecurrence(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case 'daily':
      return '毎日';
    case 'weekly': {
      if (rule.weekdays.length === 0) return '毎週';
      const labels = [...rule.weekdays]
        .sort((a, b) => a - b)
        .map(w => WEEKDAY_LABELS[w] ?? '?')
        .join('・');
      return `毎週 ${labels}`;
    }
    case 'monthly': {
      if (rule.days.length === 0) return '毎月';
      const labels = [...rule.days].sort((a, b) => a - b).join('・');
      return `毎月 ${labels}日`;
    }
  }
}
