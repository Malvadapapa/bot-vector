import React from 'react';

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  children: React.ReactNode;
}

export const Label: React.FC<LabelProps> = ({
  required = false,
  children,
  className = '',
  ...props
}) => {
  return (
    <label
      className={`
        block text-sm font-medium
        text-[var(--color-text-secondary)]
        mb-1.5
        ${className}
      `}
      {...props}
    >
      {children}
      {required && (
        <span className="text-[var(--color-danger)] ml-1">*</span>
      )}
    </label>
  );
};
