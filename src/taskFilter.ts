/**
 * タスク検索（Dashboard 詳細フィルタ・クイックフィルタ）の共通ロジック。
 *
 * 役割：
 *   - `matchSubTask`     : 1 件の SubTask が TaskFilter に合致するか判定
 *   - `isFilterActive`   : フィルタが「何か絞っているか」判定（空フィルタ = false）
 *   - `resolveDate`      : DateFilter を YYYY-MM-DD 文字列に解決（'today' は北京時間で解決）
 *   - `EMPTY_FILTER`     : 何も絞らない初期値
 *   - `defaultQuickFilters` : 初回 seed 用の 3 件
 *   - `summarizeFilter`  : Settings 一覧で「期日=今日 / 状態:未着手・進行中…」のような要約を出すヘルパ
 */

import {
  DateFilter,
  ParentTask,
  Priority,
  QuickFilter,
  SubTask,
  SubTaskStatus,
  TaskFilter,
} from './types';
import { todayBeijing } from './dateUtils';

/* ============================================================
 * 定数
 * ============================================================ */

export const ALL_STATUSES: SubTaskStatus[] = [
  '未着手',
  '進行中',
  '保留',
  '済',
  '遅れ',
  '着手遅れ',
  '期限遅れ',
];

/** 「未完了のみ」ショートカット用：「済」以外。 */
export const UNDONE_STATUSES: SubTaskStatus[] = ALL_STATUSES.filter(s => s !== '済');

export const ALL_PRIORITIES: Priority[] = ['A', 'B', 'C'];

export const EMPTY_FILTER: TaskFilter = {
  keyword: '',
  dueDate: { enabled: false },
  finalDeadline: { enabled: false },
  startDate: { enabled: false },
  priorities: [],
  statuses: [],
  parentIds: [],
};

/* ============================================================
 * 解決
 * ============================================================ */

/** DateFilter を絶対日付（YYYY-MM-DD）に解決。enabled=false は null。 */
export function resolveDate(df: DateFilter): string | null {
  if (!df.enabled) return null;
  if (df.mode === 'today') return todayBeijing();
  return df.date;
}

/* ============================================================
 * 判定
 * ============================================================ */

/** 「何か絞っているか」判定。空フィルタなら false。 */
export function isFilterActive(f: TaskFilter): boolean {
  return (
    f.keyword.trim().length > 0 ||
    f.dueDate.enabled ||
    f.finalDeadline.enabled ||
    f.startDate.enabled ||
    f.priorities.length > 0 ||
    f.statuses.length > 0 ||
    f.parentIds.length > 0
  );
}

/** 1 件の SubTask が filter に合致するか判定。
 *  parent は親タスク（未取得なら undefined）。現状は parentIds 判定にしか使わない。 */
export function matchSubTask(
  t: SubTask,
  parent: ParentTask | undefined,
  f: TaskFilter,
): boolean {
  // キーワード（タスク名 + 備考に部分一致、大小無視）。
  if (f.keyword.trim()) {
    const kw = f.keyword.trim().toLowerCase();
    const hay = `${t.task_name ?? ''} ${t.remarks ?? ''}`.toLowerCase();
    if (!hay.includes(kw)) return false;
  }

  // 日付（完全一致）。空欄なら不一致扱い（タスクに日付が無いものは絞り対象外）。
  const due = resolveDate(f.dueDate);
  if (due !== null && t.due_date !== due) return false;

  const fin = resolveDate(f.finalDeadline);
  if (fin !== null && t.final_deadline !== fin) return false;

  const sta = resolveDate(f.startDate);
  if (sta !== null && t.start_date !== sta) return false;

  // 優先度・ステータス（空配列＝指定なし）。
  if (f.priorities.length > 0 && !f.priorities.includes(t.priority)) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(t.status)) return false;

  // 親案件（空配列＝指定なし）。
  if (f.parentIds.length > 0 && !f.parentIds.includes(t.parent_task_id)) return false;
  // 親が消えているタスクを絞り対象にしたくない場合はここで弾けるが、現状は parent 未参照で OK。
  void parent;

  return true;
}

/* ============================================================
 * 初回 seed: デフォルトのクイックフィルタ 3 件
 * ============================================================ */

const today: DateFilter = { enabled: true, mode: 'today' };

export function defaultQuickFilters(): QuickFilter[] {
  return [
    {
      id: 'default-due-today-undone',
      name: '今日が期日・未完',
      filter: {
        ...EMPTY_FILTER,
        dueDate: today,
        statuses: [...UNDONE_STATUSES],
      },
    },
    {
      id: 'default-final-today-undone',
      name: '今日が期限・未完',
      filter: {
        ...EMPTY_FILTER,
        finalDeadline: today,
        statuses: [...UNDONE_STATUSES],
      },
    },
    {
      id: 'default-priority-a-undone',
      name: '優先A・未完',
      filter: {
        ...EMPTY_FILTER,
        priorities: ['A'],
        statuses: [...UNDONE_STATUSES],
      },
    },
  ];
}

/* ============================================================
 * 表示用ヘルパ
 * ============================================================ */

/** Settings のクイックフィルタ一覧に出す要約。
 *  例: "期日=今日 / 状態:未着手・進行中・…" */
export function summarizeFilter(f: TaskFilter): string {
  const parts: string[] = [];

  if (f.keyword.trim()) parts.push(`キーワード"${f.keyword.trim()}"`);

  const dateLabel = (df: DateFilter): string => {
    if (!df.enabled) return '';
    return df.mode === 'today' ? '今日' : df.date;
  };

  if (f.dueDate.enabled) parts.push(`期日=${dateLabel(f.dueDate)}`);
  if (f.finalDeadline.enabled) parts.push(`期限=${dateLabel(f.finalDeadline)}`);
  if (f.startDate.enabled) parts.push(`開始日=${dateLabel(f.startDate)}`);

  if (f.priorities.length) parts.push(`優先度:${f.priorities.join('・')}`);
  if (f.statuses.length) {
    // 多すぎるときは要約。
    const shown =
      f.statuses.length > 3 ? `${f.statuses.slice(0, 3).join('・')}…` : f.statuses.join('・');
    parts.push(`状態:${shown}`);
  }
  if (f.parentIds.length) parts.push(`案件 ${f.parentIds.length} 件`);

  return parts.join(' / ') || '条件なし';
}
