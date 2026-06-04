import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  FileUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Download,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { taskService } from '../services/taskService';
import { todayBeijing } from '../dateUtils';
import { Priority, SubTaskStatus } from '../types';
import {
  buildColumnIndexMap,
  DATA_START_ROW_INDEX,
  fillDownMergedFields,
  getRowValue,
  HEADER_ROW_INDEX,
  ImportField,
  TEMPLATE_HEADERS,
} from '../importColumns';

interface FileImportProps {
  onImportComplete: () => void;
}

const NO_DATA_MESSAGE = 'インポートするデータがありません。';

/** Served from `public/task-import-template.xlsx` (Vite static asset). */
const IMPORT_TEMPLATE_URL = '/task-import-template.xlsx';
const IMPORT_TEMPLATE_FILENAME = 'taskimportfile.xlsx';

function cellValue(cell: unknown): unknown {
  if (cell && typeof cell === 'object' && 'result' in cell) {
    return (cell as ExcelJS.CellFormulaValue).result;
  }
  return cell;
}

function worksheetToRows(worksheet: ExcelJS.Worksheet): unknown[][] {
  const jsonData: unknown[][] = [];
  worksheet.eachRow(row => {
    const values = row.values;
    if (!Array.isArray(values)) {
      jsonData.push([]);
      return;
    }
    jsonData.push(values.slice(1).map(cellValue));
  });
  return jsonData;
}

function isRowEmpty(row: unknown[]): boolean {
  return row.every(
    cell => cell === null || cell === undefined || String(cell).trim() === '',
  );
}

