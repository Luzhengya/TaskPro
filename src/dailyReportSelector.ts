/**
 * 日報の「自動抽出」 + カテゴリ表示 + 異常リマインド のロジック。
 *
 * ユーザー要件（Phase 1 最終版）：
 *   - 自動抽出は **「先にリセット → 再抽出」** 方式（追加方式から変更）
 *   - リマインド対象（下記 6 条件のいずれか）に該当するタスクは抽出しない
 *   - 完了済（'済'）、保留 は抽出しない（無条件）
 *   - 空 start_date は 4/5/6 で除外
 *   - 進行中 ステータスは start_date がどこにあっても 進行中 バケットへ
 *   - 定例作業（parent.type==='meeting'）にも同じルール
 *
 * カテゴリ：
 *   1. 期限遅れ      : status === '期限遅れ'
 *   2. 遅延中        : status === '遅れ'
 *   3. 着手遅れ      : status === '着手遅れ'
 *   4. 進行中        : status === '進行中' AND start_date 非空
 *   5. 本日予定      : status === '未着手' AND start_date === today
 *   6. 明日予定      : status === '未着手' AND today < start_date ≤ addBusinessDays(today, 1)
 *
 * 異常検出（リマインド section）：
 *   A. 必須入力     : 開始日 / 期日 / 期限 / 状態 / 予定工数 / 優先度 のいずれかが空（undefined）
 *                     ※ 数値の 0 は正当値、負数は別ルール G で拾う
 *   B. 実績未入力   : 状態='済' かつ 実績工数が undefined
 *                     ※ 0 は「対応不要だった」を明示する正当値として扱う
 *   G. 工数異常     : 予定工数 or 実績工数 が負の数（ステータス問わず）
 *   C. 日付整合性   : 期日 > 期限
 *   D. 着手遅れ候補 : 開始日<今日 かつ 状態='未着手'（着手遅れに更新すべき状態）
 *   E. 期日超過     : 期日<今日≤期限 かつ 状態 in {未着手, 進行中, 着手遅れ, 期限遅れ}
 *                     ※「遅れ」「済」「保留」は対象外
 *   F. 期限超過     : 期限<今日 かつ 状態 in {未着手, 進行中, 着手遅れ, 遅れ}
 *                     ※「済」「期限遅れ」「保留」は対象外
 *
 * 設計判断：
 *   - 自動抽出は **異常タスクをスキップする**（ユーザーがまず修正すべきため）
 *   - リマインド section は **全アクティブタスク** から異常を検出（is_in_report に依存しない）
 *   - リマインド件数は「日報の集計件数」に含めない（ユーザー要件）
 */

import { ParentTask, SubTask, SubTaskStatus } from './types';
import { addBusinessDays, normalizeDate, todayBeijing } from './dateUtils';

/* ============================================================
 * カテゴリ定義
 * ============================================================ */

export type ExtractCategory =
  | 'overdue_final'
  | 'overdue'
  | 'overdue_start'
  | 'in_progress'
  | 'starting_today'
  | 'starting_soon';

export type DisplayCategory = ExtractCategory | 'remind';

export const EXTRACT_CATEGORY_LABEL: Record<ExtractCategory, string> = {
  overdue_final:  '期限遅れ',
  overdue:        '遅延中',
  overdue_start:  '着手遅れ',
  in_progress:    '進行中',
  starting_today: '本日予定',
  starting_soon:  '明日予定',
};

export const DISPLAY_CATEGORY_LABEL: Record<DisplayCategory, string> = {
  ...EXTRACT_CATEGORY_LABEL,
  remind: 'リマインド',
};

export const EXTRACT_CATEGORY_ORDER: ExtractCategory[] = [
  'overdue_final',
  'overdue',
  'overdue_start',
  'in_progress',
  'starting_today',
  'starting_soon',
];

export const DISPLAY_CATEGORY_ORDER: DisplayCategory[] = [
  'remind',
  ...EXTRACT_CATEGORY_ORDER,
];

/* ============================================================
 * 異常検出
 * ============================================================ */

