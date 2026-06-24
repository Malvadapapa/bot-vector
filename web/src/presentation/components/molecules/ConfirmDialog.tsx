import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../atoms/Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  type = 'warning',
  isLoading = false,
}) => {
  // Prevent body scrolling when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const iconColors = {
    danger: 'bg-rose-500/10 text-[var(--color-danger)]',
    warning: 'bg-amber-500/10 text-[var(--color-warning)]',
    info: 'bg-blue-500/10 text-[var(--color-info)]',
  };

  const confirmVariants = {
    danger: 'danger' as const,
    warning: 'primary' as const, // default primary has nice accent color
    info: 'primary' as const,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Dialog card */}
      <div
        className="
          relative z-10 w-full max-w-md overflow-hidden
          bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl shadow-2xl
          animate-fade-in flex flex-col p-6
        "
      >
        <div className="flex gap-4">
          <div className={`flex-shrink-0 p-3 rounded-full h-12 w-12 flex items-center justify-center ${iconColors[type]}`}>
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="flex-1">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
              {title}
            </h3>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)] leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            variant={confirmVariants[type]}
            onClick={onConfirm}
            loading={isLoading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};
