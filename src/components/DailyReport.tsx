import React, { useState, useEffect, useMemo } from 'react';
import { SubTask, ParentTask, SubTaskStatus, DailyReportSnapshot, Priority } from '../types';
import { taskService } from '../services/taskService';
import { aiService } from '../services/aiService';
import {
  Sparkles,
  Calendar,
  Check,
  Download,
  Trash2,
  Loader2,
  RefreshCw,
  AlertCircle,
  Copy,
  BarChart3,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DailyReportProps {
  onJumpToTask: (task: SubTask) => void;
}

// Status color mappings
const statusBgText: Record<SubTaskStatus, string> = {
  '遅れ': 'bg-red-100 text-red-700',
  '済': 'bg-green-100 text-green-700',
  '進行中': 'bg-blue-100 text-blue-700',
  '未着手': 'bg-gray-100 text-gray-700',
  '保留': 'bg-yellow-100 text-yellow-700',
  '着手遅れ': 'bg-orange-100 text-orange-600',
  '期限遅れ': 'bg-red-200 text-red-800',
};

// 優先度バッジ（A=高 / B=中 / C=低）。週報モードと同じ見た目に揃える。
const PRIORITY_META: Record<Priority, { label: string; cls: string }> = {
  A: { label: '高', cls: 'bg-red-100 text-red-700' },
  B: { label: '中', cls: 'bg-amber-100 text-amber-700' },
  C: { label: '低', cls: 'bg-gray-100 text-gray-600' },
};

const statusBarColor: Record<SubTaskStatus, string> = {
  '遅れ': 'bg-red-500',
  '済': 'bg-green-500',
  '進行中': 'bg-blue-500',
  '未着手': 'bg-gray-300',
  '保留': 'bg-yellow-500',
  '着手遅れ': 'bg-orange-500',
  '期限遅れ': 'bg-red-600',
};

// Render icon_data (emoji / SVG / text)
const TaskIcon: React.FC<{ iconData?: string }> = ({ iconData }) => {
  if (!iconData || !iconData.trim()) return null;
  if (iconData.startsWith('<')) {
    return <div className="w-4 h-4 flex-shrink-0" dangerouslySetInnerHTML={{ __html: iconData }} />;
  }
  return <span className="text-sm flex-shrink-0">{iconData}</span>;
};

// Format date as YYYY/MM/DD
const fmtDate = (dateStr?: string) => {
  if (!dateStr) return '—';
  return dateStr.replace(/-/g, '/');
};

// Today as YYYY-MM-DD
const todayStr = () => new Date().toISOString().split('T')[0];

export const DailyReport: React.FC<DailyReportProps> = ({ onJumpToTask }) => {
  const today = todayStr();

  const [allSubTasks, setAllSubTasks] = useState<SubTask[]>([]);
  const [parentTasks, setParentTasks] = useState<ParentTask[]>([]);
  const [hiddenParentTasks, setHiddenParentTasks] = useState<ParentTask[]>([]);

  // Date selection - default to today, can be changed to view historical reports
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [snapshot, setSnapshot] = useState<DailyReportSnapshot | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);

  // Editable state
  const [notes, setNotes] = useState<string>('');
  const [summary, setSummary] = useState<string>('');

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitFeedback, setSubmitFeedback] = useState<string | null>(null);

  // History mode: viewing a past date (not today) — switch to snapshot-based read-only view
  const isHistoryMode = selectedDate !== today;

  // Subscribe to live data (only used for "today" mode)
  useEffect(() => {
    const unsubSubs = taskService.subscribeAllSubTasks(setAllSubTasks);
    const unsubParents = taskService.subscribeParentTasks(setParentTasks, false);
    const unsubHidden = taskService.subscribeParentTasks(setHiddenParentTasks, true);
    return () => {
      unsubSubs();
      unsubParents();
      unsubHidden();
    };
  }, []);

  // Load saved daily report for selectedDate (today or past)
  useEffect(() => {
    let cancelled = false;
    setIsLoadingSnapshot(true);
    (async () => {
      const existing = await taskService.getDailyReport(selectedDate);
      if (cancelled) return;
      setSnapshot(existing);
      setNotes(existing?.notes || '');
      setSummary(existing?.ai_summary || '');
      setIsLoadingSnapshot(false);
    })();
    return () => { cancelled = true; };
  }, [selectedDate]);

  // Map parent IDs → parent task objects (merged visible + hidden)
  const parentMap = useMemo(() => {
    const map = new Map<string, ParentTask>();
    parentTasks.forEach(p => map.set(p.id, p));
    hiddenParentTasks.forEach(p => map.set(p.id, p));
    return map;
  }, [parentTasks, hiddenParentTasks]);

  // Source of truth for displayed tasks:
  //   - History mode: use the saved snapshot's tasks_snapshot
  //   - Today mode: use live tasks where is_in_report=true
  const reportTasks = useMemo(
    () => {
      if (isHistoryMode) {
        return snapshot?.tasks_snapshot || [];
      }
      return allSubTasks.filter(t => t.is_in_report);
    },
    [isHistoryMode, snapshot, allSubTasks]
  );

  // Stats
  const stats = useMemo(() => {
    const totalPlanned = reportTasks.reduce((sum, t) => sum + (t.planned_hours || 0), 0);
    const totalActual = reportTasks.reduce((sum, t) => sum + (t.actual_hours || 0), 0);
    const delayed = reportTasks.filter(t => t.status === '遅れ' || t.status === '期限遅れ').length;
    return {
      total: reportTasks.length,
      planned: totalPlanned,
      actual: totalActual,
      delayed,
    };
  }, [reportTasks]);

  // Group tasks by parent_task_id
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, SubTask[]>();
    reportTasks.forEach(t => {
      const list = groups.get(t.parent_task_id) || [];
      list.push(t);
      groups.set(t.parent_task_id, list);
    });
    // Sort each group by order/created_at
    groups.forEach(list => {
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    });
    return groups;
  }, [reportTasks]);

  // Sorted parent IDs (preserve parent order)
  const parentIds = useMemo(() => {
    const ids = Array.from(groupedTasks.keys());
    ids.sort((a, b) => {
      const pa = parentMap.get(a);
      const pb = parentMap.get(b);
      return (pa?.order ?? 0) - (pb?.order ?? 0);
    });
    return ids;
  }, [groupedTasks, parentMap]);

  // Inline status change handler (disabled in history mode)
  const handleStatusChange = async (taskId: string, status: SubTaskStatus) => {
    if (isHistoryMode) return;
    try {
      await taskService.updateSubTask(taskId, { status });
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  // Toggle is_in_report (disabled in history mode)
  const handleToggleReport = async (task: SubTask) => {
    if (isHistoryMode) return;
    try {
      await taskService.updateSubTask(task.id, { is_in_report: !task.is_in_report });
    } catch (err) {
      console.error('Failed to toggle report:', err);
    }
  };

  // 実績工数を手動更新（履歴表示中は不可）。
  const handleActualChange = async (taskId: string, hours: number) => {
    if (isHistoryMode) return;
    try {
      await taskService.updateSubTask(taskId, { actual_hours: hours });
    } catch (err) {
      console.error('Failed to update actual hours:', err);
    }
  };

  // Generate AI summary
  const handleGenerateSummary = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const delayedTasks = reportTasks.filter(
        t => t.status === '遅れ' || t.status === '期限遅れ'
      );
      const res = await aiService.generateSummary({
        today: reportTasks,
        unfinished: [],
        delayed: delayedTasks,
      });
      setSummary(res);
    } catch (err: any) {
      setError(err.message || 'Failed to generate summary.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Submit daily report (snapshot + ai summary) — only valid for "today"
  const handleSubmit = async () => {
    if (isHistoryMode) return;
    setIsSubmitting(true);
    setSubmitFeedback(null);
    try {
      // Generate summary first if missing
      let finalSummary = summary;
      if (!finalSummary.trim()) {
        try {
          const delayedTasks = reportTasks.filter(
            t => t.status === '遅れ' || t.status === '期限遅れ'
          );
          finalSummary = await aiService.generateSummary({
            today: reportTasks,
            unfinished: [],
            delayed: delayedTasks,
          });
          setSummary(finalSummary);
        } catch (e) {
          console.warn('AI summary generation failed, saving without it:', e);
        }
      }

      await taskService.saveDailyReport({
        date: today,
        notes,
        ai_summary: finalSummary,
        tasks_snapshot: reportTasks,
        total_tasks: stats.total,
        total_planned: stats.planned,
        total_actual: stats.actual,
        delayed_count: stats.delayed,
      });
      // Reload snapshot so the "再提出" button state reflects the save
      const reloaded = await taskService.getDailyReport(today);
      setSnapshot(reloaded);
      setSubmitFeedback(snapshot ? '日報を更新しました' : '日報を保存しました');
      setTimeout(() => setSubmitFeedback(null), 3000);
    } catch (err: any) {
      setSubmitFeedback(`保存失敗: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Download report as text
  const handleDownload = () => {
    const lines: string[] = [];
    lines.push(`日報 - ${fmtDate(selectedDate)}`);
    lines.push(`集計タスク: ${stats.total} 件 / 予定 ${stats.planned}h / 実績 ${stats.actual}h / 遅延 ${stats.delayed} 件`);
    lines.push('');
    parentIds.forEach(pid => {
      const parent = parentMap.get(pid);
      const tasks = groupedTasks.get(pid) || [];
      lines.push(`■ ${parent?.name || pid} (${tasks.length}件)`);
      tasks.forEach(t => {
        lines.push(`  - [${t.status}] ${t.task_name}  期日:${fmtDate(t.due_date)}  予定:${t.planned_hours}h 実績:${t.actual_hours}h`);
      });
      lines.push('');
    });
    if (notes.trim()) {
      lines.push('--- 本日のメモ ---');
      lines.push(notes);
      lines.push('');
    }
    if (summary.trim()) {
      lines.push('--- AI Summary ---');
      lines.push(summary);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-report-${selectedDate}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Delete: behavior depends on mode
  //   - Today: uncheck all is_in_report flags + delete today's snapshot
  //   - History: only delete that day's snapshot
  const handleClear = async () => {
    const msg = isHistoryMode
      ? `${fmtDate(selectedDate)} の日報スナップショットを削除しますか？`
      : '本日の日報をクリアしますか？ (チェック解除 + 保存された日報を削除)';
    if (!confirm(msg)) return;
    try {
      if (!isHistoryMode) {
        // Uncheck all live tasks (only in today mode)
        await Promise.all(
          reportTasks.map(t => taskService.updateSubTask(t.id, { is_in_report: false }))
        );
      }
      // Delete snapshot for selectedDate
      await taskService.deleteDailyReport(selectedDate);
      setNotes('');
      setSummary('');
      setSnapshot(null);
      setSubmitFeedback('日報を削除しました');
      setTimeout(() => setSubmitFeedback(null), 3000);
    } catch (err: any) {
      setSubmitFeedback(`削除失敗: ${err.message || err}`);
    }
  };

  // Parent progress calculation
  const parentProgress = (parent: ParentTask | undefined, tasks: SubTask[]): number => {
    if (parent?.progress != null) return Math.round(parent.progress);
    const totalPlanned = tasks.reduce((s, t) => s + (t.planned_hours || 0), 0);
    const totalActual = tasks.reduce((s, t) => s + (t.actual_hours || 0), 0);
    if (totalPlanned === 0) return 0;
    return Math.round((totalActual / totalPlanned) * 100);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-sm text-[#86868b] mb-2 hidden lg:block">システム / 日報</div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl lg:text-4xl font-bold tracking-tight text-[#1d1d1f]">日報</h2>
            <div className="text-xs lg:text-sm text-[#86868b] mt-2 flex items-center gap-2 flex-wrap">
              <span className="font-medium">{isHistoryMode ? '対象日' : '本日'}</span>
              <input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="bg-white border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 cursor-pointer"
              />
              {isHistoryMode && (
                <button
                  onClick={() => setSelectedDate(today)}
                  className="text-xs text-[#007aff] hover:underline font-medium"
                >
                  本日に戻る
                </button>
              )}
              {isHistoryMode && (
                <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-md font-bold">
                  履歴表示 (読み取り専用)
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              title="ダウンロード"
              className="p-2.5 bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <Download size={18} className="text-[#1d1d1f]" />
            </button>
            <button
              onClick={handleClear}
              title={isHistoryMode ? 'この日のスナップショットを削除' : 'クリア'}
              disabled={isHistoryMode && !snapshot}
              className="p-2.5 bg-white rounded-xl border border-gray-200 hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={18} className="text-[#1d1d1f]" />
            </button>
            {!isHistoryMode && (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                title={snapshot ? `前回提出: ${new Date(snapshot.updated_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : undefined}
                className={cn(
                  'flex items-center gap-2 px-4 lg:px-5 py-2.5 text-white rounded-xl font-bold transition-colors disabled:opacity-60 shadow-sm text-sm',
                  snapshot
                    ? 'bg-[#34c759] hover:bg-[#28a745]'
                    : 'bg-[#007aff] hover:bg-[#0062cc]'
                )}
              >
                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                <span>{snapshot ? '日報再提出' : '日報を提出'}</span>
              </button>
            )}
          </div>
        </div>
        {submitFeedback && (
          <div className="mt-3 px-4 py-2 bg-blue-50 text-blue-700 text-sm rounded-lg border border-blue-100 inline-block">
            {submitFeedback}
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 lg:gap-4">
        <StatCard label="集計タスク" value={`${stats.total} 件`} accent="text-[#007aff]" />
        <StatCard label="予定工数" value={`${stats.planned} h`} accent="text-[#1d1d1f]" />
        <StatCard label="実績工数" value={`${stats.actual} h`} accent="text-[#007aff]" />
        <StatCard label="遅延タスク" value={`${stats.delayed} 件`} accent="text-red-500" />
      </div>

      {/* Grouped Task Cards */}
      {parentIds.length > 0 ? (
        <div className="space-y-4">
          {parentIds.map(pid => {
            const parent = parentMap.get(pid);
            const tasks = groupedTasks.get(pid) || [];
            const progress = parentProgress(parent, tasks);
            return (
              <div key={pid} className="mac-card">
                {/* Parent header */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 lg:px-5 py-3 lg:py-4 border-b border-gray-100">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <Calendar size={16} className="text-[#007aff] lg:hidden" />
                      <Calendar size={18} className="text-[#007aff] hidden lg:block" />
                    </div>
                    <h3 className="font-bold text-sm lg:text-lg text-[#1d1d1f] truncate">{parent?.name || '(unknown project)'}</h3>
                    <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-[#007aff] rounded-md font-bold flex-shrink-0">
                      {tasks.length} 件
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 pl-11 sm:pl-0">
                    <div className="w-24 lg:w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#007aff] rounded-full transition-all"
                        style={{ width: `${Math.min(100, progress)}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-[#1d1d1f] w-10 text-right">{progress}%</span>
                    {parent?.deadline && (
                      <span className="text-xs text-[#86868b] hidden sm:inline">
                        最終期日 {fmtDate(parent.deadline)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Sub-task rows */}
                <div className="divide-y divide-gray-50">
                  {tasks.map(t => (
                    <div key={t.id} className="flex items-stretch group hover:bg-gray-50/50 transition-colors">
                      {/* Status color bar */}
                      <div className={cn('w-1 flex-shrink-0', statusBarColor[t.status])} />

                      {/* Checkbox */}
                      <div className="flex items-center px-2.5 lg:px-4">
                        <button
                          onClick={() => handleToggleReport(t)}
                          disabled={isHistoryMode}
                          className={cn(
                            'w-5 h-5 rounded-md flex items-center justify-center transition-colors',
                            t.is_in_report
                              ? 'bg-[#007aff] text-white'
                              : 'bg-white border border-gray-300 hover:border-[#007aff]',
                            isHistoryMode && 'cursor-not-allowed opacity-80'
                          )}
                          title={isHistoryMode ? '履歴表示中 (編集不可)' : (t.is_in_report ? '日報から外す' : '日報に追加')}
                        >
                          {t.is_in_report && <Check size={14} strokeWidth={3} />}
                        </button>
                      </div>

                      {/* Task content */}
                      <div className="flex-1 min-w-0 py-2.5 lg:py-3 pr-3 lg:pr-4">
                        <div className="flex items-center gap-2 lg:gap-3 flex-wrap mb-1">
                          <TaskIcon iconData={t.icon_data} />
                          <button
                            onClick={() => onJumpToTask(t)}
                            className="font-bold text-xs lg:text-sm text-[#1d1d1f] hover:text-[#007aff] transition-colors text-left truncate"
                          >
                            {t.task_name}
                          </button>
                          <select
                            value={t.status}
                            onChange={(e) => handleStatusChange(t.id, e.target.value as SubTaskStatus)}
                            disabled={isHistoryMode}
                            className={cn(
                              'px-2 py-0.5 rounded-md text-[10px] font-bold focus:outline-none',
                              statusBgText[t.status],
                              isHistoryMode ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'
                            )}
                          >
                            {(Object.keys(statusBgText) as SubTaskStatus[]).map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          {t.priority && PRIORITY_META[t.priority] && (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold',
                                PRIORITY_META[t.priority].cls,
                              )}
                            >
                              <BarChart3 size={10} />
                              {PRIORITY_META[t.priority].label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 lg:gap-4 text-[10px] lg:text-xs text-[#86868b] flex-wrap">
                          <span>
                            期日{' '}
                            <span className={cn('font-medium', t.status === '遅れ' && 'text-red-600 font-bold')}>
                              {fmtDate(t.due_date)}
                            </span>
                          </span>
                          <span className="text-gray-300 hidden sm:inline">·</span>
                          <span className="hidden sm:inline">
                            開始日{' '}
                            <span className={cn('font-medium', t.status === '着手遅れ' && 'text-orange-600 font-bold')}>
                              {fmtDate(t.start_date)}
                            </span>
                          </span>
                          <span className="text-gray-300">·</span>
                          <span>
                            <span className="hidden sm:inline">期限 </span>
                            <span className={cn('font-medium', t.status === '期限遅れ' && 'text-red-600 font-bold')}>
                              {fmtDate(t.final_deadline)}
                            </span>
                          </span>
                          {/* Inline hours on mobile */}
                          <span className="text-gray-300 sm:hidden">·</span>
                          <span className="sm:hidden flex items-center gap-0.5">
                            <span className="font-medium text-[#1d1d1f]">{t.planned_hours}h</span>
                            <span className="mx-0.5">/</span>
                            {isHistoryMode ? (
                              <span className="font-medium text-[#007aff]">{t.actual_hours}h</span>
                            ) : (
                              <ActualHoursInput
                                value={t.actual_hours}
                                className="w-10"
                                onCommit={(h) => handleActualChange(t.id, h)}
                              />
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Right-side hours (desktop only) */}
                      <div className="hidden sm:flex flex-col items-end justify-center px-4 py-3 text-xs flex-shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[#86868b]">予定</span>
                          <span className="font-bold text-[#1d1d1f] w-8 text-right">{t.planned_hours}h</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[#86868b]">実績</span>
                          {isHistoryMode ? (
                            <span className="font-bold text-[#007aff] w-8 text-right">{t.actual_hours}h</span>
                          ) : (
                            <ActualHoursInput
                              value={t.actual_hours}
                              className="w-12"
                              onCommit={(h) => handleActualChange(t.id, h)}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mac-card p-12 text-center">
          <p className="text-sm text-[#86868b] italic">
            {isLoadingSnapshot
              ? '読み込み中...'
              : isHistoryMode
                ? `${fmtDate(selectedDate)} には保存された日報がありません。`
                : '日報に追加されたタスクがありません。サブタスク管理画面の「日報」列にチェックを入れてください。'}
          </p>
        </div>
      )}

      {/* Notes */}
      <div className="mac-card p-4 lg:p-5">
        <label className="block text-sm font-bold text-[#1d1d1f] mb-3">
          {isHistoryMode ? `${fmtDate(selectedDate)} のメモ` : '本日のメモ'}
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          disabled={isHistoryMode}
          placeholder={isHistoryMode ? '(メモなし)' : '今日の進捗、課題、明日の予定などを記入...'}
          className={cn(
            'w-full min-h-[120px] px-4 py-3 bg-[#f5f5f7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 text-sm resize-y',
            isHistoryMode && 'cursor-not-allowed opacity-90'
          )}
        />
        {!isHistoryMode && (
          <div className="text-right text-xs text-[#86868b] mt-2">{notes.length} / 500 文字</div>
        )}
      </div>

      {/* AI Summary */}
      <div className="bg-[#007aff] text-white rounded-2xl lg:rounded-[20px] p-4 lg:p-6 shadow-lg relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles size={22} />
              <h3 className="text-lg font-bold">AI Summary</h3>
            </div>
            {!isHistoryMode && (
              <button
                onClick={handleGenerateSummary}
                disabled={isGenerating}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
                title="再生成"
              >
                {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              </button>
            )}
          </div>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 rounded-lg text-xs border border-red-500/30 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
          {summary ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{summary}</ReactMarkdown>
              <button
                onClick={() => navigator.clipboard.writeText(summary)}
                className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity"
              >
                <Copy size={14} />
                Copy Summary
              </button>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-white/60 italic text-sm mb-4">
                {isHistoryMode
                  ? 'この日のAIサマリーは保存されていません。'
                  : '右上の更新ボタン、または「日報を提出」で自動生成されます。'}
              </p>
              {!isHistoryMode && (
                <button
                  onClick={handleGenerateSummary}
                  disabled={isGenerating}
                  className="px-5 py-2 bg-white text-[#007aff] rounded-lg font-bold hover:bg-gray-100 transition-all disabled:opacity-50 text-sm"
                >
                  {isGenerating ? '生成中...' : '今すぐ生成'}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-white/5 rounded-full blur-3xl" />
      </div>
    </div>
  );
};

// Stat card sub-component
const StatCard: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
  <div className="mac-card p-3 lg:p-4">
    <div className="text-[10px] lg:text-xs text-[#86868b] mb-1 lg:mb-2">{label}</div>
    <div className={cn('text-xl lg:text-2xl font-bold', accent)}>{value}</div>
  </div>
);

// 実績工数を手入力する小さな数値インプット。
// 入力中はローカル状態で保持し、フォーカスアウト / Enter で確定保存する
// （1 文字ごとに DB 書き込みしてカーソルが飛ぶのを防ぐ）。外部更新には useEffect で追従。
const ActualHoursInput: React.FC<{
  value: number;
  className?: string;
  onCommit: (hours: number) => void;
}> = ({ value, className, onCommit }) => {
  const [local, setLocal] = useState<string>(String(value ?? 0));
  useEffect(() => { setLocal(String(value ?? 0)); }, [value]);
  const commit = () => {
    const n = Number(local);
    if (!isNaN(n) && n >= 0 && n !== value) {
      onCommit(n);
    } else {
      setLocal(String(value ?? 0));
    }
  };
  return (
    <input
      type="number"
      min={0}
      step={0.5}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'text-right font-bold text-[#007aff] bg-[#f5f5f7] rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#007aff]/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
        className,
      )}
    />
  );
};