export type AnomalyCode =
  | 'missing_required'
  | 'done_no_actual'
  | 'hours_invalid'
  | 'date_inconsistent'
  | 'late_start'
  | 'due_overdue'
  | 'final_overdue';

export const ANOMALY_LABEL: Record<AnomalyCode, string> = {
  missing_required:   '必須入力',
  done_no_actual:     '実績未入力',
  hours_invalid:      '工数異常',
  date_inconsistent:  '日付整合性',
  late_start:         '着手遅れ候補',
  due_overdue:        '期日超過',
  final_overdue:      '期限超過',
};

/** 1 件のタスクの異常 code 一覧。空配列なら異常なし。 */
export function findAnomalies(t: SubTask, today: string): AnomalyCode[] {
  const codes: AnomalyCode[] = [];

  // 定例作業のテンプレート行は日付・状態を持たないため異常判定の対象外。
  if (t.recurrence) return codes;

  // 数値判定ヘルパ。**0 は正当値**として扱う（ユーザー要件）。
  // 役割分担：未入力（undefined/null）は A/B で拾い、負の数は G「工数異常」で拾う。
  const isMissing = (n: number | undefined | null) => n == null;
  const isNegative = (n: number | undefined | null) => n != null && n < 0;

  // A. 必須入力（未入力のみ。負数は別ルール G で拾う）
  const trim = (v: string | undefined | null) => (v ?? '').toString().trim();
  const requiredMissing =
    !trim(t.start_date) ||
    !trim(t.due_date) ||
    !trim(t.final_deadline) ||
    !trim(t.status as unknown as string) ||
    isMissing(t.planned_hours) ||
    !trim(t.priority as unknown as string);
  if (requiredMissing) codes.push('missing_required');

  // B. 実績未入力 (status=済 かつ actual_hours が undefined/null)。
  //    実績 0 は「対応不要だった」ことを明示する正当値として扱う。
  if (t.status === '済' && isMissing(t.actual_hours)) codes.push('done_no_actual');

  // G. 工数異常: 予定 or 実績 が負の数（ステータス問わず）
  if (isNegative(t.planned_hours) || isNegative(t.actual_hours)) codes.push('hours_invalid');

  const sd = normalizeDate(t.start_date);
  const dd = normalizeDate(t.due_date);
  const fd = normalizeDate(t.final_deadline);

  // C. 日付整合性: 期日 > 期限
  if (dd && fd && dd > fd) codes.push('date_inconsistent');

  // D. 着手遅れ候補: 開始日<今日 かつ 状態=未着手
  if (t.status === '未着手' && sd && sd < today) codes.push('late_start');

  // E. 期日超過: 期日<今日≤期限 かつ 状態 in [未着手, 進行中, 着手遅れ, 期限遅れ]
  //    → 「遅れ」「済」「保留」は対象外（既に遅延扱い or 完了 or 一時停止）
  const dueOverdueStatuses: SubTaskStatus[] = ['未着手', '進行中', '着手遅れ', '期限遅れ'];
  if (dd && fd && dd < today && today <= fd && dueOverdueStatuses.includes(t.status)) {
    codes.push('due_overdue');
  }

  // F. 期限超過: 期限<今日 かつ 状態 in [未着手, 進行中, 着手遅れ, 遅れ]
  //    → 「済」「期限遅れ」「保留」は対象外
  const finalOverdueStatuses: SubTaskStatus[] = ['未着手', '進行中', '着手遅れ', '遅れ'];
  if (fd && fd < today && finalOverdueStatuses.includes(t.status)) {
    codes.push('final_overdue');
  }

  return codes;
}

export interface AnomalyResult {
  task: SubTask;
  codes: AnomalyCode[];
}

/**
 * 全アクティブタスクから異常を検出してリスト化。
 *  - 親が visible（履歴行き / 削除済みは除外）
 *  - is_in_report の状態は問わない（データ品質チェックなので）
 */
export function findAnomalousTasks(
  allSubTasks: SubTask[],
  parentMap: Map<string, ParentTask>,
  overrideToday?: string,
): AnomalyResult[] {
  const today = overrideToday ?? todayBeijing();
  const out: AnomalyResult[] = [];
  for (const t of allSubTasks) {
    if (!parentMap.has(t.parent_task_id)) continue;
    const codes = findAnomalies(t, today);
    if (codes.length > 0) out.push({ task: t, codes });
  }
  return out;
}

