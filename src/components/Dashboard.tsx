import React, { useState, useEffect } from 'react';
import { ParentTask, SubTask, UserSettings, TaskTemplate, Priority } from '../types';
import {
  Plus,
  Calendar,
  Clock,
  AlertTriangle,
  ChevronRight,
  Trash2,
  Layers,
  CheckCircle2,
  LayoutGrid,
  List,
  BookTemplate,
  GripVertical,
  EyeOff,
  Type,
  Columns,
  FileText,
  BarChart3
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Resizable } from 'react-resizable';
import { taskService } from '../services/taskService';
import { todayBeijing } from '../dateUtils';
import { getEnabledViews, resolveActiveView, ProjectView } from '../viewPrefs';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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

type ProjectStatus = 'completed' | 'delayed' | 'start_delayed' | 'in_progress' | 'not_started';
type ProjectFilter = 'all' | 'delayed' | 'start_delayed' | 'in_progress' | 'completed';

// 定例作業（type === 'meeting'）であることを示す小さなチップ。
// 親タスクの名前の横に出して通常案件と区別する。
// （データ層では引き続き type === 'meeting' で管理。表示文言だけ「定例」）
const MeetingChip: React.FC = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 text-purple-700 flex-shrink-0">
    定例
  </span>
);

// Dot + label delay badge (matches reference project's "dot" bubble style).
const DelayBadge: React.FC<{ tone: 'danger' | 'warn' }> = ({ tone }) => {
  const cfg = tone === 'warn'
    ? { text: '着手遅れ', color: 'text-amber-600', dot: 'bg-amber-500', ring: 'ring-amber-500/15' }
    : { text: '遅延あり', color: 'text-red-600', dot: 'bg-red-500', ring: 'ring-red-500/15' };
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap', cfg.color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full ring-[3px]', cfg.dot, cfg.ring)} />
      {cfg.text}
    </span>
  );
};

// Subtask status pill colors (kept in sync with SubTaskManagement.tsx).
const SUBTASK_STATUS_PILL: Record<string, string> = {
  '遅れ': 'bg-red-100 text-red-700',
  '済': 'bg-gray-100 text-gray-600',
  '進行中': 'bg-blue-100 text-blue-700',
  '未着手': 'bg-gray-100 text-gray-700',
  '保留': 'bg-yellow-100 text-yellow-700',
  '着手遅れ': 'bg-orange-50 text-orange-600',
  '期限遅れ': 'bg-red-200 text-red-800',
};
const DELAYED_STATUSES = new Set(['遅れ', '期限遅れ', '着手遅れ']);

// 優先度バッジ（A=高 / B=中 / C=低）。週報モードの子タスク行で表示する。
const PRIORITY_META: Record<Priority, { label: string; cls: string }> = {
  A: { label: '高', cls: 'bg-red-100 text-red-700' },
  B: { label: '中', cls: 'bg-amber-100 text-amber-700' },
  C: { label: '低', cls: 'bg-gray-100 text-gray-600' },
};

