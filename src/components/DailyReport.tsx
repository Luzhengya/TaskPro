import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SubTask, ParentTask, SubTaskStatus, DailyReportSnapshot, Priority } from '../types';
import { taskService } from '../services/taskService';
import {
  Sparkles,
  Calendar,
  Check,
  Download,
  Trash2,
  Loader2,
  AlertCircle,
  Copy,
  BarChart3,
  NotebookPen,
  Pencil,
  Wand2,
  X,
  Repeat,
} from 'lucide-react';
import {
  ANOMALY_LABEL,
  AnomalyCode,
  EXTRACT_CATEGORY_LABEL,
  EXTRACT_CATEGORY_ORDER,
  DISPLAY_CATEGORY_LABEL,
  DISPLAY_CATEGORY_ORDER,
  DisplayCategory,
  ExtractCategory,
  ExtractResult,
  CONFIRMED_CATEGORY_LABEL,
  CONFIRMED_CATEGORY_ORDER,
  ConfirmedCategory,
  buildConfirmedDisplayData,
  buildDailyReportSummary,
  buildDisplayData,
  extractDailyReportCandidates,
} from '../dailyReportSelector';
import { matchesRecurrence } from '../recurrence';
import { ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DelayModal, DelaySubmitPayload } from './DelayModal';
import { addBusinessDays, normalizeDate, todayBeijing } from '../dateUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 自動抽出 banner のカテゴリ chip 色。緊急度高い順に強い色 → 中間 → 落ち着いた色。 */
const CATEGORY_CHIP_CLASS: Record<ExtractCategory, string> = {
  overdue_final:  'bg-red-100 text-red-700',
  overdue:        'bg-red-50 text-red-600',
  overdue_start:  'bg-amber-50 text-amber-700',
  in_progress:    'bg-blue-50 text-blue-700',
  starting_today: 'bg-emerald-50 text-emerald-700',
  starting_soon:  'bg-cyan-50 text-cyan-700',
};

interface DailyReportProps {
  /** App.tsx で集約した全子タスク。子コンポーネントで重複 subscribe しない。 */
  allSubTasks: SubTask[];
  /** visible 親タスク。Dashboard と同じソース。 */
  visibleParents: ParentTask[];
  /** 履歴行きした親タスク。プロジェクト名表示の fallback 用。 */
  hiddenParents: ParentTask[];
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

// Today as YYYY-MM-DD（北京時間 UTC+8 固定で算出。端末タイムゾーンに依存しない）。
const todayStr = () => todayBeijing();

const numericHours = (value: number | undefined): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const reportActualDelta = (task: SubTask, snapshot: Record<string, SubTask>): number => {
  const current = numericHours(task.actual_hours);
  const before = snapshot[task.id];
  if (!before) return current;
  return Number(Math.max(0, current - numericHours(before.actual_hours)).toFixed(2));
};

const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
};

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const buildCalendarDays = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let day = 1; day <= lastDay; day++) {
    cells.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return cells;
};

