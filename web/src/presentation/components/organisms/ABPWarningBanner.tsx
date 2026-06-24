import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { manageExamsUseCase } from '../../../infrastructure/repositories/instances';
import { ShieldAlert, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

export const ABPWarningBanner: React.FC = () => {
  const { activeGroup, user } = useAuth();
  const [warnings, setWarnings] = useState<{ subjectId: string; subjectName: string }[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const hasAccess = user?.role === 'super_admin' || user?.role === 'group_admin';

  useEffect(() => {
    if (activeGroup && hasAccess) {
      manageExamsUseCase.getABPWarnings(activeGroup.id).then((list) => {
        setWarnings(list);
      });
    } else {
      setWarnings([]);
    }
  }, [activeGroup, hasAccess]);

  // Listener to refresh warnings if exam list is updated
  useEffect(() => {
    const handleRefreshWarnings = () => {
      if (activeGroup && hasAccess) {
        manageExamsUseCase.getABPWarnings(activeGroup.id).then((list) => {
          setWarnings(list);
        });
      }
    };
    
    window.addEventListener('refresh-abp-warnings', handleRefreshWarnings);
    return () => window.removeEventListener('refresh-abp-warnings', handleRefreshWarnings);
  }, [activeGroup, hasAccess]);

  if (!hasAccess || warnings.length === 0) return null;

  return (
    <div className="w-full bg-rose-500/10 border-b border-[var(--color-border-danger)] text-[var(--color-danger)] transition-all duration-300">
      <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2.5">
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 text-[var(--color-danger)]" />
          <span>
            Alerta Académica: Hay {warnings.length} materia{warnings.length > 1 ? 's' : ''} con 3 o más evidencias registradas pero sin defensa ABP asignada.
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[var(--color-danger)] hover:underline cursor-pointer"
          >
            {isExpanded ? (
              <>
                Ocultar materias <ChevronUp className="w-4 h-4" />
              </>
            ) : (
              <>
                Ver materias <ChevronDown className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="max-w-7xl mx-auto px-6 pb-4 pt-1 animate-fade-in">
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {warnings.map((w) => (
              <div
                key={w.subjectId}
                className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-danger)]/30 text-xs font-medium text-[var(--color-text-primary)]"
              >
                <AlertCircle className="w-4 h-4 text-[var(--color-danger)]" />
                <span>{w.subjectName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
export default ABPWarningBanner;
