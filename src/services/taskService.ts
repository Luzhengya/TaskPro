import { db, auth } from '../cloudbase';
import { ParentTask, SubTask, TaskTemplate, TemplateItem, UserSettings, DailyReportSnapshot } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface DbErrorInfo {
  error: string;
  code?: string | number;
  requestId?: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    loginType: string | null | undefined;
    username: string | null | undefined;
  }
}

/**
 * 任意の形のエラーから可読なメッセージを取り出す。
 * CloudBase(腾讯云开发) の SDK は Error インスタンスではなくプレーンオブジェクト
 * （例: { code: 'DATABASE_PERMISSION_DENIED', message: '...', requestId: '...' }）を
 * throw するため、`String(error)` では "[object Object]" になってしまう。
 * code / message / errMsg などを優先的に抽出し、最後の手段として JSON 化する。
 */
function extractErrorMessage(error: unknown): { message: string; code?: string | number; requestId?: string } {
  if (error instanceof Error) return { message: error.message };
  if (typeof error === 'string') return { message: error };
  if (error && typeof error === 'object') {
    const e = error as Record<string, any>;
    const code = e.code ?? e.error_code ?? e.errCode ?? e.status;
    const requestId = e.requestId ?? e.request_id;
    const message =
      e.message ??
      e.errMsg ??
      e.error_msg ??
      e.error_description ??
      e.msg ??
      e.error ??
      // 既知のフィールドが無ければ全体を JSON 化（[object Object] を避ける）
      (() => {
        try {
          return JSON.stringify(e);
        } catch {
          return Object.prototype.toString.call(e);
        }
      })();
    return { message: String(message), code, requestId };
  }
  return { message: String(error) };
}

function handleDbError(error: unknown, operationType: OperationType, path: string | null, shouldThrow = true) {
  const { message, code, requestId } = extractErrorMessage(error);
  const errInfo: DbErrorInfo = {
    error: message,
    ...(code !== undefined ? { code } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      loginType: auth.currentUser?.loginType,
      username: auth.currentUser?.username,
    },
    operationType,
    path
  }
  console.error('CloudBase DB Error: ', JSON.stringify(errInfo), '\nraw error:', error);
  if (shouldThrow) {
    throw new Error(JSON.stringify(errInfo));
  }
}

// ============================================================
// CloudBase データベースのヘルパー
//  - Firestore の doc.id は CloudBase では `_id`。読み出し時に id へマップする。
//  - get() の既定取得件数は 20 件のため limit を引き上げる。
// ============================================================
const READ_LIMIT = 1000;
// realtime watch が使えない環境向けのポーリング間隔（watch 成功時は停止する）。
const POLL_INTERVAL_MS = 5000;

/** CloudBase ドキュメント（_id）をアプリのモデル（id）へ変換する。 */
function mapDoc<T>(d: any): T {
  const { _id, ...rest } = d || {};
  return { ...rest, id: _id } as T;
}