interface DashboardProps {
  parentTasks: ParentTask[];
  onSelectTask: (task: ParentTask) => void;
  settings: UserSettings | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ parentTasks, onSelectTask, settings }) => {
  const [isAdding, setIsAdding] = useState(false);
  // 追加フォームのモード。'normal' = 通常案件（期日・テンプレあり）、'meeting' = 会議集（期日不要）。
  const [addMode, setAddMode] = useState<'normal' | 'meeting'>('normal');
  const [newName, setNewName] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [allSubTasks, setAllSubTasks] = useState<SubTask[]>([]);

  useEffect(() => {
    const unsubscribe = taskService.subscribeAllSubTasks(setAllSubTasks);
    const unsubscribeTemplates = taskService.subscribeTaskTemplates(setTemplates);
    return () => {
      unsubscribe();
      unsubscribeTemplates();
    };
  }, []);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string, name: string } | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const [weeklyExpanded, setWeeklyExpanded] = useState<Set<string>>(new Set());

  const enabledViews = getEnabledViews(settings);
  const activeView = resolveActiveView(settings);
  const isWeekly = activeView === 'weekly';
  // In weekly mode, expand all projects by default when entering the view.
  useEffect(() => {
    if (isWeekly) setWeeklyExpanded(new Set(parentTasks.map(p => p.id)));
    else setWeeklyExpanded(new Set());
  }, [isWeekly]);

  const setView = (view: ProjectView) => {
    if (settings) {
      taskService.updateSettings(settings.id, {
        ...settings,
        ui_preferences: { ...settings.ui_preferences, view },
      });
    }
  };
  const VIEW_BUTTONS: { view: ProjectView; title: string; icon: React.ReactNode }[] = [
    { view: 'grid', title: 'グリッド表示', icon: <LayoutGrid size={18} /> },
    { view: 'table', title: 'リスト表示', icon: <List size={18} /> },
    { view: 'weekly', title: '週報モード', icon: <FileText size={18} /> },
  ];
  const visibleViewButtons = VIEW_BUTTONS.filter(b => enabledViews[b.view]);
  const toggleWeeklyExpand = (id: string) => {
    setWeeklyExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Table Enhancements State
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({
    0: 40,   // Drag handle
    1: 300,  // Project Name
    2: 150,  // Due Date
    3: 150,  // Hours
    4: 150,  // Progress
    5: 120   // Actions
  });

  const ResizableTh = ({ index, children, title }: { index: number, children?: React.ReactNode, title?: string }) => {
    const width = columnWidths[index];

    return (
      <Resizable
        width={width}
        height={0}
        onResize={(_, { size }) => {
          setColumnWidths(prev => ({ ...prev, [index]: size.width }));
        }}
        draggableOpts={{ enableUserSelectHack: false }}
        handle={
          <div
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 z-50"
            onClick={e => e.stopPropagation()}
          />
        }
      >
        <th
          style={{ 
            width,
            minWidth: width,
            maxWidth: width,
            position: 'relative',
            zIndex: 40
          }}
          className="px-6 py-4 text-[10px] font-bold text-[#86868b] uppercase tracking-widest bg-gray-50 border-b border-black/5"
        >
          <div className="flex items-center justify-between group/th">
            <span className="truncate" title={title}>{children}</span>
          </div>
        </th>
      </Resizable>
    );
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    // 会議モードでは期日不要。通常モードでは期日必須。
    if (addMode === 'normal' && !newDueDate) return;

    try {
      // 会議集は期日・テンプレ展開なしで親だけ作る。子の会議は SubTaskManagement から追加。
      if (addMode === 'meeting') {
        await taskService.addParentTask({
          name: newName,
          deadline: '', // 会議集は親の期日を持たない
          planned_hours: 0,
          actual_hours: 0,
          progress: 0,
          type: 'meeting',
        });
        setNewName('');
        setNewDueDate('');
        setSelectedTemplateId('');
        setIsAdding(false);
        setAddMode('normal');
        return;
      }

      // テンプレ選択時は子タスクを先に取得し、親の予定工数・期日を自動算出する。
      const items = selectedTemplateId
        ? await taskService.getTemplateItems(selectedTemplateId)
        : [];
      // 親の予定工数 = 子タスク予定工数の合計。
      const totalPlanned = items.reduce((sum, it) => sum + (it.planned_hours || 0), 0);
      // 親の期日 = 子タスクの最も遅い期限（子が無ければ期日そのもの）。
      let parentDeadline = newDueDate;
      for (const it of items) {
        const d = taskService.calculateDeadline(newDueDate, it.planned_hours);
        if (normalizeDate(d) > normalizeDate(parentDeadline)) parentDeadline = d;
      }

      const parentId = await taskService.addParentTask({
        name: newName,
        deadline: parentDeadline,
        planned_hours: totalPlanned,
        actual_hours: 0,
        progress: 0,
        type: 'normal',
      });

      if (parentId && items.length) {
        const addPromises = items.map(item => taskService.addSubTask({
          parent_task_id: parentId,
          system: item.system,
          month: '',
          daily_report_date: todayBeijing(),
          start_date: '',
          due_date: newDueDate,
          final_deadline: taskService.calculateDeadline(newDueDate, item.planned_hours),
          status: '未着手',
          task_name: item.task_name,
          planned_hours: item.planned_hours,
          actual_hours: 0,
          priority: item.priority,
          remarks: item.remarks,
          week_number: 0,
          flag: 0
        }));
        await Promise.all(addPromises);
      }

      setNewName('');
      setNewDueDate('');
      setSelectedTemplateId('');
      setIsAdding(false);
      setAddMode('normal');
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    // Reordering rewrites global order indices, so only persist it in the unfiltered view.
    if (filter !== 'all') return;

    const items = Array.from(parentTasks);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    // Update local state for immediate feedback
    // Note: parentTasks is passed as prop, so we might need to handle this in App.tsx or just update DB
    // For now, let's update the DB for each item's order
    const updatePromises = items.map((item, index) => 
      taskService.updateParentTask(item.id, { order: index })
    );
    await Promise.all(updatePromises);
  };

  const handleHide = async (id: string) => {
    try {
      await taskService.updateParentTask(id, { is_hidden: true });
    } catch (err) {
      console.error('Failed to hide project:', err);
    }
  };

  const confirmClearAll = () => {
    setIsClearingAll(false);
    taskService.clearAllData().catch(err => {
      console.error('Failed to clear data:', err);
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    taskService.deleteParentTask(targetId).catch(err => {
      console.error('Failed to delete project:', err);
    });
  };

  const getProjectStats = (parentId: string) => {
    const subTasks = allSubTasks.filter(st => st.parent_task_id === parentId);
    if (subTasks.length === 0) return { progress: 0, planned: 0, actual: 0, hasSubTasks: false, hasDelay: false, status: 'not_started' as ProjectStatus, maxSubTaskDueDate: '' };

    const completed = subTasks.filter(st => st.status === '済').length;
    const progress = Math.round((completed / subTasks.length) * 100);
    const hasDeadlineDelay = subTasks.some(st => st.status === '遅れ' || st.status === '期限遅れ');
    const hasStartDelay = subTasks.some(st => st.status === '着手遅れ');
    const hasDelay = hasDeadlineDelay || hasStartDelay;
    const planned = subTasks.reduce((acc, st) => acc + (st.planned_hours || 0), 0);
    const actual = subTasks.reduce((acc, st) => acc + (st.actual_hours || 0), 0);

    const maxSubTaskDueDate = subTasks.reduce((max, st) => {
      const d = normalizeDate(st.due_date);
      return d > max ? d : max;
    }, '');

    let status: ProjectStatus;
    if (progress === 100) status = 'completed';
    else if (hasDeadlineDelay) status = 'delayed';
    else if (hasStartDelay) status = 'start_delayed';
    else if (progress > 0) status = 'in_progress';
    else status = 'not_started';

    return { progress, planned, actual, hasSubTasks: true, hasDelay, maxSubTaskDueDate, status };
  };

  const STATUS_META: Record<Exclude<ProjectStatus, 'completed' | 'in_progress' | 'not_started'>, { label: string; dot: string; text: string; borderClass: string; iconBg: string }> = {
    delayed: { label: '遅延あり', dot: 'bg-red-500', text: 'text-red-600', borderClass: 'border-l-red-500', iconBg: 'bg-red-50 text-red-600' },
    start_delayed: { label: '着手遅れ', dot: 'bg-amber-400', text: 'text-amber-600', borderClass: 'border-l-amber-400', iconBg: 'bg-amber-50 text-amber-600' },
  };

  const tasksWithStats = parentTasks.map(task => ({ task, stats: getProjectStats(task.id) }));
  const counts = {
    delayed: tasksWithStats.filter(t => t.stats.status === 'delayed').length,
    start_delayed: tasksWithStats.filter(t => t.stats.status === 'start_delayed').length,
    in_progress: tasksWithStats.filter(t => t.stats.status === 'in_progress').length,
    completed: tasksWithStats.filter(t => t.stats.status === 'completed').length,
  };
  const displayedTasks = filter === 'all'
    ? parentTasks
    : tasksWithStats.filter(t => t.stats.status === filter).map(t => t.task);

  const FILTER_TABS: { key: ProjectFilter; label: string; count?: number }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'delayed', label: '遅延あり', count: counts.delayed },
    { key: 'start_delayed', label: '着手遅れ', count: counts.start_delayed },
    { key: 'in_progress', label: '進行中', count: counts.in_progress },
    { key: 'completed', label: '完了', count: counts.completed },
  ];

  const TAB_COLORS: Record<ProjectFilter, { active: string; countColor: string }> = {
    all:           { active: 'bg-[#1d1d1f] text-white', countColor: 'text-gray-500' },
    delayed:       { active: 'bg-red-500 text-white',   countColor: 'text-red-500' },
    start_delayed: { active: 'bg-amber-400 text-white', countColor: 'text-amber-500' },
    in_progress:   { active: 'bg-[#007aff] text-white', countColor: 'text-[#007aff]' },
    completed:     { active: 'bg-green-500 text-white', countColor: 'text-green-600' },
  };

  // Weekly report mode: an expandable table where each project row reveals its subtasks.
  const displayedWithStats = displayedTasks.map(task => ({ task, stats: getProjectStats(task.id) }));
  const now = new Date();
  const weekLabel = `${now.getFullYear()}年${now.getMonth() + 1}月 第${Math.ceil(now.getDate() / 7)}週`;
  const getSubTasks = (parentId: string) =>
    allSubTasks.filter(st => st.parent_task_id === parentId);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#1d1d1f]">プロジェクト</h2>
          <p className="text-[#86868b] text-sm">案件と期限の管理</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {visibleViewButtons.length > 1 && (
            <div className="flex p-1 bg-gray-100 rounded-xl">
              {visibleViewButtons.map(b => (
                <button
                  key={b.view}
                  onClick={() => setView(b.view)}
                  className={`p-1.5 rounded-lg transition-all ${activeView === b.view ? 'bg-white text-[#007aff] shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}
                  title={b.title}
                >
                  {b.icon}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setIsClearingAll(true)}
            disabled={parentTasks.length === 0}
            className="mac-button mac-button-secondary flex items-center gap-2 text-xs sm:text-sm text-[#ff3b30] disabled:opacity-40"
            title="全てのタスク（親・子）を削除"
          >
            <Trash2 size={18} />
            <span className="hidden sm:inline">全タスク削除</span>
          </button>
          <button
            onClick={() => { setAddMode('normal'); setIsAdding(true); }}
            className="mac-button mac-button-primary flex items-center gap-2 text-xs sm:text-sm flex-1 sm:flex-initial justify-center"
          >
            <Plus size={18} />
            <span>新規プロジェクト</span>
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="mac-card p-6 animate-in fade-in slide-in-from-top-4">
          {/* 追加モードのラジオ。定例作業モードでは期日 / テンプレ欄を非表示にする。 */}
          <div className="mb-4 flex items-center gap-4 flex-wrap">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="add-mode"
                value="normal"
                checked={addMode === 'normal'}
                onChange={() => setAddMode('normal')}
                className="accent-[#007aff]"
              />
              <span className="text-sm font-medium text-[#1d1d1f]">通常案件</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="add-mode"
                value="meeting"
                checked={addMode === 'meeting'}
                onChange={() => setAddMode('meeting')}
                className="accent-[#007aff]"
              />
              <span className="text-sm font-medium text-[#1d1d1f]">定例作業</span>
            </label>
          </div>
          <form onSubmit={handleAdd} className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-[#86868b] uppercase tracking-widest mb-2">
                {addMode === 'meeting' ? '定例作業名' : 'プロジェクト名'}
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mac-input w-full"
                placeholder={addMode === 'meeting' ? '例: 定例作業' : '例: システム更新 2026'}
                required
              />
            </div>
            {addMode === 'normal' && (
              <>
                <div className="w-48">
                  <label className="block text-xs font-bold text-[#86868b] uppercase tracking-widest mb-2">期日</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="mac-input w-full"
                    required
                  />
                </div>
                <div className="w-64">
                  <label className="block text-xs font-bold text-[#86868b] uppercase tracking-widest mb-2">テンプレ (任意)</label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className="mac-input w-full"
                  >
                    <option value="">なし</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                className="mac-button mac-button-primary"
              >
                作成
              </button>
              <button
                type="button"
                onClick={() => { setIsAdding(false); setAddMode('normal'); }}
                className="mac-button mac-button-secondary"
              >
                キャンセル
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center gap-2 px-1 overflow-x-auto pb-1 mobile-hide-scrollbar border-t border-black/5 pt-3 -mx-1 sm:mx-0">
        {FILTER_TABS.map(tab => {
          const active = filter === tab.key;
          const c = TAB_COLORS[tab.key];
          const hasCount = tab.count !== undefined && tab.count > 0;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors flex-shrink-0",
                active ? c.active : "text-[#86868b] hover:text-[#1d1d1f]"
              )}
            >
              <span>{tab.label}</span>
              {hasCount && (
                <span className={cn("text-xs font-bold", active ? "text-white" : c.countColor)}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
        <div className="flex-shrink-0 ml-auto pl-2 border-l border-black/5 text-xs text-[#86868b] tabular-nums whitespace-nowrap hidden sm:flex items-baseline gap-1">
          <span className="text-[#1d1d1f] font-bold text-sm">{displayedTasks.length}</span>
          <span>/</span>
          <span>全 {parentTasks.length} 件</span>
        </div>
      </div>

      {activeView === 'weekly' ? (
        <div className="mac-card border border-[#007aff]/40 lg:overflow-x-auto">
          {/* Weekly mode bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-black/5 bg-gradient-to-r from-[#007aff]/8 to-transparent">
            <div className="flex items-center gap-2 text-[#007aff] font-bold text-sm">
              <FileText size={16} />
              <span>週報モード</span>
              <span className="text-[#86868b] font-medium text-xs ml-1">{weekLabel}</span>
            </div>
            <div className="flex gap-1.5 self-end sm:self-auto">
              <button
                onClick={() => setWeeklyExpanded(new Set(displayedTasks.map(t => t.id)))}
                className="bg-white border border-black/10 px-2.5 py-1 rounded-md text-xs font-semibold text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
              >全て展開</button>
              <button
                onClick={() => setWeeklyExpanded(new Set())}
                className="bg-white border border-black/10 px-2.5 py-1 rounded-md text-xs font-semibold text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
              >全て折りたたむ</button>
            </div>
          </div>

          {/* Column header - hidden on mobile (card layout instead) */}
          <div
            className="hidden lg:grid items-center gap-3 px-5 h-11 text-[11px] font-bold text-[#86868b] uppercase tracking-wider bg-[#f5f5f7]/80 border-b border-black/5 min-w-[820px]"
            style={{ gridTemplateColumns: '40px minmax(0,1.7fr) 150px 160px minmax(0,1.1fr) 80px' }}
          >
            <div />
            <div>プロジェクト名</div>
            <div>期日</div>
            <div>工数 (予定/実績)</div>
            <div>進捗</div>
            <div className="text-right">アクション</div>
          </div>

          {/* Project rows */}
          <div className="lg:min-w-[820px]">
            {displayedWithStats.map(({ task, stats }) => {
              const { progress, planned, actual, status } = stats;
              const isOpen = weeklyExpanded.has(task.id);
              const subs = getSubTasks(task.id);
              const isDeadlineWarning = !!stats.maxSubTaskDueDate && !!task.deadline && normalizeDate(task.deadline) < stats.maxSubTaskDueDate;
              return (
                <React.Fragment key={task.id}>
                  {/* Desktop: grid row */}
                  <div
                    className={cn(
                      "group hidden lg:grid items-center gap-3 px-5 min-h-[64px] border-b border-black/5 relative transition-colors hover:bg-[#f5f5f7]",
                      isOpen && "bg-[#f5f5f7]",
                      status === 'delayed' && "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:bg-red-500 before:rounded-r",
                      status === 'start_delayed' && "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:bg-amber-400 before:rounded-r"
                    )}
                    style={{ gridTemplateColumns: '40px minmax(0,1.7fr) 150px 160px minmax(0,1.1fr) 80px' }}
                  >
                    <button
                      onClick={() => toggleWeeklyExpand(task.id)}
                      className={cn(
                        "w-6 h-6 grid place-items-center rounded-md text-[#86868b] hover:bg-black/5 hover:text-[#1d1d1f] transition-all",
                        isOpen && "text-[#007aff]"
                      )}
                      title={isOpen ? '折りたたむ' : '子タスクを展開'}
                    >
                      <ChevronRight size={14} className={cn("transition-transform", isOpen && "rotate-90")} />
                    </button>

                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        "w-8 h-8 grid place-items-center rounded-[9px] flex-shrink-0",
                        status === 'delayed' ? "bg-red-50 text-red-600" : status === 'start_delayed' ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-[#007aff]"
                      )}>
                        <Calendar size={16} />
                      </div>
                      <span
                        className={cn(
                          "font-bold text-[15px] text-[#1d1d1f] truncate cursor-pointer hover:text-[#007aff]",
                          isOpen && "text-[#007aff]"
                        )}
                        onClick={() => onSelectTask(task)}
                        title="クリックで詳細を開く"
                      >
                        {task.name}
                      </span>
                      {task.type === 'meeting' && <MeetingChip />}
                      {status === 'delayed' && <DelayBadge tone="danger" />}
                      {status === 'start_delayed' && <DelayBadge tone="warn" />}
                    </div>

                    <div className={cn("flex items-center gap-1.5 text-[13px] tabular-nums", isDeadlineWarning ? "text-red-500 font-bold" : "text-[#86868b]")}>
                      <Clock size={13} />
                      <span>{task.deadline || '—'}</span>
                    </div>

                    <div className="flex items-center gap-1 text-[13px] font-medium tabular-nums">
                      <span className="text-[#1d1d1f] font-semibold">{planned}h</span>
                      <span className="text-[#86868b] mx-1">/</span>
                      <span className="text-[#007aff] font-semibold">{actual}h</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 max-w-[220px] bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-green-500' : 'bg-[#007aff]'}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-[#86868b] tabular-nums w-9 text-right">{progress}%</span>
                    </div>

                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleHide(task.id); }}
                        className="p-1.5 text-gray-300 hover:text-[#007aff] transition-colors"
                        title="非表示（履歴へ）"
                      >
                        <EyeOff size={16} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: task.id, name: task.name }); }}
                        className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Mobile: card-style row */}
                  <div
                    className={cn(
                      "lg:hidden p-3.5 border-b border-black/5 relative active:bg-[#f5f5f7] transition-colors",
                      status === 'delayed' && "border-l-[3px] border-l-red-500",
                      status === 'start_delayed' && "border-l-[3px] border-l-amber-400"
                    )}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <button
                        onClick={() => toggleWeeklyExpand(task.id)}
                        className={cn("w-6 h-6 grid place-items-center rounded-md text-[#86868b] flex-shrink-0 mt-1", isOpen && "text-[#007aff]")}
                      >
                        <ChevronRight size={14} className={cn("transition-transform", isOpen && "rotate-90")} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={cn("font-bold text-[15px] text-[#1d1d1f] truncate cursor-pointer", isOpen && "text-[#007aff]")}
                            onClick={() => onSelectTask(task)}
                          >
                            {task.name}
                          </span>
                          {task.type === 'meeting' && <MeetingChip />}
                          {status === 'delayed' && <DelayBadge tone="danger" />}
                          {status === 'start_delayed' && <DelayBadge tone="warn" />}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: task.id, name: task.name }); }}
                        className="p-1.5 text-gray-300 hover:text-red-500 flex-shrink-0"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-4 ml-8 mb-2">
                      <div className={cn("flex items-center gap-1.5 text-[13px] tabular-nums", isDeadlineWarning ? "text-red-500 font-bold" : "text-[#86868b]")}>
                        <Clock size={13} />
                        <span>{task.deadline || '—'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[13px] font-medium tabular-nums">
                        <span className="text-[#1d1d1f] font-semibold">{planned}h</span>
                        <span className="text-[#86868b] mx-0.5">/</span>
                        <span className="text-[#007aff] font-semibold">{actual}h</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ml-8">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-green-500' : 'bg-[#007aff]'}`} style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-xs font-bold text-[#86868b] tabular-nums w-9 text-right">{progress}%</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-b border-black/5 bg-gradient-to-b from-[#007aff]/[0.025] to-transparent px-3 sm:px-5 lg:pl-[68px] py-3 overflow-x-auto mobile-hide-scrollbar">
                      {subs.length === 0 ? (
                        <div className="py-4 text-center text-[#86868b] text-[13px]">子タスクはありません</div>
                      ) : (
                        <>
                          <div
                            className="grid items-center gap-3 px-3.5 pb-2 text-[10.5px] font-bold text-[#86868b] uppercase tracking-wider border-b border-black/5 min-w-[880px]"
                            style={{ gridTemplateColumns: '18px minmax(150px,1.5fr) 110px 90px 100px 100px 100px 110px' }}
                          >
                            <div />
                            <div>タスク名</div>
                            <div>ステータス</div>
                            <div>優先度</div>
                            <div>開始日</div>
                            <div>期日</div>
                            <div>期限</div>
                            <div>予定/実績</div>
                          </div>
                          {subs.map(t => {
                            const isLate = DELAYED_STATUSES.has(t.status);
                            const isStartDelay = t.status === '着手遅れ';
                            // フィルター切替時、対象の遅延タスク下に遅延理由行を表示する。
                            const showDelayReason = !!t.delay_reason && (
                              (filter === 'delayed' && (t.status === '遅れ' || t.status === '期限遅れ')) ||
                              (filter === 'start_delayed' && isStartDelay)
                            );
                            return (
                              <React.Fragment key={t.id}>
                              <div
                                title={t.remarks ? `備考: ${t.remarks}` : undefined}
                                className={cn(
                                  "grid items-center gap-3 px-3.5 py-2 my-1 bg-white rounded-lg border border-black/5 text-[12.5px] transition-all hover:border-[#007aff] hover:translate-x-0.5 min-w-[880px]",
                                  isLate && "border-l-[3px] border-l-red-500"
                                )}
                                style={{ gridTemplateColumns: '18px minmax(150px,1.5fr) 110px 90px 100px 100px 100px 110px' }}
                              >
                                <div className="text-gray-300">
                                  <ChevronRight size={10} />
                                </div>
                                <div className="font-semibold text-[#1d1d1f] truncate" title={t.remarks || t.task_name}>{t.task_name}</div>
                                <div>
                                  <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold", SUBTASK_STATUS_PILL[t.status] || 'bg-gray-100 text-gray-700')}>
                                    {t.status}
                                  </span>
                                </div>
                                <div>
                                  {t.priority && PRIORITY_META[t.priority] ? (
                                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold", PRIORITY_META[t.priority].cls)}>
                                      <BarChart3 size={10} />
                                      {PRIORITY_META[t.priority].label}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </div>
                                <div className="text-[#86868b] tabular-nums">{t.start_date || '—'}</div>
                                <div className={cn("tabular-nums", isLate ? "text-red-500 font-bold" : "text-[#86868b]")}>{t.due_date || '—'}</div>
                                <div className={cn("tabular-nums", t.status === '期限遅れ' ? "text-red-500 font-bold" : "text-[#86868b]")}>{t.final_deadline || '—'}</div>
                                <div className="tabular-nums text-[#86868b]">
                                  <span>{t.planned_hours}h</span>
                                  <span className="text-gray-300 mx-1">/</span>
                                  <span className="text-[#007aff] font-semibold">{t.actual_hours}h</span>
                                </div>
                              </div>

                              {showDelayReason && (
                                <div
                                  className={cn(
                                    "flex items-center gap-2 px-3.5 py-2 mb-1.5 -mt-0.5 rounded-lg text-[12px] min-w-[880px]",
                                    isStartDelay ? "bg-amber-50" : "bg-red-50"
                                  )}
                                >
                                  <AlertTriangle
                                    size={13}
                                    className={cn("flex-shrink-0", isStartDelay ? "text-amber-500" : "text-red-500")}
                                  />
                                  <span
                                    className={cn(
                                      "px-1.5 py-0.5 rounded font-bold text-[10.5px] flex-shrink-0",
                                      isStartDelay ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                                    )}
                                  >
                                    遅延理由
                                  </span>
                                  <span className={cn("flex-1 min-w-0 truncate", isStartDelay ? "text-amber-800" : "text-red-800")} title={t.delay_reason}>
                                    {t.delay_reason}
                                  </span>
                                  {!!t.delay_impact_days && (
                                    <span className={cn("font-bold whitespace-nowrap flex-shrink-0", isStartDelay ? "text-amber-600" : "text-red-600")}>
                                      {t.delay_impact_days}日遅延
                                    </span>
                                  )}
                                </div>
                              )}
                              </React.Fragment>
                            );
                          })}
                          <div className="flex justify-end pt-2">
                            <button
                              onClick={() => onSelectTask(task)}
                              className="inline-flex items-center gap-1 text-[#007aff] text-[11.5px] font-semibold px-2 py-1 rounded-md hover:bg-[#007aff]/8 transition-colors"
                            >
                              詳細を開く
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {displayedTasks.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-[#86868b] italic">
                {filter === 'all' ? 'プロジェクトが見つかりません。新規作成してください。' : '該当するプロジェクトがありません。'}
              </p>
            </div>
          )}
        </div>
      ) : (
      <DragDropContext onDragEnd={onDragEnd}>
        {activeView === 'table' ? (
          <>
            {/* Desktop table view */}
            <div className="mac-card overflow-x-auto hidden lg:block">
              <table className="w-full text-left border-separate border-spacing-0 min-w-[800px]">
                <thead className="sticky top-0 z-50">
                  <tr className="mac-table-header border-b border-black/5">
                    <ResizableTh index={0} />
                    <ResizableTh index={1} title="プロジェクト名">プロジェクト名</ResizableTh>
                    <ResizableTh index={2} title="期日">期日</ResizableTh>
                    <ResizableTh index={3} title="工数 (予定/実績)">工数 (予定/実績)</ResizableTh>
                    <ResizableTh index={4} title="進捗">進捗</ResizableTh>
                    <ResizableTh index={5} title="アクション">アクション</ResizableTh>
                  </tr>
                </thead>
                <Droppable droppableId="projects-table">
                  {(provided) => (
                    <tbody
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="divide-y divide-black/5"
                    >
                      {displayedTasks.map((task, index) => {
                        const { progress, planned, actual, hasSubTasks, maxSubTaskDueDate, status } = getProjectStats(task.id);
                        const isDeadlineWarning = !!maxSubTaskDueDate && !!task.deadline && normalizeDate(task.deadline) < maxSubTaskDueDate;
                        const statusMeta = status === 'delayed' || status === 'start_delayed' ? STATUS_META[status] : null;
                        return (
                          <Draggable key={task.id} draggableId={task.id} index={index}>
                            {(provided) => (
                              <tr
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={cn(
                                  "mac-table-row cursor-pointer group transition-colors",
                                  progress === 100 ? "bg-[#f5f5f7]" : ""
                                )}
                                onClick={() => onSelectTask(task)}
                              >
                                {[0, 1, 2, 3, 4, 5].map(colIdx => {
                                  const width = columnWidths[colIdx];

                                  return (
                                    <td
                                      key={colIdx}
                                      style={{
                                        width,
                                        minWidth: width,
                                        maxWidth: width,
                                        position: 'relative',
                                        zIndex: 1
                                      }}
                                      className={cn(
                                        "px-6 py-4 border-b border-black/5 transition-colors",
                                        colIdx === 0 && statusMeta && `border-l-4 ${statusMeta.borderClass}`
                                      )}
                                    >
                                      {colIdx === 0 && (
                                        <div {...provided.dragHandleProps} className="text-gray-300 hover:text-gray-600">
                                          <GripVertical size={16} />
                                        </div>
                                      )}
                                      {colIdx === 1 && (
                                        <div className="flex items-center gap-2 min-w-0">
                                          <div className={cn(
                                            "p-1.5 rounded-lg flex-shrink-0",
                                            statusMeta ? statusMeta.iconBg : "bg-blue-50 text-[#007aff]"
                                          )}>
                                            <Calendar size={16} />
                                          </div>
                                          <span className="font-bold text-[#1d1d1f] truncate">
                                            {task.name}
                                          </span>
                                          {task.type === 'meeting' && <MeetingChip />}
                                          {statusMeta && (
                                            <span className={cn("flex items-center gap-1.5 flex-shrink-0 text-xs font-semibold", statusMeta.text)}>
                                              <span className={cn("w-1.5 h-1.5 rounded-full", statusMeta.dot)} />
                                              {statusMeta.label}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      {colIdx === 2 && (
                                        <div className="flex items-center gap-2">
                                          <Clock size={14} className={cn("flex-shrink-0", isDeadlineWarning ? "text-red-500" : "")} />
                                          <input
                                            type="date"
                                            value={task.deadline}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={async (e) => {
                                              e.stopPropagation();
                                              await taskService.updateParentTask(task.id, { deadline: e.target.value });
                                            }}
                                            className={cn(
                                              "bg-transparent focus:outline-none border-none p-0 text-sm cursor-pointer w-full",
                                              isDeadlineWarning ? "text-red-500 font-bold" : "text-[#86868b]"
                                            )}
                                          />
                                        </div>
                                      )}
                                      {colIdx === 3 && (
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                          <span className="text-[#1d1d1f]">{planned}h</span>
                                          <span className="text-[#86868b]">/</span>
                                          <span className="text-[#007aff]">{actual}h</span>
                                        </div>
                                      )}
                                      {colIdx === 4 && (
                                        hasSubTasks ? (
                                          <div className="flex items-center gap-3 w-full">
                                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                              <div
                                                className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-green-500' : 'bg-[#007aff]'}`}
                                                style={{ width: `${progress}%` }}
                                              />
                                            </div>
                                            <span className="text-[10px] font-bold text-[#1d1d1f] flex-shrink-0">{progress}%</span>
                                          </div>
                                        ) : (
                                          <span className="text-[10px] text-[#86868b] italic">No tasks</span>
                                        )
                                      )}
                                      {colIdx === 5 && (
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleHide(task.id);
                                            }}
                                            className="p-2 text-gray-300 hover:text-[#007aff] transition-colors"
                                            title="非表示（履歴へ）"
                                          >
                                            <EyeOff size={16} />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setDeleteTarget({ id: task.id, name: task.name });
                                            }}
                                            className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                          <ChevronRight size={16} className="text-gray-300" />
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
              {displayedTasks.length === 0 && !isAdding && (
                <div className="py-20 text-center">
                  <p className="text-[#86868b] italic">
                    {filter === 'all' ? 'プロジェクトが見つかりません。新規作成してください。' : '該当するプロジェクトがありません。'}
                  </p>
                </div>
              )}
            </div>

            {/* Mobile card view (replaces table on small screens) */}
            <div className="flex flex-col gap-2.5 lg:hidden">
              {displayedTasks.map((task) => {
                const { progress, planned, actual, hasSubTasks, maxSubTaskDueDate, status } = getProjectStats(task.id);
                const isDeadlineWarning = !!maxSubTaskDueDate && !!task.deadline && normalizeDate(task.deadline) < maxSubTaskDueDate;
                const statusMeta = status === 'delayed' || status === 'start_delayed' ? STATUS_META[status] : null;
                return (
                  <div
                    key={task.id}
                    className={cn(
                      "bg-white border border-black/5 rounded-xl shadow-sm p-3.5 cursor-pointer active:bg-[#f5f5f7] transition-colors relative",
                      statusMeta && "border-l-[3px]",
                      status === 'delayed' && "border-l-red-500",
                      status === 'start_delayed' && "border-l-amber-400"
                    )}
                    onClick={() => onSelectTask(task)}
                  >
                    {/* Row 1: Name + actions */}
                    <div className="flex items-start gap-2.5 mb-2.5">
                      <div className={cn(
                        "w-8 h-8 grid place-items-center rounded-[9px] flex-shrink-0",
                        statusMeta ? statusMeta.iconBg : "bg-blue-50 text-[#007aff]"
                      )}>
                        <Calendar size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-[15px] text-[#1d1d1f] truncate">{task.name}</span>
                          {task.type === 'meeting' && <MeetingChip />}
                          {statusMeta && <DelayBadge tone={status === 'start_delayed' ? 'warn' : 'danger'} />}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleHide(task.id); }}
                          className="p-1.5 text-gray-300 hover:text-[#007aff]"
                          title="非表示"
                        >
                          <EyeOff size={16} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: task.id, name: task.name }); }}
                          className="p-1.5 text-gray-300 hover:text-red-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Row 2: Due + Hours */}
                    <div className="flex items-center justify-between gap-4 mb-2.5">
                      <div className={cn("flex items-center gap-1.5 text-[13px] tabular-nums", isDeadlineWarning ? "text-red-500 font-bold" : "text-[#86868b]")}>
                        <Clock size={13} />
                        <span>{task.deadline || '—'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[13px] font-medium tabular-nums">
                        <span className="text-[#1d1d1f] font-semibold">{planned}h</span>
                        <span className="text-[#86868b] mx-0.5">/</span>
                        <span className="text-[#007aff] font-semibold">{actual}h</span>
                      </div>
                    </div>

                    {/* Row 3: Progress bar */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-green-500' : 'bg-[#007aff]'}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-[#86868b] tabular-nums w-9 text-right">{progress}%</span>
                    </div>
                  </div>
                );
              })}
              {displayedTasks.length === 0 && !isAdding && (
                <div className="py-20 text-center">
                  <p className="text-[#86868b] italic">
                    {filter === 'all' ? 'プロジェクトが見つかりません。新規作成してください。' : '該当するプロジェクトがありません。'}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <Droppable droppableId="projects-grid" direction="horizontal">
            {(provided) => (
              <div 
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              >
                {displayedTasks.map((task, index) => {
                  const { progress, planned, actual, hasSubTasks, maxSubTaskDueDate, status } = getProjectStats(task.id);
                  const isDeadlineWarning = !!maxSubTaskDueDate && !!task.deadline && normalizeDate(task.deadline) < maxSubTaskDueDate;
                  const statusMeta = status === 'delayed' || status === 'start_delayed' ? STATUS_META[status] : null;

                  return (
                    <Draggable key={task.id} draggableId={task.id} index={index}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={cn(
                            "mac-card group hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer relative overflow-hidden",
                            status === 'delayed' && "border-t-[3px] border-t-red-500",
                            status === 'start_delayed' && "border-t-[3px] border-t-amber-400"
                          )}
                          onClick={() => onSelectTask(task)}
                        >
                          <div className="p-[18px] flex flex-col h-full">
                            <div className="flex items-center justify-between gap-2 mb-3.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <div {...provided.dragHandleProps} className="text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <GripVertical size={16} />
                                </div>
                                <div className={cn(
                                  "w-8 h-8 grid place-items-center rounded-[9px] flex-shrink-0",
                                  statusMeta ? statusMeta.iconBg : "bg-blue-50 text-[#007aff]"
                                )}>
                                  <Calendar size={16} />
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {status === 'delayed' && <DelayBadge tone="danger" />}
                                {status === 'start_delayed' && <DelayBadge tone="warn" />}
                                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleHide(task.id);
                                    }}
                                    className="p-1.5 text-gray-300 hover:text-[#007aff] transition-colors"
                                    title="非表示（履歴へ）"
                                  >
                                    <EyeOff size={16} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteTarget({ id: task.id, name: task.name });
                                    }}
                                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            </div>

                            <h3 className="text-base font-bold text-[#1d1d1f] group-hover:text-[#007aff] transition-colors mb-1.5 truncate flex items-center gap-2">
                              <span className="truncate">{task.name}</span>
                              {task.type === 'meeting' && <MeetingChip />}
                            </h3>

                            <div className="flex items-center gap-1.5 text-[13px] mb-4">
                              <Clock size={13} className={isDeadlineWarning ? "text-red-500" : "text-[#86868b]"} />
                              <span className={cn(
                                "font-medium tabular-nums",
                                isDeadlineWarning ? "text-red-500 font-bold" : "text-[#86868b]"
                              )}>
                                {task.deadline || '—'}
                              </span>
                            </div>

                            <div className="mt-auto space-y-2.5">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-green-500' : 'bg-[#007aff]'}`}
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <span className="text-xs font-bold text-[#86868b] tabular-nums w-9 text-right">{progress}%</span>
                              </div>

                              <div className="flex items-center gap-1 text-[13px] font-medium tabular-nums">
                                <span className="text-[#1d1d1f] font-semibold">{planned}h</span>
                                <span className="text-[#86868b] mx-1">/</span>
                                <span className="text-[#007aff] font-semibold">{actual}h</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
                {displayedTasks.length === 0 && !isAdding && (
                  <div className="col-span-full py-20 text-center mac-card border-dashed">
                    <p className="text-[#86868b] italic">
                      {filter === 'all' ? 'プロジェクトが見つかりません。新規作成してください。' : '該当するプロジェクトがありません。'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </Droppable>
        )}
      </DragDropContext>
      )}

      {(deleteTarget || isClearingAll) && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="mac-card max-w-sm w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-lg font-bold">削除の確認</h3>
            </div>
            <p className="text-[#1d1d1f] mb-6">
              {isClearingAll
                ? '全てのタスク（親タスク・子タスク）を削除しますか？この操作は取り消せません。'
                : `「${deleteTarget?.name}」と全ての関連タスクを削除しますか？`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => (isClearingAll ? confirmClearAll() : confirmDelete())}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
              >
                削除する
              </button>
              <button
                onClick={() => {
                  setDeleteTarget(null);
                  setIsClearingAll(false);
                }}
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
