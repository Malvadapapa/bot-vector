import React from 'react';
import { Label } from '../atoms/Label';
import { Input } from '../atoms/Input';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  required?: boolean;
  error?: string;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  isTextArea?: boolean;
  rows?: number;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  required = false,
  error,
  icon,
  rightIcon,
  isTextArea = false,
  rows = 4,
  className = '',
  ...props
}) => {
  return (
    <div className={`flex flex-col w-full ${className}`}>
      <Label required={required}>{label}</Label>
      
      {isTextArea ? (
        <textarea
          rows={rows}
          className={`
            w-full px-4 py-2.5 text-sm
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
          `}
          {...(props as any)}
        />
      ) : (
        <Input
          error={!!error}
          icon={icon}
          rightIcon={rightIcon}
          {...props}
        />
      )}
      
      {error && (
        <span className="text-xs text-[var(--color-danger)] mt-1.5 font-medium animate-fade-in">
          {error}
        </span>
      )}
    </div>
  );
};
