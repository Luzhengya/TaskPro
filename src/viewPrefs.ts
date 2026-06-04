import { UserSettings } from './types';

export type ProjectView = 'grid' | 'table' | 'weekly';

/** 既定では table のみ表示。 */
export const DEFAULT_ENABLED_VIEWS: Record<ProjectView, boolean> = {
  grid: false,
  table: true,
  weekly: false,
};

/** 設定から表示ビューを取得（未設定なら既定）。 */
export function getEnabledViews(
  settings: UserSettings | null,
): Record<ProjectView, boolean> {
  return settings?.ui_preferences.enabled_views ?? DEFAULT_ENABLED_VIEWS;
}

/**
 * 実際に表示すべきビューを決める。選択中ビューが非表示なら、
 * table → grid → weekly の順で表示中のものへフォールバックする。
 */
export function resolveActiveView(settings: UserSettings | null): ProjectView {
  const enabled = getEnabledViews(settings);
  const current = (settings?.ui_preferences.view ?? 'table') as ProjectView;
  if (enabled[current]) return current;
  if (enabled.table) return 'table';
  if (enabled.grid) return 'grid';
  if (enabled.weekly) return 'weekly';
  return 'table';
}
