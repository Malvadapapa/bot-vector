import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './presentation/context/AuthContext';
import { AppRoutes } from './presentation/routes';
import { ToastContainer } from './presentation/components/atoms/ToastContainer';
import { EyeOff } from 'lucide-react';

function ImpersonationBanner() {
  const { originalUser, user, stopImpersonatingStaff } = useAuth();

  if (!originalUser || !user) return null;

  const roleLabels: Record<string, string> = {
    super_admin: 'Super Admin',
    group_admin: 'Administrador',
    professor: 'Docente',
    institutional: 'Institución',
  };

  return (
    <div className="bg-amber-600 dark:bg-amber-700 text-white px-4 py-2.5 text-center text-sm font-semibold flex items-center justify-center gap-3 shadow-md relative z-50">
      <span className="flex items-center gap-1.5">
        🚨 <strong>Simulación Activa:</strong> Estás viendo el panel de <strong>{user.name}</strong> ({roleLabels[user.role] || user.role}).
      </span>
      <button
        onClick={stopImpersonatingStaff}
        className="bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer border border-white/10"
      >
        <EyeOff className="w-3.5 h-3.5" />
        Detener Simulación
      </button>
    </div>
  );
}

function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem('app_theme') || 'classic-dark';
    if (savedTheme === 'classic-dark') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <ImpersonationBanner />
        <AppRoutes />
        <ToastContainer />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