/* ============================================================
 * 抽出（6 カテゴリ分類）
 * ============================================================ */

const ACTIVE_STATUSES: SubTaskStatus[] = ['進行中', '未着手'];

/** 6 カテゴリのどれに該当するか（該当無しは null）。is_in_report・異常チェックは行わない。 */
function classify(t: SubTask, today: string, startNearHorizon: string): ExtractCategory | null {
  // 定例テンプレートは抽出対象外（実体は別途生成される）。
  if (t.recurrence) return null;
  if (t.status === '期限遅れ') return 'overdue_final';
  if (t.status === '遅れ') return 'overdue';
  if (t.status === '着手遅れ') return 'overdue_start';

  if (t.status === '進行中') {
    const sd = normalizeDate(t.start_date);
    if (!sd) return null;
    return 'in_progress';
  }

  if (t.status === '未着手') {
    const sd = normalizeDate(t.start_date);
    if (!sd) return null;
    if (sd === today) return 'starting_today';
    if (sd > today && sd <= startNearHorizon) return 'starting_soon';
    return null;
  }

  // 'active' でないステータス（'済' / '保留'）は対象外
  void ACTIVE_STATUSES;
  return null;
}

export interface ExtractResult {
  /** is_in_report=true を立てる全タスク（6 カテゴリ + 異常タスク） */
  all: SubTask[];
  /** 6 カテゴリに分類されたタスク（異常タスクは含まない） */
  byCategory: Record<ExtractCategory, SubTask[]>;
  /** カテゴリ別件数（6 のみ。異常は別カウント） */
  counts: Record<ExtractCategory, number>;
  /** 異常タスクの件数（リマインド対象） */
  remindCount: number;
  /** 6 カテゴリの合計件数（リマインド込みでない） */
  total: number;
}

/**
 * 自動抽出のエントリポイント。
 *
 * 動作（リセット前提のため is_in_report はチェックしない）：
 *  - 親が visible なタスクを対象
 *  - **異常タスクも抽出対象に含める**（is_in_report=true を立てる）→ リマインド section に表示
 *  - 6 カテゴリのいずれかに分類できる非異常タスクは byCategory に格納
 *  - all は両方含む（書き込み対象リスト）
 */
export function extractDailyReportCandidates(
  allSubTasks: SubTask[],
  parentMap: Map<string, ParentTask>,
  overrideToday?: string,
): ExtractResult {
  const today = overrideToday ?? todayBeijing();
  const startNearHorizon = addBusinessDays(today, 1);

  const byCategory: Record<ExtractCategory, SubTask[]> = {
    overdue_final:  [],
    overdue:        [],
    overdue_start:  [],
    in_progress:    [],
    starting_today: [],
    starting_soon:  [],
  };
  const anomalousTasks: SubTask[] = [];

  for (const t of allSubTasks) {
    if (!parentMap.has(t.parent_task_id)) continue;
    if (findAnomalies(t, today).length > 0) {
      // 異常タスクも is_in_report=true 対象（リマインド section にデフォルト勾选で表示）
      anomalousTasks.push(t);
      continue;
    }
    const cat = classify(t, today, startNearHorizon);
    if (cat) byCategory[cat].push(t);
  }

  const counts: Record<ExtractCategory, number> = {
    overdue_final:  byCategory.overdue_final.length,
    overdue:        byCategory.overdue.length,
    overdue_start:  byCategory.overdue_start.length,
    in_progress:    byCategory.in_progress.length,
    starting_today: byCategory.starting_today.length,
    starting_soon:  byCategory.starting_soon.length,
  };

  const categorized = EXTRACT_CATEGORY_ORDER.flatMap(c => byCategory[c]);
  // 全 is_in_report=true 対象（6 カテゴリ + リマインド）
  const all = [...categorized, ...anomalousTasks];
  return {
    all,
    byCategory,
    counts,
    remindCount: anomalousTasks.length,
    total: categorized.length,
  };
}

/* ============================================================
 * 表示用カテゴリ化
 * ============================================================ */

