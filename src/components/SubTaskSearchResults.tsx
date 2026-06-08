/**
 * SubTaskSearchResults
 *
 * Dashboard 検索が active のときに、案件カード/テーブルの代わりに表示する
 * 「マッチしたタスク」の扁平リスト。
 *
 *   - 列：[親案件名] [icon] [タスク名] [ステータス] [優先度] [期日] [期限] [予定/実績]
 *   - 行クリック → onJump(task) で親案件 SubTaskManagement へジャンプ
 *   - 親が消えていたら（parentMap に無い）行をジャンプ不可（取り消し線・グレー）にする
 *   - モバイル：表ではなくコンパクトカード表示
 */

import React, { useEffect, useRef } from 'react';
import { ParentTask, Priority, SubTask, SubTaskStatus } from '../types';
import { fmtDate } from '../dateUtils';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Inbox } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const STATUS_PILL: Record<SubTaskStatus, string> = {
  遅れ: 'bg-red-100 text-red-700',
  済: 'bg-gray-100 text-gray-600',
  進行中: 'bg-blue-100 text-blue-700',
  未着手: 'bg-gray-100 text-gray-700',
  保留: 'bg-yellow-100 text-yellow-700',
  着手遅れ: 'bg-orange-50 text-orange-600',
  期限遅れ: 'bg-red-200 text-red-800',
};

const PRIORITY_PILL: Record<Priority, { label: string; cls: string }> = {
  A: { label: '高', cls: 'bg-red-100 text-red-700' },
  B: { label: '中', cls: 'bg-amber-100 text-amber-700' },
  C: { label: '低', cls: 'bg-gray-100 text-gray-600' },
};

const TaskIcon: React.FC<{ iconData?: string }> = ({ iconData }) => {
  if (!iconData || !iconData.trim()) return null;
  if (iconData.startsWith('<')) {
    return (
      <div
        className="w-4 h-4 flex-shrink-0"
        dangerouslySetInnerHTML={{ __html: iconData }}
      />
    );
  }
  return <span className="text-sm flex-shrink-0">{iconData}</span>;
};

interface Props {
  tasks: SubTask[];
  parentMap: Map<string, ParentTask>;
  /** 行クリック時のジャンプ。親が無い場合は呼ばれない（行自体が不活性）。 */
  onJump: (task: SubTask) => void;
  /**
   * 表示モード。デフォルト 'search' は検索結果用（開始日列なし、予定/実績の合算表示）。
   * 'start_near' は「開始間近」タブ用 → 開始日を明示、実績は非表示（未着手前提）。
   * 'final_deadline_near' は「期日間近」タブ用 → 開始日 + 予定 + 実績 を全部出す。
   */
  mode?: 'search' | 'start_near' | 'final_deadline_near';
  /** 空のときに表示する補助メッセージ。 */
  emptyHint?: string;
  /**
   * 「直前にクリックしたタスク」へスクロールして一時的にハイライトする。
   * 子タスク画面から戻ってきたとき、リスト内の位置を維持するために使う。
   * 値が変わるたびに scrollIntoView と短いハイライト演出を再トリガする。
   */
  scrollToTaskId?: string | null;
}