/** order 昇順 → created_at 昇順の比較関数（既存の並び順を踏襲）。 */
function orderSort(a: any, b: any): number {
  return (a.order ?? 0) - (b.order ?? 0) ||
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

/** owner_id（＋追加条件）で所有ドキュメントを取得する。 */
async function getOwnedDocs(collName: string, extra: Record<string, any> = {}): Promise<any[]> {
  const owner = auth.currentUser?.uid;
  const res = await db.collection(collName).where({ owner_id: owner, ...extra }).limit(READ_LIMIT).get();
  return (res.data as any[]) || [];
}

/** owner_id（＋追加条件）の所有ドキュメントを監視する。
 *  - まず get() で即時ロードして UI へ反映する。
 *  - 安全網として常時ポーリングし、watch() が onChange を返した時点で停止する
 *    （realtime が動けば watch、動かなければポーリングで更新を拾う）。
 *    安全规则が doc を参照すると watch は INIT_WATCH_FAIL になり onError すら
 *    呼ばれないことがあるため、onError 任せにせず常時ポーリングで担保する。
 *  - 同一内容なら callback を呼ばず、無駄な再描画／ちらつきを防ぐ。
 */
function watchOwnedDocs<T>(
  collName: string,
  extra: Record<string, any>,
  callback: (rows: T[]) => void,
  options: { sort?: boolean } = {},
): () => void {
  const owner = auth.currentUser?.uid;
  if (!owner) return () => {};

  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastJson = '';

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const emit = (docs: any[]) => {
    const rows = (docs || []).map((d) => mapDoc<T>(d));
    if (options.sort !== false) rows.sort(orderSort);
    const json = JSON.stringify(rows);
    if (json === lastJson) return; // 変化が無ければ再描画しない
    lastJson = json;
    if (!closed) callback(rows);
  };

  const load = async () => {
    try {
      emit(await getOwnedDocs(collName, extra));
    } catch (err) {
      handleDbError(err, OperationType.LIST, collName, false);
    }
  };

  // 即時ロード + 安全網のポーリング（watch 成功で停止）。
  load();
  pollTimer = setInterval(load, POLL_INTERVAL_MS);

  let watcher: { close: () => void } | null = null;
  try {
    watcher = db.collection(collName)
      .where({ owner_id: owner, ...extra })
      .limit(READ_LIMIT)
      .watch({
        onChange: (snapshot: any) => {
          stopPolling(); // realtime が動作 → ポーリング不要
          emit((snapshot?.docs as any[]) || []);
        },
        onError: (err: any) => {
          // watch 不可。ポーリングは起動済みなので更新は担保される。
          handleDbError(err, OperationType.LIST, collName, false);
        },
      });
  } catch (err) {
    handleDbError(err, OperationType.LIST, collName, false);
  }

  return () => {
    closed = true;
    stopPolling();
    try { watcher?.close(); } catch { /* noop */ }
  };
}


const GUEST_STORAGE_KEY = 'taskmaster_guest_data';

interface GuestStore {
  parent_tasks: ParentTask[];
  sub_tasks: SubTask[];
  task_templates: TaskTemplate[];
  template_items: TemplateItem[];
  settings: UserSettings | null;
}

const getInitialGuestStore = (): GuestStore => ({
  parent_tasks: [
    {
      id: 'sample-p1',
      name: '【サンプル】新機能開発プロジェクト',
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      planned_hours: 40,
      actual_hours: 12,
      progress: 30,
      is_hidden: false,
      order: 0,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-p2',
      name: '【サンプル】システム保守・運用',
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      planned_hours: 20,
      actual_hours: 18,
      progress: 90,
      is_hidden: false,
      order: 1,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ],
  sub_tasks: [
    {
      id: 'sample-s1',
      parent_task_id: 'sample-p1',
      system: 'Frontend',
      task_name: 'UIコンポーネントの作成',
      status: '進行中',
      month: new Date().toISOString().slice(0, 7),
      week_number: 1,
      flag: 0,
      start_date: new Date().toISOString().split('T')[0],
      due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      final_deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      planned_hours: 8,
      actual_hours: 4,
      priority: 'A',
      is_in_report: true,
      daily_report_date: new Date().toISOString().split('T')[0],
      remarks: '順調に進んでいます',
      order: 0,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-s2',
      parent_task_id: 'sample-p1',
      system: 'Backend',
      task_name: 'APIエンドポイントの実装',
      status: '未着手',
      month: new Date().toISOString().slice(0, 7),
      week_number: 2,
      flag: 0,
      start_date: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      final_deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      planned_hours: 12,
      actual_hours: 0,
      priority: 'B',
      is_in_report: false,
      daily_report_date: '',
      remarks: '',
      order: 1,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-s3',
      parent_task_id: 'sample-p2',
      system: 'Infrastructure',
      task_name: 'サーバー証明書の更新',
      status: '済',
      month: new Date().toISOString().slice(0, 7),
      week_number: 1,
      flag: 0,
      start_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      due_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      final_deadline: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      planned_hours: 2,
      actual_hours: 2.5,
      priority: 'A',
      is_in_report: true,
      daily_report_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      remarks: '完了しました',
      order: 0,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ],
  task_templates: [
    {
      id: 'sample-t1',
      name: '標準開発フロー',
      order: 0,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-t2',
      name: 'Webアプリ開発テンプレート',
      order: 1,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-t3',
      name: 'モバイルアプリ開発テンプレート',
      order: 2,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ],
  template_items: [
    {
      id: 'sample-ti1',
      template_id: 'sample-t1',
      system: '共通',
      task_name: '要件定義',
      status: '未着手',
      planned_hours: 8,
      priority: 'A',
      remarks: '',
      order: 0,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-ti2',
      template_id: 'sample-t1',
      system: '共通',
      task_name: '基本設計',
      status: '未着手',
      planned_hours: 16,
      priority: 'B',
      remarks: '',
      order: 1,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-ti3',
      template_id: 'sample-t2',
      system: 'Frontend',
      task_name: 'React環境構築',
      status: '未着手',
      planned_hours: 4,
      priority: 'A',
      remarks: '',
      order: 0,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-ti4',
      template_id: 'sample-t2',
      system: 'Frontend',
      task_name: 'トップページ実装',
      status: '未着手',
      planned_hours: 8,
      priority: 'B',
      remarks: '',
      order: 1,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-ti5',
      template_id: 'sample-t2',
      system: 'Backend',
      task_name: 'DB設計・構築',
      status: '未着手',
      planned_hours: 8,
      priority: 'A',
      remarks: '',
      order: 2,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-ti6',
      template_id: 'sample-t3',
      system: 'iOS/Android',
      task_name: 'Flutter環境構築',
      status: '未着手',
      planned_hours: 4,
      priority: 'A',
      remarks: '',
      order: 0,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'sample-ti7',
      template_id: 'sample-t3',
      system: 'Design',
      task_name: 'UI/UXデザイン作成',
      status: '未着手',
      planned_hours: 16,
      priority: 'A',
      remarks: '',
      order: 1,
      owner_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ],
  settings: {
    id: 'guest-settings',
    ai_models: [],
    ui_preferences: {
      view: 'table',
      opacity: 1,
      theme: 'light',
      font: 'Inter'
    },
    notification_rules: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
});

const loadGuestStore = (): GuestStore => {
  const stored = localStorage.getItem(GUEST_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse guest store:', e);
    }
  }
  return getInitialGuestStore();
};

// Simple observer system for guest mode
type GuestObserver = () => void;
const guestObservers: Set<GuestObserver> = new Set();

const notifyGuestObservers = () => {
  guestObservers.forEach(observer => observer());
};

const saveGuestStore = (store: GuestStore) => {
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(store));
  notifyGuestObservers();
};

let guestStore = loadGuestStore();

export const taskService = {
  isGuest: false,

  // Test connection
  async testConnection() {
    if (this.isGuest) return;
    try {
      await db.collection('parent_tasks').limit(1).get();
    } catch (error) {
      console.error('CloudBase connection check failed. Please verify TCB_ENV_ID and login state.', error);
    }
  },

  async cleanupUserData(userId: string) {
    if (this.isGuest) {
      guestStore = getInitialGuestStore();
      saveGuestStore(guestStore);
      notifyGuestObservers();
      return;
    }
    console.log('Cleaning up data for user:', userId);
    const collections = ['parent_tasks', 'sub_tasks', 'task_templates', 'template_items', 'settings'];
    for (const colName of collections) {
      try {
        const res = await db.collection(colName).where({ owner_id: userId }).limit(READ_LIMIT).get();
        const docs = (res.data as any[]) || [];
        await Promise.all(docs.map((d) => db.collection(colName).doc(d._id).remove()));
        console.log(`Cleaned up ${docs.length} documents from ${colName}`);
      } catch (error) {
        console.error(`Error cleaning up ${colName}:`, error);
      }
    }
  },

  // Parent Tasks
  subscribeParentTasks(callback: (tasks: ParentTask[]) => void, showHidden = false) {
    if (this.isGuest) {
      const update = () => {
        const filtered = guestStore.parent_tasks.filter(t => !!t.is_hidden === showHidden);
        callback(filtered);
      };
      update();
      guestObservers.add(update);
      return () => guestObservers.delete(update);
    }
    return watchOwnedDocs<ParentTask>('parent_tasks', { is_hidden: showHidden }, callback);
  },

  async addParentTask(task: Omit<ParentTask, 'id' | 'created_at' | 'updated_at' | 'owner_id'>, order?: number) {
    if (this.isGuest) {
      const newTask: ParentTask = {
        ...task,
        id: Math.random().toString(36).substr(2, 9),
        is_hidden: false,
        order: order ?? guestStore.parent_tasks.length,
        owner_id: 'guest',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      guestStore.parent_tasks.push(newTask);
      saveGuestStore(guestStore);
      return newTask.id;
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    const path = 'parent_tasks';
    try {
      // order が渡されればそれを使う。無い場合のみ件数を読んで採番する。
      // （大量インポート時に 1 件ごと全件読み込みすると O(n^2) になるため）
      const computedOrder = order ?? (await getOwnedDocs(path)).length;

      const res = await db.collection(path).add({
        ...task,
        is_hidden: false,
        order: computedOrder,
        owner_id: auth.currentUser.uid,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return res.id;
    } catch (error) {
      handleDbError(error, OperationType.CREATE, path);
    }
  },

  async updateParentTask(id: string, task: Partial<ParentTask>) {
    if (this.isGuest) {
      const index = guestStore.parent_tasks.findIndex(t => t.id === id);
      if (index !== -1) {
        guestStore.parent_tasks[index] = {
          ...guestStore.parent_tasks[index],
          ...task,
          updated_at: new Date().toISOString()
        };
        saveGuestStore(guestStore);
      }
      return;
    }
    const path = `parent_tasks/${id}`;
    try {
      await db.collection('parent_tasks').doc(id).update({
        ...task,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      handleDbError(error, OperationType.UPDATE, path);
    }
  },

  async deleteParentTask(id: string) {
    if (this.isGuest) {
      guestStore.parent_tasks = guestStore.parent_tasks.filter(t => t.id !== id);
      guestStore.sub_tasks = guestStore.sub_tasks.filter(t => t.parent_task_id !== id);
      saveGuestStore(guestStore);
      return;
    }
    const path = `parent_tasks/${id}`;
    try {
      // Delete associated sub-tasks first
      const subTasks = await getOwnedDocs('sub_tasks', { parent_task_id: id });
      await Promise.all(subTasks.map((d) => db.collection('sub_tasks').doc(d._id).remove()));

      // Delete parent task
      await db.collection('parent_tasks').doc(id).remove();
    } catch (error) {
      handleDbError(error, OperationType.DELETE, path);
    }
  },

  async clearAllData() {
    if (this.isGuest) {
      guestStore.parent_tasks = [];
      guestStore.sub_tasks = [];
      saveGuestStore(guestStore);
      notifyGuestObservers();
      return;
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    try {
      // Delete all parent tasks
      const parents = await getOwnedDocs('parent_tasks');
      const pDeletes = parents.map((d) => db.collection('parent_tasks').doc(d._id).remove());

      // Delete all sub tasks
      const subs = await getOwnedDocs('sub_tasks');
      const sDeletes = subs.map((d) => db.collection('sub_tasks').doc(d._id).remove());

      await Promise.all([...pDeletes, ...sDeletes]);
    } catch (error) {
      handleDbError(error, OperationType.DELETE, 'all_data');
    }
  },

  // Sub Tasks
  subscribeAllSubTasks(callback: (tasks: SubTask[]) => void) {
    if (this.isGuest) {
      const update = () => {
        callback(guestStore.sub_tasks);
      };
      update();
      guestObservers.add(update);
      return () => guestObservers.delete(update);
    }
    return watchOwnedDocs<SubTask>('sub_tasks', {}, callback);
  },

  subscribeSubTasks(parentTaskId: string, callback: (tasks: SubTask[]) => void) {
    if (this.isGuest) {
      const update = () => {
        const filtered = guestStore.sub_tasks.filter(t => t.parent_task_id === parentTaskId);
        callback(filtered);
      };
      update();
      guestObservers.add(update);
      return () => guestObservers.delete(update);
    }
    return watchOwnedDocs<SubTask>('sub_tasks', { parent_task_id: parentTaskId }, callback);
  },

  async addSubTask(task: Omit<SubTask, 'id' | 'created_at' | 'updated_at' | 'owner_id'>, order?: number) {
    if (this.isGuest) {
      const newTask: SubTask = {
        ...task,
        id: Math.random().toString(36).substr(2, 9),
        is_in_report: false,
        order: order ?? guestStore.sub_tasks.filter(t => t.parent_task_id === task.parent_task_id).length,
        owner_id: 'guest',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      guestStore.sub_tasks.push(newTask);
      saveGuestStore(guestStore);
      return newTask.id;
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    const path = 'sub_tasks';
    try {
      // order が渡されればそれを使い、無い場合のみ件数を読んで採番する。
      const computedOrder = order ?? (await getOwnedDocs(path, { parent_task_id: task.parent_task_id })).length;

      const res = await db.collection(path).add({
        ...task,
        is_in_report: false,
        order: computedOrder,
        owner_id: auth.currentUser.uid,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return res.id;
    } catch (error) {
      handleDbError(error, OperationType.CREATE, path);
    }
  },

  calculateDeadline(dueDate: string, plannedHours: number): string {
    const date = new Date(dueDate);
    let businessDaysToAdd = 0;

    if (plannedHours >= 1 && plannedHours < 3) {
      businessDaysToAdd = 1;
    } else if (plannedHours >= 3 && plannedHours < 5) {
      businessDaysToAdd = 2;
    } else if (plannedHours >= 5 && plannedHours < 8) {
      businessDaysToAdd = 4; // User said 3-4, I'll pick 4 for safety or 3. Let's use 4 as per "3-4".
    } else if (plannedHours >= 8) {
      businessDaysToAdd = 5; // 1 week business days
    }

    let addedDays = 0;
    while (addedDays < businessDaysToAdd) {
      date.setDate(date.getDate() + 1);
      const day = date.getDay();
      if (day !== 0 && day !== 6) { // Not Sunday (0) or Saturday (6)
        addedDays++;
      }
    }

    return date.toISOString().split('T')[0];
  },

  async updateSubTask(id: string, task: Partial<SubTask>) {
    if (this.isGuest) {
      const index = guestStore.sub_tasks.findIndex(t => t.id === id);
      if (index !== -1) {
        guestStore.sub_tasks[index] = {
          ...guestStore.sub_tasks[index],
          ...task,
          updated_at: new Date().toISOString()
        };
        saveGuestStore(guestStore);
      }
      return;
    }
    const path = `sub_tasks/${id}`;
    try {
      await db.collection('sub_tasks').doc(id).update({
        ...task,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      handleDbError(error, OperationType.UPDATE, path);
    }
  },

  async deleteSubTask(id: string) {
    if (this.isGuest) {
      guestStore.sub_tasks = guestStore.sub_tasks.filter(t => t.id !== id);
      saveGuestStore(guestStore);
      return;
    }
    const path = `sub_tasks/${id}`;
    try {
      await db.collection('sub_tasks').doc(id).remove();
    } catch (error) {
      handleDbError(error, OperationType.DELETE, path);
    }
  },

  // Task Templates
  subscribeTaskTemplates(callback: (templates: TaskTemplate[]) => void) {
    if (this.isGuest) {
      const update = () => {
        callback([...guestStore.task_templates]);
      };
      update();
      guestObservers.add(update);
      return () => guestObservers.delete(update);
    }
    return watchOwnedDocs<TaskTemplate>('task_templates', {}, callback);
  },

  async addTaskTemplate(template: Omit<TaskTemplate, 'id' | 'created_at' | 'updated_at' | 'owner_id'>) {
    if (this.isGuest) {
      const newTemplate: TaskTemplate = {
        ...template,
        id: Math.random().toString(36).substr(2, 9),
        order: guestStore.task_templates.length,
        owner_id: 'guest',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      guestStore.task_templates.push(newTemplate);
      saveGuestStore(guestStore);
      return newTemplate.id;
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    const path = 'task_templates';
    try {
      const existing = await getOwnedDocs(path);
      const order = existing.length;

      const res = await db.collection(path).add({
        ...template,
        order,
        owner_id: auth.currentUser.uid,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return res.id;
    } catch (error) {
      handleDbError(error, OperationType.CREATE, path);
    }
  },

  async updateTaskTemplate(id: string, updates: Partial<TaskTemplate>) {
    if (this.isGuest) {
      const index = guestStore.task_templates.findIndex(t => t.id === id);
      if (index !== -1) {
        guestStore.task_templates[index] = {
          ...guestStore.task_templates[index],
          ...updates,
          updated_at: new Date().toISOString()
        };
        saveGuestStore(guestStore);
      }
      return;
    }
    const path = `task_templates/${id}`;
    try {
      await db.collection('task_templates').doc(id).update({
        ...updates,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      handleDbError(error, OperationType.UPDATE, path);
    }
  },

  async deleteTaskTemplate(id: string) {
    if (this.isGuest) {
      guestStore.task_templates = guestStore.task_templates.filter(t => t.id !== id);
      guestStore.template_items = guestStore.template_items.filter(t => t.template_id !== id);
      saveGuestStore(guestStore);
      return;
    }
    const path = `task_templates/${id}`;
    try {
      // Delete associated template items first
      const items = await getOwnedDocs('template_items', { template_id: id });
      await Promise.all(items.map((d) => db.collection('template_items').doc(d._id).remove()));

      // Delete template
      await db.collection('task_templates').doc(id).remove();
    } catch (error) {
      handleDbError(error, OperationType.DELETE, path);
    }
  },

  // Template Items
  subscribeTemplateItems(templateId: string, callback: (items: TemplateItem[]) => void) {
    if (this.isGuest) {
      const update = () => {
        const filtered = guestStore.template_items.filter(t => t.template_id === templateId);
        callback(filtered);
      };
      update();
      guestObservers.add(update);
      return () => guestObservers.delete(update);
    }
    return watchOwnedDocs<TemplateItem>('template_items', { template_id: templateId }, callback);
  },

  async addTemplateItem(item: Omit<TemplateItem, 'id' | 'created_at' | 'updated_at' | 'owner_id'>) {
    if (this.isGuest) {
      const newItem: TemplateItem = {
        ...item,
        id: Math.random().toString(36).substr(2, 9),
        order: guestStore.template_items.filter(t => t.template_id === item.template_id).length,
        owner_id: 'guest',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      guestStore.template_items.push(newItem);
      saveGuestStore(guestStore);
      return newItem.id;
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    const path = 'template_items';
    try {
      const existing = await getOwnedDocs(path, { template_id: item.template_id });
      const order = existing.length;

      const res = await db.collection(path).add({
        ...item,
        order,
        owner_id: auth.currentUser.uid,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return res.id;
    } catch (error) {
      handleDbError(error, OperationType.CREATE, path);
    }
  },

  async updateTemplateItem(id: string, updates: Partial<TemplateItem>) {
    if (this.isGuest) {
      const index = guestStore.template_items.findIndex(t => t.id === id);
      if (index !== -1) {
        guestStore.template_items[index] = {
          ...guestStore.template_items[index],
          ...updates,
          updated_at: new Date().toISOString()
        };
        saveGuestStore(guestStore);
      }
      return;
    }
    const path = `template_items/${id}`;
    try {
      await db.collection('template_items').doc(id).update({
        ...updates,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      handleDbError(error, OperationType.UPDATE, path);
    }
  },

  async deleteTemplateItem(id: string) {
    if (this.isGuest) {
      guestStore.template_items = guestStore.template_items.filter(t => t.id !== id);
      saveGuestStore(guestStore);
      return;
    }
    const path = `template_items/${id}`;
    try {
      await db.collection('template_items').doc(id).remove();
    } catch (error) {
      handleDbError(error, OperationType.DELETE, path);
    }
  },

  async getTemplateItems(templateId: string) {
    if (this.isGuest) {
      return guestStore.template_items.filter(t => t.template_id === templateId);
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    const items = await getOwnedDocs('template_items', { template_id: templateId });
    return items.map((d) => mapDoc<TemplateItem>(d));
  },

  // Settings
  subscribeSettings(callback: (settings: UserSettings | null) => void) {
    if (this.isGuest) {
      const update = () => {
        callback(guestStore.settings);
      };
      update();
      guestObservers.add(update);
      return () => guestObservers.delete(update);
    }
    // get + watch（失敗時ポーリング）の共通ロジックを再利用。settings は単一ドキュメント。
    return watchOwnedDocs<UserSettings>(
      'settings',
      {},
      (rows) => callback(rows.length > 0 ? rows[0] : null),
      { sort: false },
    );
  },

  async updateSettings(id: string | undefined, settings: Partial<UserSettings>) {
    if (this.isGuest) {
      guestStore.settings = {
        ...(guestStore.settings || {
          id: 'guest-settings',
          owner_id: 'guest',
          ai_models: [],
          ui_preferences: { view: 'table', opacity: 1, theme: 'light', font: 'Inter' },
          notification_rules: [],
          updated_at: new Date().toISOString()
        }),
        ...settings,
        updated_at: new Date().toISOString()
      } as UserSettings;
      saveGuestStore(guestStore);
      return;
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    if (id) {
      const path = `settings/${id}`;
      try {
        await db.collection('settings').doc(id).update({
          ...settings,
          updated_at: new Date().toISOString()
        });
      } catch (error) {
        handleDbError(error, OperationType.UPDATE, path);
      }
    } else {
      const path = 'settings';
      try {
        await db.collection(path).add({
          ...settings,
          owner_id: auth.currentUser.uid,
          updated_at: new Date().toISOString()
        });
      } catch (error) {
        handleDbError(error, OperationType.CREATE, path);
      }
    }
  },

  // ============================================================
  // Daily Report Snapshots
  // ============================================================
  async saveDailyReport(snapshot: Omit<DailyReportSnapshot, 'id' | 'created_at' | 'updated_at' | 'owner_id'>) {
    if (this.isGuest) {
      // Store in localStorage for guest mode
      const key = `daily-report-${snapshot.date}`;
      const stored: DailyReportSnapshot = {
        ...snapshot,
        id: snapshot.date,
        owner_id: 'guest',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      try {
        localStorage.setItem(key, JSON.stringify(stored));
      } catch (e) {
        console.warn('Failed to persist guest daily report:', e);
      }
      return stored.id;
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    const path = 'daily_reports';
    try {
      // Try update existing report for the same date first
      const existing = await getOwnedDocs(path, { date: snapshot.date });
      const now = new Date().toISOString();
      if (existing.length > 0) {
        const docId = existing[0]._id;
        await db.collection(path).doc(docId).update({
          ...snapshot,
          updated_at: now,
        });
        return docId;
      }
      const res = await db.collection(path).add({
        ...snapshot,
        owner_id: auth.currentUser.uid,
        created_at: now,
        updated_at: now,
      });
      return res.id;
    } catch (error) {
      handleDbError(error, OperationType.CREATE, path);
      throw error;
    }
  },

  async getDailyReport(date: string): Promise<DailyReportSnapshot | null> {
    if (this.isGuest) {
      try {
        const stored = localStorage.getItem(`daily-report-${date}`);
        return stored ? JSON.parse(stored) as DailyReportSnapshot : null;
      } catch {
        return null;
      }
    }
    if (!auth.currentUser) return null;
    const path = 'daily_reports';
    try {
      const docs = await getOwnedDocs(path, { date });
      if (docs.length === 0) return null;
      return mapDoc<DailyReportSnapshot>(docs[0]);
    } catch (error) {
      handleDbError(error, OperationType.GET, path, false);
      return null;
    }
  },

  async deleteDailyReport(date: string) {
    if (this.isGuest) {
      try {
        localStorage.removeItem(`daily-report-${date}`);
      } catch {}
      return;
    }
    if (!auth.currentUser) throw new Error('User not authenticated');
    const path = 'daily_reports';
    try {
      const docs = await getOwnedDocs(path, { date });
      await Promise.all(docs.map((d) => db.collection(path).doc(d._id).remove()));
    } catch (error) {
      handleDbError(error, OperationType.DELETE, path);
    }
  }
};