export interface CategorizedDisplay {
  byCategory: Record<DisplayCategory, Map<string, SubTask[]>>;
  counts: Record<DisplayCategory, number>;
  /** タスク id → 異常 code（リマインドセクションでチップ表示用） */
  anomalyCodes: Map<string, AnomalyCode[]>;
}

/**
 * 表示用にデータを組み立てる。
 *  - 1-6 バケット: reportTasks（is_in_report=true + 定例自動分）を分類
 *  - 'remind' バケット: allSubTasks から異常検出（is_in_report に依存しない）
 *  - リマインドに入ったタスクは 1-6 にも入れる（重複表示）ことはしない
 *  - リマインド件数は別カウント（DailyReport 側で stats から除外）
 */
export function buildDisplayData(
  reportTasks: SubTask[],
  allSubTasks: SubTask[],
  parentMap: Map<string, ParentTask>,
  overrideToday?: string,
): CategorizedDisplay {
  const today = overrideToday ?? todayBeijing();
  const startNearHorizon = addBusinessDays(today, 1);

  const byCategory: Record<DisplayCategory, Map<string, SubTask[]>> = {
    overdue_final:  new Map(),
    overdue:        new Map(),
    overdue_start:  new Map(),
    in_progress:    new Map(),
    starting_today: new Map(),
    starting_soon:  new Map(),
    remind:         new Map(),
  };

  // 異常タスクを集める。anomalyCodes は集計除外用（is_in_report 問わず全件）。
  // 一方、リマインド section に "表示" するのは **is_in_report=true な異常タスク のみ**。
  // → ユーザーが勾选を外すと section から消える（ユーザー要件）。
  const anomalyCodes = new Map<string, AnomalyCode[]>();
  for (const t of allSubTasks) {
    if (!parentMap.has(t.parent_task_id)) continue;
    const codes = findAnomalies(t, today);
    if (codes.length === 0) continue;
    anomalyCodes.set(t.id, codes);
    if (t.is_in_report) {
      const list = byCategory.remind.get(t.parent_task_id) || [];
      list.push(t);
      byCategory.remind.set(t.parent_task_id, list);
    }
  }

  // reportTasks を 1-6 に分類（異常タスクは除外）
  for (const t of reportTasks) {
    if (anomalyCodes.has(t.id)) continue; // 異常なものは remind のみ
    const cat = classify(t, today, startNearHorizon);
    if (!cat) continue; // どこにも該当しないものはサイレントスキップ
    const projMap = byCategory[cat];
    const list = projMap.get(t.parent_task_id) || [];
    list.push(t);
    projMap.set(t.parent_task_id, list);
  }

  const counts: Record<DisplayCategory, number> = {} as Record<DisplayCategory, number>;
  for (const cat of DISPLAY_CATEGORY_ORDER) {
    let total = 0;
    for (const list of byCategory[cat].values()) total += list.length;
    counts[cat] = total;
  }

  return { byCategory, counts, anomalyCodes };
}

/* ============================================================
 * 確定後ビュー（編集モード抜けた後の日報表示）
 * ============================================================ */

/** 確定後ビューのカテゴリ（ステータスベース + 定例作業）。 */
export type ConfirmedCategory =
  | 'overdue_final'    // 期限遅れあり
  | 'overdue'          // 遅延あり
  | 'overdue_start'    // 着手遅れあり
  | 'in_progress'      // 進行中
  | 'completed_today'  // 完了（編集中に済に変更された task）
  | 'starting_planned' // 着手予定（明日予定 = 未着手 + start_date が 1 営業日先まで）
  | 'recurring';       // 定例作業（テンプレートから生成された実体）

export const CONFIRMED_CATEGORY_LABEL: Record<ConfirmedCategory, string> = {
  overdue_final:     '期限遅れあり',
  overdue:           '遅延あり',
  overdue_start:     '着手遅れあり',
  in_progress:       '進行中',
  completed_today:   '完了',
  starting_planned:  '着手予定',
  recurring:         '定例作業',
};

