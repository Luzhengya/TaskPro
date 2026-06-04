import React, { useState, useEffect, useRef } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface EditableCellProps {
  value: string | number;
  onSave: (value: string | number) => void;
  type?: 'text' | 'number' | 'textarea';
  className?: string;
  placeholder?: string;
  rows?: number;
  title?: string;
}

export const EditableCell: React.FC<EditableCellProps> = ({
  value,
  onSave,
  type = 'text',
  className,
  placeholder,
  rows = 1,
  title
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const isComposing = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      setLocalValue(value);
    }
  }, [value, isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    if (localValue !== value) {
      onSave(localValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isComposing.current && type !== 'textarea') {
      (e.currentTarget as HTMLElement).blur();
    }
    if (e.key === 'Escape') {
      setLocalValue(value);
      setIsEditing(false);
    }
  };

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = () => {
    isComposing.current = false;
  };

  if (type === 'textarea') {
    return (
      <textarea
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          setIsEditing(true);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        className={cn("w-full bg-transparent focus:outline-none resize-none", className)}
        placeholder={placeholder}
        rows={rows}
        title={title}
      />
    );
  }

  return (
    <input
      type={type}
      // 数値入力時はモバイルで小数キーパッドを表示する（type=number でも一部端末で
      // ヒントになる）。type が text 等の場合は inputMode を指定しない。
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={localValue}
      onChange={(e) => {
        const val = type === 'number' ? parseFloat(e.target.value) : e.target.value;
        setLocalValue(isNaN(val as number) && type === 'number' ? 0 : val);
        setIsEditing(true);
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      // フォーカス時に値を全選択し、「0 のセルに 2 を打ったら 02 になる」を防ぐ。
      // タッチ／マウス／キーボードのいずれの方法でフォーカスが入っても確実に動くよう、
      // ブラウザ間のタイミング差を吸収するため次フレームで select() を呼ぶ。
      onFocus={(e) => {
        const el = e.currentTarget;
        requestAnimationFrame(() => {
          try { el.select(); } catch { /* noop */ }
        });
      }}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      className={cn("w-full bg-transparent focus:outline-none", className)}
      placeholder={placeholder}
      title={title}
    />
  );
};
