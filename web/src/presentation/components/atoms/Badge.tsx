import React from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'secondary';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]',
  success: 'bg-[var(--color-success-muted)] text-[var(--color-accent-light)]',
  warning: 'bg-[var(--color-warning-muted)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-muted)] text-[var(--color-text-danger)]',
  info: 'bg-[var(--color-info-muted)] text-[var(--color-info)]',
  accent: 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]',
  secondary: 'bg-[var(--color-secondary-muted)] text-[var(--color-secondary-light)]',
};

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-[var(--color-text-tertiary)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
  info: 'bg-[var(--color-info)]',
  accent: 'bg-[var(--color-accent)]',
  secondary: 'bg-[var(--color-secondary)]',
};

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  children,
  dot = false,
  className = '',
}) => {
  return (
    <span
      className={`
        inline-flex items-center gap-1.5
        px-2.5 py-0.5 text-xs font-medium
        rounded-full
        ${variantClasses[variant]}
        ${className}
      `}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />
      )}
      {children}
    </span>
  );
};
