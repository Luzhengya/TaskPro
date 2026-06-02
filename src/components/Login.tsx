import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, LayoutGrid, Loader2, ArrowLeft } from 'lucide-react';

// Simple but practical email format check (RFC-5322 is overkill for a login form).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface LoginProps {
  isAuthReady: boolean;
  isGuestLoading: boolean;
  onGuestLogin: () => void;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  // メール認証コードによる新規登録（2ステップ）
  onSendSignUpCode: (email: string) => Promise<void>;
  onConfirmSignUp: (email: string, password: string, code: string) => Promise<void>;
  // メール認証コードによるパスワード再設定（2ステップ）
  onSendResetCode: (email: string) => Promise<void>;
  onConfirmReset: (email: string, newPassword: string, code: string) => Promise<void>;
}

type Mode = 'login' | 'register' | 'reset';
type Step = 'form' | 'code';

const BRAND = '#3b5bfe';

function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

const STRENGTH_COLORS = ['#e5e7eb', '#ef4444', '#f59e0b', '#eab308', '#22c55e'];

function Logo() {
  return (
    <div
      className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg"
      style={{ backgroundColor: BRAND }}
    >
      <LayoutGrid size={30} className="text-white" />
    </div>
  );
}

export function Login(props: LoginProps) {
  const {
    isAuthReady,
    isGuestLoading,
    onGuestLogin,
    onEmailSignIn,
    onSendSignUpCode,
    onConfirmSignUp,
    onSendResetCode,
    onConfirmReset,
  } = props;

  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<Step>('form');

  // shared form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);
  const busy = submitting || isGuestLoading;

  const resetFields = () => {
    setStep('form');
    setError(null);
    setInfo(null);
    setPassword('');
    setConfirmPassword('');
    setCode('');
    setShowPassword(false);
    setShowConfirm(false);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    resetFields();
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const addr = email.trim();
    if (!EMAIL_PATTERN.test(addr)) {
      setError('メールアドレスの形式が正しくありません。');
      return;
    }
    if (!password) {
      setError('パスワードを入力してください。');
      return;
    }
    setSubmitting(true);
    try {
      await onEmailSignIn(addr, password);
    } catch (err: any) {
      setError(err?.message || 'サインインに失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  // 新規登録ステップ1：入力チェック後に認証コードを送信
  const handleSendSignUpCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const addr = email.trim();
    if (!EMAIL_PATTERN.test(addr)) {
      setError('メールアドレスの形式が正しくありません。');
      return;
    }
    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください。');
      return;
    }
    if (password !== confirmPassword) {
      setError('パスワードが一致しません。');
      return;
    }
    setSubmitting(true);
    try {
      await onSendSignUpCode(addr);
      setStep('code');
      setInfo(`${addr} 宛に認証コードを送信しました。メールをご確認ください。`);
    } catch (err: any) {
      setError(err?.message || '認証コードの送信に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  // 新規登録ステップ2：認証コードを検証してアカウント作成
  const handleConfirmSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!code.trim()) {
      setError('認証コードを入力してください。');
      return;
    }
    setSubmitting(true);
    try {
      await onConfirmSignUp(email.trim(), password, code.trim());
    } catch (err: any) {
      setError(err?.message || 'アカウントの作成に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  // パスワード再設定ステップ1：認証コードを送信
  const handleSendResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const addr = email.trim();
    if (!EMAIL_PATTERN.test(addr)) {
      setError('有効なメールアドレスを入力してください。');
      return;
    }
    setSubmitting(true);
    try {
      await onSendResetCode(addr);
      setStep('code');
      setInfo(`${addr} 宛に認証コードを送信しました。メールをご確認ください。`);
    } catch (err: any) {
      setError(err?.message || '認証コードの送信に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  // パスワード再設定ステップ2：認証コードを検証して新しいパスワードを設定
  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!code.trim()) {
      setError('認証コードを入力してください。');
      return;
    }
    if (password.length < 8) {
      setError('新しいパスワードは8文字以上で入力してください。');
      return;
    }
    if (password !== confirmPassword) {
      setError('パスワードが一致しません。');
      return;
    }
    setSubmitting(true);
    try {
      await onConfirmReset(email.trim(), password, code.trim());
      switchMode('login');
      setInfo('パスワードを再設定しました。新しいパスワードでサインインしてください。');
    } catch (err: any) {
      setError(err?.message || 'パスワードの再設定に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full bg-[#f9fafb] border border-black/10 rounded-xl px-4 py-3 text-sm outline-none transition-all placeholder:text-[#9ca3af] focus:bg-white focus:border-transparent focus:ring-4';
  const ringStyle = { ['--tw-ring-color' as any]: `${BRAND}1a` };

  const renderEmailField = (disabled = false) => (
    <div>
      <label className="block text-sm font-semibold text-[#1d1d1f] mb-2">メールアドレス</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        className={inputClass}
        style={ringStyle}
        disabled={busy || disabled}
      />
    </div>
  );

  const renderPasswordField = (
    value: string,
    setValue: (v: string) => void,
    show: boolean,
    setShow: (v: boolean) => void,
    placeholder: string,
    autoComplete: string,
  ) => (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${inputClass} pr-11`}
        style={ringStyle}
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#6b7280] transition-colors"
        aria-label={show ? 'パスワードを隠す' : 'パスワードを表示'}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );

  const renderCodeField = () => (
    <div>
      <label className="block text-sm font-semibold text-[#1d1d1f] mb-2">認証コード</label>
      <input
        type="text"
        inputMode="numeric"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="メールに記載された6桁のコード"
        autoComplete="one-time-code"
        className={inputClass}
        style={ringStyle}
        disabled={busy}
      />
    </div>
  );

  const submitButton = (label: string) => (
    <button
      type="submit"
      disabled={busy || !isAuthReady}
      className="w-full py-3.5 rounded-xl font-bold text-white shadow-md hover:brightness-95 active:brightness-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ backgroundColor: BRAND }}
    >
      {submitting ? <Loader2 className="animate-spin" size={20} /> : null}
      {label}
    </button>
  );

  const messages = (
    <>
      {error && <p className="text-sm text-[#ef4444]">{error}</p>}
      {info && <p className="text-sm text-[#16a34a]">{info}</p>}
    </>
  );

  const backToForm = (
    <button
      type="button"
      onClick={() => { setStep('form'); setError(null); setInfo(null); setCode(''); }}
      className="text-sm font-medium inline-flex items-center gap-1 hover:underline"
      style={{ color: BRAND }}
      disabled={busy}
    >
      <ArrowLeft size={14} /> 戻る
    </button>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] p-4">
      <div className="max-w-md w-full bg-white rounded-3xl border border-black/5 shadow-[0_8px_40px_rgba(0,0,0,0.08)] p-8 sm:p-10">
        <Logo />

        {/* ===================== ログイン ===================== */}
        {mode === 'login' && (
          <>
            <h1 className="text-3xl font-bold text-[#1d1d1f] text-center tracking-tight">TaskMaster</h1>
            <p className="text-[#86868b] text-sm text-center mt-2 mb-8 leading-relaxed">
              Your personal productivity hub. Manage tasks, import reports, and get AI-powered summaries
            </p>

            <form onSubmit={handleSignIn} noValidate className="space-y-5">
              {renderEmailField()}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-[#1d1d1f]">パスワード</label>
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-sm font-medium hover:underline"
                    style={{ color: BRAND }}
                    disabled={busy}
                  >
                    パスワードを忘れた？
                  </button>
                </div>
                {renderPasswordField(password, setPassword, showPassword, setShowPassword, 'パスワード', 'current-password')}
              </div>

              {messages}
              {submitButton('サインイン')}
            </form>

            <p className="text-sm text-[#86868b] text-center mt-6">
              アカウントをお持ちでないですか？{' '}
              <button
                type="button"
                onClick={() => switchMode('register')}
                className="font-semibold hover:underline"
                style={{ color: BRAND }}
              >
                新規登録
              </button>
            </p>

            <div className="mt-7 pt-6 border-t border-black/5 text-center">
              <button
                type="button"
                onClick={onGuestLogin}
                disabled={busy}
                className="text-sm font-semibold text-[#1d1d1f] hover:underline disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {isGuestLoading ? <Loader2 className="animate-spin" size={16} /> : null}
                ゲストとして試す
              </button>
              <p className="text-[11px] text-[#9ca3af] mt-1.5">
                ゲストモードのデータはブラウザのローカルストレージに保存されます。
              </p>
            </div>
          </>
        )}

        {/* ===================== 新規登録 ===================== */}
        {mode === 'register' && (
          <>
            <h1 className="text-3xl font-bold text-[#1d1d1f] text-center tracking-tight">新規登録</h1>
            <p className="text-[#86868b] text-sm text-center mt-2 mb-8 leading-relaxed">
              {step === 'form'
                ? 'メールアドレスとパスワードでアカウントを作成'
                : 'メールに届いた認証コードを入力してください'}
            </p>

            {step === 'form' ? (
              <form onSubmit={handleSendSignUpCode} noValidate className="space-y-5">
                <div>
                  {renderEmailField()}
                  <p className="text-xs text-[#9ca3af] mt-1.5">認証コードの送信に使用します</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#1d1d1f] mb-2">パスワード</label>
                  {renderPasswordField(password, setPassword, showPassword, setShowPassword, '8文字以上', 'new-password')}
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-1 rounded-full transition-colors"
                        style={{ backgroundColor: i <= strength ? STRENGTH_COLORS[strength] : '#e5e7eb' }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#1d1d1f] mb-2">パスワード（確認）</label>
                  {renderPasswordField(confirmPassword, setConfirmPassword, showConfirm, setShowConfirm, 'もう一度入力', 'new-password')}
                </div>

                {messages}
                {submitButton('認証コードを送信')}
              </form>
            ) : (
              <form onSubmit={handleConfirmSignUp} noValidate className="space-y-5">
                {renderCodeField()}
                <div className="flex items-center justify-between">
                  {backToForm}
                  <button
                    type="button"
                    onClick={() => handleSendSignUpCode(new Event('submit') as any)}
                    className="text-sm font-medium hover:underline"
                    style={{ color: BRAND }}
                    disabled={busy}
                  >
                    コードを再送
                  </button>
                </div>
                {messages}
                {submitButton('アカウントを作成')}
              </form>
            )}

            <p className="text-sm text-[#86868b] text-center mt-6">
              すでにアカウントをお持ちですか？{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="font-semibold hover:underline"
                style={{ color: BRAND }}
              >
                サインイン
              </button>
            </p>
          </>
        )}

        {/* ===================== パスワード再設定 ===================== */}
        {mode === 'reset' && (
          <>
            <h1 className="text-3xl font-bold text-[#1d1d1f] text-center tracking-tight">パスワード再設定</h1>
            <p className="text-[#86868b] text-sm text-center mt-2 mb-8 leading-relaxed">
              {step === 'form'
                ? '登録済みのメールアドレスを入力してください'
                : '認証コードと新しいパスワードを入力してください'}
            </p>

            {step === 'form' ? (
              <form onSubmit={handleSendResetCode} noValidate className="space-y-5">
                {renderEmailField()}
                {messages}
                {submitButton('認証コードを送信')}
              </form>
            ) : (
              <form onSubmit={handleConfirmReset} noValidate className="space-y-5">
                {renderCodeField()}

                <div>
                  <label className="block text-sm font-semibold text-[#1d1d1f] mb-2">新しいパスワード</label>
                  {renderPasswordField(password, setPassword, showPassword, setShowPassword, '8文字以上', 'new-password')}
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-1 rounded-full transition-colors"
                        style={{ backgroundColor: i <= strength ? STRENGTH_COLORS[strength] : '#e5e7eb' }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#1d1d1f] mb-2">新しいパスワード（確認）</label>
                  {renderPasswordField(confirmPassword, setConfirmPassword, showConfirm, setShowConfirm, 'もう一度入力', 'new-password')}
                </div>

                <div className="flex items-center justify-between">
                  {backToForm}
                  <button
                    type="button"
                    onClick={() => handleSendResetCode(new Event('submit') as any)}
                    className="text-sm font-medium hover:underline"
                    style={{ color: BRAND }}
                    disabled={busy}
                  >
                    コードを再送
                  </button>
                </div>
                {messages}
                {submitButton('パスワードを再設定')}
              </form>
            )}

            <p className="text-sm text-[#86868b] text-center mt-6">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="font-semibold hover:underline"
                style={{ color: BRAND }}
              >
                サインインに戻る
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
