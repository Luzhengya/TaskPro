/**
 * FilterForm
 *
 * Dashboard の「詳細フィルタ」パネルと Settings の「クイックフィルタ編集モーダル」で
 * 共通利用される表単。controlled component。
 *
 * フィールド：
 *  - キーワード（タスク名 + 備考の部分一致）
 *  - 期日 / 期限 / 開始日：各々 enable toggle + 「今日（動的）/ 固定日」切替 + 日付ピッカー
 *  - 優先度（複数選択）
 *  - ステータス（複数選択 + 「未完了のみ」ショートカット）
 *  - 親案件（複数選択）
 *
 * 「適用」「保存」などのアクションボタンは含めず、呼び出し側で表示する（フッタ操作は文脈で異なるため）。
 */

import React from 'react';
import { ParentTask, Priority, SubTaskStatus, TaskFilter, DateFilter } from '../types';
import { ALL_PRIORITIES, ALL_STATUSES, UNDONE_STATUSES } from '../taskFilter';
import { todayBeijing } from '../dateUtils';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FilterFormProps {
  value: TaskFilter;
  onChange: (next: TaskFilter) => void;
  /** 親案件選択用のリスト。 */
  parentTasks: ParentTask[];
  /** クイックフィルタ編集モードのときに true にすると日付欄の既定モードを '今日（動的）' にする。
   *  Dashboard の即席フィルタは固定日（今日）が直感的なので false でよい。 */
  preferDynamicToday?: boolean;
}

const DATE_LABELS: { key: 'dueDate' | 'finalDeadline' | 'startDate'; label: string }[] = [
  { key: 'dueDate', label: '期日' },
  { key: 'finalDeadline', label: '期限' },
  { key: 'startDate', label: '開始日' },
];