export const CONFIRMED_CATEGORY_ORDER: ConfirmedCategory[] = [
  'overdue_final',
  'overdue',
  'overdue_start',
  'in_progress',
  'completed_today',
  'starting_planned',
  'recurring',
];

export interface ConfirmedDisplay {
  byCategory: Record<ConfirmedCategory, Map<string, SubTask[]>>;
  counts: Record<ConfirmedCategory, number>;
}

/**
 * 確定後の表示データを構築（6 カテゴリ、ステータス互斥）。
 *
 *  - ステータス別カテゴリは task の現在ステータスで振り分け（同 task は 1 個だけ）
 *  - 「完了」は **snapshot 上で「済」でなかった** task が現状「済」になっているもの
 *    （snapshot に居ない場合は「編集中に追加 → 即完了」とみなして 完了 に入れる）
 *  - 「着手予定」は status='未着手' AND today < start_date ≤ 1営業日先
 *
 * snapshot を空オブジェクトで渡せば「完了 = 現状全 済 task」として動く（初期表示・履歴表示 fallback）。
 */
export function buildConfirmedDisplayData(
  reportTasks: SubTask[],
  snapshot: Record<string, SubTask>,
  overrideToday?: string,
): ConfirmedDisplay {
  const today = overrideToday ?? todayBeijing();
  const startNearHorizon = addBusinessDays(today, 1);

  const byCategory: Record<ConfirmedCategory, Map<string, SubTask[]>> = {
    overdue_final:    new Map(),
    overdue:          new Map(),
    overdue_start:    new Map(),
    in_progress:      new Map(),
    completed_today:  new Map(),
    starting_planned: new Map(),
    recurring:        new Map(),
  };

  const push = (cat: ConfirmedCategory, t: SubTask) => {
    const list = byCategory[cat].get(t.parent_task_id) || [];
    list.push(t);
    byCategory[cat].set(t.parent_task_id, list);
  };

  for (const t of reportTasks) {
    if (t.recurrence) continue; // 定例テンプレートは表示対象外（防御）
    // 定例作業の実体は専用カテゴリへ（状態を問わず一括表示）。
    if (t.recurrence_source_id) { push('recurring', t); continue; }
    // ステータス別（互斥）
    if (t.status === '期限遅れ') push('overdue_final', t);
    else if (t.status === '遅れ') push('overdue', t);
    else if (t.status === '着手遅れ') push('overdue_start', t);
    else if (t.status === '進行中') push('in_progress', t);
    else if (t.status === '済') {
      const before = snapshot[t.id];
      // snapshot に無い or snapshot で非「済」だった → 「今日完了した」
      if (!before || before.status !== '済') push('completed_today', t);
      // snapshot で既に「済」だったものは「すべて」のみに入れる（重複させない）
    } else if (t.status === '未着手') {
      const sd = normalizeDate(t.start_date);
      if (sd && sd > today && sd <= startNearHorizon) push('starting_planned', t);
    }
  }

  const counts: Record<ConfirmedCategory, number> = {} as Record<ConfirmedCategory, number>;
  for (const cat of CONFIRMED_CATEGORY_ORDER) {
    let total = 0;
    for (const list of byCategory[cat].values()) total += list.length;
    counts[cat] = total;
  }

  return { byCategory, counts };
}

/* ============================================================
 * 日報サマリー生成（テンプレート方式 + 前後比較）
 * ============================================================
 *
 * 「確定」ボタン押下時に snapshot（編集前）と現状（編集後）を比較し、
 * 状態遷移に応じた定型文でサマリーを組み立てる。AI は使わない（安定・無料・高速）。
 *
 * 状態遷移ルール（before → after）：
 *   - 未着手 / 進行中 → 済 : 「予定通り完了しました」
 *   - 遅延系       → 済 : 「遅れていましたが完了しました」
 *   - その他       → 済 : 「完了しました」（snapshot 無し等）
 *   - 非遅延       → 遅延系 : 「本日発生」
 *   - 遅延系       → 遅延系 : 「継続中」
 *
 * タスク名は「【親案件】子タスク」形式。
 */

const DELAY_STATUSES: SubTaskStatus[] = ['遅れ', '期限遅れ', '着手遅れ'];

