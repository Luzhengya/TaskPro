export type SubTaskStatus = '遅れ' | '済' | '進行中' | '未着手' | '保留' | '着手遅れ' | '期限遅れ';
export type Priority = 'A' | 'B' | 'C';

/**
 * 親タスクの種別。
 *  - 'normal'（既定）: 通常の案件。期日・期限を持つ。
 *  - 'meeting'      : 会議集（子は個別の会議）。親側の期日は持たず、
 *                     子の開始日(start_date) == 今日 のときに日報へ自動表示される。
 * undefined は後方互換のため 'normal' として扱う。
 * （CloudBase 既存ドキュメント／Excel インポート由来のレコードはこのフィールドを持たない） */
export type ParentTaskType = 'normal' | 'meeting';

/**
 * 定例作業の繰り返しルール。
 *  - daily   : 毎日
 *  - weekly  : 毎週、指定曜日（weekdays: 0=日, 1=月, ..., 6=土）
 *  - monthly : 毎月、指定日（days: 1〜31）
 * このルールを持つ SubTask は「テンプレート」扱いとなり、日報には直接出ず、
 * 日報を開いた日に該当すれば「実体タスク」が自動生成される。
 */
export type RecurrenceRule =
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }
  | { kind: 'monthly'; days: number[] };

export interface ParentTask {
  id: string;
  name: string;
  deadline: string; // This will be used as "期日" (Due Date)
  planned_hours: number;
  actual_hours?: number;
  progress?: number;
  is_hidden?: boolean;
  order?: number;
  /** 'meeting' のとき会議集として扱う（親の期日表示・整合性チェックを抑制）。 */
  type?: ParentTaskType;
  created_at: string;
  updated_at: string;
  owner_id?: string;
}

export interface SubTask {
  id: string;
  parent_task_id: string;
  system: string;
  month: string;
  daily_report_date: string;
  start_date: string;
  due_date: string;
  final_deadline: string;
  status: SubTaskStatus;
  task_name: string;
  planned_hours: number;
  /** 実績工数。未入力（undefined）と「0 を明示」を区別する。
   *  作成・インポート時には初期値を入れない。「済」かつ undefined はリマインド対象。 */
  actual_hours?: number;
  priority: Priority;
  remarks: string;
  delay_reason?: string;
  impact_assessment?: '小' | '中' | '大';
  /** 遅延が後続タスクへ与えた影響日数（0＝影響なし）。 */
  delay_impact_days?: number;
  /** 遅延シフト前の期日（取り消し線表示用。シフトされていなければ未設定）。 */
  original_due_date?: string;
  /** 遅延シフト前の期限（取り消し線表示用）。 */
  original_final_deadline?: string;
  /** このタスクの期日・期限をシフトさせた遅延の発生元ステータス（表示色の決定に使う）。 */
  delay_shift_status?: SubTaskStatus;
  is_in_report?: boolean;
  /** 定例作業のテンプレート行。値があれば日報には出ず、該当日に実体を自動生成する。 */
  recurrence?: RecurrenceRule;
  /** 自動生成された実体タスクの場合、生成元テンプレートの SubTask id。
   *  同一テンプレ × 同一日で二重生成しないための紐付け。 */
  recurrence_source_id?: string;
  order?: number;
  weekday?: string;
  week?: string;
  week_number: number;
  flag: number;
  icon_data?: string; // SVG data or icon name from lucide-react
  created_at: string;
  updated_at: string;
  owner_id?: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  order?: number;
  created_at: string;
  updated_at: string;
  owner_id?: string;
}

export interface TemplateItem {
  id: string;
  template_id: string;
  system: string;
  task_name: string;
  status: SubTaskStatus;
  planned_hours: number;
  priority: Priority;
  remarks: string;
  order?: number;
  created_at: string;
  updated_at: string;
  owner_id?: string;
}

export interface UserSettings {
  id: string;
  ai_models: any[];
  ui_preferences: {
    view: 'table' | 'grid' | 'weekly';
    opacity: number;
    theme: 'light' | 'dark';
    font: string;
    /** プロジェクト画面で表示するビュー。未設定時は table のみ表示が既定。 */
    enabled_views?: { grid: boolean; table: boolean; weekly: boolean };
  };
  notification_rules: NotificationRule[];
  /** ユーザー定義のクイックフィルタ。Dashboard 上部のチップとして並ぶ。
   *  未設定（undefined）の場合は初回起動時に DEFAULT_QUICK_FILTERS で seed する。 */
  quick_filters?: QuickFilter[];
  /** 「期限間近」「開始間近」タブの判定に使う営業日数（土日を飛ばす）。
   *  例: 1 → 今日〜「次の営業日」 までに期限/開始日が来る子タスクを持つ案件を該当扱い。
   *  未設定なら既定 1。 */
  near_threshold_days?: number;
  created_at: string;
  updated_at: string;
}

/* ============================================================
 * タスク検索（Dashboard 詳細フィルタ・クイックフィルタの共通スキーマ）
 * ============================================================ */

/** 日付条件。enabled=false は「この日付では絞らない」。
 *  mode='today' は「実行時の今日」（毎日今日に追従。北京時間で解決）。
 *  mode='fixed' は固定の日付文字列。 */
export type DateFilter =
  | { enabled: false }
  | { enabled: true; mode: 'today' }
  | { enabled: true; mode: 'fixed'; date: string };

/** タスク検索の条件。Dashboard で実行時に組み立てるほか、QuickFilter にも埋め込む。 */
export interface TaskFilter {
  keyword: string;
  dueDate: DateFilter;
  finalDeadline: DateFilter;
  startDate: DateFilter;
  /** 空配列 = 指定なし（全部 OK）。 */
  priorities: Priority[];
  /** 空配列 = 指定なし（全部 OK）。 */
  statuses: SubTaskStatus[];
  /** 空配列 = 指定なし（全部 OK）。 */
  parentIds: string[];
}

/** Settings から作成・編集できる名前付きフィルタ。Dashboard のチップとして並ぶ。 */
export interface QuickFilter {
  id: string;
  name: string;
  filter: TaskFilter;
}

export interface NotificationRule {
  id: string;
  enabled: boolean;
  time: string;
  content_types: ('today_tasks' | 'delayed_tasks')[];
  days_before_deadline: number;
}

export interface DailyReportSnapshot {
  id: string;
  date: string;           // YYYY-MM-DD
  notes: string;          // 本日のメモ
  ai_summary?: string;    // AI 生成总结
  tasks_snapshot: SubTask[]; // 当日所有 is_in_report 任务的快照
  total_tasks: number;
  total_planned: number;
  total_actual: number;
  delayed_count: number;
  owner_id?: string;
  created_at: string;
  updated_at: string;
}
