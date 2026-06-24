import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  error = false,
  icon,
  rightIcon,
  className = '',
  ...props
}) => {
  return (
    <div className="relative flex items-center w-full">
      {icon && (
        <span className="absolute left-3.5 text-[var(--color-text-tertiary)] pointer-events-none flex items-center justify-center">
          {icon}
        </span>
      )}
      <input
        style={{
          paddingLeft: icon ? '2.5rem' : '1rem',
          paddingRight: rightIcon ? '2.5rem' : '1rem',
        }}
        className={`
          w-full py-2.5 text-sm
          bg-[var(--color-bg-input)] 
          border rounded-lg
          text-[var(--color-text-primary)]
          placeholder:text-[var(--color-text-tertiary)]
          transition-all duration-[var(--transition-fast)]
          focus:ring-2 focus:ring-offset-0
          ${error
            ? 'border-[var(--color-border-danger)] focus:ring-[var(--color-danger-muted)] focus:border-[var(--color-border-danger)]'
            : 'border-[var(--color-border)] focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-border-focus)] hover:border-[var(--color-border-hover)]'
          }
          ${className}
        `}
        {...props}
      />
      {rightIcon && (
        <span className="absolute right-3 text-[var(--color-text-tertiary)]">
          {rightIcon}
        </span>
      )}
    </div>
  );
};