export function buildDailyReportSummary(
  reportTasks: SubTask[],
  snapshot: Record<string, SubTask>,
  parentMap: Map<string, ParentTask>,
  overrideToday?: string,
): string {
  const today = overrideToday ?? todayBeijing();
  const startNearHorizon = addBusinessDays(today, 1);

  // 「【親案件】子タスク」
  const fmtName = (t: SubTask) => {
    const parentName = parentMap.get(t.parent_task_id)?.name ?? '案件不明';
    return `【${parentName}】${t.task_name}`;
  };

  // 遅延タスクの「本日発生 / 継続中」判定（前後比較）
  const delayNote = (t: SubTask): string => {
    const before = snapshot[t.id];
    if (before && DELAY_STATUSES.includes(before.status)) return '継続中';
    return '本日発生';
  };

  // 完了タスクの完了文言（前後比較）
  const completeNote = (t: SubTask): string => {
    const before = snapshot[t.id];
    if (!before) return '完了しました';
    if (before.status === '未着手' || before.status === '進行中') return '予定通り完了しました';
    if (DELAY_STATUSES.includes(before.status)) return '遅れていましたが完了しました';
    return '完了しました';
  };

  // カテゴリ分類
  const overdueFinal: SubTask[] = [];
  const overdue: SubTask[] = [];
  const overdueStart: SubTask[] = [];
  const completed: SubTask[] = [];
  const inProgress: SubTask[] = [];
  const startingPlanned: SubTask[] = [];

  for (const t of reportTasks) {
    if (t.recurrence) continue; // 定例テンプレートはサマリー対象外（防御）
    if (t.status === '期限遅れ') overdueFinal.push(t);
    else if (t.status === '遅れ') overdue.push(t);
    else if (t.status === '着手遅れ') overdueStart.push(t);
    else if (t.status === '済') {
      const before = snapshot[t.id];
      if (!before || before.status !== '済') completed.push(t);
    } else if (t.status === '進行中') inProgress.push(t);
    else if (t.status === '未着手') {
      const sd = normalizeDate(t.start_date);
      if (sd && sd > today && sd <= startNearHorizon) startingPlanned.push(t);
    }
  }

  const total =
    overdueFinal.length + overdue.length + overdueStart.length +
    completed.length + inProgress.length + startingPlanned.length;

  const lines: string[] = [];

  // ヘッダー（総数 + 内訳）
  lines.push(`本日 ${total} 件のタスクを対応しています。`);
  lines.push(
    `内訳：期限遅れ ${overdueFinal.length} 件、遅れ ${overdue.length} 件、` +
    `着手遅れ ${overdueStart.length} 件、完了 ${completed.length} 件、進行中 ${inProgress.length} 件。`,
  );
  lines.push('');

  // 遅延系セクション（原因付き）
  const delaySection = (label: string, tasks: SubTask[]) => {
    if (tasks.length === 0) return;
    lines.push(`## ${label}`);
    for (const t of tasks) {
      lines.push(`- ${fmtName(t)}（${delayNote(t)}）`);
      const reason = (t.delay_reason ?? '').trim();
      const impact = t.delay_impact_days ? `（影響 ${t.delay_impact_days} 日）` : '';
      lines.push(`  原因: ${reason || '（原因未記入）'}${impact}`);
    }
    lines.push('');
  };
  delaySection('期限遅れ', overdueFinal);
  delaySection('遅れ', overdue);
  delaySection('着手遅れ', overdueStart);

  // 本日完了
  if (completed.length > 0) {
    lines.push('## 本日完了');
    for (const t of completed) {
      lines.push(`- ${fmtName(t)} ${completeNote(t)}`);
    }
    lines.push('');
  }

  // 本日の予定（進行中の継続 + 明日着手予定）
  if (inProgress.length > 0 || startingPlanned.length > 0) {
    lines.push('## 本日の予定');
    for (const t of inProgress) {
      lines.push(`- ${fmtName(t)} を引き続き対応します`);
    }
    for (const t of startingPlanned) {
      lines.push(`- ${fmtName(t)} に着手予定です`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

// 後方互換のため type を再エクスポート（unused import 警告防止）
export type { SubTaskStatus };
