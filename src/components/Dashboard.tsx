import React, { useState, useEffect, useMemo } from 'react';
import {
  ParentTask,
  SubTask,
  UserSettings,
  TaskTemplate,
  Priority,
  TaskFilter,
  QuickFilter,
} from '../types';
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
  BarChart3,
  Search,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Resizable } from 'react-resizable';
import { taskService } from '../services/taskService';
import { todayBeijing, addBusinessDays } from '../dateUtils';
import { getEnabledViews, resolveActiveView, ProjectView } from '../viewPrefs';
import { EMPTY_FILTER, isFilterActive, matchSubTask } from '../taskFilter';
import { groupSubTasksByWeek, computeWeekPriorityStats } from '../weekReport';

/**
 * sessionStorage キー群。Dashboard の UI 状態を子タスク画面への往復で消えないように保持する。
 * 同タブ内は維持、タブを閉じれば消える（= 直感的な「会話セッション」スコープ）。
 *  - FILTER_SESSION_KEY    : 詳細検索 TaskFilter（キーワード等）
 *  - FILTER_TAB_KEY        : 案件レベルのタブ選択（遅延あり / 期限間近 等）
 *  - LAST_CLICKED_TASK_KEY : 直前にクリックしたタスク ID（扁平リストで戻った時の位置復元）
 */
const FILTER_SESSION_KEY = 'taskmaster_dashboard_filter';
const FILTER_TAB_KEY = 'taskmaster_dashboard_filter_tab';
const LAST_CLICKED_TASK_KEY = 'taskmaster_dashboard_last_task';

function loadFilterFromSession(): TaskFilter {
  if (typeof sessionStorage === 'undefined') return EMPTY_FILTER;
  try {
    const raw = sessionStorage.getItem(FILTER_SESSION_KEY);
    if (!raw) return EMPTY_FILTER;
    const parsed = JSON.parse(raw) as Partial<TaskFilter>;
    // 形が壊れていても落ちないよう EMPTY_FILTER とマージする。
    return { ...EMPTY_FILTER, ...parsed };
  } catch {
    return EMPTY_FILTER;
  }
}

function loadFilterTabFromSession(): ProjectFilter {
  if (typeof sessionStorage === 'undefined') return 'all';
  try {
    const raw = sessionStorage.getItem(FILTER_TAB_KEY) as ProjectFilter | null;
    // 想定外の値が混入してもクラッシュしないよう既知値だけ受け付ける。
    const known: ProjectFilter[] = ['all', 'delayed', 'start_delayed', 'final_deadline_near', 'start_near', 'in_progress', 'completed'];
    if (raw && (known as string[]).includes(raw)) return raw;
  } catch {}
  return 'all';
}
import { FilterForm } from './FilterForm';
import { SubTaskSearchResults } from './SubTaskSearchResults';

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

type ProjectStatus =
  | 'completed'
  | 'delayed'
  | 'start_delayed'
  | 'final_deadline_near'
  | 'start_near'
  | 'in_progress'
  | 'not_started';
type ProjectFilter =
  | 'all'
  | 'delayed'
  | 'start_delayed'
  | 'final_deadline_near'
  | 'start_near'
  | 'in_progress'
  | 'completed';

// 定例作業（type === 'meeting'）であることを示す小さなチップ。
// 親タスクの名前の横に出して通常案件と区別する。
// （データ層では引き続き type === 'meeting' で管理。表示文言だけ「定例」）
const MeetingChip: React.FC = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 text-purple-700 flex-shrink-0">
    定例
  </span>
);

// Dot + label badge（カード上の状態バッジ）。danger=遅延あり / warn=着手遅れ /
// urgent=期限間近 / soon=開始間近。色は STATUS_META と整合。
type BadgeTone = 'danger' | 'warn' | 'urgent' | 'soon';
const BADGE_CFG: Record<BadgeTone, { text: string; color: string; dot: string; ring: string }> = {
  danger: { text: '遅延あり', color: 'text-red-600',    dot: 'bg-red-500',    ring: 'ring-red-500/15' },
  warn:   { text: '着手遅れ', color: 'text-amber-600',  dot: 'bg-amber-500',  ring: 'ring-amber-500/15' },
  urgent: { text: '期限間近', color: 'text-orange-600', dot: 'bg-orange-500', ring: 'ring-orange-500/15' },
  soon:   { text: '開始間近', color: 'text-cyan-700',   dot: 'bg-cyan-500',   ring: 'ring-cyan-500/15' },
};
const DelayBadge: React.FC<{ tone: BadgeTone }> = ({ tone }) => {
  const cfg = BADGE_CFG[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap', cfg.color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full ring-[3px]', cfg.dot, cfg.ring)} />
      {cfg.text}
    </span>
  );
};

