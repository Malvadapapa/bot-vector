import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-2',
  lg: 'w-12 h-12 border-3',
};

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '' }) => {
  return (
    <div
      className={`
        ${sizeClasses[size]}
        border-[var(--color-border)]
        border-t-[var(--color-accent)]
        rounded-full animate-spin
        ${className}
      `}
      role="status"
      aria-label="Cargando"
    />
  );
};

export const FullPageSpinner: React.FC = () => (
  <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-primary)]">
    <div className="flex flex-col items-center gap-4 animate-fade-in">
      <Spinner size="lg" />
      <p className="text-sm text-[var(--color-text-secondary)]">Cargando...</p>
    </div>
  </div>
);
