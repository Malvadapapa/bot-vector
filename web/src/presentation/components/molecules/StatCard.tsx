import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
    label: string;
  };
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  trend,
  className = '',
}) => {
  return (
    <div
      className={`
        p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm
        hover:border-[var(--color-border-hover)] hover:shadow-md
        transition-all duration-[var(--transition-normal)]
        flex flex-col justify-between relative overflow-hidden group
        ${className}
      `}
    >
      {/* Decorative accent light */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--color-accent-muted)] rounded-full blur-3xl opacity-0 group-hover:opacity-40 transition-opacity duration-500 pointer-events-none" />

      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</span>
        <div className="p-2.5 rounded-lg bg-[var(--color-bg-sidebar)] text-[var(--color-accent)] border border-[var(--color-border)]">
          {icon}
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div className="flex flex-col">
          <span className="text-3xl font-bold text-[var(--color-text-primary)] tracking-tight">
            {value}
          </span>
          {trend && (
            <div className="flex items-center mt-2 text-xs">
              <span
                className={`
                  flex items-center font-semibold mr-1.5 px-1.5 py-0.5 rounded
                  ${trend.isPositive
                    ? 'bg-emerald-500/10 text-[var(--color-success)]'
                    : 'bg-rose-500/10 text-[var(--color-danger)]'
                  }
                `}
              >
                {trend.isPositive ? (
                  <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                )}
                {trend.value}%
              </span>
              <span className="text-[var(--color-text-tertiary)]">{trend.label}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