export const FilterForm: React.FC<FilterFormProps> = ({
  value,
  onChange,
  parentTasks,
  preferDynamicToday = false,
}) => {
  const update = (patch: Partial<TaskFilter>) => onChange({ ...value, ...patch });

  /* ---------------- 日付欄 ---------------- */

  const toggleDate = (key: 'dueDate' | 'finalDeadline' | 'startDate') => {
    const current = value[key];
    if (current.enabled) {
      update({ [key]: { enabled: false } as DateFilter });
    } else {
      update({
        [key]: preferDynamicToday
          ? { enabled: true, mode: 'today' }
          : { enabled: true, mode: 'fixed', date: todayBeijing() },
      } as Partial<TaskFilter>);
    }
  };

  const setDateMode = (
    key: 'dueDate' | 'finalDeadline' | 'startDate',
    mode: 'today' | 'fixed',
  ) => {
    const current = value[key];
    if (!current.enabled) return;
    update({
      [key]:
        mode === 'today'
          ? { enabled: true, mode: 'today' }
          : {
              enabled: true,
              mode: 'fixed',
              date: current.mode === 'fixed' ? current.date : todayBeijing(),
            },
    } as Partial<TaskFilter>);
  };

  const setFixedDate = (
    key: 'dueDate' | 'finalDeadline' | 'startDate',
    date: string,
  ) => {
    update({ [key]: { enabled: true, mode: 'fixed', date } } as Partial<TaskFilter>);
  };

  /* ---------------- 配列フィールドの toggle ---------------- */

  const togglePriority = (p: Priority) => {
    update({
      priorities: value.priorities.includes(p)
        ? value.priorities.filter(x => x !== p)
        : [...value.priorities, p],
    });
  };

  const toggleStatus = (s: SubTaskStatus) => {
    update({
      statuses: value.statuses.includes(s)
        ? value.statuses.filter(x => x !== s)
        : [...value.statuses, s],
    });
  };

  const toggleParent = (id: string) => {
    update({
      parentIds: value.parentIds.includes(id)
        ? value.parentIds.filter(x => x !== id)
        : [...value.parentIds, id],
    });
  };

  /* ---------------- スタイル定数 ---------------- */
  const SECTION_LABEL = 'block text-xs font-bold text-[#1d1d1f] mb-2';
  const CHIP_BASE =
    'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors border';
  const CHIP_OFF = 'border-gray-200 text-[#86868b] hover:border-gray-300 hover:bg-gray-50';
  const CHIP_ON = 'border-[#007aff] bg-[#007aff]/10 text-[#007aff]';

  return (
    <div className="space-y-4">
      {/* キーワード */}
      <div>
        <label className={SECTION_LABEL}>キーワード</label>
        <input
          type="text"
          value={value.keyword}
          onChange={(e) => update({ keyword: e.target.value })}
          placeholder="タスク名・備考で検索..."
          className="mac-input w-full text-sm"
        />
      </div>

      {/* 日付 3 欄 */}
      {DATE_LABELS.map(({ key, label }) => {
        const df = value[key];
        return (
          <div key={key}>
            <div className="flex items-center justify-between mb-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={df.enabled}
                  onChange={() => toggleDate(key)}
                  className="w-4 h-4 accent-[#007aff] flex-shrink-0"
                />
                <span className="text-xs font-bold text-[#1d1d1f]">{label}</span>
              </label>
              {df.enabled && (
                <div className="flex items-center gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setDateMode(key, 'today')}
                    className={cn(
                      'px-2 py-0.5 rounded font-bold transition-colors',
                      df.mode === 'today'
                        ? 'bg-[#007aff] text-white'
                        : 'text-[#86868b] hover:text-[#1d1d1f]',
                    )}
                  >
                    今日（動的）
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateMode(key, 'fixed')}
                    className={cn(
                      'px-2 py-0.5 rounded font-bold transition-colors',
                      df.mode === 'fixed'
                        ? 'bg-[#007aff] text-white'
                        : 'text-[#86868b] hover:text-[#1d1d1f]',
                    )}
                  >
                    固定日
                  </button>
                </div>
              )}
            </div>
            {df.enabled && (
              <input
                type="date"
                disabled={df.mode === 'today'}
                value={df.mode === 'today' ? todayBeijing() : df.date}
                onChange={(e) => setFixedDate(key, e.target.value)}
                className={cn(
                  'mac-input w-full text-sm',
                  df.mode === 'today' && 'opacity-60 cursor-not-allowed',
                )}
                title={
                  df.mode === 'today'
                    ? '「今日（動的）」は実行時の北京時間で自動解決されます。日付を選びたい場合は「固定日」に切替'
                    : undefined
                }
              />
            )}
          </div>
        );
      })}

      {/* 優先度 */}
      <div>
        <label className={SECTION_LABEL}>
          優先度{' '}
          <span className="font-normal text-[#86868b]">（複数選択可。未選択 = 全部）</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_PRIORITIES.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => togglePriority(p)}
              className={cn(CHIP_BASE, value.priorities.includes(p) ? CHIP_ON : CHIP_OFF)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* ステータス */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-bold text-[#1d1d1f]">
            ステータス{' '}
            <span className="font-normal text-[#86868b]">（複数選択可。未選択 = 全部）</span>
          </label>
          <button
            type="button"
            onClick={() => update({ statuses: [...UNDONE_STATUSES] })}
            className="text-[10px] font-bold text-[#007aff] hover:underline"
            title="「済」以外を一括選択"
          >
            未完了のみ ▸
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              className={cn(CHIP_BASE, value.statuses.includes(s) ? CHIP_ON : CHIP_OFF)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 親案件 */}
      <div>
        <label className={SECTION_LABEL}>
          親案件{' '}
          <span className="font-normal text-[#86868b]">
            （複数選択可。未選択 = 全部 / 選択 {value.parentIds.length} 件）
          </span>
        </label>
        {parentTasks.length === 0 ? (
          <p className="text-[10px] text-[#86868b] italic">案件がありません。</p>
        ) : (
          <div className="max-h-32 overflow-auto rounded-lg border border-gray-200 p-2 space-y-0.5 bg-white">
            {parentTasks.map(p => (
              <label
                key={p.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-1.5 py-1 rounded text-xs"
              >
                <input
                  type="checkbox"
                  checked={value.parentIds.includes(p.id)}
                  onChange={() => toggleParent(p.id)}
                  className="w-4 h-4 accent-[#007aff] flex-shrink-0"
                />
                <span className="truncate flex-1" title={p.name}>{p.name}</span>
                {p.type === 'meeting' && (
                  <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-700 flex-shrink-0">
                    定例
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
