import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Spinner } from './components/atoms/Spinner';

// Pages
import { LoginPage } from './pages/LoginPage';
import { SuperAdminDashboard } from './pages/SuperAdminDashboard';
import { GroupAdminDashboard } from './pages/GroupAdminDashboard';
import { ProfessorDashboard } from './pages/ProfessorDashboard';
import { InstitutionalDashboard } from './pages/InstitutionalDashboard';
import { GroupOnboardingPage } from './pages/GroupOnboardingPage';

interface ProtectedRouteProps {
  allowedRoles: ('super_admin' | 'group_admin' | 'professor' | 'institutional')[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    // Redirect to default page based on role
    switch (user.role) {
      case 'super_admin':
        return <Navigate to="/super-admin/groups" replace />;
      case 'group_admin':
        return <Navigate to="/admin/calendar" replace />;
      case 'professor':
        return <Navigate to="/professor/calendar" replace />;
      case 'institutional':
        return <Navigate to="/institutional/notices" replace />;
      default:
        return <Navigate to="/login" replace />;
    }
  }

  return <Outlet />;
};

const DefaultRedirect: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  switch (user.role) {
    case 'super_admin':
      return <Navigate to="/super-admin/groups" replace />;
    case 'group_admin':
      return <Navigate to="/admin/calendar" replace />;
    case 'professor':
      return <Navigate to="/professor/calendar" replace />;
    case 'institutional':
      return <Navigate to="/institutional/notices" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
};

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/group-onboarding" element={<GroupOnboardingPage />} />

      {/* Super Admin Protected Routes */}
      <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
        <Route path="/super-admin/*" element={<SuperAdminDashboard />} />
      </Route>

      {/* Group Admin Protected Routes */}
      <Route element={<ProtectedRoute allowedRoles={['group_admin']} />}>
        <Route path="/admin/*" element={<GroupAdminDashboard />} />
      </Route>

      {/* Professor Protected Routes */}
      <Route element={<ProtectedRoute allowedRoles={['professor']} />}>
        <Route path="/professor/*" element={<ProfessorDashboard />} />
      </Route>

      {/* Institutional Protected Routes */}
      <Route element={<ProtectedRoute allowedRoles={['institutional']} />}>
        <Route path="/institutional/*" element={<InstitutionalDashboard />} />
      </Route>

      {/* Default Routes */}
      <Route path="/" element={<DefaultRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
export default AppRoutes;