/** ProjectStatus → BadgeTone（バッジを出すべきステータスかも判定）。 */
const statusToBadgeTone = (s: ProjectStatus): BadgeTone | null => {
  if (s === 'delayed') return 'danger';
  if (s === 'start_delayed') return 'warn';
  if (s === 'final_deadline_near') return 'urgent';
  if (s === 'start_near') return 'soon';
  return null;
};

/** ProjectStatus → 左端 / 上端アクセント色。Tailwind JIT が拾えるよう完全な class 文字列で持つ。 */
const STATUS_BEFORE_BG: Partial<Record<ProjectStatus, string>> = {
  delayed: 'before:bg-red-500',
  start_delayed: 'before:bg-amber-400',
  final_deadline_near: 'before:bg-orange-500',
  start_near: 'before:bg-cyan-500',
};
const STATUS_BORDER_L: Partial<Record<ProjectStatus, string>> = {
  delayed: 'border-l-red-500',
  start_delayed: 'border-l-amber-400',
  final_deadline_near: 'border-l-orange-500',
  start_near: 'border-l-cyan-500',
};
const STATUS_BORDER_T: Partial<Record<ProjectStatus, string>> = {
  delayed: 'border-t-red-500',
  start_delayed: 'border-t-amber-400',
  final_deadline_near: 'border-t-orange-500',
  start_near: 'border-t-cyan-500',
};
/** カード左上の Calendar icon の背景色。 */
const STATUS_ICON_BG: Partial<Record<ProjectStatus, string>> = {
  delayed: 'bg-red-50 text-red-600',
  start_delayed: 'bg-amber-50 text-amber-600',
  final_deadline_near: 'bg-orange-50 text-orange-600',
  start_near: 'bg-cyan-50 text-cyan-700',
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
  /** 親で集約した全子タスク（App.tsx 経由）。ローカルでは再 subscribe しない。 */
  allSubTasks: SubTask[];
  onSelectTask: (task: ParentTask) => void;
  /** タスク検索結果からのジャンプ。App.tsx の jumpToTask を渡す（履歴行きも解決）。 */
  onJumpToTask: (task: { id: string; parent_task_id: string }) => void;
  settings: UserSettings | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ parentTasks, allSubTasks, onSelectTask, onJumpToTask, settings }) => {
  const [isAdding, setIsAdding] = useState(false);
  // 追加フォームのモード。'normal' = 通常案件（期日・テンプレあり）、'meeting' = 会議集（期日不要）。
  const [addMode, setAddMode] = useState<'normal' | 'meeting'>('normal');
  const [newName, setNewName] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  // allSubTasks は App.tsx から props で渡ってくる（重複 subscribe 排除のため）

  // ─── タスク検索（詳細フィルタ + クイックフィルタ + キーワード）────────
  // Settings 上の quick_filters はチップとして渡ってくる。
  // フィルタ ON のときは「マッチしたタスクの扁平リスト」のみ表示。案件カード切替は混乱を招くため廃止。
  // フィルタは sessionStorage に保存。子タスク画面に飛んで戻っても消えない（Dashboard 自体は
  // 親子画面切替時に unmount されるため、ローカル state だけだと毎回リセットされてしまう）。
  const [taskFilter, setTaskFilter] = useState<TaskFilter>(loadFilterFromSession);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  const filterActive = isFilterActive(taskFilter);

  // taskFilter を sessionStorage に同期。空フィルタなら削除しておく。
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return;
    try {
      if (filterActive) {
        sessionStorage.setItem(FILTER_SESSION_KEY, JSON.stringify(taskFilter));
      } else {
        sessionStorage.removeItem(FILTER_SESSION_KEY);
      }
    } catch {
      // QuotaExceeded など。検索条件が消えるだけなので致命ではない。
    }
  }, [taskFilter, filterActive]);
  const quickFilters: QuickFilter[] = settings?.quick_filters ?? [];

  // 親 ID → ParentTask Map（検索結果リストで親名表示に使う）。
  const parentMap = useMemo(() => {
    const m = new Map<string, ParentTask>();
    for (const p of parentTasks) m.set(p.id, p);
    return m;
  }, [parentTasks]);

  // 「期限間近」「開始間近」判定の地平線。getProjectStats でも nearTasksByFilter でも使う。
  // 既定 1 営業日。settings.near_threshold_days で 1〜30 の範囲に変更可能。
  // 営業日加算なので、金曜に「1 営業日先」と言えば月曜になる（土日スキップ）。
  const nearThresholdDays = Math.max(0, Math.min(30, settings?.near_threshold_days ?? 1));
  const todayStr = todayBeijing();
  const nearHorizon = addBusinessDays(todayStr, nearThresholdDays);

  // 検索条件に合致する子タスクを抽出。
  // 親が visible parentMap に居ないもの（履歴行き / 完全削除）は除外する。
  // 検索は「現役で動いているタスクを探す」のが主目的のため、アーカイブ済みや孤児は出さない。
  const matchedTasks = useMemo(() => {
    if (!filterActive) return [];
    return allSubTasks.filter(t => {
      const parent = parentMap.get(t.parent_task_id);
      if (!parent) return false; // 履歴行き or 完全削除 → 検索結果から除外
      return matchSubTask(t, parent, taskFilter);
    });
  }, [filterActive, allSubTasks, parentMap, taskFilter]);

  // 「期限間近」「開始間近」タブ用：プロジェクトカードではなく、該当する **子タスク自体** の
  // 扁平リストを出すため、子タスク粒度で抽出する（タブカウントもこちらを使う）。
  // 親が visible parentMap に居ないものは除外（履歴行き / 完全削除）。
  const nearTasksByFilter = useMemo(() => {
    const finalDeadlineNear: SubTask[] = [];
    const startNear: SubTask[] = [];
    for (const t of allSubTasks) {
      const parent = parentMap.get(t.parent_task_id);
      if (!parent) continue;
      // 期限間近：済以外 + 今日 ≤ 期日 ≤ horizon （期日基準）
      if (t.status !== '済') {
        const d = normalizeDate(t.due_date);
        if (d && d >= todayStr && d <= nearHorizon) finalDeadlineNear.push(t);
      }
      // 開始間近：未着手 + 今日 ≤ 開始日 ≤ horizon
      if (t.status === '未着手') {
        const sd = normalizeDate(t.start_date);
        if (sd && sd >= todayStr && sd <= nearHorizon) startNear.push(t);
      }
    }
    return { finalDeadlineNear, startNear };
  }, [allSubTasks, parentMap, todayStr, nearHorizon]);

  // クイックフィルタ適用：チップをクリックすると条件をそのまま反映。
  const applyQuickFilter = (qf: QuickFilter) => {
    setTaskFilter(qf.filter);
  };

  // 全クリア。
  const clearFilter = () => setTaskFilter(EMPTY_FILTER);

  useEffect(() => {
    // allSubTasks は props 経由のため subscribe 不要。テンプレのみ自前で取る。
    const unsubscribeTemplates = taskService.subscribeTaskTemplates(setTemplates);
    return () => {
      unsubscribeTemplates();
    };
  }, []);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string, name: string } | null>(null);
  // 案件レベルのタブ選択。sessionStorage から復元することで「タスククリック → 戻る」で
  // タブが all に巻き戻る現象を防ぐ。
  const [filter, setFilter] = useState<ProjectFilter>(loadFilterTabFromSession);

  // タブ選択を sessionStorage に同期。
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return;
    try {
      if (filter === 'all') sessionStorage.removeItem(FILTER_TAB_KEY);
      else sessionStorage.setItem(FILTER_TAB_KEY, filter);
    } catch { /* noop */ }
  }, [filter]);

  // 直前に flat list でクリックしたタスク ID。子タスク画面から戻ったとき、
  // SubTaskSearchResults にこの ID を渡して該当行へスクロール＋一瞬ハイライトする。
  // 値が変わるたびに sessionStorage と同期し、useEffect の依存変数として有効。
  const [lastClickedTaskId, setLastClickedTaskId] = useState<string | null>(() => {
    if (typeof sessionStorage === 'undefined') return null;
    try { return sessionStorage.getItem(LAST_CLICKED_TASK_KEY); }
    catch { return null; }
  });

  // クリック時に保存。
  const recordTaskClick = (task: SubTask) => {
    setLastClickedTaskId(task.id);
    try { sessionStorage?.setItem(LAST_CLICKED_TASK_KEY, task.id); }
    catch { /* noop */ }
    onJumpToTask(task);
  };

  /**
   * 案件カード（テーブルビュー）クリック時のハンドラ。
   *
   *   - すべて / 期限間近 / 開始間近 :「特定状態のタスクへ直行」する意味が薄いので通常の onSelectTask
   *   - 遅延あり / 着手遅れ / 進行中 / 完了 : その状態の **最初の子タスク** をハイライトしてジャンプ
   *
   * 該当する子タスクが無いときは onSelectTask に fallback（プロジェクト画面を開くだけ）。
   * 「最初」は order 昇順 + created_at 昇順（subscribeAllSubTasks の既定ソート順）。
   */
  const handleTableProjectClick = (task: ParentTask) => {
    const predicate: ((t: SubTask) => boolean) | null =
      filter === 'delayed'       ? (t) => t.status === '遅れ' || t.status === '期限遅れ' :
      filter === 'start_delayed' ? (t) => t.status === '着手遅れ' :
      filter === 'in_progress'   ? (t) => t.status === '進行中' :
      filter === 'completed'     ? (t) => t.status === '済' :
      null;

    if (predicate) {
      const subs = allSubTasks.filter(t => t.parent_task_id === task.id);
      const first = subs.find(predicate);
      if (first) {
        onJumpToTask(first);
        return;
      }
    }
    onSelectTask(task);
  };
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
          // actual_hours は未設定（undefined）。「0 を明示」と「未入力」を区別するため
          // 自動 0 埋めはしない。
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

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    taskService.deleteParentTask(targetId).catch(err => {
      console.error('Failed to delete project:', err);
    });
  };

  const getProjectStats = (parentId: string) => {
    // 定例テンプレート（recurrence あり）は実タスクではないので統計対象外。
    const subTasks = allSubTasks.filter(st => st.parent_task_id === parentId && !st.recurrence);
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

    // 期限間近：済以外 かつ 今日 ≤ due_date ≤ horizon
    //   ※「期限間近」のラベルだが判定は **期日（due_date）** を使う（ユーザー要件）。
    //   業務上「期日」のほうが日々の運用基準として強いため、こちらを基準にする。
    //   - 既に期日/期限を過ぎたものは hasDeadlineDelay（遅れ系ステータス）で拾われる
    //   - 「今日まさに期日」は最も間近として含む
    const hasFinalDeadlineNear = subTasks.some(st => {
      if (st.status === '済') return false;
      const d = normalizeDate(st.due_date);
      if (!d) return false;
      return d >= todayStr && d <= nearHorizon;
    });

    // 開始間近：未着手 かつ 今日 ≤ start_date ≤ horizon
    //   - 既に開始日を過ぎ未着手のものは「着手遅れ」（高優先度）に拾われる
    const hasStartNear = subTasks.some(st => {
      if (st.status !== '未着手') return false;
      const sd = normalizeDate(st.start_date);
      if (!sd) return false;
      return sd >= todayStr && sd <= nearHorizon;
    });

    // 優先度: 完了 > 遅延 > 着手遅れ > 期限間近 > 開始間近 > 進行中 > 未着手
    // 互斥（1 案件 = 1 ステータス）。
    let status: ProjectStatus;
    if (progress === 100) status = 'completed';
    else if (hasDeadlineDelay) status = 'delayed';
    else if (hasStartDelay) status = 'start_delayed';
    else if (hasFinalDeadlineNear) status = 'final_deadline_near';
    else if (hasStartNear) status = 'start_near';
    else if (progress > 0) status = 'in_progress';
    else status = 'not_started';

    return { progress, planned, actual, hasSubTasks: true, hasDelay, maxSubTaskDueDate, status };
  };

  // STATUS_META はカード上に出す「ステータスバッジ」用のメタ情報。
  // 完了 / 進行中 / 未着手 はカード上に独立のバッジを出さないため Exclude する。
  const STATUS_META: Record<Exclude<ProjectStatus, 'completed' | 'in_progress' | 'not_started'>, { label: string; dot: string; text: string; borderClass: string; iconBg: string }> = {
    delayed:             { label: '遅延あり',   dot: 'bg-red-500',    text: 'text-red-600',    borderClass: 'border-l-red-500',    iconBg: 'bg-red-50 text-red-600' },
    start_delayed:       { label: '着手遅れ',   dot: 'bg-amber-400',  text: 'text-amber-600',  borderClass: 'border-l-amber-400',  iconBg: 'bg-amber-50 text-amber-600' },
    final_deadline_near: { label: '期限間近',   dot: 'bg-orange-500', text: 'text-orange-600', borderClass: 'border-l-orange-500', iconBg: 'bg-orange-50 text-orange-600' },
    start_near:          { label: '開始間近',   dot: 'bg-cyan-500',   text: 'text-cyan-700',   borderClass: 'border-l-cyan-500',   iconBg: 'bg-cyan-50 text-cyan-700' },
  };

  const tasksWithStats = parentTasks.map(task => ({ task, stats: getProjectStats(task.id) }));
  // タブ badge に表示する件数は **すべて子タスク粒度** で統一する。
  // 案件数（プロジェクト数）でカウントすると「3 プロジェクト」と「5 タスク」の意味が混ざって
  // ユーザーが何を見ているか分かりにくいため、タスク基準に揃える。
  // 履歴行き / 削除済みの親に紐付く子タスクは除外（parentMap は visible のみ）。
  const counts = useMemo(() => {
    const visibleSubs = allSubTasks.filter(t => parentMap.has(t.parent_task_id));
    return {
      delayed: visibleSubs.filter(t => t.status === '遅れ' || t.status === '期限遅れ').length,
      start_delayed: visibleSubs.filter(t => t.status === '着手遅れ').length,
      final_deadline_near: nearTasksByFilter.finalDeadlineNear.length,
      start_near: nearTasksByFilter.startNear.length,
      in_progress: visibleSubs.filter(t => t.status === '進行中').length,
      completed: visibleSubs.filter(t => t.status === '済').length,
    };
  }, [allSubTasks, parentMap, nearTasksByFilter]);
  // 「期限間近」「開始間近」タブで週報モードを表示するときに、子タスクハイライトに使う ID 集合。
  // 通常表示モード（テーブル / グリッド）では SubTaskSearchResults に切替するので使われない。
  const nearTaskIdSet = useMemo(() => {
    if (filter === 'final_deadline_near') return new Set(nearTasksByFilter.finalDeadlineNear.map(t => t.id));
    if (filter === 'start_near') return new Set(nearTasksByFilter.startNear.map(t => t.id));
    return new Set<string>();
  }, [filter, nearTasksByFilter]);

  // タブごとに「表示する案件」を決める。
  //  - すべて                   : 全件
  //  - 期限間近 / 開始間近     : 該当タスクを持つ親案件（カウントとの一貫性のため）
  //  - その他（遅延 / 着手遅れ / 進行中 / 完了）: 案件ステータスでフィルタ（既存挙動）
  const displayedTasks = useMemo(() => {
    if (filter === 'all') return parentTasks;
    if (filter === 'final_deadline_near' || filter === 'start_near') {
      const source = filter === 'final_deadline_near'
        ? nearTasksByFilter.finalDeadlineNear
        : nearTasksByFilter.startNear;
      const parentIds = new Set(source.map(t => t.parent_task_id));
      return parentTasks.filter(p => parentIds.has(p.id));
    }
    return tasksWithStats.filter(t => t.stats.status === filter).map(t => t.task);
  }, [filter, parentTasks, tasksWithStats, nearTasksByFilter]);

  // 子タスク行に出す「期限間近 / 開始間近」用の左ボーダー色クラス。
  // 既存の「遅延 = 赤」と被らないよう、タブ色（orange / cyan）に合わせる。
  const nearHighlightBorder =
    filter === 'final_deadline_near' ? 'border-l-orange-500' :
    filter === 'start_near' ? 'border-l-cyan-500' : '';

  const FILTER_TABS: { key: ProjectFilter; label: string; count?: number }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'delayed', label: '遅延あり', count: counts.delayed },
    { key: 'start_delayed', label: '着手遅れ', count: counts.start_delayed },
    { key: 'final_deadline_near', label: '期限間近', count: counts.final_deadline_near },
    { key: 'start_near', label: '開始間近', count: counts.start_near },
    { key: 'in_progress', label: '進行中', count: counts.in_progress },
    { key: 'completed', label: '完了', count: counts.completed },
  ];

  const TAB_COLORS: Record<ProjectFilter, { active: string; countColor: string }> = {
    all:                 { active: 'bg-[#1d1d1f] text-white', countColor: 'text-gray-500' },
    delayed:             { active: 'bg-red-500 text-white',    countColor: 'text-red-500' },
    start_delayed:       { active: 'bg-amber-400 text-white',  countColor: 'text-amber-500' },
    final_deadline_near: { active: 'bg-orange-500 text-white', countColor: 'text-orange-500' },
    start_near:          { active: 'bg-cyan-500 text-white',   countColor: 'text-cyan-600' },
    in_progress:         { active: 'bg-[#007aff] text-white',  countColor: 'text-[#007aff]' },
    completed:           { active: 'bg-green-500 text-white',  countColor: 'text-green-600' },
  };

  // Weekly report mode: an expandable table where each project row reveals its subtasks.
  const displayedWithStats = displayedTasks.map(task => ({ task, stats: getProjectStats(task.id) }));
  const now = new Date();
  const weekLabel = `${now.getFullYear()}年${now.getMonth() + 1}月 第${Math.ceil(now.getDate() / 7)}週`;
  // 定例テンプレート（recurrence あり）は実タスクではないため、週報・統計には含めない。
  // テンプレから生成された実体（recurrence_source_id あり）は通常タスクとして扱う。
  const getSubTasks = (parentId: string) =>
    allSubTasks.filter(st => st.parent_task_id === parentId && !st.recurrence);

  // 週報ヘッダの「本週・来週」優先度別件数。表示中プロジェクト配下の全子タスクから集計。
  const weekPriorityStats = useMemo(() => {
    const subs = displayedTasks.flatMap(task => getSubTasks(task.id));
    return computeWeekPriorityStats(subs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedTasks, allSubTasks]);

  // 週報モードの子タスク 1 行を描画。週分段で跨週タスクが複数セグメントに重複表示されるため、
  // key の衝突を避ける目的で keyPrefix を受け取る。
  const renderWeeklySubRow = (t: SubTask, keyPrefix: string) => {
    const isLate = DELAYED_STATUSES.has(t.status);
    const isStartDelay = t.status === '着手遅れ';
    const showDelayReason = !!t.delay_reason && (
      (filter === 'delayed' && (t.status === '遅れ' || t.status === '期限遅れ')) ||
      (filter === 'start_delayed' && isStartDelay)
    );
    const isNearHighlight = !isLate && nearTaskIdSet.has(t.id);
    return (
      <React.Fragment key={`${keyPrefix}-${t.id}`}>
        <div
          title={t.remarks ? `備考: ${t.remarks}` : undefined}
          className={cn(
            "grid items-center gap-3 px-3.5 py-2 my-1 bg-white rounded-lg border border-black/5 text-[12.5px] transition-all hover:border-[#007aff] hover:translate-x-0.5 min-w-[880px]",
            isLate && "border-l-[3px] border-l-red-500",
            isNearHighlight && cn("border-l-[3px]", nearHighlightBorder),
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
            <span className="text-[#007aff] font-semibold">{t.actual_hours ?? 0}h</span>
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
  };

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

      {/* ─── タスク検索バー ───────────────────────────────────────
          ・キーワード入力 + 「絞り込み(N) ▼」ボタン + クイックチップ
          ・チップは settings.quick_filters から（Settings で編集）
          ・初回 seed されていなければ空 → Settings へ案内
      */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none z-10"
            />
            <input
              type="text"
              value={taskFilter.keyword}
              onChange={(e) => setTaskFilter({ ...taskFilter, keyword: e.target.value })}
              placeholder="タスク名・備考で検索..."
              // mac-input が @apply px-4 を持っているため、! 修飾で確実に上書きする
              className="mac-input w-full text-sm !pl-9 !pr-9"
            />
            {taskFilter.keyword && (
              <button
                onClick={() => setTaskFilter({ ...taskFilter, keyword: '' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#86868b] hover:text-[#1d1d1f] rounded z-10"
                title="クリア"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilterPanel(true)}
            className={cn(
              'mac-button mac-button-secondary flex items-center gap-1.5 text-xs whitespace-nowrap',
              filterActive && 'text-[#007aff] border-[#007aff]/40',
            )}
            title="詳細フィルタを開く"
          >
            <SlidersHorizontal size={14} />
            <span>絞り込み</span>
            {filterActive && (
              <span className="text-[10px] font-bold bg-[#007aff] text-white rounded-full px-1.5 py-0.5">
                ON
              </span>
            )}
          </button>
          {filterActive && (
            <button
              onClick={clearFilter}
              className="mac-button mac-button-secondary flex items-center gap-1 text-xs whitespace-nowrap text-[#ff3b30]"
              title="全クリア"
            >
              <X size={14} />
              <span className="hidden sm:inline">クリア</span>
            </button>
          )}
        </div>

        {/* クイックチップ */}
        {quickFilters.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto mobile-hide-scrollbar pb-1">
            <span className="text-[10px] font-bold text-[#86868b] flex-shrink-0">★クイック:</span>
            {quickFilters.map(qf => (
              <button
                key={qf.id}
                onClick={() => applyQuickFilter(qf)}
                className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-[#007aff] hover:bg-blue-100 transition-colors"
                title={qf.name}
              >
                {qf.name}
              </button>
            ))}
          </div>
        )}

        {/* マッチ件数の表示（フィルタ active 時のみ） */}
        {filterActive && (
          <div className="text-xs text-[#86868b] tabular-nums pt-0.5">
            マッチしたタスク <span className="font-bold text-[#1d1d1f]">{matchedTasks.length}</span> 件
          </div>
        )}
      </div>

      {/* 検索フィルタ active → マッチした子タスクの扁平リストのみ表示。
          フィルタ無し時のみ従来通り案件カード / テーブル / 週報。 */}
      {filterActive ? (
        <SubTaskSearchResults
          tasks={matchedTasks}
          parentMap={parentMap}
          onJump={recordTaskClick}
          scrollToTaskId={lastClickedTaskId}
        />
      ) : (
      <>
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

      {/* 「期限間近」「開始間近」タブは、案件カードではなく該当する子タスクの
          扁平リストで表示する（タブ名どおりタスク単位で確認したいユースケース）。
          開始間近モードは「未着手 + 開始日が近い」前提なので実績工数は出さない。 */}
      {filter === 'final_deadline_near' && activeView !== 'weekly' ? (
        <SubTaskSearchResults
          tasks={nearTasksByFilter.finalDeadlineNear}
          parentMap={parentMap}
          onJump={recordTaskClick}
          mode="final_deadline_near"
          emptyHint="期限間近のタスクはありません。"
          scrollToTaskId={lastClickedTaskId}
        />
      ) : filter === 'start_near' && activeView !== 'weekly' ? (
        <SubTaskSearchResults
          tasks={nearTasksByFilter.startNear}
          parentMap={parentMap}
          onJump={recordTaskClick}
          mode="start_near"
          emptyHint="開始間近のタスクはありません。"
          scrollToTaskId={lastClickedTaskId}
        />
      ) : activeView === 'weekly' ? (
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

          {/* 本週・来週の優先度別件数の集計バー（標題が混まないよう独立した 2 行目に置く）。
              跨週タスクは両週にカウントされる。優先度 A/B/C は 高/中/低 表示。 */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 sm:px-5 py-2 border-b border-black/5 text-[11px] bg-white/50">
            {([
              { label: '本週', cnt: weekPriorityStats.current },
              { label: '来週', cnt: weekPriorityStats.next },
            ] as const).map(({ label, cnt }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="font-bold text-[#1d1d1f]">{label}</span>
                {(['A', 'B', 'C'] as Priority[]).map(p => (
                  <span
                    key={p}
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-bold tabular-nums',
                      PRIORITY_META[p].cls,
                    )}
                  >
                    {PRIORITY_META[p].label}
                    <span>{cnt[p]}</span>
                  </span>
                ))}
                <span className="text-[#86868b] tabular-nums">
                  計 {cnt.A + cnt.B + cnt.C}
                </span>
              </div>
            ))}
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
                      // 左端アクセント（before 擬似要素で 3px 縦バー）。状態に応じて色を差し替え。
                      STATUS_BEFORE_BG[status] && cn(
                        "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-r",
                        STATUS_BEFORE_BG[status],
                      ),
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
                        STATUS_ICON_BG[status] ?? "bg-blue-50 text-[#007aff]",
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
                      {(() => { const t = statusToBadgeTone(status); return t && <DelayBadge tone={t} />; })()}
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
                      STATUS_BORDER_L[status] && cn("border-l-[3px]", STATUS_BORDER_L[status]),
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
                          {(() => { const t = statusToBadgeTone(status); return t && <DelayBadge tone={t} />; })()}
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
                          {(() => {
                            const grouping = groupSubTasksByWeek(subs);
                            return (
                              <>
                                {grouping.anomalies.length > 0 && (
                                  <div className="my-1.5 rounded-lg border border-red-200 bg-red-50/50 overflow-hidden">
                                    <div className="flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold text-red-700 bg-red-100/60 min-w-[880px]">
                                      <AlertTriangle size={12} />
                                      日付異常（開始日・期日が未設定のタスク）
                                    </div>
                                    <div className="px-1">
                                      {grouping.anomalies.map(t => renderWeeklySubRow(t, 'anomaly'))}
                                    </div>
                                  </div>
                                )}
                                {grouping.groups.map(({ segment, tasks }) => {
                                  const isCurrent = segment.key === 'current';
                                  return (
                                    <div
                                      key={segment.key}
                                      className={cn(
                                        "my-1.5 rounded-lg overflow-hidden",
                                        isCurrent && "bg-[#007aff]/[0.06] ring-1 ring-[#007aff]/20",
                                      )}
                                    >
                                      <div className={cn(
                                        "flex items-center gap-2 px-3.5 py-1.5 text-[11px] font-bold min-w-[880px]",
                                        isCurrent ? "text-[#007aff] bg-[#007aff]/[0.08]" : "text-[#86868b] bg-black/[0.02]",
                                      )}>
                                        <span>{segment.label}</span>
                                        {segment.rangeLabel && <span className="font-medium opacity-70">({segment.rangeLabel})</span>}
                                        <span className="ml-auto font-medium opacity-70">{tasks.length} 件</span>
                                      </div>
                                      <div className="px-1">
                                        {tasks.map(t => renderWeeklySubRow(t, segment.key))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </>
                            );
                          })()}
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
                        const statusMeta = status === 'delayed' || status === 'start_delayed' || status === 'final_deadline_near' || status === 'start_near' ? STATUS_META[status] : null;
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
                                onClick={() => handleTableProjectClick(task)}
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
                const statusMeta = status === 'delayed' || status === 'start_delayed' || status === 'final_deadline_near' || status === 'start_near' ? STATUS_META[status] : null;
                return (
                  <div
                    key={task.id}
                    className={cn(
                      "bg-white border border-black/5 rounded-xl shadow-sm p-3.5 cursor-pointer active:bg-[#f5f5f7] transition-colors relative",
                      statusMeta && cn("border-l-[3px]", STATUS_BORDER_L[status]),
                    )}
                    onClick={() => handleTableProjectClick(task)}
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
                          {(() => { const t = statusToBadgeTone(status); return t && <DelayBadge tone={t} />; })()}
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
                  const statusMeta = status === 'delayed' || status === 'start_delayed' || status === 'final_deadline_near' || status === 'start_near' ? STATUS_META[status] : null;

                  return (
                    <Draggable key={task.id} draggableId={task.id} index={index}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={cn(
                            "mac-card group hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer relative overflow-hidden",
                            STATUS_BORDER_T[status] && cn("border-t-[3px]", STATUS_BORDER_T[status]),
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
                                {(() => { const t = statusToBadgeTone(status); return t && <DelayBadge tone={t} />; })()}
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
      </>
      )}

      {/* 詳細フィルタ パネル（モーダル）─────────────────────────────── */}
      {showFilterPanel && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowFilterPanel(false)}
        >
          <div
            className="mac-card max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 p-5 border-b border-black/5">
              <div className="p-1.5 bg-blue-50 text-[#007aff] rounded-lg">
                <SlidersHorizontal size={18} />
              </div>
              <h3 className="text-base font-bold text-[#1d1d1f]">詳細フィルタ</h3>
              <button
                onClick={() => setShowFilterPanel(false)}
                className="ml-auto p-1 text-[#86868b] hover:text-[#1d1d1f] rounded"
                aria-label="閉じる"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <FilterForm
                value={taskFilter}
                onChange={setTaskFilter}
                parentTasks={parentTasks}
              />
            </div>
            <div className="flex gap-2 p-5 border-t border-black/5">
              <button
                onClick={() => { clearFilter(); }}
                className="flex-1 py-2.5 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                リセット
              </button>
              <button
                onClick={() => setShowFilterPanel(false)}
                className="flex-1 py-2.5 bg-[#007aff] text-white rounded-xl font-bold hover:bg-[#0066d6] transition-colors"
              >
                適用 ({matchedTasks.length} 件)
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="mac-card max-w-sm w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-lg font-bold">削除の確認</h3>
            </div>
            <p className="text-[#1d1d1f] mb-6">
              「{deleteTarget.name}」と全ての関連タスクを削除しますか？
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmDelete}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
              >
                削除する
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
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
