import React, { useState, useEffect } from 'react';
import { UserSettings } from '../types';
import { taskService } from '../services/taskService';
import { DEFAULT_ENABLED_VIEWS, ProjectView } from '../viewPrefs';
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
  FileText
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const unsubscribe = taskService.subscribeSettings(setSettings);
    return () => unsubscribe();
  }, []);

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
      </div>
    </div>
  );
};
