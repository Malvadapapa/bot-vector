import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--color-bg-primary)] px-4 py-12 relative overflow-hidden">
      {/* Decorative gradients in background */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[var(--color-accent-muted)] rounded-full blur-[120px] opacity-35" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-[var(--color-secondary-muted)] rounded-full blur-[120px] opacity-35" />

      {/* Grid Pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(30,41,59,0.2)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,41,59,0.2)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* Main card */}
      <div className="relative z-10 w-full max-w-md animate-fade-in-scale">
        <div className="glass-card p-8 md:p-10 shadow-2xl flex flex-col items-center">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-8">
            <div className="p-3 bg-[var(--color-accent-muted)] rounded-2xl text-[var(--color-accent)] shadow-glow-accent animate-pulse-glow">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-extrabold text-2xl tracking-tight text-[var(--color-text-primary)]">
                Vectorito
              </span>
              <span className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-bold mt-0.5">
                Panel de Administración
              </span>
            </div>
          </div>

          {/* Children form/state */}
          <div className="w-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
export default AuthLayout;
