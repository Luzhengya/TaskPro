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
  actual_hours: number;
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
  created_at: string;
  updated_at: string;
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