export const SubTaskSearchResults: React.FC<Props> = ({
  tasks,
  parentMap,
  onJump,
  mode = 'search',
  emptyHint,
  scrollToTaskId,
}) => {
  const showStartDate = mode === 'start_near' || mode === 'final_deadline_near';
  // 開始間近は未着手前提なので実績は出さない（紛らわしい 0h を避ける）。
  const showActualHours = mode !== 'start_near';

  // scrollToTaskId に該当する行をビューに入れる。
  // 1 フレーム待ってからスクロールするのは、初回マウント直後だと DOM レイアウトが
  // 確定していないことがあるため。tasks が更新されたらもう一度走る。
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scrollToTaskId) return;
    const root = rootRef.current;
    if (!root) return;
    const id = requestAnimationFrame(() => {
      const target = root.querySelector<HTMLElement>(`[data-task-row-id="${scrollToTaskId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [scrollToTaskId, tasks]);
  if (tasks.length === 0) {
    return (
      <div className="mac-card py-16 text-center">
        <Inbox className="mx-auto text-gray-300 mb-3" size={36} />
        <p className="text-sm text-[#86868b] italic">
          {emptyHint ?? '条件に一致するタスクがありません。'}
        </p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="mac-card overflow-hidden">
      {/* デスクトップ：テーブル */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-left border-separate border-spacing-0 min-w-[1000px]">
          <thead className="bg-gray-50">
            <tr>
              <Th>親案件</Th>
              <Th>タスク名</Th>
              <Th>ステータス</Th>
              <Th>優先度</Th>
              {showStartDate && <Th>開始日</Th>}
              <Th>期日</Th>
              <Th>期限</Th>
              <Th>{showActualHours ? '予定 / 実績' : '予定'}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {tasks.map(t => {
              const parent = parentMap.get(t.parent_task_id);
              const clickable = !!parent;
              const isScrollTarget = scrollToTaskId === t.id;
              return (
                <tr
                  key={t.id}
                  data-task-row-id={t.id}
                  onClick={clickable ? () => onJump(t) : undefined}
                  className={cn(
                    'transition-colors',
                    clickable ? 'cursor-pointer hover:bg-blue-50/30' : 'cursor-not-allowed opacity-60',
                    // 戻り先ハイライト：薄い背景＋左ボーダーで「これだよ」を 0.5 秒くらい目立たせる
                    isScrollTarget && 'bg-blue-50/60',
                  )}
                  title={!clickable ? 'このタスクのプロジェクトは削除されています' : undefined}
                >
                  <Td>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {parent?.type === 'meeting' && (
                        <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-700 flex-shrink-0">
                          定例
                        </span>
                      )}
                      {parent?.is_hidden && (
                        <span className="text-[9px] px-1 rounded bg-gray-100 text-[#86868b] flex-shrink-0">
                          履歴
                        </span>
                      )}
                      <span
                        className={cn(
                          'truncate text-sm',
                          parent ? 'text-[#1d1d1f]' : 'text-gray-400 italic line-through',
                        )}
                        title={parent?.name || '(削除されたプロジェクト)'}
                      >
                        {parent?.name || '(削除されたプロジェクト)'}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2 min-w-0">
                      <TaskIcon iconData={t.icon_data} />
                      <span className="truncate text-sm font-medium" title={t.task_name}>
                        {t.task_name}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold',
                        STATUS_PILL[t.status],
                      )}
                    >
                      {t.status}
                    </span>
                  </Td>
                  <Td>
                    {t.priority && PRIORITY_PILL[t.priority] && (
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold',
                          PRIORITY_PILL[t.priority].cls,
                        )}
                      >
                        {PRIORITY_PILL[t.priority].label}
                      </span>
                    )}
                  </Td>
                  {showStartDate && (
                    <Td>
                      <span
                        className={cn(
                          'tabular-nums text-xs',
                          t.status === '着手遅れ' && 'text-orange-600 font-bold',
                        )}
                      >
                        {fmtDate(t.start_date)}
                      </span>
                    </Td>
                  )}
                  <Td>
                    <span
                      className={cn(
                        'tabular-nums text-xs',
                        t.status === '遅れ' && 'text-red-600 font-bold',
                      )}
                    >
                      {fmtDate(t.due_date)}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        'tabular-nums text-xs',
                        t.status === '期限遅れ' && 'text-red-600 font-bold',
                      )}
                    >
                      {fmtDate(t.final_deadline)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs tabular-nums whitespace-nowrap">
                      <span className="text-[#1d1d1f] font-semibold">{t.planned_hours}h</span>
                      {showActualHours && (
                        <>
                          <span className="text-[#86868b] mx-1">/</span>
                          <span className="text-[#007aff] font-semibold">{t.actual_hours ?? 0}h</span>
                        </>
                      )}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* モバイル：コンパクトカードのリスト */}
      <div className="lg:hidden divide-y divide-gray-100">
        {tasks.map(t => {
          const parent = parentMap.get(t.parent_task_id);
          const clickable = !!parent;
          const isScrollTarget = scrollToTaskId === t.id;
          return (
            <div
              key={t.id}
              data-task-row-id={t.id}
              onClick={clickable ? () => onJump(t) : undefined}
              className={cn(
                'p-3 transition-colors',
                clickable ? 'cursor-pointer active:bg-blue-50/40' : 'cursor-not-allowed opacity-60',
                isScrollTarget && 'bg-blue-50/60',
              )}
            >
              {/* 1 行目：親案件名 + chips */}
              <div className="flex items-center gap-1.5 mb-1 min-w-0">
                {parent?.type === 'meeting' && (
                  <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-700 flex-shrink-0">
                    定例
                  </span>
                )}
                {parent?.is_hidden && (
                  <span className="text-[9px] px-1 rounded bg-gray-100 text-[#86868b] flex-shrink-0">
                    履歴
                  </span>
                )}
                <span
                  className={cn(
                    'text-[10px] truncate',
                    parent ? 'text-[#86868b]' : 'text-gray-400 italic line-through',
                  )}
                >
                  {parent?.name || '(削除されたプロジェクト)'}
                </span>
              </div>
              {/* 2 行目：タスク名 + ステータス + 優先度 */}
              <div className="flex items-center gap-2 mb-1 min-w-0">
                <TaskIcon iconData={t.icon_data} />
                <span className="flex-1 truncate text-sm font-bold text-[#1d1d1f]">
                  {t.task_name}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0',
                    STATUS_PILL[t.status],
                  )}
                >
                  {t.status}
                </span>
                {t.priority && PRIORITY_PILL[t.priority] && (
                  <span
                    className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0',
                      PRIORITY_PILL[t.priority].cls,
                    )}
                  >
                    {PRIORITY_PILL[t.priority].label}
                  </span>
                )}
              </div>
              {/* 3 行目：日付 + 工数。タブモードに応じて 開始日 / 実績 をトグル。 */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[#86868b] tabular-nums">
                {showStartDate && (
                  <span>開始日 <span className={cn('font-medium text-[#1d1d1f]', t.status === '着手遅れ' && 'text-orange-600 font-bold')}>{fmtDate(t.start_date)}</span></span>
                )}
                <span>期日 <span className={cn('font-medium text-[#1d1d1f]', t.status === '遅れ' && 'text-red-600 font-bold')}>{fmtDate(t.due_date)}</span></span>
                <span>期限 <span className={cn('font-medium text-[#1d1d1f]', t.status === '期限遅れ' && 'text-red-600 font-bold')}>{fmtDate(t.final_deadline)}</span></span>
                <span className="ml-auto">
                  <span className="font-medium text-[#1d1d1f]">{t.planned_hours}h</span>
                  {showActualHours && (
                    <>
                      <span className="mx-1">/</span>
                      <span className="font-medium text-[#007aff]">{t.actual_hours ?? 0}h</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th className="px-4 py-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest border-b border-gray-100">
    {children}
  </th>
);

const Td: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <td className="px-4 py-2.5 border-b border-gray-50 align-middle">{children}</td>
);
