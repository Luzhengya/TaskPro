import React, { useMemo, useState } from 'react';
import { AlertCircle, Minus, Plus } from 'lucide-react';
import { SubTask } from '../types';
import { fmtDate, addBusinessDays } from '../dateUtils';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DelaySubmitPayload {
  reason: string;
  /** 影響日数（0＝影響なし）。 */
  impactDays: number;
  /** 期日・期限をシフトする対象タスクの id（影響ありのときのみ。本タスクを含む）。 */
  affectedTaskIds: string[];
}

interface DelayModalProps {
  /** 「遅れ」に変更されたタスク。 */
  task: SubTask;
  /** 同一プロジェクトの全サブタスク（order 昇順）。後続タスクの抽出に使う。 */
  siblings: SubTask[];
  /** ヘッダー副題に出すプロジェクト名。 */
  projectName?: string;
  onCancel: () => void;
  onSubmit: (payload: DelaySubmitPayload) => void | Promise<void>;
}

export const DelayModal: React.FC<DelayModalProps> = ({
  task,
  siblings,
  projectName,
  onCancel,
  onSubmit,
}) => {
  const [reason, setReason] = useState('');
  // null＝未選択（どちらのボタンもハイライトしない）。
  const [hasImpact, setHasImpact] = useState<boolean | null>(null);
  const [impactDays, setImpactDays] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // 着手遅れはオレンジ、遅れ（その他）は赤でテーマを切り替える。
  const isStartDelay = task.status === '着手遅れ';
  const accent = isStartDelay
    ? {
        iconBg: 'bg-orange-50',
        iconText: 'text-orange-500',
        newDate: 'text-orange-600',
        impactSelected: 'border-orange-400 bg-orange-50 text-orange-600',
        impactDot: 'border-orange-500 bg-orange-500',
        submit: 'bg-[#ff9500] hover:bg-[#e0850e]',
        submitDisabled: 'bg-[#ff9500]/40',
      }
    : {
        iconBg: 'bg-red-50',
        iconText: 'text-red-500',
        newDate: 'text-red-600',
        impactSelected: 'border-red-400 bg-red-50 text-red-600',
        impactDot: 'border-red-500 bg-red-500',
        submit: 'bg-[#ff3b30] hover:bg-[#e0352b]',
        submitDisabled: 'bg-[#ff3b30]/40',
      };

  // 本タスク＋後続タスク（自分以降の order）。影響を受ける候補。
  const affectedCandidates = useMemo(() => {
    const idx = siblings.findIndex(s => s.id === task.id);
    if (idx < 0) return [task];
    return siblings.slice(idx);
  }, [siblings, task]);

  // チェック状態（既定で全選択）。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(affectedCandidates.map(s => s.id)),
  );

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit =
    reason.trim().length > 0 && hasImpact !== null && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        reason: reason.trim(),
        impactDays: hasImpact ? impactDays : 0,
        affectedTaskIds: hasImpact
          ? affectedCandidates.filter(s => selectedIds.has(s.id)).map(s => s.id)
          : [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="mac-card max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', accent.iconBg)}>
              <AlertCircle size={20} className={accent.iconText} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-[#1d1d1f] leading-tight">遅延の登録</h3>
              <p className="text-xs text-[#86868b] truncate">
                {projectName ? `${projectName}　·　` : ''}
                {task.task_name}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* 原因 */}
          <div>
            <label className="block text-sm font-bold text-[#1d1d1f] mb-2">
              <span className="text-red-500">*</span> 原因
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              autoFocus
              placeholder="遅延の原因を記載してください..."
              className="w-full px-4 py-3 bg-[#f5f5f7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 text-sm min-h-[90px]"
            />
          </div>

          {/* 続きのタスクに影響がある？ */}
          <div>
            <label className="block text-sm font-bold text-[#1d1d1f] mb-2">
              <span className="text-red-500">*</span> 続きのタスクに影響がある？
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setHasImpact(false)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all',
                  hasImpact === false
                    ? 'border-[#007aff] bg-[#007aff]/5 text-[#007aff]'
                    : 'border-gray-200 text-[#1d1d1f] hover:border-gray-300',
                )}
              >
                <span
                  className={cn(
                    'w-4 h-4 rounded-full border-2 flex-shrink-0',
                    hasImpact === false ? 'border-[#007aff] bg-[#007aff]' : 'border-gray-300',
                  )}
                />
                影響なし
              </button>
              <button
                type="button"
                onClick={() => setHasImpact(true)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all',
                  hasImpact === true
                    ? accent.impactSelected
                    : 'border-gray-200 text-[#1d1d1f] hover:border-gray-300',
                )}
              >
                <span
                  className={cn(
                    'w-4 h-4 rounded-full border-2 flex-shrink-0',
                    hasImpact === true ? accent.impactDot : 'border-gray-300',
                  )}
                />
                影響あり
              </button>
            </div>
          </div>

          {/* 影響あり：日数 + 影響を受けるタスク */}
          {hasImpact === true && (
            <>
              <div>
                <label className="block text-sm font-bold text-[#1d1d1f] mb-2">
                  <span className="text-red-500">*</span> 影響日数
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setImpactDays(d => Math.max(1, d - 1))}
                    className="w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={impactDays}
                    onChange={e =>
                      setImpactDays(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                    }
                    className="w-16 h-9 text-center rounded-lg bg-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 text-sm font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => setImpactDays(d => d + 1)}
                    className="w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                  <span className="text-sm text-[#86868b] ml-1">日</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-[#1d1d1f] mb-2">
                  影響を受けるタスク
                </label>
                <div className="rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
                  {affectedCandidates.map(s => {
                    const isSelf = s.id === task.id;
                    const checked = selectedIds.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSelected(s.id)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                          isSelf ? 'bg-blue-50/60' : 'hover:bg-gray-50',
                        )}
                      >
                        <span
                          className={cn(
                            'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border',
                            checked
                              ? 'bg-[#007aff] border-[#007aff] text-white'
                              : 'bg-white border-gray-300',
                          )}
                        >
                          {checked && <span className="text-[10px] leading-none">✓</span>}
                        </span>
                        <span className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-sm font-medium text-[#1d1d1f] truncate">
                            {s.task_name || '(無題)'}
                          </span>
                          {isSelf && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-[#007aff] rounded font-bold flex-shrink-0">
                              本タスク
                            </span>
                          )}
                        </span>
                        <span className="text-xs tabular-nums text-[#86868b] flex-shrink-0">
                          {fmtDate(s.due_date)}{' '}
                          <span className="text-gray-300">→</span>{' '}
                          <span className={cn('font-bold', accent.newDate)}>
                            {fmtDate(addBusinessDays(s.due_date, impactDays))}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 pt-4 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              'flex-1 py-2.5 rounded-xl font-bold text-white transition-colors',
              canSubmit ? accent.submit : cn(accent.submitDisabled, 'cursor-not-allowed'),
            )}
          >
            登録
          </button>
        </div>
      </div>
    </div>
  );
};
