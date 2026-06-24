import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { User, Group, ImpersonationProfile } from '../../domain/entities';
import { loginUseCase, impersonateStudentUseCase, groupRepository } from '../../infrastructure/repositories/instances';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  activeGroup: Group | null;
  groups: Group[];
  impersonation: ImpersonationProfile | null;
  otpDebug: string | null;
  originalUser: User | null;
  requestOTP: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyOTP: (email: string, code: string) => Promise<boolean>;
  logout: () => void;
  setActiveGroup: (group: Group) => void;
  refreshImpersonation: () => void;
  activateImpersonation: (profile: Omit<ImpersonationProfile, 'active' | 'queriesUsed'>) => void;
  deactivateImpersonation: () => void;
  updateImpersonationQueryLimit: (limit: number) => void;
  resetImpersonationQueries: () => void;
  setImpersonationCommission: (commissionId: string, commissionName: string) => void;
  impersonateStaff: (email: string) => Promise<void>;
  stopImpersonatingStaff: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<User | null>(null);
  const [activeGroup, setActiveGroupState] = useState<Group | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [impersonation, setImpersonation] = useState<ImpersonationProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [otpDebug, setOtpDebug] = useState<string | null>(null);
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  
  const inactivityTimerRef = useRef<number | null>(null);

  // Redirect if general group is active on incompatible tabs
  useEffect(() => {
    if (activeGroup?.type === 'general') {
      const pathname = location.pathname;
      const isIncompatible = pathname.includes('/calendar') || pathname.includes('/exams') || pathname.includes('/classes');
      
      if (isIncompatible) {
        if (user?.role === 'super_admin') {
          navigate('/super-admin/groups');
        } else if (user?.role === 'group_admin') {
          navigate('/admin/notices');
        } else if (user?.role === 'professor') {
          navigate('/professor/messages');
        } else if (user?.role === 'institutional') {
          navigate('/institutional/notices');
        }
      }
    }
  }, [activeGroup, location.pathname, user, navigate]);

  // Initialize session
  useEffect(() => {
    const session = loginUseCase.getSession();
    if (session) {
      let currentUser = session.user;
      const savedSimulated = localStorage.getItem('simulated_user');
      const savedOriginal = localStorage.getItem('original_user');
      if (savedSimulated) {
        try {
          currentUser = JSON.parse(savedSimulated);
        } catch {}
      }
      if (savedOriginal) {
        try {
          setOriginalUser(JSON.parse(savedOriginal));
        } catch {}
      }
      setUser(currentUser);
      
      // Load groups this user has access to
      groupRepository.getAll().then((allGroups) => {
        const userGroups = (currentUser.role === 'super_admin' || currentUser.role === 'institutional')
          ? allGroups 
          : allGroups.filter((g) => currentUser.groupIds.includes(g.id));
        setGroups(userGroups);
        
        // Restore active group from storage or default to first
        const savedGroupId = localStorage.getItem('active_group_id');
        const defaultGroup = userGroups.find((g) => g.id === savedGroupId) || userGroups[0] || null;
        setActiveGroupState(defaultGroup);
        if (defaultGroup) {
          localStorage.setItem('active_group_id', defaultGroup.id);
        }
      });

      // Load impersonation profile
      setImpersonation(impersonateStudentUseCase.getProfile());
      
      // Setup activity listeners
      setupActivityListeners();
      resetInactivityTimer();
    }
    
    setIsLoading(false);

    return () => {
      clearInactivityTimer();
      removeActivityListeners();
    };
  }, []);

  const clearInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      window.clearTimeout(inactivityTimerRef.current);
    }
  };

  const resetInactivityTimer = () => {
    clearInactivityTimer();
    if (loginUseCase.isSessionValid()) {
      // Set timer for remaining time or default check interval
      // 2h inactivity timeout (handled inside LoginUseCase too)
      inactivityTimerRef.current = window.setTimeout(() => {
        if (!loginUseCase.isSessionValid()) {
          toast.warning('Sesión expirada por inactividad.');
          handleLogout();
        } else {
          resetInactivityTimer();
        }
      }, 60000); // Check every minute
    }
  };

  const handleActivity = () => {
    if (loginUseCase.isSessionValid()) {
      loginUseCase.refreshActivity();
      resetInactivityTimer();
    }
  };

  const setupActivityListeners = () => {
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);
  };

  const removeActivityListeners = () => {
    window.removeEventListener('mousemove', handleActivity);
    window.removeEventListener('keydown', handleActivity);
    window.removeEventListener('click', handleActivity);
    window.removeEventListener('scroll', handleActivity);
  };

  const handleLogout = () => {
    loginUseCase.logout();
    localStorage.removeItem('simulated_user');
    localStorage.removeItem('original_user');
    setOriginalUser(null);
    setUser(null);
    setActiveGroupState(null);
    setGroups([]);
    setImpersonation(null);
    setOtpDebug(null);
    clearInactivityTimer();
    removeActivityListeners();
  };

  const requestOTP = async (email: string) => {
    const res = await loginUseCase.requestOTP(email);
    if (res.success) {
      setOtpDebug(res.debugCode || null);
    }
    return res;
  };

  const verifyOTP = async (email: string, code: string) => {
    const session = await loginUseCase.verifyOTP(email, code);
    if (session) {
      setUser(session.user);
      
      const allGroups = await groupRepository.getAll();
      const userGroups = (session.user.role === 'super_admin' || session.user.role === 'institutional')
        ? allGroups 
        : allGroups.filter((g) => session.user.groupIds.includes(g.id));
      setGroups(userGroups);
      
      const defaultGroup = userGroups[0] || null;
      setActiveGroupState(defaultGroup);
      if (defaultGroup) {
        localStorage.setItem('active_group_id', defaultGroup.id);
      }

      setImpersonation(impersonateStudentUseCase.getProfile());
      setupActivityListeners();
      resetInactivityTimer();
      return true;
    }
    return false;
  };

  const setActiveGroup = (group: Group) => {
    setActiveGroupState(group);
    localStorage.setItem('active_group_id', group.id);
  };

  const refreshImpersonation = () => {
    setImpersonation(impersonateStudentUseCase.getProfile());
  };

  const activateImpersonation = (profile: Omit<ImpersonationProfile, 'active' | 'queriesUsed'>) => {
    const activeProfile = impersonateStudentUseCase.activate(profile);
    setImpersonation(activeProfile);
    toast.success(`Simulación activada: ${profile.studentName}`);
  };

  const deactivateImpersonation = () => {
    impersonateStudentUseCase.deactivate();
    setImpersonation(null);
    toast.info('Simulación desactivada');
  };

  const updateImpersonationQueryLimit = (limit: number) => {
    impersonateStudentUseCase.setDailyQueryLimit(limit);
    refreshImpersonation();
  };

  const resetImpersonationQueries = () => {
    impersonateStudentUseCase.resetQueries();
    refreshImpersonation();
    toast.success('Límite de consultas diarias reiniciado');
  };

  const setImpersonationCommission = (commissionId: string, commissionName: string) => {
    impersonateStudentUseCase.setCommission(commissionId, commissionName);
    refreshImpersonation();
    toast.success(`Comisión cambiada a: ${commissionName}`);
  };

  const impersonateStaff = async (email: string) => {
    try {
      if (!localStorage.getItem('original_user') && user) {
        localStorage.setItem('original_user', JSON.stringify(user));
        setOriginalUser(user);
      }
      
      localStorage.setItem('simulated_user', JSON.stringify({ email }));

      const { profileRepository } = await import('../../infrastructure/repositories/instances');
      const fetchedUser = await profileRepository.getProfileMe();

      localStorage.setItem('simulated_user', JSON.stringify(fetchedUser));
      setUser(fetchedUser);

      const allGroups = await groupRepository.getAll();
      const userGroups = (fetchedUser.role === 'super_admin' || fetchedUser.role === 'institutional')
        ? allGroups 
        : allGroups.filter((g) => fetchedUser.groupIds.includes(g.id));
      setGroups(userGroups);
      
      const defaultGroup = userGroups[0] || null;
      setActiveGroupState(defaultGroup);
      if (defaultGroup) {
        localStorage.setItem('active_group_id', defaultGroup.id);
      }

      toast.success(`Simulando a: ${fetchedUser.name} (${fetchedUser.role})`);
    } catch (e) {
      toast.error('Error al iniciar la simulación.');
      localStorage.removeItem('simulated_user');
      localStorage.removeItem('original_user');
      setOriginalUser(null);
      const session = loginUseCase.getSession();
      setUser(session ? session.user : null);
    }
  };

  const stopImpersonatingStaff = () => {
    const origUserStr = localStorage.getItem('original_user');
    if (origUserStr) {
      const origUser = JSON.parse(origUserStr);
      localStorage.removeItem('original_user');
      localStorage.removeItem('simulated_user');
      setOriginalUser(null);
      setUser(origUser);

      groupRepository.getAll().then((allGroups) => {
        const userGroups = allGroups;
        setGroups(userGroups);
        
        const savedGroupId = localStorage.getItem('active_group_id');
        const defaultGroup = userGroups.find((g) => g.id === savedGroupId) || userGroups[0] || null;
        setActiveGroupState(defaultGroup);
        if (defaultGroup) {
          localStorage.setItem('active_group_id', defaultGroup.id);
        }
      });

      toast.info('Simulación finalizada');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        activeGroup,
        groups,
        impersonation,
        otpDebug,
        originalUser,
        requestOTP,
        verifyOTP,
        logout: handleLogout,
        setActiveGroup,
        refreshImpersonation,
        activateImpersonation,
        deactivateImpersonation,
        updateImpersonationQueryLimit,
        resetImpersonationQueries,
        setImpersonationCommission,
        impersonateStaff,
        stopImpersonatingStaff,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
