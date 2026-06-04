import React, { useState, useEffect } from 'react';
import { TaskTemplate, TemplateItem, Priority, SubTaskStatus } from '../types';
import { taskService } from '../services/taskService';
import { EditableCell } from './EditableCell';
import {
  Plus,
  Trash2,
  ChevronLeft,
  Calendar,
  Clock,
  ChevronRight,
  AlertCircle,
  GripVertical
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TemplateManagement: React.FC = () => {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [isAddingTemplate, setIsAddingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string, name: string } | null>(null);

  useEffect(() => {
    const unsubscribe = taskService.subscribeTaskTemplates(setTemplates);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (selectedTemplate) {
      const unsubscribe = taskService.subscribeTemplateItems(selectedTemplate.id, setTemplateItems);
      return () => unsubscribe();
    } else {
      setTemplateItems([]);
    }
  }, [selectedTemplate]);

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim()) return;
    try {
      await taskService.addTaskTemplate({
        name: newTemplateName,
      });
      setNewTemplateName('');
      setIsAddingTemplate(false);
    } catch (err) {
      console.error('Failed to create template:', err);
    }
  };

  const handleDeleteTemplate = () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    if (selectedTemplate?.id === targetId) {
      setSelectedTemplate(null);
    }
    taskService.deleteTaskTemplate(targetId).catch(err => {
      console.error('Failed to delete template:', err);
    });
  };

  const handleAddItem = async () => {
    if (!selectedTemplate) return;
    await taskService.addTemplateItem({
      template_id: selectedTemplate.id,
      system: '',
      task_name: '新規タスク',
      status: '未着手',
      planned_hours: 0,
      priority: 'B',
      remarks: ''
    });
  };

  const handleUpdateItem = async (id: string, updates: Partial<TemplateItem>) => {
    await taskService.updateTemplateItem(id, updates);
  };

  const handleDeleteItem = async (id: string) => {
    await taskService.deleteTemplateItem(id);
  };

  // ドラッグで並べ替え、order を採番し直して永続化する（案件一覧の子タスクと同様）。
  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(templateItems);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setTemplateItems(items); // 即時反映
    try {
      await Promise.all(
        items.map((it, idx) => taskService.updateTemplateItem(it.id, { order: idx })),
      );
    } catch (err) {
      console.error('Failed to reorder template items:', err);
    }
  };

  const statusColors: Record<SubTaskStatus, string> = {
    '遅れ': 'bg-red-100 text-red-700',
    '済': 'bg-green-100 text-green-700',
    '進行中': 'bg-blue-100 text-blue-700',
    '未着手': 'bg-gray-100 text-gray-700',
    '保留': 'bg-yellow-100 text-yellow-700',
    '着手遅れ': 'bg-orange-50 text-orange-600',
    '期限遅れ': 'bg-red-200 text-red-800',
  };

  if (selectedTemplate) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 lg:gap-4 min-w-0">
            <button
              onClick={() => setSelectedTemplate(null)}
              className="p-2 hover:bg-gray-200 rounded-full transition-colors flex-shrink-0"
            >
              <ChevronLeft size={24} />
            </button>
            <div className="min-w-0">
              <h2 className="text-xl lg:text-3xl font-bold tracking-tight text-[#1d1d1f] truncate">{selectedTemplate.name}</h2>
              <p className="text-[#86868b] text-xs lg:text-sm">作成日: {new Date(selectedTemplate.created_at).toLocaleString()}</p>
            </div>
          </div>

          <div className="pl-11 lg:pl-0">
            <button
              onClick={handleAddItem}
              className="mac-button mac-button-primary flex items-center gap-2"
            >
              <Plus size={18} />
              <span>タスク追加</span>
            </button>
          </div>
        </div>

        <div className="mac-card overflow-hidden">
          <div className="overflow-x-auto">
            <DragDropContext onDragEnd={onDragEnd}>
            <table className="w-full text-left border-separate border-spacing-0 min-w-[680px]">
              <thead className="sticky top-[56px] lg:top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-2 py-3 w-10" />
                  <th className="px-4 py-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest border-b border-gray-100">システム</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest border-b border-gray-100">タスク名</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest border-b border-gray-100">ステータス</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest w-24 border-b border-gray-100">予定工数</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest w-24 border-b border-gray-100">優先度</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest border-b border-gray-100">備考</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest w-16 text-center border-b border-gray-100">操作</th>
                </tr>
              </thead>
              <Droppable droppableId="template-items">
                {(provided) => (
                  <tbody ref={provided.innerRef} {...provided.droppableProps}>
                    {templateItems.map((item, index) => (
                      <Draggable key={item.id} draggableId={item.id} index={index}>
                        {(dragProvided, snapshot) => (
                          <tr
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={cn(
                              "group hover:bg-gray-50 transition-colors",
                              snapshot.isDragging && "bg-white shadow-lg"
                            )}
                          >
                            <td className="px-2 py-2 border-b border-gray-50 text-center">
                              <div
                                {...dragProvided.dragHandleProps}
                                className="inline-flex text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                                title="ドラッグで並べ替え"
                              >
                                <GripVertical size={16} />
                              </div>
                            </td>
                            <td className="px-4 py-2 border-b border-gray-50">
                              <EditableCell
                                value={item.system}
                                onSave={(val) => handleUpdateItem(item.id, { system: val as string })}
                                className="text-sm"
                                placeholder="システム名"
                              />
                            </td>
                            <td className="px-4 py-2 border-b border-gray-50">
                              <EditableCell
                                value={item.task_name}
                                onSave={(val) => handleUpdateItem(item.id, { task_name: val as string })}
                                className="font-medium text-sm"
                                placeholder="タスク名"
                              />
                            </td>
                            <td className="px-4 py-2 border-b border-gray-50">
                              <select
                                value={item.status}
                                onChange={(e) => handleUpdateItem(item.id, { status: e.target.value as SubTaskStatus })}
                                className={cn(
                                  "px-2 py-0.5 rounded-md text-[10px] font-bold focus:outline-none",
                                  statusColors[item.status]
                                )}
                              >
                                {Object.keys(statusColors).map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                            <td className="px-4 py-2 border-b border-gray-50">
                              <EditableCell
                                type="number"
                                value={isNaN(item.planned_hours) ? 0 : item.planned_hours}
                                onSave={(val) => handleUpdateItem(item.id, { planned_hours: val as number })}
                                className="w-16 text-sm"
                              />
                            </td>
                            <td className="px-4 py-2 border-b border-gray-50">
                              <select
                                value={item.priority}
                                onChange={(e) => handleUpdateItem(item.id, { priority: e.target.value as Priority })}
                                className="bg-transparent focus:outline-none text-sm"
                              >
                                <option value="A">A</option>
                                <option value="B">B</option>
                                <option value="C">C</option>
                              </select>
                            </td>
                            <td className="px-4 py-2 border-b border-gray-50">
                              <EditableCell
                                value={item.remarks || ''}
                                onSave={(val) => handleUpdateItem(item.id, { remarks: val as string })}
                                className="text-sm"
                                placeholder="備考..."
                              />
                            </td>
                            <td className="px-4 py-2 border-b border-gray-50 text-center">
                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </tbody>
                )}
              </Droppable>
            </table>
            </DragDropContext>
          </div>
          
          {templateItems.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-[#86868b] italic text-sm">タスクがありません。「タスク追加」ボタンから作成してください。</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#1d1d1f]">テンプレ管理</h2>
          <p className="text-[#86868b] text-xs lg:text-sm">案件作成時に使用するタスクセットの管理</p>
        </div>
        <button
          onClick={() => setIsAddingTemplate(true)}
          className="mac-button mac-button-primary flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus size={18} />
          <span>新規テンプレ</span>
        </button>
      </div>

      {isAddingTemplate && (
        <div className="mac-card p-4 lg:p-6 animate-in slide-in-from-top-4 duration-300">
          <h3 className="text-lg font-bold mb-4">新規テンプレ作成</h3>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <input
              type="text"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder="テンプレ名を入力..."
              className="mac-input flex-1"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handleCreateTemplate}
                className="mac-button mac-button-primary flex-1 sm:flex-initial"
              >
                作成
              </button>
              <button
                onClick={() => setIsAddingTemplate(false)}
                className="mac-button mac-button-secondary flex-1 sm:flex-initial"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        {templates.map((template) => (
          <div
            key={template.id}
            className="mac-card group hover:shadow-md transition-all cursor-pointer active:bg-[#f5f5f7] relative"
            onClick={() => setSelectedTemplate(template)}
          >
            <div className="p-4 lg:p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl group-hover:bg-purple-600 group-hover:text-white transition-colors">
                  <Calendar size={20} />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget({ id: template.id, name: template.name });
                  }}
                  className="p-2 text-gray-300 hover:text-red-500 transition-colors opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              
              <h3 className="text-xl font-bold text-[#1d1d1f] mb-1 group-hover:text-[#007aff] transition-colors">
                {template.name}
              </h3>
              
              <div className="flex items-center gap-2 text-sm text-[#86868b] mt-2">
                <Clock size={14} />
                <span>作成日: {new Date(template.created_at).toLocaleDateString()}</span>
              </div>
              
              <div className="pt-4 mt-6 flex items-center justify-between border-t border-gray-100">
                <span className="text-xs font-bold text-[#86868b] uppercase tracking-widest">詳細・編集</span>
                <ChevronRight size={18} className="text-gray-300 group-hover:text-[#007aff] group-hover:translate-x-1 transition-all" />
              </div>
            </div>
          </div>
        ))}

        {templates.length === 0 && !isAddingTemplate && (
          <div className="col-span-full py-20 text-center mac-card border-dashed">
            <p className="text-[#86868b] italic">テンプレが見つかりません。新規作成してください。</p>
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="mac-card max-w-sm w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertCircle size={24} />
              <h3 className="text-lg font-bold">削除の確認</h3>
            </div>
            <p className="text-[#1d1d1f] mb-6">
              テンプレ「{deleteTarget.name}」を削除しますか？<br />
              <span className="text-xs text-red-500">※含まれるタスクもすべて削除されます。</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteTemplate}
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