export const FileImport: React.FC<FileImportProps> = ({ onImportComplete }) => {
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsImporting(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const data = e.target?.result as ArrayBuffer;
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(data);
          const worksheet =
            workbook.worksheets.find(ws => ws.name.toLowerCase() === 'import') ??
            workbook.worksheets[0];
          if (!worksheet) {
            throw new Error('Excel ファイルにワークシートがありません。');
          }

          const allRows = worksheetToRows(worksheet);
          if (allRows.length < DATA_START_ROW_INDEX + 1) {
            throw new Error(NO_DATA_MESSAGE);
          }

          const columnMap = buildColumnIndexMap(allRows[HEADER_ROW_INDEX]);
          const rawDataRows = allRows
            .slice(DATA_START_ROW_INDEX)
            .filter(row => !isRowEmpty(row));

          if (rawDataRows.length === 0) {
            throw new Error(NO_DATA_MESSAGE);
          }

          const dataRows = fillDownMergedFields(rawDataRows, columnMap);

          const projectGroups = new Map<string, unknown[][]>();
          for (const row of dataRows) {
            const projectName = String(
              getRowValue(row, columnMap, 'projectName') ?? '',
            ).trim();
            if (!projectName) continue;
            if (!projectGroups.has(projectName)) {
              projectGroups.set(projectName, []);
            }
            projectGroups.get(projectName)?.push(row);
          }

          if (projectGroups.size === 0) {
            throw new Error(NO_DATA_MESSAGE);
          }

          // 取込時に日付を YYYY-MM-DD（ゼロ埋め）へ統一する。
          // 「2024/1/5」「2024-1-5」など区切り・桁が不揃いでも揃え、表示のばらつきを防ぐ。
          const parseDate = (val: unknown) => {
            if (!val) return '';
            if (val instanceof Date) return val.toISOString().split('T')[0];
            const str = String(val).trim().replace(/\//g, '-');
            const parts = str.split('-');
            if (parts.length === 3) {
              const [y, m, d] = parts;
              return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            }
            return str;
          };

          const parseNumber = (val: unknown) => {
            const n = Number(val);
            return isNaN(n) ? 0 : n;
          };

          const str = (row: unknown[], field: ImportField, fallback = '') => {
            const value = String(getRowValue(row, columnMap, field) ?? fallback).trim();
            return value || fallback;
          };

          for (const [projectName, projectRows] of projectGroups.entries()) {
            let totalPlanned = 0;
            let totalActual = 0;
            let completedCount = 0;
            const totalCount = projectRows.length;

            // Parent due date = the latest 期日 among its subtasks (zero-pad for
            // chronological string comparison; rows aren't guaranteed to be sorted).
            const pad = (d: string) =>
              d.split('-').length === 3
                ? d.split('-').map((p, i) => p.padStart(i === 0 ? 4 : 2, '0')).join('-')
                : d;
            const deadline = projectRows.reduce((max, row) => {
              const d = parseDate(getRowValue(row, columnMap, 'dueDate'));
              return d && pad(d) > pad(max) ? d : max;
            }, '');

            for (const row of projectRows) {
              totalPlanned += parseNumber(
                getRowValue(row, columnMap, 'plannedHours'),
              );
              totalActual += parseNumber(
                getRowValue(row, columnMap, 'actualHours'),
              );
              if (str(row, 'status').includes('済')) {
                completedCount++;
              }
            }

            const progress =
              totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            const parentId = await taskService.addParentTask({
              name: projectName,
              deadline: deadline || todayBeijing(),
              planned_hours: totalPlanned,
              actual_hours: totalActual,
              progress,
            });

            if (!parentId) continue;

            // 各 row を SubTask 入力へ変換。order は行インデックスで確定させ、
            // 1 件ごとの全件読み込み（O(n^2)）を避ける。
            const subTaskInputs = projectRows.map((row) => {
              const dueDate = parseDate(getRowValue(row, columnMap, 'dueDate'));
              const plannedHours = parseNumber(
                getRowValue(row, columnMap, 'plannedHours'),
              );
              return {
                parent_task_id: parentId,
                system: str(row, 'system'),
                month: str(row, 'month'),
                daily_report_date:
                  parseDate(getRowValue(row, columnMap, 'dailyReport')) ||
                  todayBeijing(),
                start_date: parseDate(getRowValue(row, columnMap, 'startDate')),
                due_date: dueDate,
                // 期限は Excel から取り込まず、期日＋予定工数から自動計算する
                // （規則表シート参照。土日を飛ばす）。
                final_deadline: taskService.calculateDeadline(dueDate, plannedHours),
                status: (str(row, 'status', '未着手') || '未着手') as SubTaskStatus,
                task_name: str(row, 'taskName'),
                planned_hours: plannedHours,
                actual_hours: parseNumber(
                  getRowValue(row, columnMap, 'actualHours'),
                ),
                priority: (str(row, 'priority', 'B') || 'B') as Priority,
                remarks: str(row, 'remarks'),
                weekday: str(row, 'weekday'),
                week: str(row, 'week'),
                week_number: 0,
                flag: 0,
              };
            });

            // 並列書き込み（同時実行数を制限してサーバ負荷を抑える）。
            const CONCURRENCY = 20;
            for (let i = 0; i < subTaskInputs.length; i += CONCURRENCY) {
              const chunk = subTaskInputs.slice(i, i + CONCURRENCY);
              await Promise.all(
                chunk.map((input, j) => taskService.addSubTask(input, i + j)),
              );
            }
          }

          setSuccess(true);
          setTimeout(() => {
            onImportComplete();
          }, 1500);
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : 'Excel のインポートに失敗しました。';
          setError(message);
        } finally {
          setIsImporting(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました。';
      setError(message);
      setIsImporting(false);
    }
  }, [onImportComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
        '.xlsx',
      ],
    },
    multiple: false,
  });

  return (
    <div className="w-full space-y-4">
      <div
        {...getRootProps()}
        className={`relative border-2 border-dashed rounded-2xl lg:rounded-3xl p-6 lg:p-12 transition-all duration-300 flex flex-col items-center justify-center cursor-pointer ${
          isDragActive
            ? 'border-[#007aff] bg-[#007aff]/5'
            : 'border-black/10 hover:border-[#007aff]/50 hover:bg-black/[0.02]'
        } ${isImporting ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input {...getInputProps()} />

        {isImporting ? (
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-[#007aff] animate-spin mx-auto mb-4" />
            <p className="text-lg font-bold">インポート中…</p>
            <p className="text-sm text-[#86868b]">少々お待ちください</p>
          </div>
        ) : success ? (
          <div className="text-center animate-in zoom-in-95">
            <CheckCircle2 className="w-12 h-12 text-[#28c840] mx-auto mb-4" />
            <p className="text-lg font-bold">インポート完了</p>
            <p className="text-sm text-[#86868b]">タスク一覧へ移動します…</p>
          </div>
        ) : (
          <div className="text-center">
            <div className="w-16 h-16 bg-[#f5f5f7] rounded-2xl flex items-center justify-center mx-auto mb-6">
              <FileUp className="w-8 h-8 text-[#007aff]" />
            </div>
            <p className="text-lg font-bold mb-2">
              {isDragActive ? 'ドロップしてアップロード' : 'クリックまたは Excel ファイルをドラッグしてインポート'}
            </p>
            <p className="text-sm text-[#86868b] mb-6">
              1 行目は見出し、データは 2 行目から（{TEMPLATE_HEADERS.projectName}・
              {TEMPLATE_HEADERS.taskName} など）
            </p>
            <div className="flex items-center gap-2 text-[10px] font-bold text-[#86868b] uppercase tracking-widest bg-[#f5f5f7] px-4 py-2 rounded-full">
              <FileText size={12} />
              週報テンプレート形式
            </div>
          </div>
        )}

        {error && (
          <div className="absolute -bottom-16 left-0 right-0 p-4 bg-[#fff2f2] text-[#ff3b30] rounded-xl flex items-center gap-3 text-sm border border-[#ff3b30]/10 animate-in slide-in-from-top-2">
            <AlertCircle size={18} />
            {error}
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <a
          href={IMPORT_TEMPLATE_URL}
          download={IMPORT_TEMPLATE_FILENAME}
          className="mac-button mac-button-secondary inline-flex items-center gap-2 text-sm font-bold"
        >
          <Download size={18} />
          インポートテンプレートをダウンロード（Excel）
        </a>
      </div>
    </div>
  );
};