export const DailyReport: React.FC<DailyReportProps> = ({
  allSubTasks,
  visibleParents,
  hiddenParents,
  onJumpToTask,
}) => {
  const today = todayStr();

  // props 経由で渡ってくるので、ローカルで subscribe しない。
  // 既存コードでの参照名互換のため別名 alias を作る。
  const parentTasks = visibleParents;
  const hiddenParentTasks = hiddenParents;

  // Date selection - default to today, can be changed to view historical reports
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [snapshot, setSnapshot] = useState<DailyReportSnapshot | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [savedReportDates, setSavedReportDates] = useState<Set<string>>(new Set());
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<string>(() => today.slice(0, 7));

  // Editable state.
  // notes / summary は提出までは local state のみ。session 内で複数回ナビゲーションした時に
  // 「タブ切り替えで AI サマリーが消えた」を防ぐため sessionStorage に同期しておく。
  // 日付（selectedDate）切替時には saved snapshot から再設定する。
  const NOTES_KEY = 'taskmaster_daily_report_notes';
  const SUMMARY_KEY = 'taskmaster_daily_report_summary';
  const [notes, setNotes] = useState<string>(() => {
    if (typeof sessionStorage === 'undefined') return '';
    try { return sessionStorage.getItem(NOTES_KEY) ?? ''; }
    catch { return ''; }
  });
  const [summary, setSummary] = useState<string>(() => {
    if (typeof sessionStorage === 'undefined') return '';
    try { return sessionStorage.getItem(SUMMARY_KEY) ?? ''; }
    catch { return ''; }
  });
  // 変更を session に同期
  useEffect(() => {
    try {
      if (summary) sessionStorage.setItem(SUMMARY_KEY, summary);
      else sessionStorage.removeItem(SUMMARY_KEY);
    } catch { /* noop */ }
  }, [summary]);
  useEffect(() => {
    try {
      if (notes) sessionStorage.setItem(NOTES_KEY, notes);
      else sessionStorage.removeItem(NOTES_KEY);
    } catch { /* noop */ }
  }, [notes]);

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitFeedback, setSubmitFeedback] = useState<string | null>(null);

  // 遅延登録モーダル
  const [delayModalTask, setDelayModalTask] = useState<SubTask | null>(null);
  const [delayPrevStatus, setDelayPrevStatus] = useState<SubTaskStatus | null>(null);

  // 備考編集モーダル。A 優先度の備考ストリップ右端の編集ボタンから開く。
  const [remarksEditTask, setRemarksEditTask] = useState<SubTask | null>(null);
  const [remarksEditText, setRemarksEditText] = useState('');
  const [isSavingRemarks, setIsSavingRemarks] = useState(false);

  // 自動抽出ボタンの状態。抽出後 banner にカテゴリ別件数を出すための保持。
  const [isExtracting, setIsExtracting] = useState(false);
  const [lastExtractResult, setLastExtractResult] = useState<ExtractResult | null>(null);

  // 編集モード：自動抽出後の「キャンセル/確定」フローを管理。
  //  - editSnapshot は 1-6 カテゴリのタスクのみ（リマインドは含まない）
  //  - キャンセル → snapshot から rollback 書込
  //  - 確定     → 現状を保持（次フェーズで diff/summary 生成）
  // sessionStorage に保存し、リロード/タブ切替でも編集モードが復元される。
  const SNAPSHOT_KEY = 'taskmaster_daily_report_edit_snapshot';
  const EDIT_MODE_KEY = 'taskmaster_daily_report_edit_mode';

  type EditSnapshot = Record<string, SubTask>;

  const [editMode, setEditMode] = useState<boolean>(() => {
    if (typeof sessionStorage === 'undefined') return false;
    try { return sessionStorage.getItem(EDIT_MODE_KEY) === '1'; }
    catch { return false; }
  });
  const [editSnapshot, setEditSnapshot] = useState<EditSnapshot>(() => {
    if (typeof sessionStorage === 'undefined') return {};
    try {
      const raw = sessionStorage.getItem(SNAPSHOT_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [isCanceling, setIsCanceling] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  // 編集モード終了の共通処理。
  //   - opts.keepSnapshot=true: editMode フラグだけ落として snapshot は残す
  //                              （確定後の「完了」判定で必要）
  //   - opts.keepSnapshot=false（既定）: snapshot も完全クリア（キャンセル / 提出 / 再抽出）
  const exitEditMode = (opts?: { keepSnapshot?: boolean }) => {
    const keepSnapshot = opts?.keepSnapshot ?? false;
    setEditMode(false);
    try { sessionStorage.removeItem(EDIT_MODE_KEY); } catch { /* noop */ }
    if (!keepSnapshot) {
      setEditSnapshot({});
      try { sessionStorage.removeItem(SNAPSHOT_KEY); } catch { /* noop */ }
    }
  };

  // 子タスク画面 → 戻る時のスクロール復元用。
  // session 内で「最後に DailyReport でクリックしたタスク」を覚えておき、戻ってきた時に
  // 該当行までスクロール + 該当セクション/プロジェクトを自動展開する。
  //
  // LAST_DR_SIBLINGS_KEY には「クリック時、同じセクション内に居た全 task id を順序付きで」保存。
  // 戻ってきた時に該当 task が消えていれば、リストの次／前の id へフォールバックして
  // 「あれ、どこに居るか分からない」を回避する。
  const LAST_DR_TASK_KEY = 'taskmaster_daily_report_last_task';
  const LAST_DR_SIBLINGS_KEY = 'taskmaster_daily_report_last_siblings';
  const [lastClickedDailyTaskId, setLastClickedDailyTaskId] = useState<string | null>(() => {
    if (typeof sessionStorage === 'undefined') return null;
    try { return sessionStorage.getItem(LAST_DR_TASK_KEY); }
    catch { return null; }
  });
  const restoredScrollRef = useRef(false);
  const allSubTasksRef = useRef<SubTask[]>(allSubTasks);
  // 定例作業の実体自動生成ガード。同一テンプレート x 同一日の生成中/生成済みキーを保持する。
  const materializingRecurringKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    allSubTasksRef.current = allSubTasks;
  }, [allSubTasks]);

  // カテゴリセクションの折叠状態。既定: 全て折叠（ユーザー要件）。
  // 中身（プロジェクト見出し）の既定: 展開（折叠状態を Set で管理し、要素が入っていれば折叠扱い）。
  const [collapsedSections, setCollapsedSections] = useState<Set<DisplayCategory>>(
    () => new Set(DISPLAY_CATEGORY_ORDER),
  );
  // 確定後ビュー（新カテゴリ）の折叠状態。同じく既定で全部折叠。
  const [collapsedConfirmedSections, setCollapsedConfirmedSections] = useState<Set<ConfirmedCategory>>(
    () => new Set(CONFIRMED_CATEGORY_ORDER),
  );
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  const toggleSection = (cat: DisplayCategory) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  const toggleConfirmedSection = (cat: ConfirmedCategory) => {
    setCollapsedConfirmedSections(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  const toggleProject = (key: string) => {
    setCollapsedProjects(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // History mode: viewing a past date (not today) — switch to snapshot-based read-only view
  const isHistoryMode = selectedDate !== today;

  // allSubTasks / parentTasks / hiddenParentTasks は props 経由（App.tsx 集約）。
  // ローカル subscribe は撤去（重複 fetch 排除でロード高速化）。

  // Load saved daily report for selectedDate (today or past).
  //   - 履歴日付 or 提出済 snapshot 有り → snapshot の notes/summary を使う
  //   - 今日 + 未提出 → sessionStorage の作業中ノート/サマリーを維持（消さない）
  useEffect(() => {
    let cancelled = false;
    setIsLoadingSnapshot(true);
    (async () => {
      const existing = await taskService.getDailyReport(selectedDate);
      if (cancelled) return;
      setSnapshot(existing);
      const isToday = selectedDate === today;
      if (existing) {
        // 提出済 → snapshot 内容で上書き（session を同期）
        setNotes(existing.notes || '');
        setSummary(existing.ai_summary || '');
      } else if (!isToday) {
        // 履歴日 + 未保存 → 空表示
        setNotes('');
        setSummary('');
      }
      // 今日 + 未提出 のときは session の作業内容をそのまま残す
      setIsLoadingSnapshot(false);
    })();
    return () => { cancelled = true; };
  }, [selectedDate, today]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dates = await taskService.getDailyReportDates();
      if (!cancelled) setSavedReportDates(new Set(dates));
    })();
    return () => { cancelled = true; };
  }, [snapshot]);

  useEffect(() => {
    setCalendarMonth(selectedDate.slice(0, 7));
  }, [selectedDate]);

  // Map parent IDs → parent task objects (merged visible + hidden)
  // 表示用：履歴行きしたプロジェクト名も出したいので visible + hidden をマージ。
  // 主に「子タスク行で親案件名を表示する」「日報履歴で過去のプロジェクト名を引く」用途。
  const parentMap = useMemo(() => {
    const map = new Map<string, ParentTask>();
    parentTasks.forEach(p => map.set(p.id, p));
    hiddenParentTasks.forEach(p => map.set(p.id, p));
    return map;
  }, [parentTasks, hiddenParentTasks]);

  // 抽出・異常検出用：**visible 親のみ**。履歴行きしたプロジェクトの子は
  // 「業務対象から外した」ものとして扱い、自動抽出やリマインドに登らないようにする。
  const visibleParentMap = useMemo(() => {
    const map = new Map<string, ParentTask>();
    parentTasks.forEach(p => map.set(p.id, p));
    return map;
  }, [parentTasks]);

  // 定例作業の自動実体化（lazy materialization）。
  //   - **今日分のみ** 実体タスクを生成する。明日分は実体化せず、表示上の文言予告のみ
  //     （後述の tomorrowRecurring）。これにより「未来の実体」が DB に溜まらず、
  //     二重生成のリスクも無い（毎日その日が来た時だけ生成）。
  //   - 履歴日表示中は生成しない（過去を遡って作らない）。
  //   - allSubTasks は親集約で更新されるため、生成 → 反映 → 再評価で収束する。
  //     途中更新で effect が再実行されても、同一テンプレート x 同一日は生成しない。
  useEffect(() => {
    if (isHistoryMode) return;
    const templates = allSubTasks.filter(
      t => t.recurrence && visibleParentMap.has(t.parent_task_id),
    );
    const due = templates.filter(t => matchesRecurrence(t.recurrence!, today));
    const missing = due.filter(
      tmpl => {
        const key = `${today}|${tmpl.id}`;
        return !materializingRecurringKeysRef.current.has(key)
          && !allSubTasks.some(
            t => t.recurrence_source_id === tmpl.id && t.start_date === today,
          );
      },
    );
    if (missing.length === 0) return;

    for (const tmpl of missing) {
      materializingRecurringKeysRef.current.add(`${today}|${tmpl.id}`);
    }

    (async () => {
      for (const tmpl of missing) {
        const key = `${today}|${tmpl.id}`;
        try {
          const alreadyExists = allSubTasksRef.current.some(
            t => t.recurrence_source_id === tmpl.id && t.start_date === today,
          );
          if (alreadyExists) continue;

          await taskService.addSubTask({
            parent_task_id: tmpl.parent_task_id,
            system: tmpl.system || '',
            month: '',
            daily_report_date: today,
            start_date: today,
            due_date: today,
            final_deadline: today,
            status: '未着手',
            task_name: tmpl.task_name,
            planned_hours: tmpl.planned_hours,
            // actual_hours は未設定（テンプレからは引き継がない）
            priority: tmpl.priority,
            remarks: tmpl.remarks || '',
            recurrence_source_id: tmpl.id,
            week_number: 0,
            flag: 0,
          });
        } catch (err) {
          materializingRecurringKeysRef.current.delete(key);
          console.error('Failed to materialize recurring task:', err);
        }
      }
    })();
  }, [allSubTasks, today, isHistoryMode, visibleParentMap]);

  // 明日（1 営業日先）にルール該当する定例テンプレートの一覧（実体化しない予告用）。
  // 確定後ビューの「定例作業」セクション末尾に「明日、着手する予定です」と文言表示する。
  const tomorrowRecurring = useMemo(() => {
    if (isHistoryMode) return [] as SubTask[];
    const tomorrow = addBusinessDays(today, 1);
    return allSubTasks.filter(
      t => t.recurrence
        && visibleParentMap.has(t.parent_task_id)
        && matchesRecurrence(t.recurrence, tomorrow),
    );
  }, [allSubTasks, today, isHistoryMode, visibleParentMap]);

  // Source of truth for displayed tasks:
  //   - History mode: use the saved snapshot's tasks_snapshot
  //   - Today mode: live tasks where
  //       is_in_report=true（既存の手動チェック）
  //       OR 親が会議集（type==='meeting'）かつ start_date が今日 ← 自動表示
  //     会議は終わったら（翌日になれば）自動で日報から消える。is_in_report を
  //     書き換えないので「チェックを外す」と競合せず、過去日も汚さない。
  const reportTasks = useMemo(
    () => {
      if (isHistoryMode) {
        return snapshot?.tasks_snapshot || [];
      }
      return allSubTasks.filter(t => {
        if (t.recurrence) return false; // 定例テンプレートは日報に出さない（実体だけ出す）
        if (t.is_in_report) return true;
        const parent = parentMap.get(t.parent_task_id);
        return parent?.type === 'meeting' && t.start_date === today;
      });
    },
    [isHistoryMode, snapshot, allSubTasks, parentMap, today]
  );

  // 7 カテゴリ別 → 親プロジェクトごとにグルーピング（表示用）。
  // リマインド bucket は **全アクティブタスクから異常検出** で別途集める（reportTasks 範囲外でも拾う）。
  const categorized = useMemo(
    // anomaly 検出も「業務対象の親 (visible)」のみで判定。履歴行きしたプロジェクトの
    // 子タスクはリマインドにも上げない（業務対象から外したと解釈）。
    () => buildDisplayData(reportTasks, allSubTasks, visibleParentMap, today),
    [reportTasks, allSubTasks, visibleParentMap, today],
  );

  // 提出・集計・確定後 summary の対象。最終的に日報へ残った task からリマインド対象を除外する。
  const reportableTasks = useMemo(
    () => reportTasks.filter(t => !categorized.anomalyCodes.has(t.id)),
    [reportTasks, categorized.anomalyCodes],
  );

  // 戻り先スクロール復元：
  //   1. lastClickedDailyTaskId のタスクが categorized のどこに居るかを探す
  //   2. 居なければ sessionStorage の sibling list から「次の id」を試す（無ければ「前の id」）
  //   3. 該当セクションを自動展開
  //   4. DOM 上の data-daily-task-id 要素へ scrollIntoView + ハイライト
  //   5. 1 回だけ実行（restoredScrollRef ガード）
  useEffect(() => {
    if (restoredScrollRef.current) return;
    if (!lastClickedDailyTaskId) return;
    if (isHistoryMode) return;

    // 任意の id がどのカテゴリに居るかを探すヘルパ
    const findCategory = (taskId: string): DisplayCategory | null => {
      for (const cat of DISPLAY_CATEGORY_ORDER) {
        for (const list of categorized.byCategory[cat].values()) {
          if (list.some(t => t.id === taskId)) return cat;
        }
      }
      return null;
    };

    let targetId = lastClickedDailyTaskId;
    let foundCategory = findCategory(targetId);

    // 元 task が消えていれば sibling list から次の生存 id を探す
    if (!foundCategory) {
      try {
        const stored = sessionStorage.getItem(LAST_DR_SIBLINGS_KEY);
        if (stored) {
          const ids: string[] = JSON.parse(stored);
          const idx = ids.indexOf(lastClickedDailyTaskId);
          if (idx >= 0) {
            // 後方優先 → 後方に無ければ前方
            for (let i = idx + 1; i < ids.length; i++) {
              const cat = findCategory(ids[i]);
              if (cat) { targetId = ids[i]; foundCategory = cat; break; }
            }
            if (!foundCategory) {
              for (let i = idx - 1; i >= 0; i--) {
                const cat = findCategory(ids[i]);
                if (cat) { targetId = ids[i]; foundCategory = cat; break; }
              }
            }
          }
        }
      } catch { /* noop */ }
    }

    if (!foundCategory) return; // 何も見つからない（セクションが空）→ 何もしない

    const scrollCategory = foundCategory;
    // セクションを展開
    setCollapsedSections(prev => {
      if (!prev.has(scrollCategory)) return prev;
      const next = new Set(prev);
      next.delete(scrollCategory);
      return next;
    });
    // 次フレームでスクロール（展開後 / レイアウト確定後）
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-daily-task-id="${targetId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
        restoredScrollRef.current = true;
        // フォールバックで別 task に着地した場合は state も更新（ハイライト追従のため）
        if (targetId !== lastClickedDailyTaskId) {
          setLastClickedDailyTaskId(targetId);
          try { sessionStorage.setItem(LAST_DR_TASK_KEY, targetId); } catch { /* noop */ }
        }
      }
    });
  }, [lastClickedDailyTaskId, categorized, isHistoryMode]);

  // Stats（リマインド対象タスクは集計から除外する。ユーザー要件：日報の件数には含めない）。
  const stats = useMemo(() => {
    const totalPlanned = reportableTasks.reduce((sum, t) => sum + (t.planned_hours || 0), 0);
    const hasDiffBaseline = Object.keys(editSnapshot).length > 0;
    const totalActual = snapshot && !hasDiffBaseline
      ? snapshot.total_actual
      : reportableTasks.reduce((sum, t) => sum + reportActualDelta(t, editSnapshot), 0);
    const delayed = reportableTasks.filter(t => t.status === '遅れ' || t.status === '期限遅れ').length;
    // 優先度別件数（円グラフ用）
    const byPriority = { A: 0, B: 0, C: 0 };
    for (const t of reportableTasks) {
      if (t.priority === 'A' || t.priority === 'B' || t.priority === 'C') byPriority[t.priority]++;
    }
    return {
      total: reportableTasks.length,
      planned: totalPlanned,
      actual: totalActual,
      delayed,
      byPriority,
    };
  }, [reportableTasks, editSnapshot, snapshot]);

  // 各カテゴリ内の親 ID を表示順（parent.order）でソートしたもの。
  const sortedParentIdsByCategory = useMemo(() => {
    const result = {} as Record<DisplayCategory, string[]>;
    for (const cat of DISPLAY_CATEGORY_ORDER) {
      const ids = Array.from(categorized.byCategory[cat].keys());
      ids.sort((a, b) => {
        const pa = parentMap.get(a);
        const pb = parentMap.get(b);
        return (pa?.order ?? 0) - (pb?.order ?? 0);
      });
      result[cat] = ids;
    }
    return result;
  }, [categorized, parentMap]);

  // 確定後ビュー（新カテゴリ 7 種類）。snapshot を参照して「完了」を判定。
  const confirmedView = useMemo(
    () => buildConfirmedDisplayData(reportableTasks, editSnapshot, today),
    [reportableTasks, editSnapshot, today],
  );
  const sortedConfirmedParentIdsByCategory = useMemo(() => {
    const result = {} as Record<ConfirmedCategory, string[]>;
    for (const cat of CONFIRMED_CATEGORY_ORDER) {
      const ids = Array.from(confirmedView.byCategory[cat].keys());
      ids.sort((a, b) => {
        const pa = parentMap.get(a);
        const pb = parentMap.get(b);
        return (pa?.order ?? 0) - (pb?.order ?? 0);
      });
      result[cat] = ids;
    }
    return result;
  }, [confirmedView, parentMap]);

  // Group tasks by parent_task_id（既存ユーティリティとして残す。AI サマリー生成
  // など、カテゴリ非依存の処理で使われている）。
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, SubTask[]>();
    reportableTasks.forEach(t => {
      const list = groups.get(t.parent_task_id) || [];
      list.push(t);
      groups.set(t.parent_task_id, list);
    });
    groups.forEach(list => {
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    });
    return groups;
  }, [reportableTasks]);

  // Sorted parent IDs（カテゴリ非依存。AI サマリー生成等で利用）
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
    const task = allSubTasks.find(t => t.id === taskId);
    const delayedStatuses: SubTaskStatus[] = ['遅れ', '着手遅れ', '期限遅れ'];
    const updates: Partial<SubTask> = { status };
    // 遅延系ステータスへの変更時は優先度を A へ引き上げる。
    if (delayedStatuses.includes(status)) updates.priority = 'A';
    try {
      await taskService.updateSubTask(taskId, updates);
      // 「遅れ」「着手遅れ」に変更したら遅延登録モーダルを開く。
      if ((status === '遅れ' || status === '着手遅れ') && task) {
        setDelayPrevStatus(task.status);
        setDelayModalTask({ ...task, status });
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  // 遅延モーダル：原因を記録し、影響ありなら本タスク＋後続タスクの期日・期限をずらす。
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

    const base = ensure(target.id);
    base.delay_reason = reason;
    base.delay_impact_days = impactDays;

    if (impactDays > 0) {
      for (const id of affectedTaskIds) {
        const t = allSubTasks.find(s => s.id === id);
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
      const siblings = allSubTasks.filter(s => s.parent_task_id === target.parent_task_id);
      let maxDue = '';
      for (const s of siblings) {
        const u = updatesById.get(s.id);
        const due = u && typeof u.due_date === 'string' && u.due_date ? u.due_date : s.due_date;
        if (due && normalizeDate(due) > normalizeDate(maxDue)) maxDue = due;
      }
      const parent = parentMap.get(target.parent_task_id);
      if (parent && maxDue && normalizeDate(maxDue) > normalizeDate(parent.deadline)) {
        parentDeadlineUpdate = taskService.updateParentTask(parent.id, { deadline: maxDue });
      }
    }

    setDelayModalTask(null);
    setDelayPrevStatus(null);
    try {
      await Promise.all([
        ...[...updatesById].map(([id, u]) => taskService.updateSubTask(id, u)),
        ...(parentDeadlineUpdate ? [parentDeadlineUpdate] : []),
      ]);
    } catch (err) {
      console.error('Failed to register delay:', err);
    }
  };

  // キャンセルしたら「遅れ」へ変更する前のステータスへ戻す。
  const handleDelayCancel = async () => {
    const target = delayModalTask;
    const prev = delayPrevStatus;
    setDelayModalTask(null);
    setDelayPrevStatus(null);
    if (target && prev && prev !== '遅れ') {
      try {
        await taskService.updateSubTask(target.id, { status: prev });
      } catch (err) {
        console.error('Failed to revert status:', err);
      }
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

  // 子タスク画面へジャンプする時、戻り先位置のために id を session に記録してから飛ぶ。
  // 同セクション内の sibling list も保存し、戻ってきた時に該当 task が消えていれば
  // 次／前の sibling へフォールバックする。
  const recordTaskJump = (t: SubTask) => {
    setLastClickedDailyTaskId(t.id);
    try {
      sessionStorage.setItem(LAST_DR_TASK_KEY, t.id);
      // クリック時点のカテゴリを特定し、そのセクション内の task id を順序付きで列挙
      let siblings: string[] = [];
      for (const cat of DISPLAY_CATEGORY_ORDER) {
        const projMap = categorized.byCategory[cat];
        const flat: string[] = [];
        for (const pid of projMap.keys()) {
          for (const x of projMap.get(pid) || []) flat.push(x.id);
        }
        if (flat.includes(t.id)) {
          siblings = flat;
          break;
        }
      }
      sessionStorage.setItem(LAST_DR_SIBLINGS_KEY, JSON.stringify(siblings));
    } catch { /* noop */ }
    restoredScrollRef.current = false;
    onJumpToTask(t);
  };

  // 実績工数を手動更新（履歴表示中は不可）。
  // 備考の保存。モーダルから呼ばれる。空文字列も許可（=削除）。
  const openRemarksEdit = (task: SubTask) => {
    setRemarksEditTask(task);
    setRemarksEditText(task.remarks || '');
  };
  const closeRemarksEdit = () => {
    setRemarksEditTask(null);
    setRemarksEditText('');
  };
  const handleSaveRemarks = async () => {
    if (!remarksEditTask) return;
    setIsSavingRemarks(true);
    try {
      await taskService.updateSubTask(remarksEditTask.id, { remarks: remarksEditText });
      closeRemarksEdit();
    } catch (err) {
      console.error('Failed to update remarks:', err);
    } finally {
      setIsSavingRemarks(false);
    }
  };

  const handleActualChange = async (taskId: string, hours: number) => {
    if (isHistoryMode) return;
    try {
      await taskService.updateSubTask(taskId, { actual_hours: hours });
    } catch (err) {
      console.error('Failed to update actual hours:', err);
    }
  };

  // 手動「再生成」機能は廃止。Summary は「確定」ボタンを押した時にだけ生成される
  // （handleConfirm 内で snapshot vs 現状の diff から組み立てる）。

  // 自動抽出：「リセット → 再抽出」の 2 段階。
  //   1. is_in_report=true な既存タスクを全て false にクリア（visible 親配下のみ）
  //   2. 抽出ロジック実行（dailyReportSelector）。異常タスクは候補から除外される
  //   3. 候補に is_in_report=true + daily_report_date=today を立てる
  // これにより、毎日「日報を白紙から再構成」できる。手動勾选の上書きもリセットされるため、
  // 必要なら抽出後にもう一度手動勾选する。履歴モードでは禁止。
  const handleAutoExtract = async () => {
    if (isHistoryMode) return;
    setIsExtracting(true);
    try {
      const CONCURRENCY = 10;

      // Step 1: 現在 is_in_report=true なタスクを全て false に
      // （履歴行き・削除済みの親に紐付くものは対象外＝そもそも parentMap に居ないのでスキップ）
      const toReset = allSubTasks.filter(
        t => t.is_in_report && parentMap.has(t.parent_task_id),
      );
      for (let i = 0; i < toReset.length; i += CONCURRENCY) {
        const chunk = toReset.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(t => taskService.updateSubTask(t.id, { is_in_report: false })),
        );
      }

      // Step 2: 抽出（履歴行きの親配下は対象外、異常タスクは候補から除かれる）
      const result = extractDailyReportCandidates(allSubTasks, visibleParentMap, today);

      // Step 3: 候補に is_in_report=true を立てる。daily_report_date は既存値があれば尊重
      for (let i = 0; i < result.all.length; i += CONCURRENCY) {
        const chunk = result.all.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(t =>
            taskService.updateSubTask(t.id, {
              is_in_report: true,
              daily_report_date: t.daily_report_date || today,
            }),
          ),
        );
      }
      setLastExtractResult(result);

      // Step 4: 編集モード突入用 snapshot（1-6 カテゴリのみ。リマインドは除外）。
      // ユーザーが編集 → キャンセル時にここの値で書戻す。
      // is_in_report と daily_report_date は **書き込んだ後の値** を採用（rollback で同状態に戻すため）。
      const snapshot: EditSnapshot = {};
      for (const cat of EXTRACT_CATEGORY_ORDER) {
        for (const t of result.byCategory[cat]) {
          snapshot[t.id] = {
            ...t,
            is_in_report: true,
            daily_report_date: t.daily_report_date || today,
          };
        }
      }
      setEditSnapshot(snapshot);
      setEditMode(true);
      try {
        sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
        sessionStorage.setItem(EDIT_MODE_KEY, '1');
      } catch { /* noop */ }
    } catch (err) {
      console.error('Auto extract failed:', err);
      setError('自動抽出に失敗しました。再度お試しください。');
    } finally {
      setIsExtracting(false);
    }
  };

  // 編集モードのキャンセル：snapshot から rollback 書込。
  //   - snapshot に居る task: 編集対象だった全フィールドを撮影時の値に戻す
  //   - snapshot に居ない is_in_report=true な task（編集中に手動勾选追加された分）:
  //     is_in_report=false に戻す
  // 並列数は CONCURRENCY=10 で server 負荷を抑える。
  const handleCancel = async () => {
    if (isHistoryMode) return;
    if (isCanceling) return;
    setIsCanceling(true);
    try {
      const CONCURRENCY = 10;

      // (a) snapshot タスクを元の状態に書戻し
      const snapshotTasks = Object.values(editSnapshot);
      for (let i = 0; i < snapshotTasks.length; i += CONCURRENCY) {
        const chunk = snapshotTasks.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(t => taskService.updateSubTask(t.id, {
          status: t.status,
          planned_hours: t.planned_hours,
          actual_hours: t.actual_hours,
          remarks: t.remarks,
          delay_reason: t.delay_reason,
          delay_impact_days: t.delay_impact_days,
          task_name: t.task_name,
          is_in_report: t.is_in_report,
          daily_report_date: t.daily_report_date,
          priority: t.priority,
          start_date: t.start_date,
          due_date: t.due_date,
          final_deadline: t.final_deadline,
        })));
      }

      // (b) 編集中に手動勾选追加された task の is_in_report を false に
      const addedDuringEdit = allSubTasks.filter(
        t => t.is_in_report && !editSnapshot[t.id] && parentMap.has(t.parent_task_id),
      );
      for (let i = 0; i < addedDuringEdit.length; i += CONCURRENCY) {
        const chunk = addedDuringEdit.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(t =>
          taskService.updateSubTask(t.id, { is_in_report: false }),
        ));
      }

      exitEditMode();
    } catch (err) {
      console.error('Cancel rollback failed:', err);
      setError('キャンセルに失敗しました。再度お試しください。');
    } finally {
      setIsCanceling(false);
    }
  };

  // 編集モードの確定：snapshot（編集前）vs 現状（編集後）を比較し、
  // テンプレート方式で日報サマリーを生成 → 編集モード解除（snapshot は保持）。
  const handleConfirm = async () => {
    if (isHistoryMode) return;
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      const summaryText = buildDailyReportSummary(
        reportableTasks,
        editSnapshot,
        parentMap,
        today,
      );
      setSummary(summaryText);
      // 確定後の「完了」判定で snapshot を引き続き使うため、ここではクリアしない。
      // 提出 / 再抽出 / キャンセルの時に初めてクリアする。
      exitEditMode({ keepSnapshot: true });
    } catch (err) {
      console.error('Confirm failed:', err);
      setError('確定処理でエラーが発生しました。');
    } finally {
      setIsConfirming(false);
    }
  };

  // Submit daily report (snapshot + ai summary) — only valid for "today"
  const handleSubmit = async () => {
    if (isHistoryMode) return;
    setIsSubmitting(true);
    setSubmitFeedback(null);
    try {
      // サマリーが空（＝確定を経ずに直接提出）の場合はテンプレートで生成しておく。
      let finalSummary = summary;
      if (!finalSummary.trim()) {
        finalSummary = buildDailyReportSummary(reportableTasks, editSnapshot, parentMap, today);
        setSummary(finalSummary);
      }

      await taskService.saveDailyReport({
        date: today,
        notes,
        ai_summary: finalSummary,
        tasks_snapshot: reportableTasks,
        total_tasks: stats.total,
        total_planned: stats.planned,
        total_actual: stats.actual,
        delayed_count: stats.delayed,
      });
      // Reload snapshot so the "再提出" button state reflects the save
      const reloaded = await taskService.getDailyReport(today);
      setSnapshot(reloaded);
      setSavedReportDates(prev => new Set(prev).add(today));
      setSubmitFeedback(snapshot ? '日報を更新しました' : '日報を保存しました');
      setTimeout(() => setSubmitFeedback(null), 3000);
      // 提出完了 → 確定後ビュー用の編集 snapshot もクリア（完了判定が無効に戻る）。
      setEditSnapshot({});
      try { sessionStorage.removeItem(SNAPSHOT_KEY); } catch { /* noop */ }
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
        lines.push(`  - [${t.status}] ${t.task_name}  期日:${fmtDate(t.due_date)}  予定:${t.planned_hours}h 実績:${t.actual_hours ?? 0}h`);
      });
      lines.push('');
    });
    if (notes.trim()) {
      lines.push('--- 本日のメモ ---');
      lines.push(notes);
      lines.push('');
    }
    if (summary.trim()) {
      lines.push('--- Summary ---');
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
      setSavedReportDates(prev => {
        const next = new Set(prev);
        next.delete(selectedDate);
        return next;
      });
      setSubmitFeedback('日報を削除しました');
      setTimeout(() => setSubmitFeedback(null), 3000);
    } catch (err: any) {
      setSubmitFeedback(`削除失敗: ${err.message || err}`);
    }
  };

  // Parent progress calculation. 日報のカードは現在表示中のタスク集合に対して進捗を出す。
  const parentProgress = (_parent: ParentTask | undefined, tasks: SubTask[]): number => {
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(t => t.status === '済').length;
    return Math.round((completed / tasks.length) * 100);
  };

  /* ============================================================
   * 子タスク行のレンダ（カテゴリビュー / 旧グルーピング両方で使う想定で外出し）
   * ============================================================ */
  const renderTaskRow = (t: SubTask, parent: ParentTask | undefined) => (
    <div
      key={t.id}
      data-daily-task-id={t.id}
      title={t.remarks ? `備考: ${t.remarks}` : undefined}
      className={cn(
        "flex items-stretch group hover:bg-gray-50/50 transition-colors",
        t.status === '済' && "bg-gray-50/80",
        // 戻り先ハイライト：sessionStorage で覚えていた最後にクリックしたタスクなら背景を一瞬強調
        lastClickedDailyTaskId === t.id && "bg-blue-50/60",
      )}
    >
      {/* Status color bar */}
      <div className={cn('w-1 flex-shrink-0', statusBarColor[t.status])} />

      {/* Checkbox */}
      <div className="flex items-center px-2.5 lg:px-4">
        <button
          onClick={() => handleToggleReport(t)}
          disabled={isHistoryMode}
          className={cn(
            'w-5 h-5 rounded-md flex items-center justify-center transition-colors',
            t.is_in_report ? 'bg-[#007aff] text-white' : 'bg-white border border-gray-300 hover:border-[#007aff]',
            isHistoryMode && 'cursor-not-allowed opacity-80',
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
          {parent ? (
            <button
              onClick={() => recordTaskJump(t)}
              className="font-bold text-xs lg:text-sm text-[#1d1d1f] hover:text-[#007aff] transition-colors text-left truncate"
              title={parent.is_hidden ? '履歴行きプロジェクト（クリックで開く）' : undefined}
            >
              {t.task_name}
            </button>
          ) : (
            <span
              className="font-bold text-xs lg:text-sm text-gray-400 line-through cursor-not-allowed text-left truncate"
              title="このタスクのプロジェクトは削除されています"
            >
              {t.task_name}
            </span>
          )}
          <select
            value={t.status}
            onChange={(e) => handleStatusChange(t.id, e.target.value as SubTaskStatus)}
            disabled={isHistoryMode}
            className={cn(
              'px-2 py-0.5 rounded-md text-[10px] font-bold focus:outline-none',
              statusBgText[t.status],
              isHistoryMode ? 'cursor-not-allowed opacity-90' : 'cursor-pointer',
            )}
          >
            {(Object.keys(statusBgText) as SubTaskStatus[]).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {t.priority && PRIORITY_META[t.priority] && (
            <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold', PRIORITY_META[t.priority].cls)}>
              <BarChart3 size={10} />
              {PRIORITY_META[t.priority].label}
            </span>
          )}
          {/* 異常 code chips（リマインドセクションのタスクのみ） */}
          {categorized.anomalyCodes.get(t.id)?.map(code => (
            <span
              key={code}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800"
              title={`修正が必要: ${ANOMALY_LABEL[code]}`}
            >
              {ANOMALY_LABEL[code]}
            </span>
          ))}
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
          <span className="text-gray-300 sm:hidden">·</span>
          <span className="sm:hidden flex items-center gap-0.5">
            <span className="font-medium text-[#1d1d1f]">{t.planned_hours}h</span>
            <span className="mx-0.5">/</span>
            {isHistoryMode ? (
              <span className="font-medium text-[#007aff]">{t.actual_hours ?? 0}h</span>
            ) : (
              <ActualHoursInput value={t.actual_hours} className="w-10" onCommit={(h) => handleActualChange(t.id, h)} />
            )}
          </span>
        </div>

        {/* 備考ストリップ（優先度 A のみ） */}
        {t.priority === 'A' && (t.remarks?.trim() || !isHistoryMode) && (
          <div className="mt-1.5 flex items-start gap-1.5 text-[10px] lg:text-xs bg-amber-50 text-amber-800 px-2 py-1 rounded">
            <NotebookPen size={12} className="flex-shrink-0 mt-0.5" />
            <span className="flex-1 break-words line-clamp-2" title={t.remarks || undefined}>
              {t.remarks?.trim() || (<span className="italic text-amber-600/70">備考を追加</span>)}
            </span>
            {!isHistoryMode && (
              <button
                onClick={() => openRemarksEdit(t)}
                className="ml-1 flex-shrink-0 p-1 -m-0.5 rounded hover:bg-amber-100 active:bg-amber-200 transition-colors text-amber-700"
                title="備考を編集"
                aria-label="備考を編集"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}

        {/* 遅延原因 */}
        {(t.status === '遅れ' || t.status === '着手遅れ') && t.delay_reason && (
          <div className={cn('mt-1.5 flex items-start gap-1 text-[10px] lg:text-xs', t.status === '着手遅れ' ? 'text-orange-600' : 'text-red-600')}>
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            <span className="break-words">
              遅延原因: {t.delay_reason}
              {t.delay_impact_days ? `（影響 ${t.delay_impact_days} 日）` : '（影響なし）'}
            </span>
          </div>
        )}
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
            <span className="font-bold text-[#007aff] w-8 text-right">{t.actual_hours ?? 0}h</span>
          ) : (
            <ActualHoursInput value={t.actual_hours} className="w-12" onCommit={(h) => handleActualChange(t.id, h)} />
          )}
        </div>
      </div>
    </div>
  );

  /* ============================================================
   * プロジェクトカードのレンダ（カテゴリセクション内側で使う）
   *   - collapseKey 単位で折叠状態を管理
   *   - 既定: 開（collapsedProjects に居なければ展開）
   * ============================================================ */
  const renderProjectCard = (parent: ParentTask | undefined, tasks: SubTask[], collapseKey: string) => {
    const progress = parentProgress(parent, tasks);
    const isOpen = !collapsedProjects.has(collapseKey);
    return (
      <div key={collapseKey} className="bg-white">
        {/* Parent header（クリックで折叠） */}
        <button
          type="button"
          onClick={() => toggleProject(collapseKey)}
          className="w-full flex flex-col sm:flex-row sm:items-center gap-3 px-4 lg:px-5 py-3 hover:bg-gray-50/50 transition-colors text-left"
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <ChevronDown
              size={14}
              className={cn('text-[#86868b] transition-transform flex-shrink-0', !isOpen && '-rotate-90')}
            />
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Calendar size={13} className="text-[#007aff]" />
            </div>
            <h3 className={cn('font-bold text-sm truncate', parent ? 'text-[#1d1d1f]' : 'text-gray-400 italic')}>
              {parent?.name || '(削除されたプロジェクト)'}
            </h3>
            {parent?.is_hidden && (
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-[#86868b] rounded-md font-bold flex-shrink-0">
                履歴
              </span>
            )}
            {!parent && (
              <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 rounded-md font-bold flex-shrink-0">
                削除済み
              </span>
            )}
            <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-[#007aff] rounded-md font-bold flex-shrink-0">
              {tasks.length} 件
            </span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 pl-11 sm:pl-0">
            <div className="w-20 lg:w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#007aff] rounded-full transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
            <span className="text-xs font-bold text-[#1d1d1f] w-9 text-right">{progress}%</span>
          </div>
        </button>
        {/* Sub-task rows */}
        {isOpen && (
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {tasks.map(t => renderTaskRow(t, parent))}
          </div>
        )}
      </div>
    );
  };

  const calendarDays = buildCalendarDays(calendarMonth);
  const canMoveNextMonth = calendarMonth < today.slice(0, 7);

  return (
    <div className={cn("space-y-6", editMode && "pb-24")}>
      {/* Header */}
      <div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl lg:text-4xl font-bold tracking-tight text-[#1d1d1f]">日報</h2>
            <div className="text-xs lg:text-sm text-[#86868b] mt-2 flex items-center gap-2 flex-wrap">
              <span className="font-medium">{isHistoryMode ? '対象日' : '本日'}</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsDatePickerOpen(v => !v)}
                  disabled={editMode}
                  title={editMode ? '編集中は日付を切り替えられません' : '日付を選択'}
                  className="inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-md px-2 py-1 text-sm text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Calendar size={14} className="text-[#007aff]" />
                  <span>{fmtDate(selectedDate)}</span>
                  {savedReportDates.has(selectedDate) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#007aff]" title="保存済みの日報があります" />
                  )}
                </button>
                {isDatePickerOpen && (
                  <div className="absolute left-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-2xl shadow-xl z-50 p-3 text-[#1d1d1f]">
                    <div className="flex items-center justify-between mb-2">
                      <button
                        type="button"
                        onClick={() => setCalendarMonth(m => shiftMonth(m, -1))}
                        className="px-2 py-1 rounded-lg text-sm font-bold hover:bg-gray-100"
                        aria-label="前月"
                      >
                        ‹
                      </button>
                      <div className="text-sm font-bold">{monthLabel(calendarMonth)}</div>
                      <button
                        type="button"
                        onClick={() => setCalendarMonth(m => shiftMonth(m, 1))}
                        disabled={!canMoveNextMonth}
                        className="px-2 py-1 rounded-lg text-sm font-bold hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-white"
                        aria-label="次月"
                      >
                        ›
                      </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-[#86868b] mb-1">
                      {['日', '月', '火', '水', '木', '金', '土'].map(d => <div key={d}>{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {calendarDays.map((date, idx) => {
                        if (!date) return <div key={`blank-${idx}`} className="h-8" />;
                        const day = Number(date.slice(-2));
                        const disabled = date > today;
                        const selected = date === selectedDate;
                        const hasReport = savedReportDates.has(date);
                        return (
                          <button
                            key={date}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              setSelectedDate(date);
                              setIsDatePickerOpen(false);
                            }}
                            className={cn(
                              'relative h-8 rounded-lg text-xs font-semibold transition-colors',
                              selected ? 'bg-[#007aff] text-white' : 'hover:bg-blue-50 text-[#1d1d1f]',
                              disabled && 'text-gray-300 cursor-not-allowed hover:bg-white',
                            )}
                          >
                            {day}
                            {hasReport && (
                              <span className={cn(
                                'absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full',
                                selected ? 'bg-white' : 'bg-[#007aff]',
                              )} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[10px] text-[#86868b]">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#007aff]" />
                        日報履歴あり
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDate(today);
                          setIsDatePickerOpen(false);
                        }}
                        className="font-bold text-[#007aff] hover:underline"
                      >
                        今日
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
                onClick={handleAutoExtract}
                disabled={isExtracting || editMode}
                title={
                  editMode
                    ? '編集中はキャンセル/確定後に再実行できます'
                    : '今日報告すべき可能性のあるタスクを自動で勾选します（既存はリセットされます）'
                }
                className="flex items-center gap-2 px-4 lg:px-5 py-2.5 bg-white text-[#007aff] border border-[#007aff]/30 rounded-xl font-bold hover:bg-[#007aff]/5 transition-colors disabled:opacity-60 shadow-sm text-sm"
              >
                {isExtracting ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                <span>自動抽出</span>
              </button>
            )}
            {/* 編集モード中は「日報を提出」を隠す。確定後に再表示される。 */}
            {!isHistoryMode && !editMode && (
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

        {/* 自動抽出の結果バナー。カテゴリ別件数を確認 → [閉じる] で消す */}
        {lastExtractResult && (
          <div className="mt-3 p-3 lg:p-4 bg-gradient-to-r from-[#007aff]/8 to-purple-500/5 rounded-xl border border-[#007aff]/20">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-white rounded-lg text-[#007aff] flex-shrink-0">
                <Wand2 size={16} />
              </div>
              <div className="flex-1 min-w-0">
                {lastExtractResult.total === 0 && lastExtractResult.remindCount === 0 ? (
                  <p className="text-sm text-[#1d1d1f] font-medium">
                    抽出対象のタスクはありませんでした
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-[#1d1d1f] font-bold mb-2">
                      リセット後、{lastExtractResult.total + lastExtractResult.remindCount} 件を日報に抽出しました
                      {lastExtractResult.remindCount > 0 && (
                        <span className="text-[#86868b] font-normal">
                          （うち {lastExtractResult.remindCount} 件はリマインド）
                        </span>
                      )}
                    </p>
                    {/* カテゴリ別件数の chip 群。0 件カテゴリは出さない */}
                    <div className="flex flex-wrap gap-1.5">
                      {EXTRACT_CATEGORY_ORDER
                        .filter(c => lastExtractResult.counts[c] > 0)
                        .map(c => (
                          <span
                            key={c}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold',
                              CATEGORY_CHIP_CLASS[c],
                            )}
                          >
                            <span>{EXTRACT_CATEGORY_LABEL[c]}</span>
                            <span className="opacity-70">{lastExtractResult.counts[c]}</span>
                          </span>
                        ))}
                      {lastExtractResult.remindCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800">
                          <span>リマインド</span>
                          <span className="opacity-70">{lastExtractResult.remindCount}</span>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setLastExtractResult(null)}
                className="p-1 text-[#86868b] hover:text-[#1d1d1f] rounded transition-colors flex-shrink-0"
                aria-label="閉じる"
                title="閉じる"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 lg:gap-4">
        <StatCard label="集計タスク" value={`${stats.total} 件`} accent="text-[#007aff]" />
        <StatCard label="予定工数" value={`${stats.planned} h`} accent="text-[#1d1d1f]" />
        <StatCard label="実績工数" value={`${stats.actual} h`} accent="text-[#007aff]" />
        <PriorityPieCard counts={stats.byPriority} />
      </div>

      {/* Grouped Task Cards by Category。編集モード中は抽出 list view（旧 7 セクション）、
          それ以外は確定後 view（新 7 セクション：すべて / 期限遅れあり / 遅延あり / 着手遅れあり /
          進行中 / 完了 / 着手予定）。 */}
      {reportTasks.length > 0 ? (
        editMode ? (
        <div className="space-y-3">
          {DISPLAY_CATEGORY_ORDER.map(cat => {
            const count = categorized.counts[cat];
            // 全 7 セクション（6 + リマインド）とも 0 件でも常に表示（disabled 状態）。
            // ユーザーが「異常 0 件 = データ綺麗」を確認できるため。
            const isOpen = !collapsedSections.has(cat);
            const isDisabled = count === 0;
            const ids = sortedParentIdsByCategory[cat];
            return (
              <div
                key={cat}
                className={cn(
                  "mac-card overflow-hidden",
                  isDisabled && "opacity-50",
                )}
              >
                <button
                  type="button"
                  onClick={() => !isDisabled && toggleSection(cat)}
                  disabled={isDisabled}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 lg:px-5 py-3 lg:py-4 text-left transition-colors",
                    !isDisabled && "hover:bg-gray-50/50",
                    isDisabled && "cursor-not-allowed",
                  )}
                >
                  <ChevronDown
                    size={16}
                    className={cn(
                      "text-[#86868b] transition-transform flex-shrink-0",
                      !isOpen && "-rotate-90",
                      isDisabled && "opacity-30",
                    )}
                  />
                  <h3 className="font-bold text-sm lg:text-base text-[#1d1d1f] flex-1">
                    {DISPLAY_CATEGORY_LABEL[cat]}
                  </h3>
                  <span className="text-xs lg:text-sm font-bold text-[#86868b] tabular-nums">
                    {count} 件
                  </span>
                </button>
                {isOpen && !isDisabled && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100 bg-gray-50/30">
                    {ids.map(pid => {
                      const parent = parentMap.get(pid);
                      const tasks = categorized.byCategory[cat].get(pid) || [];
                      return renderProjectCard(parent, tasks, `${cat}::${pid}`);
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        ) : (
        // 確定後ビュー（新 7 セクション）
        <div className="space-y-3">
          {CONFIRMED_CATEGORY_ORDER.map(cat => {
            const isRecurring = cat === 'recurring';
            // 「定例作業」セクションは今日実体 + 明日予告（文言のみ）を合算して件数表示。
            const tomorrowCount = isRecurring ? tomorrowRecurring.length : 0;
            const todayCount = confirmedView.counts[cat];
            const count = todayCount + tomorrowCount;
            const isOpen = !collapsedConfirmedSections.has(cat);
            const isDisabled = count === 0;
            const ids = sortedConfirmedParentIdsByCategory[cat];
            return (
              <div
                key={cat}
                className={cn(
                  "mac-card overflow-hidden",
                  isDisabled && "opacity-50",
                )}
              >
                <button
                  type="button"
                  onClick={() => !isDisabled && toggleConfirmedSection(cat)}
                  disabled={isDisabled}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 lg:px-5 py-3 lg:py-4 text-left transition-colors",
                    !isDisabled && "hover:bg-gray-50/50",
                    isDisabled && "cursor-not-allowed",
                  )}
                >
                  <ChevronDown
                    size={16}
                    className={cn(
                      "text-[#86868b] transition-transform flex-shrink-0",
                      !isOpen && "-rotate-90",
                      isDisabled && "opacity-30",
                    )}
                  />
                  <h3 className="font-bold text-sm lg:text-base text-[#1d1d1f] flex-1">
                    {CONFIRMED_CATEGORY_LABEL[cat]}
                  </h3>
                  <span className="text-xs lg:text-sm font-bold text-[#86868b] tabular-nums">
                    {count} 件
                  </span>
                </button>
                {isOpen && !isDisabled && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100 bg-gray-50/30">
                    {ids.map(pid => {
                      const parent = parentMap.get(pid);
                      const tasks = confirmedView.byCategory[cat].get(pid) || [];
                      return renderProjectCard(parent, tasks, `confirmed::${cat}::${pid}`);
                    })}
                    {/* 定例作業セクション末尾：明日の定例予告（実体化しない文言） */}
                    {isRecurring && tomorrowRecurring.length > 0 && (
                      <div className="px-4 lg:px-5 py-3 bg-white space-y-1">
                        {tomorrowRecurring.map(t => (
                          <div key={t.id} className="flex items-center gap-2 text-xs lg:text-sm text-[#86868b]">
                            <Repeat size={13} className="text-purple-400 flex-shrink-0" />
                            <span>
                              定例作業 <span className="font-medium text-[#1d1d1f]">{t.task_name}</span>　明日、着手する予定です。
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )
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

      {/* Notes（編集モード中は非表示。確定後に再表示）*/}
      {!editMode && (
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
      )}

      {/* Summary（編集モード中は非表示）。生成は「確定」ボタン押下時のみ。手動再生成は廃止。 */}
      {!editMode && (
      <div className="bg-[#007aff] text-white rounded-2xl lg:rounded-[20px] p-4 lg:p-6 shadow-lg relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={22} />
            <h3 className="text-lg font-bold">Summary</h3>
          </div>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 rounded-lg text-xs border border-red-500/30 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
          {summary ? (
            isHistoryMode ? (
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
              <div>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full min-h-[220px] px-4 py-3 bg-white/10 border border-white/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/40 text-sm text-white placeholder:text-white/50 resize-y"
                  placeholder="Summary を編集..."
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[10px] text-white/60">提出前に内容を直接編集できます。</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(summary)}
                    className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <Copy size={14} />
                    Copy Summary
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="text-center py-8">
              <p className="text-white/60 italic text-sm">
                {isHistoryMode
                  ? 'この日のサマリーは保存されていません。'
                  : '「確定」ボタンを押すとサマリーが自動生成されます。'}
              </p>
            </div>
          )}
        </div>
        <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-white/5 rounded-full blur-3xl" />
      </div>
      )}

      {/* 編集モード時の sticky な「キャンセル / 確定」バー（画面下に固定）。
          desktop は左 sidebar 256px 分のオフセットを `lg:left-64` で確保する。 */}
      {editMode && !isHistoryMode && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] z-40 px-4 lg:px-6 py-3 flex items-center gap-3 justify-end">
          <span className="text-xs text-[#86868b] mr-auto hidden sm:block">編集中：キャンセルで元の状態へ戻ります</span>
          <button
            onClick={handleCancel}
            disabled={isCanceling || isConfirming}
            className="px-4 py-2 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors disabled:opacity-50 text-sm"
          >
            {isCanceling ? <Loader2 size={16} className="animate-spin inline" /> : 'キャンセル'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isCanceling || isConfirming}
            className="px-4 py-2 bg-[#007aff] text-white rounded-xl font-bold hover:bg-[#0062cc] transition-colors disabled:opacity-50 text-sm"
          >
            {isConfirming ? <Loader2 size={16} className="animate-spin inline" /> : '確定'}
          </button>
        </div>
      )}

      {delayModalTask && (
        <DelayModal
          task={delayModalTask}
          siblings={allSubTasks.filter(s => s.parent_task_id === delayModalTask.parent_task_id)}
          projectName={parentMap.get(delayModalTask.parent_task_id)?.name}
          onCancel={handleDelayCancel}
          onSubmit={handleDelaySubmit}
        />
      )}

      {/* 備考編集モーダル（A 優先度ストリップの編集ボタンから開く） */}
      {remarksEditTask && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[80] flex items-center justify-center p-4"
          onClick={closeRemarksEdit}
        >
          <div
            className="mac-card max-w-md w-full p-5 lg:p-6 shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-amber-50 text-amber-700 rounded-lg">
                <NotebookPen size={18} />
              </div>
              <h3 className="text-base font-bold text-[#1d1d1f]">備考を編集</h3>
            </div>
            <p className="text-xs text-[#86868b] mb-3 truncate" title={remarksEditTask.task_name}>
              {remarksEditTask.task_name}
            </p>
            <textarea
              value={remarksEditText}
              onChange={(e) => setRemarksEditText(e.target.value)}
              autoFocus
              rows={5}
              placeholder="このタスクに関するメモ・連絡事項・注意点など…"
              className="mac-input w-full resize-y min-h-[120px] text-sm"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSaveRemarks}
                disabled={isSavingRemarks}
                className="flex-1 py-2.5 bg-[#007aff] text-white rounded-xl font-bold hover:bg-[#0066d6] transition-colors disabled:opacity-50"
              >
                {isSavingRemarks ? '保存中...' : '保存'}
              </button>
              <button
                onClick={closeRemarksEdit}
                disabled={isSavingRemarks}
                className="flex-1 py-2.5 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
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

// Stat card sub-component
const StatCard: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
  <div className="mac-card p-3 lg:p-4">
    <div className="text-[10px] lg:text-xs text-[#86868b] mb-1 lg:mb-2">{label}</div>
    <div className={cn('text-xl lg:text-2xl font-bold', accent)}>{value}</div>
  </div>
);

// 優先度 A/B/C の円グラフ（CSS conic-gradient。チャートライブラリ非依存）。
const PRIORITY_PIE_COLOR = { A: '#ef4444', B: '#f59e0b', C: '#d1d5db' } as const;
const PRIORITY_PIE_LABEL = { A: '高', B: '中', C: '低' } as const;
const PriorityPieCard: React.FC<{ counts: { A: number; B: number; C: number } }> = ({ counts }) => {
  const { A, B, C } = counts;
  const sum = A + B + C;
  // 角度（0 件のときは均等グレー）
  const aDeg = sum ? (A / sum) * 360 : 0;
  const bDeg = sum ? (B / sum) * 360 : 0;
  const background = sum
    ? `conic-gradient(${PRIORITY_PIE_COLOR.A} 0deg ${aDeg}deg, ${PRIORITY_PIE_COLOR.B} ${aDeg}deg ${aDeg + bDeg}deg, ${PRIORITY_PIE_COLOR.C} ${aDeg + bDeg}deg 360deg)`
    : '#e5e7eb';
  return (
    <div className="mac-card p-3 lg:p-4">
      <div className="text-[10px] lg:text-xs text-[#86868b] mb-1 lg:mb-2">優先度</div>
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 lg:w-12 lg:h-12 rounded-full flex-shrink-0"
          style={{ background }}
          title={`高 ${A} / 中 ${B} / 低 ${C}`}
        />
        <div className="flex flex-col gap-0.5 text-[11px] lg:text-xs min-w-0">
          {(['A', 'B', 'C'] as const).map(p => (
            <div key={p} className="flex items-center gap-1.5 tabular-nums">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: PRIORITY_PIE_COLOR[p] }} />
              <span className="text-[#86868b]">{PRIORITY_PIE_LABEL[p]}</span>
              <span className="font-bold text-[#1d1d1f]">{counts[p]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// 実績工数を手入力する小さな数値インプット。
// 入力中はローカル状態で保持し、フォーカスアウト / Enter で確定保存する
// （1 文字ごとに DB 書き込みしてカーソルが飛ぶのを防ぐ）。外部更新には useEffect で追従。
const ActualHoursInput: React.FC<{
  value: number | undefined;
  className?: string;
  onCommit: (hours: number) => void;
}> = ({ value, className, onCommit }) => {
  // undefined（未入力）と 0（明示 0）を視覚的に区別するため、未入力時は空表示する。
  const toLocal = (v: number | undefined) => (v == null ? '' : String(v));
  const [local, setLocal] = useState<string>(toLocal(value));
  useEffect(() => { setLocal(toLocal(value)); }, [value]);
  const commit = () => {
    // 空入力のままなら何も保存しない（クリック→ブラーで意図せず 0 が入るのを防ぐ）。
    if (local.trim() === '') {
      setLocal(toLocal(value));
      return;
    }
    const n = Number(local);
    if (!isNaN(n) && n >= 0 && n !== value) {
      onCommit(n);
    } else {
      setLocal(toLocal(value));
    }
  };
  return (
    <input
      type="number"
      min={0}
      step={0.5}
      value={local}
      placeholder="—"
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
