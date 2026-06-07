import React, { useState, useEffect } from 'react';
import { ParentTask, QuickFilter, TaskFilter, UserSettings } from '../types';
import { taskService } from '../services/taskService';
import { DEFAULT_ENABLED_VIEWS, ProjectView } from '../viewPrefs';
import { defaultQuickFilters, EMPTY_FILTER, summarizeFilter } from '../taskFilter';
import { FilterForm } from './FilterForm';
import {
  Save,
  Cpu,
  Palette,
  Bell,
  Plus,
  Trash2,
  CheckCircle2,
  LayoutGrid,
  List,
  FileText,
  AlertTriangle,
  Search,
  Pencil,
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  // 全タスク削除の対象件数（表示中の親タスク = is_hidden=false）。
  // 0 件のときはボタンを非活性にしておきたいので件数を購読する。
  const [visibleParentCount, setVisibleParentCount] = useState(0);
  const [isClearingAll, setIsClearingAll] = useState(false);

  // クイックフィルタ編集用。親案件選択肢のため visible parents の一覧も持つ。
  const [parentTasks, setParentTasks] = useState<ParentTask[]>([]);
  const [editingQuickFilter, setEditingQuickFilter] = useState<QuickFilter | null>(null);
  const [deletingQuickFilterId, setDeletingQuickFilterId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = taskService.subscribeSettings(setSettings);
    const unsubscribeParents = taskService.subscribeParentTasks((list: ParentTask[]) => {
      setVisibleParentCount(list.length);
      setParentTasks(list);
    });
    return () => {
      unsubscribe();
      unsubscribeParents();
    };
  }, []);

  // 初回 seed：settings 取得済みかつ quick_filters が未定義なら、内蔵 3 件を入れて保存する。
  // 一度入った後はユーザーが削除/編集できる。空配列で保存されている場合は seed しない（意図的に空）。
  useEffect(() => {
    if (!settings) return;
    if (settings.quick_filters !== undefined) return;
    const seeded = defaultQuickFilters();
    taskService
      .updateSettings(settings.id, { ...settings, quick_filters: seeded })
      .catch(err => console.error('Failed to seed quick filters:', err));
    // setSettings は subscribe 経由で自動更新されるため、ここでは触らない。
  }, [settings]);

  const updateQuickFilters = async (next: QuickFilter[]) => {
    if (!settings) return;
    try {
      await taskService.updateSettings(settings.id, { ...settings, quick_filters: next });
    } catch (err) {
      console.error('Failed to update quick filters:', err);
    }
  };

  const saveQuickFilter = async (qf: QuickFilter) => {
    if (!settings) return;
    const list = settings.quick_filters ?? [];
    const exists = list.some(x => x.id === qf.id);
    const next = exists ? list.map(x => (x.id === qf.id ? qf : x)) : [...list, qf];
    await updateQuickFilters(next);
    setEditingQuickFilter(null);
  };

  const deleteQuickFilter = async (id: string) => {
    if (!settings) return;
    const next = (settings.quick_filters ?? []).filter(x => x.id !== id);
    await updateQuickFilters(next);
    setDeletingQuickFilterId(null);
  };

  const startNewQuickFilter = () => {
    setEditingQuickFilter({
      id: `qf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: '',
      filter: { ...EMPTY_FILTER },
    });
  };

  const confirmClearAll = () => {
    setIsClearingAll(false);
    taskService.clearAllData().catch(err => {
      console.error('Failed to clear data:', err);
    });
  };

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    try {
      await taskService.updateSettings(settings.id, settings);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!settings) return <div className="p-8 text-center text-[#86868b] italic">Initializing settings...</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#1d1d1f]">Settings</h2>
          <p className="text-[#86868b] text-xs lg:text-sm">Configure AI, UI, and notifications</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="mac-button mac-button-primary flex items-center gap-2 self-start sm:self-auto"
        >
          {isSaving ? 'Saving...' : (
            <>
              <Save size={18} />
              <span>Save Changes</span>
            </>
          )}
        </button>
      </div>

      {showSuccess && (
        <div className="p-4 bg-green-50 text-green-600 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={18} />
          <span className="font-medium text-sm">Settings saved successfully!</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* AI Configuration（一時的に非活性。将来必要になった時点で aria-disabled / pointer-events-none / opacity を外せば復活する） */}
        <section
          className="mac-card p-5 lg:p-8 opacity-60 pointer-events-none select-none"
          aria-disabled="true"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
              <Cpu size={24} />
            </div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">AI設定</h3>
            <span className="ml-auto px-2 py-0.5 bg-gray-200 text-[#86868b] text-[10px] font-bold rounded-full">準備中</span>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-black/[0.02] rounded-xl border border-black/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#1d1d1f]">使用モデル</span>
              </div>
              <p className="text-sm font-medium text-[#1d1d1f]">Gemini 3 Flash</p>
              <p className="text-[10px] text-[#86868b] mt-1">タスクの要約と分析に使用されます。</p>
            </div>
          </div>
        </section>

        {/* UI Preferences */}
        <section className="mac-card p-5 lg:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-50 text-[#007aff] rounded-xl">
              <Palette size={24} />
            </div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">UI設定</h3>
          </div>
          
          <div className="space-y-6">
            {/* 「期限間近」「開始間近」タブの判定しきい値（営業日）。 */}
            <div>
              <label className="block text-xs font-bold text-[#1d1d1f] mb-1">
                「期限間近・開始間近」タブの判定（営業日）
              </label>
              <p className="text-[10px] text-[#86868b] mb-3">
                今日からこの営業日数以内に「期限」または「開始日」が来るタスクを持つ案件を「間近」扱いにします（土日スキップ）。
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={settings.near_threshold_days ?? 1}
                  onChange={(e) => {
                    const raw = parseInt(e.target.value, 10);
                    const v = isNaN(raw) ? 1 : Math.max(0, Math.min(30, raw));
                    setSettings({ ...settings, near_threshold_days: v });
                  }}
                  className="mac-input w-24 text-sm"
                />
                <span className="text-xs text-[#86868b]">営業日（0〜30）</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#1d1d1f] mb-1">プロジェクト画面の表示ビュー</label>
              <p className="text-[10px] text-[#86868b] mb-3">表示に設定したビューだけがプロジェクト画面に出ます（最低1つ）。</p>
              <div className="space-y-2">
                {([
                  { key: 'grid', label: 'グリッド', Icon: LayoutGrid },
                  { key: 'table', label: 'テーブル', Icon: List },
                  { key: 'weekly', label: '週報', Icon: FileText },
                ] as { key: ProjectView; label: string; Icon: typeof LayoutGrid }[]).map(({ key, label, Icon }) => {
                  const enabled = settings.ui_preferences.enabled_views ?? DEFAULT_ENABLED_VIEWS;
                  const checked = enabled[key];
                  const toggle = () => {
                    const next = { ...enabled, [key]: !checked };
                    // 最低1つは表示を残す。
                    if (!next.grid && !next.table && !next.weekly) return;
                    setSettings({
                      ...settings,
                      ui_preferences: { ...settings.ui_preferences, enabled_views: next },
                    });
                  };
                  return (
                    <div key={key} className="flex items-center justify-between p-3 bg-black/[0.02] rounded-xl border border-black/5">
                      <div className="flex items-center gap-2.5">
                        <Icon size={18} className="text-[#86868b]" />
                        <span className="text-sm font-medium text-[#1d1d1f]">{label}</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={checked} onChange={toggle} />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#007aff]"></div>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </section>

        {/* Notifications（一時的に非活性。将来必要になった時点で aria-disabled / pointer-events-none / opacity を外せば復活する） */}
        <section
          className="mac-card p-5 lg:p-8 md:col-span-2 opacity-60 pointer-events-none select-none"
          aria-disabled="true"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-orange-50 text-orange-600 rounded-xl">
              <Bell size={24} />
            </div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">通知設定</h3>
            <span className="ml-auto px-2 py-0.5 bg-gray-200 text-[#86868b] text-[10px] font-bold rounded-full">準備中</span>
          </div>

          <div className="space-y-4">
            {settings.notification_rules.map((rule, index) => (
              <div key={rule.id} className="flex items-center gap-4 p-4 bg-black/[0.02] rounded-xl border border-black/5">
                <div className="flex items-center gap-3 flex-1">
                  <div className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={rule.enabled}
                      onChange={(e) => {
                        const newRules = [...settings.notification_rules];
                        newRules[index].enabled = e.target.checked;
                        setSettings({ ...settings, notification_rules: newRules });
                      }}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#007aff]"></div>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm text-[#1d1d1f]">デイリーサマリー ({rule.time})</p>
                    <p className="text-[10px] text-[#86868b]">内容: {rule.content_types.join(', ')}</p>
                  </div>
                </div>
                <button className="p-2 text-gray-300 hover:text-red-500 transition-colors">
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            
            <button className="w-full py-4 border-2 border-dashed border-gray-200 rounded-2xl text-[#86868b] font-bold hover:border-[#007aff] hover:text-[#007aff] transition-all flex items-center justify-center gap-2 text-sm">
              <Plus size={18} />
              <span>新しい通知ルールを追加</span>
            </button>
          </div>
        </section>

        {/* クイックフィルタ管理。Dashboard 上部のチップになる。 */}
        <section className="mac-card p-5 lg:p-8 md:col-span-2">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-50 text-[#007aff] rounded-xl">
              <Search size={24} />
            </div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">クイックフィルタ</h3>
            <button
              onClick={startNewQuickFilter}
              className="ml-auto mac-button mac-button-secondary flex items-center gap-1.5 text-xs"
            >
              <Plus size={14} />
              <span>新規作成</span>
            </button>
          </div>
          <p className="text-xs text-[#86868b] mb-4 pl-12">
            プロジェクト画面の上部に「クイックチップ」として並びます。タップ一発で「今日が期日」「優先A・未完」などの条件をかけられます。
          </p>

          <div className="space-y-2">
            {(settings.quick_filters ?? []).length === 0 ? (
              <p className="text-xs text-[#86868b] italic pl-12">
                クイックフィルタがありません。「新規作成」から追加してください。
              </p>
            ) : (
              (settings.quick_filters ?? []).map(qf => (
                <div
                  key={qf.id}
                  className="flex items-center gap-3 p-3 bg-black/[0.02] rounded-xl border border-black/5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1d1d1f] truncate">
                      {qf.name || '(無題)'}
                    </p>
                    <p className="text-[10px] text-[#86868b] truncate" title={summarizeFilter(qf.filter)}>
                      {summarizeFilter(qf.filter)}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditingQuickFilter(qf)}
                    className="p-2 text-[#86868b] hover:text-[#007aff] hover:bg-blue-50 rounded-lg transition-colors"
                    title="編集"
                    aria-label="クイックフィルタを編集"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setDeletingQuickFilterId(qf.id)}
                    className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                    title="削除"
                    aria-label="クイックフィルタを削除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* 危険な操作（全タスク削除）。元は案件一覧にあったが、誤タップ防止のため設定画面へ移動。 */}
        <section className="mac-card p-5 lg:p-8 md:col-span-2 border border-red-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-50 text-red-600 rounded-xl">
              <AlertTriangle size={24} />
            </div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">危険な操作</h3>
          </div>
          <p className="text-xs text-[#86868b] mb-4 pl-12">
            表示中の案件と紐づく子タスクをまとめて削除します。履歴（非表示の案件）・テンプレート・日報は削除されません。
          </p>
          <div className="pl-12">
            <button
              onClick={() => setIsClearingAll(true)}
              disabled={visibleParentCount === 0}
              className="mac-button mac-button-secondary flex items-center gap-2 text-sm text-[#ff3b30] disabled:opacity-40"
              title={
                visibleParentCount === 0
                  ? '削除対象の案件がありません。'
                  : `表示中の ${visibleParentCount} 件の案件と関連タスクを削除`
              }
            >
              <Trash2 size={18} />
              <span>全タスク削除</span>
              {visibleParentCount > 0 && (
                <span className="text-[10px] font-bold text-[#86868b]">（{visibleParentCount} 件）</span>
              )}
            </button>
          </div>
        </section>
      </div>

      {isClearingAll && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="mac-card max-w-sm w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-lg font-bold">削除の確認</h3>
            </div>
            <p className="text-[#1d1d1f] mb-6">
              全てのタスク（親タスク・子タスク）を削除しますか？この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmClearAll}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
              >
                削除する
              </button>
              <button
                onClick={() => setIsClearingAll(false)}
                className="flex-1 py-2.5 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {editingQuickFilter && (
        <QuickFilterEditor
          quickFilter={editingQuickFilter}
          parentTasks={parentTasks}
          onChange={setEditingQuickFilter}
          onSave={saveQuickFilter}
          onCancel={() => setEditingQuickFilter(null)}
        />
      )}

      {deletingQuickFilterId && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="mac-card max-w-sm w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-lg font-bold">削除の確認</h3>
            </div>
            <p className="text-[#1d1d1f] mb-6">
              このクイックフィルタを削除しますか？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => deleteQuickFilter(deletingQuickFilterId)}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
              >
                削除する
              </button>
              <button
                onClick={() => setDeletingQuickFilterId(null)}
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

/* ============================================================
 * クイックフィルタ編集モーダル（新規作成 / 編集 兼用）
 * ============================================================ */

interface QuickFilterEditorProps {
  quickFilter: QuickFilter;
  parentTasks: ParentTask[];
  onChange: (next: QuickFilter) => void;
  onSave: (qf: QuickFilter) => Promise<void> | void;
  onCancel: () => void;
}

const QuickFilterEditor: React.FC<QuickFilterEditorProps> = ({
  quickFilter,
  parentTasks,
  onChange,
  onSave,
  onCancel,
}) => {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!quickFilter.name.trim()) return;
    setSaving(true);
    try {
      await onSave({ ...quickFilter, name: quickFilter.name.trim() });
    } finally {
      setSaving(false);
    }
  };

  const setName = (name: string) => onChange({ ...quickFilter, name });
  const setFilter = (filter: TaskFilter) => onChange({ ...quickFilter, filter });

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="mac-card max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-5 border-b border-black/5">
          <div className="p-1.5 bg-blue-50 text-[#007aff] rounded-lg">
            <Search size={18} />
          </div>
          <h3 className="text-base font-bold text-[#1d1d1f]">クイックフィルタを編集</h3>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#1d1d1f] mb-2">名前</label>
            <input
              type="text"
              value={quickFilter.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 今日が期日・未完"
              className="mac-input w-full text-sm"
              autoFocus
            />
          </div>
          <FilterForm
            value={quickFilter.filter}
            onChange={setFilter}
            parentTasks={parentTasks}
            preferDynamicToday
          />
        </div>
        <div className="flex gap-2 p-5 border-t border-black/5">
          <button
            onClick={handleSave}
            disabled={saving || !quickFilter.name.trim()}
            className="flex-1 py-2.5 bg-[#007aff] text-white rounded-xl font-bold hover:bg-[#0066d6] transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};
