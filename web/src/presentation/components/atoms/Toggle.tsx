import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className = '',
}) => {
  const trackSize = size === 'sm' ? 'w-9 h-5' : 'w-11 h-6';
  const thumbSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5';
  const thumbTranslate = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

  return (
    <label
      className={`
        inline-flex items-center gap-2.5 cursor-pointer select-none
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`
          ${trackSize} relative inline-flex items-center
          rounded-full transition-colors duration-200
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]
          ${checked
            ? 'bg-[var(--color-accent)]'
            : 'bg-[var(--color-border-hover)]'
          }
        `}
      >
        <span
          className={`
            ${thumbSize}
            inline-block rounded-full bg-white shadow-md
            transform transition-transform duration-200
            ${checked ? thumbTranslate : 'translate-x-1'}
          `}
        />
      </button>
      {label && (
        <span className="text-sm text-[var(--color-text-secondary)]">
          {label}
        </span>
      )}
    </label>
  );
};
