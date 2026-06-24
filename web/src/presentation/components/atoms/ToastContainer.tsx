import { Toaster } from 'sonner';

export const ToastContainer: React.FC = () => {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.875rem',
        },
        className: 'glass-card',
      }}
      richColors
      closeButton
      expand={false}
      gap={8}
    />
  );
};

import React from 'react';
