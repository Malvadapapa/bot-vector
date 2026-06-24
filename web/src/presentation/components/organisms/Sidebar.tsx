import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Calendar,
  FileText,
  Clock,
  Megaphone,
  UserX,
  MessageSquare,
  Building,
  Settings,
  Eye,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  X,
  Mail,
  GraduationCap,
  BookOpen,
} from 'lucide-react';
import { Avatar } from '../atoms/Avatar';

interface SidebarProps {
  className?: string;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ className = '', onClose }) => {
  const { user, impersonation, logout, activeGroup } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!user) return null;

  // Navigation config based on role
  const getNavItems = () => {
    switch (user.role) {
      case 'super_admin':
        return [
          { to: '/super-admin/groups', label: 'Grupos', icon: <Building className="w-5 h-5" /> },
          { to: '/super-admin/subjects', label: 'Materias', icon: <BookOpen className="w-5 h-5" /> },
          { to: '/super-admin/admins', label: 'Administradores', icon: <ShieldCheck className="w-5 h-5" /> },
          { to: '/super-admin/authorized-emails', label: 'Emails Autorizados', icon: <Mail className="w-5 h-5" /> },
          { to: '/super-admin/lifecycle', label: 'Ciclo Lectivo', icon: <GraduationCap className="w-5 h-5" /> },
          { to: '/super-admin/calendar', label: 'Calendario', icon: <Calendar className="w-5 h-5" /> },
          { to: '/super-admin/exams', label: 'Exámenes', icon: <FileText className="w-5 h-5" /> },
          { to: '/super-admin/classes', label: 'Horarios', icon: <Clock className="w-5 h-5" /> },
          { to: '/super-admin/notices', label: 'Avisos', icon: <Megaphone className="w-5 h-5" /> },
          { to: '/super-admin/moderation', label: 'Moderación', icon: <UserX className="w-5 h-5" /> },
          { to: '/super-admin/simulation', label: 'Simulación', icon: <Eye className="w-5 h-5" /> },
          { to: '/super-admin/settings', label: 'Ajustes', icon: <Settings className="w-5 h-5" /> },
        ];
      case 'group_admin':
        return [
          { to: '/admin/calendar', label: 'Calendario', icon: <Calendar className="w-5 h-5" /> },
          { to: '/admin/exams', label: 'Exámenes', icon: <FileText className="w-5 h-5" /> },
          { to: '/admin/classes', label: 'Horarios', icon: <Clock className="w-5 h-5" /> },
          { to: '/admin/notices', label: 'Avisos', icon: <Megaphone className="w-5 h-5" /> },
          { to: '/admin/lifecycle', label: 'Ciclo Lectivo', icon: <GraduationCap className="w-5 h-5" /> },
          { to: '/admin/super-admins', label: 'Super Admins', icon: <ShieldCheck className="w-5 h-5" /> },
          { to: '/admin/moderation', label: 'Baneos', icon: <UserX className="w-5 h-5" /> },
          { to: '/admin/settings', label: 'Ajustes', icon: <Settings className="w-5 h-5" /> },
        ];
      case 'professor':
        return [
          { to: '/professor/calendar', label: 'Calendario', icon: <Calendar className="w-5 h-5" /> },
          { to: '/professor/classes', label: 'Horarios', icon: <Clock className="w-5 h-5" /> },
          { to: '/professor/exams', label: 'Exámenes', icon: <FileText className="w-5 h-5" /> },
          { to: '/professor/messages', label: 'Mensajes / Chat', icon: <MessageSquare className="w-5 h-5" /> },
          { to: '/professor/settings', label: 'Ajustes', icon: <Settings className="w-5 h-5" /> },
        ];
      case 'institutional':
        return [
          { to: '/institutional/lifecycle', label: 'Ciclo Lectivo', icon: <GraduationCap className="w-5 h-5" /> },
          { to: '/institutional/subjects', label: 'Materias', icon: <BookOpen className="w-5 h-5" /> },
          { to: '/institutional/calendar', label: 'Calendario', icon: <Calendar className="w-5 h-5" /> },
          { to: '/institutional/classes', label: 'Horarios', icon: <Clock className="w-5 h-5" /> },
          { to: '/institutional/notices', label: 'Avisos', icon: <Megaphone className="w-5 h-5" /> },
          { to: '/institutional/settings', label: 'Ajustes', icon: <Settings className="w-5 h-5" /> },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems().filter((item) => {
    if (activeGroup?.type === 'general') {
      return !['Calendario', 'Exámenes', 'Horarios'].includes(item.label);
    }
    return true;
  });

  const roleLabels = {
    super_admin: 'Super Admin',
    group_admin: 'Administrador',
    professor: 'Docente',
    institutional: 'Institución',
  };

  return (
    <aside
      className={`
        h-full bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)]
        flex flex-col justify-between relative transition-all duration-300 z-30
        ${isCollapsed ? 'md:w-20' : 'md:w-64'} w-full
        ${className}
      `}
    >
      {/* Toggle button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="
          absolute top-6 -right-3.5 w-7 h-7 rounded-full border border-[var(--color-border)]
          bg-[var(--color-bg-card)] hidden md:flex items-center justify-center text-[var(--color-text-secondary)]
          hover:text-[var(--color-accent)] hover:border-[var(--color-border-hover)] shadow-sm
          cursor-pointer z-40 transition-colors
        "
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Header / Logo */}
      <div className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-[var(--color-accent-muted)] rounded-xl flex-shrink-0">
              <ShieldCheck className="w-6 h-6 text-[var(--color-accent)]" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col animate-fade-in min-w-0">
                <span className="font-bold text-lg text-[var(--color-text-primary)] leading-none truncate">
                  Vectorito
                </span>
                <span className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-semibold mt-1 truncate">
                  Panel Control
                </span>
              </div>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-border-hover)] cursor-pointer md:hidden flex-shrink-0"
              title="Cerrar menú"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation menu */}
      <nav className={`flex-1 ${isCollapsed ? 'px-2' : 'px-4'} py-2 space-y-1.5 overflow-y-auto`}>
        {navItems.map((item, index) => (
          <NavLink
            key={index}
            to={item.to}
            className={({ isActive }) => `
              group flex items-center transition-all duration-150
              ${isCollapsed ? 'justify-center w-12 h-12 rounded-xl mx-auto flex-shrink-0' : 'gap-3 px-4 py-3 rounded-lg text-sm font-medium'}
              ${isActive
                ? 'bg-[var(--color-accent)] shadow-sm'
                : 'hover:bg-[var(--color-bg-card-hover)]'
              }
            `}
          >
            {({ isActive }) => (
              <>
                {React.cloneElement(item.icon as React.ReactElement<any>, {
                  className: `${isCollapsed ? 'w-6 h-6' : 'w-5 h-5'} flex-shrink-0 transition-all ${
                    isActive
                      ? 'text-[var(--color-text-inverse)]'
                      : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
                  }`
                })}
                {!isCollapsed && (
                  <span className={`animate-fade-in ${
                    isActive
                      ? 'text-[var(--color-text-inverse)]'
                      : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
                  }`}>
                    {item.label}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer / User profile */}
      <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-bg-sidebar-footer)]">
        {/* Impersonation Indicator inside Sidebar when collapsed */}
        {impersonation?.active && isCollapsed && (
          <div className="w-full flex justify-center mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] animate-ping" />
          </div>
        )}

        {/* User Info Card */}
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''} mb-4`}>
          <Avatar name={user.name} src={user.avatarUrl} size="sm" />
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 flex-1 animate-fade-in">
              <span className="text-sm font-bold text-[var(--color-text-primary)] truncate">
                {user.name}
              </span>
              <span className="text-xs text-[var(--color-text-tertiary)] truncate">
                {roleLabels[user.role]}
              </span>
            </div>
          )}
        </div>

        {/* Impersonation Info details when active */}
        {!isCollapsed && impersonation?.active && user.role === 'super_admin' && (
          <div className="mb-4 p-3 bg-[var(--color-accent-muted)]/40 border border-[var(--color-accent-muted)] rounded-lg animate-fade-in">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-accent)] font-bold mb-1">
              <Eye className="w-3.5 h-3.5" />
              <span>Simulando Alumno</span>
            </div>
            <p className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
              {impersonation.studentName}
            </p>
            <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
              Cupo: {impersonation.queriesUsed}/{impersonation.dailyQueryLimit} queries
            </p>
          </div>
        )}

        {/* Logout Button */}
        <button
          onClick={logout}
          className={`
            flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-150 w-full text-left
            text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] hover:text-[var(--color-danger)]
            cursor-pointer
            ${isCollapsed ? 'justify-center !p-2' : 'justify-start'}
          `}
          title="Cerrar Sesión"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!isCollapsed && <span className="animate-fade-in whitespace-nowrap">Cerrar Sesión</span>}
        </button>
      </div>
    </aside>
  );
};
