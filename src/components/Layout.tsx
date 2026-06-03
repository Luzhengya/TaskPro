import React from 'react';
import { LayoutDashboard, ListTodo, FileUp, Settings, BarChart3, LogOut, History, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: any;
  onLogout: () => void;
  /** 日報メニューに表示する件数（is_in_report のタスク数）。0 のときは非表示。 */
  reportCount?: number;
}

const NAV_ITEMS = [
  { id: 'dashboard', label: '案件一覧', icon: LayoutDashboard },
  { id: 'templates', label: 'テンプレ', icon: ListTodo },
  { id: 'history', label: '履歴', icon: History },
  { id: 'import', label: 'インポート', icon: FileUp },
  { id: 'reports', label: '日報', icon: BarChart3 },
  { id: 'settings', label: '設定', icon: Settings },
];

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab, user, onLogout, reportCount = 0 }) => {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);

  const navItems = NAV_ITEMS;

  // メニュー項目ごとの件数バッジ（現状は日報のみ）。
  const navBadge = (id: string): number => (id === 'reports' ? reportCount : 0);
  const NavBadge: React.FC<{ count: number; active: boolean }> = ({ count, active }) =>
    count > 0 ? (
      <span
        className={`ml-auto min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold ${
          active ? 'bg-white text-[#007aff]' : 'bg-[#ff3b30] text-white'
        }`}
      >
        {count > 99 ? '99+' : count}
      </span>
    ) : null;

  const SidebarContent = () => (
    <>
      <div className="p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#007aff] rounded-2xl flex items-center justify-center shadow-lg shadow-[#007aff]/20">
            <ListTodo className="text-white" size={24} />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-[#1d1d1f]">TaskMaster</h1>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(false)}
          className="lg:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-full"
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-4 mb-2">
        <p className="px-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest mb-2">メイン</p>
        <nav className="space-y-0.5">
          {navItems.slice(0, 4).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setIsSidebarOpen(false);
              }}
              className={`w-full mac-sidebar-item ${
                activeTab === item.id ? 'active' : ''
              }`}
            >
              <item.icon size={18} className={activeTab === item.id ? 'text-white' : 'text-[#007aff]'} />
              <span>{item.label}</span>
              <NavBadge count={navBadge(item.id)} active={activeTab === item.id} />
            </button>
          ))}
        </nav>
      </div>

      <div className="px-4 mt-6">
        <p className="px-3 text-[10px] font-bold text-[#86868b] uppercase tracking-widest mb-2">システム</p>
        <nav className="space-y-0.5">
          {navItems.slice(4).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setIsSidebarOpen(false);
              }}
              className={`w-full mac-sidebar-item ${
                activeTab === item.id ? 'active' : ''
              }`}
            >
              <item.icon size={18} className={activeTab === item.id ? 'text-white' : 'text-[#86868b]'} />
              <span>{item.label}</span>
              <NavBadge count={navBadge(item.id)} active={activeTab === item.id} />
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-black/5 bg-black/[0.02]">
        <div className="flex items-center gap-3 p-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-400 flex items-center justify-center text-white text-xs font-bold border border-white/50 shadow-sm">
            {user?.email?.[0].toUpperCase() || 'G'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-[#1d1d1f] truncate">{user?.email || 'Guest User'}</p>
            <p className="text-[9px] text-[#86868b]">オンライン</p>
          </div>
        </div>
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-[#ff3b30] hover:bg-red-50 rounded-xl transition-colors"
        >
          <LogOut size={14} />
          サインアウト
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-[#f5f5f7] font-sans text-[#1d1d1f] overflow-hidden relative">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar (Desktop) */}
      <aside className="hidden lg:flex w-64 bg-[#f2f2f2]/80 backdrop-blur-2xl border-r border-black/10 flex-col z-20">
        <SidebarContent />
      </aside>

      {/* Sidebar (Mobile) */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -256 }}
            animate={{ x: 0 }}
            exit={{ x: -256 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 w-64 bg-[#f2f2f2] border-r border-black/10 flex flex-col z-[70] lg:hidden shadow-2xl"
          >
            <SidebarContent />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-white relative flex flex-col">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-2.5 bg-white/80 backdrop-blur-md border-b border-black/5 sticky top-0 z-[60] h-14">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 text-[#1d1d1f] hover:bg-gray-100 rounded-lg"
            aria-label="メニュー"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[#007aff] rounded-lg flex items-center justify-center">
              <ListTodo className="text-white" size={16} />
            </div>
            <span className="font-bold text-base">{NAV_ITEMS.find(n => n.id === activeTab)?.label || 'TaskMaster'}</span>
          </div>
          <div className="flex-1" />
        </header>

        <div className="absolute inset-0 bg-[#f5f5f7] -z-10" />
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          className="max-w-6xl mx-auto p-4 sm:p-8 lg:p-12 w-full"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
};
