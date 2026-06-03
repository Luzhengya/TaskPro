/** Weekly-report template column headers (row 1). */
export const TEMPLATE_HEADERS = {
  system: 'システム',
  month: '月次',
  projectName: '案件',
  dailyReport: '日報',
  startDate: '開始日',
  dueDate: '期日',
  finalDeadline: '期限',
  status: 'ステータス',
  taskName: 'タスク',
  plannedHours: '予定工数(H)',
  actualHours: '実績工数(H)',
  priority: '優先度',
  remarks: '備考',
  weekday: '曜日',
  week: '週次',
} as const;

export type ImportField = keyof typeof TEMPLATE_HEADERS;

/** Default column index (0-based) when header sits in the merged top-left cell. */
export const TEMPLATE_COLUMN_INDEX: Record<ImportField, number> = {
  system: 0, // A (A–B merged)
  month: 2, // C (C–D merged)
  projectName: 4, // E
  dailyReport: 5, // F
  startDate: 6, // G
  dueDate: 7, // H
  finalDeadline: 8, // I
  status: 9, // J
  taskName: 10, // K (K–P merged)
  plannedHours: 16, // Q
  actualHours: 17, // R
  priority: 18, // S
  remarks: 19, // T
  weekday: 20, // U
  week: 21, // V
};

/** Merged ranges: read the first non-empty cell in the range. */
export const MERGED_COLUMN_INDICES: Partial<Record<ImportField, readonly number[]>> = {
  system: [0, 1],
  month: [2, 3],
  taskName: [10, 11, 12, 13, 14, 15],
};

const REQUIRED_FIELDS: ImportField[] = ['projectName', 'taskName'];

export const HEADER_ROW_INDEX = 0;
export const DATA_START_ROW_INDEX = 1;

export function normalizeHeaderLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function headerMatches(cell: unknown, expected: string): boolean {
  const normalized = normalizeHeaderLabel(cell);
  const target = normalizeHeaderLabel(expected);
  if (!normalized) return false;
  return (
    normalized === target ||
    normalized.startsWith(target) ||
    target.startsWith(normalized)
  );
}

/** Row 1 headers → column index map (validates template). */
export function buildColumnIndexMap(
  headerRow: unknown[],
): Record<ImportField, number> {
  const map = { ...TEMPLATE_COLUMN_INDEX };

  for (const field of Object.keys(TEMPLATE_HEADERS) as ImportField[]) {
    const label = TEMPLATE_HEADERS[field];
    const found = headerRow.findIndex(cell => headerMatches(cell, label));
    if (found >= 0) {
      map[field] = found;
    }
  }

  const missing = REQUIRED_FIELDS.filter(field => {
    const idx = map[field];
    const cell = headerRow[idx];
    return !headerMatches(cell, TEMPLATE_HEADERS[field]);
  });

  if (missing.length > 0) {
    const labels = missing.map(f => TEMPLATE_HEADERS[f]).join('、');
    throw new Error(`見出しに必須列がありません：${labels}`);
  }

  return map;
}

function indicesForField(
  field: ImportField,
  columnMap: Record<ImportField, number>,
): readonly number[] {
  return MERGED_COLUMN_INDICES[field] ?? [columnMap[field]];
}

export function getRowValue(
  row: unknown[],
  columnMap: Record<ImportField, number>,
  field: ImportField,
): unknown {
  const indices = indicesForField(field, columnMap);
  for (const index of indices) {
    const value = row[index];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

/** Fill down 案件 / merged cells when Excel leaves continuation rows blank. */
export function fillDownMergedFields(
  rows: unknown[][],
  columnMap: Record<ImportField, number>,
): unknown[][] {
  const carry: Partial<Record<ImportField, unknown>> = {};

  return rows.map(row => {
    const next = [...row];
    const fieldsToFill: ImportField[] = ['system', 'month', 'projectName'];

    for (const field of fieldsToFill) {
      const value = getRowValue(next, columnMap, field);
      if (value !== undefined && String(value).trim() !== '') {
        carry[field] = value;
        const primary = columnMap[field];
        next[primary] = value;
      } else if (carry[field] !== undefined) {
        const primary = columnMap[field];
        next[primary] = carry[field];
      }
    }

    return next;
  });
}
