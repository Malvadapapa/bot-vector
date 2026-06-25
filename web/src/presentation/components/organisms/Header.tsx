import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Eye, UserCheck, Menu } from 'lucide-react';

interface HeaderProps {
  title: string;
  onMenuClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ title, onMenuClick }) => {
  const { impersonation, deactivateImpersonation, user, activeGroup } = useAuth();

  return (
    <header className="sticky top-0 z-30 min-h-16 md:h-16 border-b border-[var(--color-border)] bg-[var(--color-bg-card)] flex flex-wrap md:flex-nowrap items-center justify-between px-4 md:px-6 py-2.5 md:py-0 gap-3">
      {/* Left Area: Hamburger and Title/Subtitles */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="p-2 rounded-lg bg-[var(--color-bg-sidebar)] border border-[var(--color-border)] text-[var(--color-text-secondary)] md:hidden cursor-pointer flex-shrink-0 hover:text-[var(--color-accent)] hover:border-[var(--color-border-hover)]"
            title="Abrir menú"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="flex flex-col justify-center min-w-0">
          <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
            <h1 className="text-base md:text-lg font-bold text-[var(--color-text-primary)] truncate">
              {title}
            </h1>
            {impersonation?.active && (
              <div className="flex items-center gap-1 animate-pulse bg-[var(--color-accent-muted)] border border-[var(--color-accent)] text-[var(--color-accent)] text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                <Eye className="w-3.5 h-3.5" />
                <span>Simulación</span>
              </div>
            )}
          </div>
          {user && activeGroup && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] font-semibold">
              {user.role !== 'super_admin' && (
                <span className="bg-[var(--color-bg-sidebar)] text-[var(--color-text-secondary)] px-1.5 py-0.5 rounded-md border border-[var(--color-border)] whitespace-nowrap">
                  Panel: <strong className="text-[var(--color-text-primary)]">{user.role === 'group_admin' ? 'Administrador' : user.role === 'professor' ? 'Docente' : 'Institución'}</strong>
                </span>
              )}
              {user.role !== 'professor' && (
                <span className="bg-[var(--color-accent-muted)] text-[var(--color-accent)] px-1.5 py-0.5 rounded-md border border-[var(--color-accent)]/20" title={activeGroup.name}>
                  Grupo: <strong>{activeGroup.name}</strong>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Area: Controls */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        {/* Impersonation active banner/button */}
        {impersonation?.active && (
          <button
            onClick={deactivateImpersonation}
            className="
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
              bg-rose-500/10 text-[var(--color-danger)] border border-[var(--color-border-danger)]
              hover:bg-rose-500/20 transition-colors cursor-pointer
            "
            title="Hacé click para salir del modo simulación"
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Salir de simulación</span>
          </button>
        )}

        {/* Tecnicatura Superior Degree Program Title Banner */}
        <span
          className="text-xs md:text-sm font-bold text-[var(--color-accent)] bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/20 px-3 py-1.5 rounded-xl whitespace-nowrap"
          title="Tecnicatura Superior en Desarrollo de Software ISPC"
        >
          <span className="sm:hidden">TSDS</span>
          <span className="hidden sm:inline">Tecnicatura Superior en Desarrollo de Software ISPC</span>
        </span>
      </div>
    </header>
  );
};
