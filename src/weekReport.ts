/**
 * 週報モードの「週分段」ロジック。
 *
 * タスクの期間 [開始日, 期日] が各週 [月曜, 日曜] と重なるかで分類する。
 * 跨週タスクは重なる全ての週に重複表示される。
 *
 *  - 先週 / 今週 / 来週 の 3 週（月曜始まり）
 *  - 完全な日付（開始日・期日の両方）を持たないタスクは「異常」として分離
 *  - 完全だが 3 週いずれにも重ならないものは「その他」へ
 */

import { Priority, SubTask } from './types';
import { normalizeDate, todayBeijing } from './dateUtils';

/** YYYY-MM-DD に暦日 n 日を加減（営業日ではなく単純なカレンダー日）。 */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 指定日を含む週の月曜日（月曜始まり）。 */
function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=日 … 6=土
  const offset = (dow + 6) % 7;               // 月曜まで戻る日数
  return addDays(ymd, -offset);
}

/** 「6/2〜6/8」形式のラベル。 */
function rangeLabel(monday: string, sunday: string): string {
  const fmt = (s: string) => {
    const [, m, d] = s.split('-');
    return `${Number(m)}/${Number(d)}`;
  };
  return `${fmt(monday)}〜${fmt(sunday)}`;
}

export type WeekKey = 'prev' | 'current' | 'next' | 'other';

export interface WeekSegment {
  key: WeekKey;
  label: string;
  rangeLabel: string; // other は空文字
  monday: string;     // other は空文字
  sunday: string;     // other は空文字
}

/** 先週・今週・来週の 3 セグメントを返す（月曜始まり）。 */
export function getWeekSegments(today?: string): WeekSegment[] {
  const t = today ?? todayBeijing();
  const curMon = mondayOf(t);
  const prevMon = addDays(curMon, -7);
  const nextMon = addDays(curMon, 7);
  const seg = (key: WeekKey, label: string, mon: string): WeekSegment => {
    const sun = addDays(mon, 6);
    return { key, label, monday: mon, sunday: sun, rangeLabel: rangeLabel(mon, sun) };
  };
  return [
    seg('prev', '先週', prevMon),
    seg('current', '今週', curMon),
    seg('next', '来週', nextMon),
  ];
}

/** 開始日・期日の両方を持つか。 */
export function hasCompleteDates(t: SubTask): boolean {
  return !!normalizeDate(t.start_date) && !!normalizeDate(t.due_date);
}

/** タスク [開始日, 期日] が週 [mon, sun] と重なるか。 */
function overlapsWeek(t: SubTask, mon: string, sun: string): boolean {
  const s = normalizeDate(t.start_date);
  const d = normalizeDate(t.due_date);
  if (!s || !d) return false;
  return s <= sun && d >= mon;
}

export interface WeeklyGroup {
  segment: WeekSegment;
  tasks: SubTask[];
}

export interface WeeklyGrouping {
  /** 日付が不完全（開始日 or 期日 が空）＝異常。最上部に提示する。 */
  anomalies: SubTask[];
  /** 空でない週グループ（先週/今週/来週/その他の順）。 */
  groups: WeeklyGroup[];
}

/** 子タスク群を週ごとに分段する。 */
export function groupSubTasksByWeek(subs: SubTask[], today?: string): WeeklyGrouping {
  const segments = getWeekSegments(today);
  const anomalies: SubTask[] = [];
  const other: SubTask[] = [];
  const buckets = new Map<WeekKey, SubTask[]>();
  segments.forEach(s => buckets.set(s.key, []));

  for (const t of subs) {
    if (!hasCompleteDates(t)) {
      anomalies.push(t);
      continue;
    }
    let matched = false;
    for (const s of segments) {
      if (overlapsWeek(t, s.monday, s.sunday)) {
        buckets.get(s.key)!.push(t);
        matched = true;
      }
    }
    if (!matched) other.push(t);
  }

  const otherSegment: WeekSegment = {
    key: 'other',
    label: 'その他',
    rangeLabel: '',
    monday: '',
    sunday: '',
  };

  const groups: WeeklyGroup[] = [
    ...segments.map(s => ({ segment: s, tasks: buckets.get(s.key)! })),
    { segment: otherSegment, tasks: other },
  ].filter(g => g.tasks.length > 0);

  return { anomalies, groups };
}

/* ============================================================
 * 本週・来週の優先度別件数の集計（週報モードのヘッダ表示用）
 * ============================================================ */

export type PriorityCount = Record<Priority, number>;
export interface WeekPriorityStats {
  current: PriorityCount; // 今週
  next: PriorityCount;    // 来週
}

/** 与えられた全子タスクから、今週・来週それぞれの優先度別件数を集計する。
 *  跨週タスクは重なる週の両方にカウントされる（表示と整合）。
 *  日付不完全なタスクは集計対象外。 */
export function computeWeekPriorityStats(subs: SubTask[], today?: string): WeekPriorityStats {
  const segments = getWeekSegments(today);
  const current = segments.find(s => s.key === 'current')!;
  const next = segments.find(s => s.key === 'next')!;
  const empty = (): PriorityCount => ({ A: 0, B: 0, C: 0 });
  const stats: WeekPriorityStats = { current: empty(), next: empty() };

  for (const t of subs) {
    if (!hasCompleteDates(t)) continue;
    const pri = t.priority;
    if (pri !== 'A' && pri !== 'B' && pri !== 'C') continue;
    if (overlapsWeek(t, current.monday, current.sunday)) stats.current[pri]++;
    if (overlapsWeek(t, next.monday, next.sunday)) stats.next[pri]++;
  }
  return stats;
}
