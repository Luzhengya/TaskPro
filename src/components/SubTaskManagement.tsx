import React, { useState, useEffect } from 'react';
import { ParentTask, SubTask, SubTaskStatus, Priority } from '../types';
import { taskService } from '../services/taskService';
import { EditableCell } from './EditableCell';
import {
  Plus,
  Lock,
  Unlock,
  Trash2,
  AlertCircle,
  ChevronLeft,
  GripVertical,
  CheckSquare,
  Square
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DelayModal, DelaySubmitPayload } from './DelayModal';
import { fmtDate, addBusinessDays } from '../dateUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Zero-pad a YYYY-M-D date string so string comparison matches chronological order.
// Imported dates aren't zero-padded ("2026-6-9") while <input type="date"> emits "2026-06-09".
function normalizeDate(d?: string): string {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  const [y, m, day] = parts;
  return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

interface SubTaskManagementProps {
  parentTask: ParentTask;
  onBack: () => void;
  highlightTaskId?: string | null;
}

export const SubTaskManagement: React.FC<SubTaskManagementProps> = ({ parentTask, onBack, highlightTaskId }) => {
  const [subTasks, setSubTasks] = useState<SubTask[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [delayModalTask, setDelayModalTask] = useState<SubTask | null>(null);
  // 遅延モーダルをキャンセルしたとき、ステータスを元へ戻すために直前値を保持する。
  const [delayPrevStatus, setDelayPrevStatus] = useState<SubTaskStatus | null>(null);
  const [iconModalTask, setIconModalTask] = useState<SubTask | null>(null);
  const [iconInput, setIconInput] = useState('');
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Storage keys for persisting table preferences
  const STORAGE_KEY_FROZEN = 'subtask-frozen-columns';
  const STORAGE_KEY_WIDTHS = 'subtask-column-widths';

  // Default column widths
  const DEFAULT_WIDTHS: Record<number, number> = {
    0: 40,  // Drag
    1: 50,  // Report
    2: 120, // System
    3: 250, // Task Name
    4: 100, // Status
    5: 120, // Start
    6: 120, // Due
    7: 120, // Deadline
    8: 80,  // Planned
    9: 80,  // Actual
    10: 80, // Priority
    11: 200,// Remarks
    12: 60  // Actions
  };

  // Table features state - load from localStorage, default: only freeze タスク名 column (index 3)
  const [frozenColumns, setFrozenColumns] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_FROZEN);
      if (stored) return JSON.parse(stored);
    } catch {}
    return [3];
  });

  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_WIDTHS);
      if (stored) return { ...DEFAULT_WIDTHS, ...JSON.parse(stored) };
    } catch {}
    return DEFAULT_WIDTHS;
  });

  // Persist frozen columns to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_FROZEN, JSON.stringify(frozenColumns));
    } catch {}
  }, [frozenColumns]);

  // Persist column widths to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_WIDTHS, JSON.stringify(columnWidths));
    } catch {}
  }, [columnWidths]);

  const toggleFrozenColumn = (index: number) => {
    setFrozenColumns(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index].sort((a, b) => a - b)
    );
  };

  useEffect(() => {
    const unsubscribe = taskService.subscribeSubTasks(parentTask.id, setSubTasks);
    return () => unsubscribe();
  }, [parentTask.id]);

  useEffect(() => {
    if (highlightTaskId && subTasks.length > 0) {
      const element = document.getElementById(`task-${highlightTaskId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('bg-blue-50/50');
        setTimeout(() => {
          element.classList.remove('bg-blue-50/50');
        }, 3000);
      }
    }
  }, [highlightTaskId, subTasks]);

  const handleAddRow = async () => {
    const newTaskId = await taskService.addSubTask({
      parent_task_id: parentTask.id,
      system: '',
      month: '',
      daily_report_date: new Date().toISOString().split('T')[0],
      start_date: '',
      due_date: '',
      final_deadline: '',
      status: '未着手',
      task_name: 'New Task',
      planned_hours: 0,
      actual_hours: 0,
      priority: 'B',
      remarks: '',
      week_number: 0,
      flag: 0
    });

    // Auto-focus new task row's task name field
    if (newTaskId) {
      setTimeout(() => {
        const row = document.getElementById(`task-${newTaskId}`);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Focus the task name input (column 3)
          const taskNameCell = row.querySelector('td:nth-child(4)');
          if (taskNameCell) {
            const input = taskNameCell.querySelector('textarea, input');
            if (input instanceof HTMLElement) {
              input.focus();
              // Select all text for easier editing
              if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
                input.select();
              }
            }
          }
        }
      }, 100);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<SubTask>) => {
    const task = subTasks.find(st => st.id === id);
    if (!task) return;

    // Clean up undefined values (Firestore doesn't support undefined)
    const newUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      newUpdates[key] = value === undefined ? '' : value;
    }

    // Auto-calculate deadline if due_date or planned_hours changes
    if ('due_date' in updates || 'planned_hours' in updates) {
      const dueDate = updates.due_date ?? task.due_date;
      const plannedHours = updates.planned_hours ?? task.planned_hours;
      if (dueDate && plannedHours > 0) {
        newUpdates.final_deadline = taskService.calculateDeadline(dueDate, plannedHours);
      }
    }

    // Auto-set warning icon for delayed statuses
    if ('status' in updates && updates.status) {
      const newStatus = updates.status;
      const delayedStatuses: SubTaskStatus[] = ['遅れ', '着手遅れ', '期限遅れ'];
      if (delayedStatuses.includes(newStatus)) {
        // Only set warning icon if no icon is already set
        if (!task.icon_data || !task.icon_data.trim()) {
          newUpdates.icon_data = '⚠️';
        }

        // 遅延系ステータスへの変更時は優先度を A へ引き上げる。
        newUpdates.priority = 'A';

        // 遅れ・着手遅れは遅延登録モーダルで原因を記録（task.status は変更前の値なので
        // モーダルへは変更後ステータスを渡してテーマ色を切り替える）。
        if (newStatus === '遅れ' || newStatus === '着手遅れ') {
          setDelayModalTask({ ...task, status: newStatus });
          setDelayPrevStatus(task.status);
        }
      }
    }

    try {
      await taskService.updateSubTask(id, newUpdates);
    } catch (err: any) {
      console.error('[handleUpdate] Update failed:', err);
      // Extract concise error message
      let msg = err?.message || String(err);
      try {
        const parsed = JSON.parse(msg);
        msg = parsed.error || msg;
      } catch {}
      setUpdateError(`更新に失敗しました: ${msg}`);
      setTimeout(() => setUpdateError(null), 5000);
    }
  };

  // 遅延モーダルの登録：原因を記録し、影響ありなら本タスク＋選択した後続タスクの
  // 期日・期限を影響日数だけ後ろへずらす（取り消し線表示用に元の値を保存）。
  const handleDelaySubmit = async ({ reason, impactDays, affectedTaskIds }: DelaySubmitPayload) => {
    const target = delayModalTask;
    if (!target) return;

    const updatesById = new Map<string, Record<string, any>>();
    const ensure = (id: string) => {
      const existing = updatesById.get(id);
      if (existing) return existing;
      const fresh: Record<string, any> = {};
      updatesById.set(id, fresh);
      return fresh;
    };

    // 遅延した本タスクに原因・影響日数を記録。
    const base = ensure(target.id);
    base.delay_reason = reason;
    base.delay_impact_days = impactDays;

    // 影響ありなら対象タスクの期日・期限をずらす。
    if (impactDays > 0) {
      for (const id of affectedTaskIds) {
        const t = subTasks.find(s => s.id === id);
        if (!t) continue;
        const u = ensure(id);
        // シフトの発生元ステータス（着手遅れ＝黄、遅れ＝赤の表示色を決める）。
        u.delay_shift_status = target.status;
        if (t.due_date) {
          u.original_due_date = t.original_due_date || t.due_date;
          u.due_date = addBusinessDays(t.due_date, impactDays);
        }
        if (t.final_deadline) {
          u.original_final_deadline = t.original_final_deadline || t.final_deadline;
          u.final_deadline = addBusinessDays(t.final_deadline, impactDays);
        }
      }
    }

    // 後続タスクのシフトで最大期日が親の最終期日を超えたら、親の最終期日も延ばす。
    let parentDeadlineUpdate: Promise<unknown> | null = null;
    if (impactDays > 0) {
      let maxDue = '';
      for (const s of subTasks) {
        const u = updatesById.get(s.id);
        const due = u && typeof u.due_date === 'string' && u.due_date ? u.due_date : s.due_date;
        if (due && normalizeDate(due) > normalizeDate(maxDue)) maxDue = due;
      }
      if (maxDue && normalizeDate(maxDue) > normalizeDate(parentTask.deadline)) {
        parentDeadlineUpdate = taskService.updateParentTask(parentTask.id, { deadline: maxDue });
      }
    }

    setDelayModalTask(null);
    setDelayPrevStatus(null);
    try {
      await Promise.all([
        ...[...updatesById].map(([id, u]) => taskService.updateSubTask(id, u)),
        ...(parentDeadlineUpdate ? [parentDeadlineUpdate] : []),
      ]);
    } catch (err: any) {
      console.error('[handleDelaySubmit] failed:', err);
      setUpdateError(`遅延の登録に失敗しました: ${err?.message || String(err)}`);
      setTimeout(() => setUpdateError(null), 5000);
    }
  };

  // モーダルをキャンセルしたら「遅れ」へ変更する前のステータスへ戻す。
  const handleDelayCancel = async () => {
    const target = delayModalTask;
    const prev = delayPrevStatus;
    setDelayModalTask(null);
    setDelayPrevStatus(null);
    if (target && prev && prev !== '遅れ') {
      try {
        await taskService.updateSubTask(target.id, { status: prev });
      } catch (err) {
        console.error('[handleDelayCancel] revert failed:', err);
      }
    }
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    
    const items = Array.from(subTasks);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    const updatePromises = items.map((item, index) => 
      taskService.updateSubTask(item.id, { order: index })
    );
    await Promise.all(updatePromises);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    const targetId = deleteId;
    setDeleteId(null);
    taskService.deleteSubTask(targetId).catch(err => {
      console.error('Failed to delete sub-task:', err);
    });
  };

  const getFrozenLeft = (index: number) => {
    if (!frozenColumns.includes(index)) return undefined;
    let left = 0;
    for (let i = 0; i < index; i++) {
      if (frozenColumns.includes(i)) {
        left += columnWidths[i] || 0;
      }
    }
    return left;
  };

  const handleMouseDownResize = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths[index];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(40, startWidth + (moveEvent.clientX - startX));
      setColumnWidths(prev => ({ ...prev, [index]: newWidth }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const ResizableTh = ({ index, title, children }: { index: number, title?: string, children?: React.ReactNode }) => {
    const isFrozen = frozenColumns.includes(index);
    const left = getFrozenLeft(index);

    return (
      <th
        style={{
          width: columnWidths[index],
          minWidth: columnWidths[index],
          maxWidth: columnWidths[index],
          left: isFrozen ? left : undefined,
          position: isFrozen ? 'sticky' : 'relative',
          zIndex: isFrozen ? 40 : 10,
        }}
        onDoubleClick={() => {
          // Don't allow freezing the drag handle column (index 0, no header text)
          if (index === 0) return;
          toggleFrozenColumn(index);
        }}
        className={cn(
          "px-4 py-3 text-[10px] font-bold uppercase tracking-widest bg-gray-50 border-b border-gray-100 group select-none",
          index !== 0 && "cursor-pointer",
          isFrozen ? "text-[#007aff]" : "text-[#86868b]",
          isFrozen && "shadow-[1px_0_0_0_rgba(0,0,0,0.05)]"
        )}
        title={
          index === 0
            ? undefined
            : isFrozen ? "ダブルクリックで固定を解除" : "ダブルクリックで列を固定"
        }
      >
        <div className="pr-2">
          <span className="whitespace-normal break-words line-clamp-2 block" title={title}>{children}</span>
        </div>
        {/* Resize handle - always visible at right edge */}
        <div
          onMouseDown={handleMouseDownResize(index)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-[#007aff]/50 active:bg-[#007aff] transition-colors"
          style={{ zIndex: 100 }}
          title="ドラッグで列幅を調整"
        />
      </th>
    );
  };

  const statusColors: Record<SubTaskStatus, string> = {
    '遅れ': 'bg-red-100 text-red-700',
    '済': 'bg-gray-100 text-gray-600',
    '進行中': 'bg-blue-100 text-blue-700',
    '未着手': 'bg-gray-100 text-gray-700',
    '保留': 'bg-yellow-100 text-yellow-700',
    '着手遅れ': 'bg-orange-50 text-orange-600',
    '期限遅れ': 'bg-red-200 text-red-800',
  };

  // Date anomaly: parent's final due date must not be earlier than the latest subtask due date.
  const maxSubTaskDueDate = subTasks.reduce((max, t) => {
    const d = normalizeDate(t.due_date);
    return d > max ? d : max;
  }, '');
  const hasDateAnomaly =
    maxSubTaskDueDate !== '' &&
    normalizeDate(parentTask.deadline) < maxSubTaskDueDate;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 lg:gap-4 min-w-0">
          <button onClick={onBack} className="p-2 hover:bg-gray-200 rounded-full transition-colors flex-shrink-0">
            <ChevronLeft size={24} />
          </button>
          <div className="min-w-0">
            <h2 className="text-xl lg:text-3xl font-bold tracking-tight text-[#1d1d1f] truncate">{parentTask.name}</h2>
            <p className="text-[#86868b] text-xs lg:text-sm">
              最終期日: {parentTask.deadline}
              {hasDateAnomaly && (
                <span className="ml-2 text-red-600 font-bold inline-flex items-center gap-1 align-middle">
                  <AlertCircle size={14} />
                  <span className="hidden sm:inline">日付異常（サブタスクの期日 {maxSubTaskDueDate} を下回っています）</span>
                  <span className="sm:hidden">日付異常</span>
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pl-11 lg:pl-0">
          <button
            onClick={handleAddRow}
            className="mac-button mac-button-secondary flex items-center gap-2"
          >
            <Plus size={18} />
            <span>タスク追加</span>
          </button>
        </div>
      </div>

      {updateError && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1 break-all">{updateError}</span>
          <button
            onClick={() => setUpdateError(null)}
            className="text-red-600 hover:text-red-800 text-xs font-bold flex-shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <div className="mac-card overflow-hidden flex flex-col h-[calc(100vh-220px)] lg:h-[calc(100vh-250px)]">
        <div className="overflow-auto flex-1 relative">
          <DragDropContext onDragEnd={onDragEnd}>
            <table className="w-full text-left border-separate border-spacing-0">
              <thead className="sticky top-[56px] lg:top-0 z-50">
                <tr className="bg-gray-50">
                  <ResizableTh index={0} />
                  <ResizableTh index={1} title="日報">日報</ResizableTh>
                  <ResizableTh index={2} title="システム">システム</ResizableTh>
                  <ResizableTh index={3} title="タスク名">タスク名</ResizableTh>
                  <ResizableTh index={4} title="ステータス">ステータス</ResizableTh>
                  <ResizableTh index={5} title="開始日">開始日</ResizableTh>
                  <ResizableTh index={6} title="期日">期日</ResizableTh>
                  <ResizableTh index={7} title="期限">期限</ResizableTh>
                  <ResizableTh index={8} title="予定">予定</ResizableTh>
                  <ResizableTh index={9} title="実績">実績</ResizableTh>
                  <ResizableTh index={10} title="優先度">優先度</ResizableTh>
                  <ResizableTh index={11} title="備考">備考</ResizableTh>
                  <ResizableTh index={12} title="操作">操作</ResizableTh>
                </tr>
              </thead>
              <Droppable droppableId="subtasks-table">
                {(provided) => (
                  <tbody 
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="divide-y divide-gray-50"
                  >
                    {subTasks.map((task, index) => {
                      const isCompleted = task.status === '済';
                      const isHighlighted = highlightTaskId === task.id;
                      const LAST_COL = 12;

                      return (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided) => (
                            <tr
                              id={`task-${task.id}`}
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={cn(
                                "group transition-colors",
                                isCompleted ? "bg-[#f5f5f7]" : "hover:bg-gray-50"
                              )}
                            >
                              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(colIdx => {
                                const isFrozen = frozenColumns.includes(colIdx);
                                const left = getFrozenLeft(colIdx);
                                const width = columnWidths[colIdx];

                                // 選択ハイライトの枠線は <tr> に付けると固定列（不透明・高 z-index）に
                                // 隠れてしまうため、各セルに上下＋両端の inset box-shadow として描く。
                                let boxShadow: string | undefined;
                                if (isHighlighted) {
                                  const parts = [
                                    'inset 0 2px 0 0 #007aff',
                                    'inset 0 -2px 0 0 #007aff',
                                  ];
                                  if (colIdx === 0) parts.push('inset 2px 0 0 0 #007aff');
                                  if (colIdx === LAST_COL) parts.push('inset -2px 0 0 0 #007aff');
                                  boxShadow = parts.join(', ');
                                }

                                return (
                                  <td
                                    key={colIdx}
                                    style={{
                                      width,
                                      minWidth: width,
                                      maxWidth: width,
                                      left: isFrozen ? left : undefined,
                                      position: isFrozen ? 'sticky' : 'relative',
                                      ...(boxShadow ? { boxShadow } : {}),
                                    }}
                                    className={cn(
                                      "px-4 py-2 border-b border-gray-50 transition-colors",
                                      // z-index via class so focus-within can override inline style.
                                      // ハイライト行は固定列より前面（z-40）にして枠線を確実に見せる。
                                      isHighlighted ? "z-40" : isFrozen ? "z-30" : "z-[1]",
                                      // Raise above frozen columns (z-30) when a child has focus,
                                      // so focus rings/outlines aren't hidden by sticky neighbors
                                      "focus-within:!z-50",
                                      // Apply background colors to ALL cells (frozen and non-frozen) for consistency
                                      // Sticky cells need explicit bg, non-sticky cells get same bg to match
                                      isHighlighted
                                        ? "bg-blue-50/60"
                                        : isCompleted
                                          ? "bg-[#f5f5f7]"
                                          : "bg-white group-hover:bg-gray-50",
                                      isFrozen && !boxShadow && "shadow-[1px_0_0_0_rgba(0,0,0,0.05)]",
                                      isCompleted && !isFrozen && !isHighlighted && "opacity-60"
                                    )}
                                  >
                                    {colIdx === 0 && (
                                      <div {...provided.dragHandleProps} className="text-gray-300 hover:text-gray-600">
                                        <GripVertical size={16} />
                                      </div>
                                    )}
                                    {colIdx === 1 && (
                                      <div className="text-center">
                                        <button
                                          onClick={() => {
                                            const newIsInReport = !task.is_in_report;
                                            const updates: Partial<SubTask> = { is_in_report: newIsInReport };
                                            // Only set daily_report_date when first checking and no date is set yet
                                            if (newIsInReport && !task.daily_report_date) {
                                              updates.daily_report_date = new Date().toISOString().split('T')[0];
                                            }
                                            handleUpdate(task.id, updates);
                                          }}
                                          className={cn(
                                            "p-1 rounded transition-colors",
                                            task.is_in_report ? "text-[#007aff]" : "text-gray-300 hover:text-gray-400"
                                          )}
                                        >
                                          {task.is_in_report ? <CheckSquare size={18} /> : <Square size={18} />}
                                        </button>
                                      </div>
                                    )}
                                    {colIdx === 2 && (
                                      <EditableCell
                                        value={task.system}
                                        onSave={(val) => handleUpdate(task.id, { system: val as string })}
                                        className="text-sm truncate"
                                        title={task.system}
                                        placeholder="システム名"
                                      />
                                    )}
                                    {colIdx === 3 && (
                                      <div className="flex items-center gap-2">
                                        {/* Icon display/selector */}
                                        <button
                                          onClick={() => {
                                            setIconModalTask(task);
                                            setIconInput(task.icon_data || '');
                                          }}
                                          className="flex-shrink-0 p-1 rounded hover:bg-gray-200 transition-colors group"
                                          title="Click to add or edit icon"
                                        >
                                          {task.icon_data && task.icon_data.trim() ? (
                                            task.icon_data.startsWith('<') ? (
                                              <div
                                                className="w-5 h-5"
                                                dangerouslySetInnerHTML={{ __html: task.icon_data }}
                                              />
                                            ) : (
                                              <span className="text-sm">{task.icon_data}</span>
                                            )
                                          ) : (
                                            <div className="w-5 h-5 text-gray-300 group-hover:text-gray-400 transition-colors flex items-center justify-center">
                                              <span className="text-lg">+</span>
                                            </div>
                                          )}
                                        </button>
                                        <EditableCell
                                          type="textarea"
                                          rows={1}
                                          value={task.task_name}
                                          onSave={(val) => handleUpdate(task.id, { task_name: val as string })}
                                          className="font-medium text-sm py-1 truncate flex-1"
                                          title={task.task_name}
                                          placeholder="タスク名"
                                        />
                                      </div>
                                    )}
                                    {colIdx === 4 && (
                                      <select
                                        value={task.status}
                                        onChange={(e) => handleUpdate(task.id, { status: e.target.value as SubTaskStatus })}
                                        className={cn(
                                          "px-2 py-0.5 rounded-md text-[10px] font-bold focus:outline-none w-full",
                                          statusColors[task.status]
                                        )}
                                      >
                                        {Object.keys(statusColors).map(s => <option key={s} value={s}>{s}</option>)}
                                      </select>
                                    )}
                                    {colIdx === 5 && (
                                      <input
                                        type="date"
                                        value={task.start_date || ''}
                                        onChange={(e) => handleUpdate(task.id, { start_date: e.target.value })}
                                        className={cn(
                                          "bg-transparent focus:outline-none text-sm w-full",
                                          task.status === '着手遅れ' && "text-orange-600 font-bold bg-orange-50/30"
                                        )}
                                      />
                                    )}
                                    {colIdx === 6 && (() => {
                                      const shifted = !!task.original_due_date && task.original_due_date !== task.due_date;
                                      // シフト済みなら発生元（delay_shift_status）の色、未シフトなら自身のステータス色。
                                      const delayColor = (task.delay_shift_status ?? task.status) === '着手遅れ' ? 'text-orange-600' : 'text-red-600';
                                      return (
                                        <div className="flex flex-col leading-tight">
                                          {shifted && (
                                            <span className="text-[10px] text-gray-400 line-through tabular-nums">
                                              {fmtDate(task.original_due_date)}
                                            </span>
                                          )}
                                          <input
                                            type="date"
                                            value={task.due_date || ''}
                                            onChange={(e) => handleUpdate(task.id, { due_date: e.target.value })}
                                            className={cn(
                                              "bg-transparent focus:outline-none text-sm w-full",
                                              (task.status === '遅れ' || shifted) && cn(delayColor, "font-bold")
                                            )}
                                          />
                                        </div>
                                      );
                                    })()}
                                    {colIdx === 7 && (() => {
                                      const shifted = !!task.original_final_deadline && task.original_final_deadline !== task.final_deadline;
                                      // シフト済みなら発生元（delay_shift_status）の色、未シフトなら自身のステータス色。
                                      const delayColor = (task.delay_shift_status ?? task.status) === '着手遅れ' ? 'text-orange-600' : 'text-red-600';
                                      return (
                                        <div className="flex flex-col leading-tight">
                                          {shifted && (
                                            <span className="text-[10px] text-gray-400 line-through tabular-nums">
                                              {fmtDate(task.original_final_deadline)}
                                            </span>
                                          )}
                                          <input
                                            type="date"
                                            value={task.final_deadline}
                                            onChange={(e) => handleUpdate(task.id, { final_deadline: e.target.value })}
                                            className={cn(
                                              "bg-transparent focus:outline-none text-sm w-full",
                                              (task.status === '期限遅れ' || shifted) && cn(delayColor, "font-bold")
                                            )}
                                          />
                                        </div>
                                      );
                                    })()}
                                    {colIdx === 8 && (
                                      <EditableCell
                                        type="number"
                                        value={isNaN(task.planned_hours) ? 0 : task.planned_hours}
                                        onSave={(val) => handleUpdate(task.id, { planned_hours: val as number })}
                                        className="text-sm"
                                      />
                                    )}
                                    {colIdx === 9 && (
                                      <EditableCell
                                        type="number"
                                        value={isNaN(task.actual_hours) ? 0 : task.actual_hours}
                                        onSave={(val) => handleUpdate(task.id, { actual_hours: val as number })}
                                        className="text-sm"
                                      />
                                    )}
                                    {colIdx === 10 && (
                                      <select
                                        value={task.priority}
                                        onChange={(e) => handleUpdate(task.id, { priority: e.target.value as Priority })}
                                        className="bg-transparent focus:outline-none text-sm w-full"
                                      >
                                        <option value="A">A</option>
                                        <option value="B">B</option>
                                        <option value="C">C</option>
                                      </select>
                                    )}
                                    {colIdx === 11 && (
                                      <EditableCell
                                        type="textarea"
                                        rows={1}
                                        value={task.remarks || ''}
                                        onSave={(val) => handleUpdate(task.id, { remarks: val as string })}
                                        className="text-sm py-1 truncate"
                                        title={task.remarks || ''}
                                        placeholder="備考..."
                                      />
                                    )}
                                    {colIdx === 12 && (
                                      <div className="text-center">
                                        <button 
                                          onClick={() => setDeleteId(task.id)}
                                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </tbody>
                )}
              </Droppable>
            </table>
        </DragDropContext>
      </div>
      
      {subTasks.length === 0 && (
        <div className="py-20 text-center">
          <p className="text-[#86868b] italic text-sm">タスクが見つかりません。Excelからインポートするか、手動で追加してください。</p>
        </div>
      )}
    </div>

      {delayModalTask && (
        <DelayModal
          task={delayModalTask}
          siblings={subTasks}
          projectName={parentTask.name}
          onCancel={handleDelayCancel}
          onSubmit={handleDelaySubmit}
        />
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="mac-card max-w-sm w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertCircle size={24} />
              <h3 className="text-lg font-bold">削除の確認</h3>
            </div>
            <p className="text-[#1d1d1f] mb-6">
              このタスクを削除しますか？
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmDelete}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
              >
                削除する
              </button>
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {iconModalTask && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="mac-card max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-[#1d1d1f] mb-4">アイコンを選択</h3>

            <div className="space-y-4 mb-6">
              {/* Preset icons from lucide-react */}
              <div>
                <label className="block text-[10px] font-bold text-[#86868b] uppercase tracking-widest mb-3">
                  プリセット
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {[
                    { label: 'NEW', emoji: '🆕' },
                    { label: 'HOT', emoji: '🔥' },
                    { label: 'STAR', emoji: '⭐' },
                    { label: '✓', emoji: '✓' },
                    { label: '!', emoji: '⚠️' },
                    { label: 'BUG', emoji: '🐛' },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => {
                        handleUpdate(iconModalTask.id, { icon_data: item.emoji });
                        setIconModalTask(null);
                      }}
                      className="p-2 rounded-lg hover:bg-gray-100 transition-colors border border-gray-100 flex items-center justify-center"
                      title={item.label}
                    >
                      <span className="text-xl">{item.emoji}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom SVG input */}
              <div>
                <label className="block text-[10px] font-bold text-[#86868b] uppercase tracking-widest mb-2">
                  カスタム SVG または Emoji
                </label>
                <textarea
                  value={iconInput}
                  onChange={(e) => setIconInput(e.target.value)}
                  className="w-full px-4 py-3 bg-[#f5f5f7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 text-sm min-h-[80px] font-mono text-[11px]"
                  placeholder="SVG コード、Emoji、または任意のテキスト"
                />
                <p className="text-[9px] text-[#86868b] mt-2">
                  例: SVG コード: &lt;svg&gt;...&lt;/svg&gt; または Emoji: 😀
                </p>
              </div>
            </div>

            {/* Preview */}
            {iconInput && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg flex items-center justify-center min-h-[60px]">
                {iconInput.startsWith('<') ? (
                  <div
                    className="w-12 h-12"
                    dangerouslySetInnerHTML={{ __html: iconInput }}
                  />
                ) : (
                  <span className="text-4xl">{iconInput}</span>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (iconInput) {
                    handleUpdate(iconModalTask.id, { icon_data: iconInput });
                  }
                  setIconModalTask(null);
                }}
                disabled={!iconInput}
                className="flex-1 py-2.5 bg-[#007aff] text-white rounded-xl font-bold hover:bg-[#0070e0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                保存する
              </button>
              <button
                onClick={() => {
                  handleUpdate(iconModalTask.id, { icon_data: '' });
                  setIconModalTask(null);
                }}
                className="flex-1 py-2.5 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                削除する
              </button>
              <button
                onClick={() => setIconModalTask(null)}
                className="flex-1 py-2.5 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
