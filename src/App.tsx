import React, { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from './cloudbase';
import { Layout } from './components/Layout';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { SubTaskManagement } from './components/SubTaskManagement';
import { TemplateManagement } from './components/TemplateManagement';
import { History } from './components/History';
import { FileImport } from './components/FileImport';
import { DailyReport } from './components/DailyReport';
import { Settings } from './components/Settings';
import { ErrorBoundary } from './components/ErrorBoundary';
import { taskService } from './services/taskService';
import { ParentTask, SubTask, UserSettings } from './types';
import { todayBeijing } from './dateUtils';
import { findAnomalies } from './dailyReportSelector';
import { Loader2 } from 'lucide-react';

/** CloudBase 認証エラーを、ログインフォームに表示する日本語メッセージへ変換する。 */
function authErrorMessage(error: any): string {
  const code: string | undefined = error?.code;
  const raw: string | undefined = error?.message;
  switch (code) {
    case 'invalid_password':
    case 'password_not_match':
    case 'user_not_exist':
    case 'user_not_found':
      return 'メールアドレスまたはパスワードが正しくありません。';
    case 'user_already_exist':
    case 'email_already_exist':
      return 'このメールアドレスは既に使用されています。';
    case 'invalid_param':
    case 'invalid_email':
      return 'メールアドレスの形式が正しくありません。';
    case 'verification_code_error':
    case 'invalid_verification_code':
      return '認証コードが正しくありません。';
    case 'too_many_requests':
      return '試行回数が多すぎます。しばらく時間をおいてから再度お試しください。';
    case 'network_error':
      return 'ネットワーク接続に失敗しました。接続を確認してください。';
    default:
      return raw || 'エラーが発生しました。しばらくしてから再度お試しください。';
  }
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isGuestLoading, setIsGuestLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedParentTask, setSelectedParentTask] = useState<ParentTask | null>(null);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const [parentTasks, setParentTasks] = useState<ParentTask[]>([]);
  // 履歴行き（is_hidden=true）の親タスク。日報履歴から「履歴行きプロジェクト」へ
  // ジャンプするときの参照元。Dashboard 側の表示には使わない。
  const [hiddenParentTasks, setHiddenParentTasks] = useState<ParentTask[]>([]);
  // 全子タスク。元は Dashboard / DailyReport が個別に subscribe していたが、
  // 重複 fetch を避けて App.tsx に集約。props で配下に渡す。
  const [allSubTasks, setAllSubTasks] = useState<SubTask[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  // 日報メニューに出す件数（is_in_report のタスク数）。
  const [reportCount, setReportCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);

  // メール認証コードの検証情報を一時保持（送信 → 入力 の2ステップ間で引き継ぐ）
  const signupVerifyRef = useRef<{ email: string; verificationId: string } | null>(null);
  const resetVerifyRef = useRef<{ email: string; verificationId: string } | null>(null);

  // 現在のログイン状態を React state に反映する
  const applyAuthState = useCallback(() => {
    const u = auth.currentUser;
    if (u) {
      setUser(u);
      const anon = u.loginType === 'ANONYMOUS';
      setIsGuest(anon);
      taskService.isGuest = anon;
    } else {
      setUser(null);
      // ローカルゲストモード（匿名ログイン未開放時のフォールバック）は保持する
    }
    setIsAuthReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    applyAuthState();
    const { data } = auth.onAuthStateChange(() => {
      if (cancelled) return;
      applyAuthState();
    });
    return () => {
      cancelled = true;
      data?.subscription?.unsubscribe?.();
    };
  }, [applyAuthState]);

  useEffect(() => {
    if (user || isGuest) {
      taskService.testConnection();

      // 日報メニューの件数バッジ。is_in_report=true + 「会議集の子タスクで開始日が今日」を
      // ベース集合とし、そこから **リマインド対象（異常 task）を除外** する。
      // DailyReport の stats と同じ意味合い：「報告対象の件数」を表す。
      // 「今日」の判定は北京時間（UTC+8）固定。端末タイムゾーンに依存しない。
      const today = todayBeijing();
      const parentTypeMap = new Map<string, string | undefined>();
      let lastSubs: any[] = [];
      const recompute = () => {
        const count = lastSubs.filter((t: any) => {
          // ベース集合：is_in_report=true OR 今日開始の会議
          const inBase =
            t.is_in_report ||
            (parentTypeMap.get(t.parent_task_id) === 'meeting' && t.start_date === today);
          if (!inBase) return false;
          // 異常 task は カウントから除外（リマインド扱い、別途修正対象）
          if (findAnomalies(t, today).length > 0) return false;
          return true;
        }).length;
        setReportCount(count);
      };
      const unsubscribeTasks = taskService.subscribeParentTasks((list) => {
        parentTypeMap.clear();
        for (const p of list) parentTypeMap.set(p.id, (p as any).type);
        setParentTasks(list);
        recompute();
      });
      // 履歴行きプロジェクトの購読（日報履歴からのジャンプ先解決にだけ使う）。
      const unsubscribeHidden = taskService.subscribeParentTasks(setHiddenParentTasks, true);
      const unsubscribeReportCount = taskService.subscribeAllSubTasks((subs) => {
        lastSubs = subs;
        setAllSubTasks(subs);  // 子コンポーネントに props で配るため state に保持
        recompute();
      });
      const unsubscribeSettings = taskService.subscribeSettings((s) => {
        if (!s) {
          // Initialize default settings for new user
          taskService.updateSettings(undefined, {
            ai_models: [],
            ui_preferences: {
              view: 'table',
              opacity: 1,
              theme: 'light',
              font: 'Inter'
            },
            notification_rules: [
              { id: 'default', enabled: true, time: '09:00', content_types: ['today_tasks', 'delayed_tasks'], days_before_deadline: 3 }
            ]
          });
        } else {
          setSettings(s);
        }
      });

      return () => {
        unsubscribeTasks();
        unsubscribeHidden();
        unsubscribeReportCount();
        unsubscribeSettings();
      };
    } else {
      // Clear data when no user
      setParentTasks([]);
      setHiddenParentTasks([]);
      setAllSubTasks([]);
      setReportCount(0);
      setSettings(null);
      setSelectedParentTask(null);
      setHighlightTaskId(null);
    }
  }, [user, isGuest]);

  const handleEmailSignIn = async (email: string, password: string) => {
    const res = await auth.signInWithPassword({ email, password });
    if (res.error) {
      throw new Error(authErrorMessage(res.error));
    }
    applyAuthState();
  };

  // 新規登録ステップ1：メールへ認証コードを送信
  const handleSendSignUpCode = async (email: string) => {
    try {
      const res = await auth.getVerification({ email });
      if (!res?.verification_id) {
        throw new Error('認証コードの送信に失敗しました。');
      }
      signupVerifyRef.current = { email, verificationId: res.verification_id };
    } catch (error: any) {
      throw new Error(authErrorMessage(error));
    }
  };

  // 新規登録ステップ2：認証コードを検証してアカウント作成
  const handleConfirmSignUp = async (email: string, password: string, code: string) => {
    const pending = signupVerifyRef.current;
    if (!pending || pending.email !== email) {
      throw new Error('認証コードを先に送信してください。');
    }
    try {
      const verifyRes = await auth.verify({
        verification_id: pending.verificationId,
        verification_code: code,
      });
      if (!verifyRes?.verification_token) {
        throw new Error('認証コードが正しくありません。');
      }
      const res = await auth.signUp({
        email,
        password,
        verification_code: code,
        verification_token: verifyRes.verification_token,
      });
      if (res.error) {
        throw new Error(authErrorMessage(res.error));
      }
      signupVerifyRef.current = null;
      // signUp で自動ログインされない場合に備えてパスワードログインを試みる
      if (!auth.currentUser) {
        const signInRes = await auth.signInWithPassword({ email, password });
        if (signInRes.error) {
          throw new Error(authErrorMessage(signInRes.error));
        }
      }
      applyAuthState();
    } catch (error: any) {
      throw error instanceof Error ? error : new Error(authErrorMessage(error));
    }
  };

  // パスワード再設定ステップ1：メールへ認証コードを送信
  const handleSendResetCode = async (email: string) => {
    try {
      const res = await auth.getVerification({ email });
      if (!res?.verification_id) {
        throw new Error('認証コードの送信に失敗しました。');
      }
      resetVerifyRef.current = { email, verificationId: res.verification_id };
    } catch (error: any) {
      throw new Error(authErrorMessage(error));
    }
  };

  // パスワード再設定ステップ2：認証コードを検証して新しいパスワードを設定
  const handleConfirmReset = async (email: string, newPassword: string, code: string) => {
    const pending = resetVerifyRef.current;
    if (!pending || pending.email !== email) {
      throw new Error('認証コードを先に送信してください。');
    }
    try {
      const verifyRes = await auth.verify({
        verification_id: pending.verificationId,
        verification_code: code,
      });
      if (!verifyRes?.verification_token) {
        throw new Error('認証コードが正しくありません。');
      }
      await auth.resetPassword({
        email,
        new_password: newPassword,
        verification_token: verifyRes.verification_token,
      });
      resetVerifyRef.current = null;
    } catch (error: any) {
      throw error instanceof Error ? error : new Error(authErrorMessage(error));
    }
  };

  const handleGuestLogin = async () => {
    setIsGuestLoading(true);
    try {
      const res = await auth.signInAnonymously();
      if (res.error) throw res.error;
      setIsGuest(true);
      taskService.isGuest = true;
    } catch (error: any) {
      // 匿名ログインが未開放などの場合はローカルゲストモードにフォールバック
      console.warn('Anonymous sign-in unavailable, using local guest mode:', error?.message || error);
      taskService.isGuest = true;
      setIsGuest(true);
    } finally {
      setIsGuestLoading(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7]">
        <div className="text-center">
          <Loader2 className="animate-spin text-[#007aff] mx-auto mb-4" size={40} />
          <p className="text-sm text-[#86868b]">Initializing...</p>
        </div>
      </div>
    );
  }

  if (!user && !isGuest) {
    return (
      <Login
        isAuthReady={isAuthReady}
        isGuestLoading={isGuestLoading}
        onGuestLogin={handleGuestLogin}
        onEmailSignIn={handleEmailSignIn}
        onSendSignUpCode={handleSendSignUpCode}
        onConfirmSignUp={handleConfirmSignUp}
        onSendResetCode={handleSendResetCode}
        onConfirmReset={handleConfirmReset}
      />
    );
  }

  const handleLogout = async () => {
    const wasAnonymous = (user && user.loginType === 'ANONYMOUS') || isGuest;
    if (wasAnonymous) {
      console.log('Cleaning up guest data before logout...');
      try {
        await taskService.cleanupUserData(user?.uid || 'guest');
      } catch (error) {
        console.error('Failed to cleanup guest data:', error);
      }
    }
    await auth.signOut();
    if (wasAnonymous) {
      setIsGuest(false);
      taskService.isGuest = false;
      window.location.reload();
    }
  };

  // タスク → 親案件画面ジャンプの共通ハンドラ。
  // 表示中 → 履歴行き の順で親を解決。完全削除されている場合は何もしない。
  // Dashboard 検索結果 / DailyReport のリンクから共用される。
  const jumpToTask = (task: { id: string; parent_task_id: string }) => {
    const parent =
      parentTasks.find(p => p.id === task.parent_task_id) ||
      hiddenParentTasks.find(p => p.id === task.parent_task_id);
    if (parent) {
      setSelectedParentTask(parent);
      setHighlightTaskId(task.id);
    }
  };

  const renderContent = () => {
    if (selectedParentTask) {
      return (
        <SubTaskManagement
          parentTask={selectedParentTask}
          onBack={() => {
            setSelectedParentTask(null);
            setHighlightTaskId(null);
          }}
          highlightTaskId={highlightTaskId}
        />
      );
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard
            parentTasks={parentTasks}
            allSubTasks={allSubTasks}
            onSelectTask={setSelectedParentTask}
            onJumpToTask={jumpToTask}
            settings={settings}
          />
        );
      case 'templates':
        return <TemplateManagement />;
      case 'history':
        return <History onSelectTask={setSelectedParentTask} settings={settings} />;
      case 'import':
        return (
          <FileImport
            onImportingChange={setIsImporting}
            onImportComplete={() => {
              setIsImporting(false);
              setActiveTab('dashboard');
            }}
          />
        );
      case 'reports':
        return (
          <DailyReport
            allSubTasks={allSubTasks}
            visibleParents={parentTasks}
            hiddenParents={hiddenParentTasks}
            onJumpToTask={jumpToTask}
          />
        );
      case 'settings':
        return <Settings />;
      case 'tasks':
        return (
          <div className="p-12 text-center mac-card">
            <h3 className="text-xl font-bold mb-2 text-[#1d1d1f]">タスク一覧</h3>
            <p className="text-[#86868b] text-sm">案件一覧からプロジェクトを選択して詳細タスクを管理してください。</p>
          </div>
        );
      default:
        return (
          <Dashboard
            parentTasks={parentTasks}
            allSubTasks={allSubTasks}
            onSelectTask={setSelectedParentTask}
            onJumpToTask={jumpToTask}
            settings={settings}
          />
        );
    }
  };

  return (
    <ErrorBoundary>
      <Layout
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (isImporting) return;
          setActiveTab(tab);
          setSelectedParentTask(null);
          setHighlightTaskId(null);
        }}
        user={user}
        onLogout={handleLogout}
        reportCount={reportCount}
        navigationDisabled={isImporting}
      >
        {renderContent()}
      </Layout>
    </ErrorBoundary>
  );
}
