import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { profileRepository } from '../../infrastructure/repositories/instances';
import { FormField } from '../components/molecules/FormField';
import { Button } from '../components/atoms/Button';
import { Badge } from '../components/atoms/Badge';
import { Spinner } from '../components/atoms/Spinner';
import { Settings, User, Mail, Phone, Bell, Eye, Paintbrush, FileText, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export const SettingsPage: React.FC = () => {
  const { user, originalUser, stopImpersonatingStaff } = useAuth();
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(true);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Theme states
  const [selectedTheme, setSelectedTheme] = useState(() => {
    return localStorage.getItem('app_theme') || 'classic-dark';
  });

  const [examColors, setExamColors] = useState(() => {
    const saved = localStorage.getItem('exam_colors');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      evidence: '#10b981',
      abp: '#8b5cf6',
      final: '#ef4444',
      colloquium: '#f59e0b'
    };
  });

  const themesList = [
    {
      id: 'classic-dark',
      name: 'Clásico Oscuro (WhatsApp Vibe)',
      type: 'Oscuro',
      previewBg: '#0a0e17',
      previewCard: '#151f2e',
      previewAccent: '#10b981',
      description: 'Fondo esmeralda/gris oscuro y acentos verdes.'
    },
    {
      id: 'nord-dark',
      name: 'Gris Nórdico (Sleek Slate)',
      type: 'Oscuro',
      previewBg: '#0f172a',
      previewCard: '#1e293b',
      previewAccent: '#6366f1',
      description: 'Fondo azul/grisáceo mate con acentos añil y celeste.'
    },
    {
      id: 'midnight-purple',
      name: 'Violeta de Medianoche (Midnight)',
      type: 'Oscuro',
      previewBg: '#030712',
      previewCard: '#0f111a',
      previewAccent: '#a855f7',
      description: 'Fondo negro puro con acentos morados y magenta.'
    },
    {
      id: 'hillside-dark',
      name: 'Monocromático Cálido (Hillside Dark)',
      type: 'Oscuro',
      previewBg: '#5A4E42',
      previewCard: '#6D5A49',
      previewAccent: '#EED9BE',
      description: 'Gradación armónica de tonos tierra, marrones y arenas.'
    },
    {
      id: 'nordic-accent',
      name: 'Gris Azulado con Acento (Nordic Accent)',
      type: 'Oscuro',
      previewBg: '#2d3e4e',
      previewCard: '#3d5063',
      previewAccent: '#DC9D68',
      description: 'Base fría predominante con un acento naranja ocre.'
    },
    {
      id: 'emerald-light',
      name: 'Esmeralda Claro (Light Emerald)',
      type: 'Claro',
      previewBg: '#f8fafc',
      previewCard: '#ffffff',
      previewAccent: '#10b981',
      description: 'Fondo blanco/gris claro con textos oscuros y acentos verdes.'
    },
    {
      id: 'oceanic-light',
      name: 'Océano Claro (Light Ocean)',
      type: 'Claro',
      previewBg: '#f0f4f8',
      previewCard: '#ffffff',
      previewAccent: '#2563eb',
      description: 'Fondo azul claro suave con textos oscuros y acentos azul rey.'
    },
    {
      id: 'urban-light',
      name: 'Diagramación Urbana (Urban Light)',
      type: 'Claro',
      previewBg: '#F0DED0',
      previewCard: '#F7EBE1',
      previewAccent: '#A67C52',
      description: 'Estética clara otoñal en tonos sienna, beige y madera.'
    }
  ];

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await profileRepository.getSettings();
        setName(data.name || '');
        setEmail(data.email || '');
        setPhone(data.phone || '');
        setNotifyEmail(data.notifyEmail !== false);
        setNotifyWhatsapp(data.notifyWhatsapp !== false);
      } catch (e) {
        toast.error('Error al cargar la configuración del perfil.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, [user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await profileRepository.updateSettings({
        name,
        email,
        phone: user?.role === 'professor' ? phone : undefined,
        notifyEmail: user?.role === 'professor' ? notifyEmail : undefined,
        notifyWhatsapp: user?.role === 'professor' ? notifyWhatsapp : undefined,
      });
      toast.success('Configuración guardada correctamente.');
    } catch (e) {
      toast.error('Error al guardar la configuración.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleThemeChange = (themeId: string) => {
    setSelectedTheme(themeId);
    localStorage.setItem('app_theme', themeId);
    document.body.className = '';
    document.body.classList.add(`theme-${themeId}`);
    toast.success('Paleta visual aplicada con éxito.');
  };

  const handleColorChange = (key: string, color: string) => {
    const newColors = { ...examColors, [key]: color };
    setExamColors(newColors);
    localStorage.setItem('exam_colors', JSON.stringify(newColors));
    window.dispatchEvent(new Event('exam-colors-updated'));
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      {/* Simulation Banner inside Settings */}
      {originalUser && (
        <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in shadow-sm">
          <div className="flex gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-500 rounded-lg h-fit">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Modo Simulación Activo</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Estás configurando los ajustes de: <strong className="text-[var(--color-text-primary)]">{name}</strong> ({email}).
              </p>
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={stopImpersonatingStaff}>
            Volver a mi Perfil de Super Admin
          </Button>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {/* Profile Settings Form */}
        <div className="md:col-span-2 p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[var(--color-border)]">
            <div className="p-2 bg-[var(--color-accent-muted)] text-[var(--color-accent)] rounded-lg">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--color-text-primary)]">Datos de Perfil</h2>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Administrá tu información básica y preferencias de avisos.</p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <FormField
                label="Nombre Completo"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre"
                required
                icon={<User className="w-4 h-4" />}
              />
              <FormField
                label="Email Institucional"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@ejemplo.com"
                required
                icon={<Mail className="w-4 h-4" />}
              />
            </div>

            {/* Professor specific settings */}
            {user?.role === 'professor' && (
              <div className="p-5 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)] rounded-xl space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-[var(--color-border)]">
                  <Bell className="w-4 h-4 text-[var(--color-accent)]" />
                  <span className="text-xs font-bold text-[var(--color-text-primary)]">Preferencias de Notificaciones (Docente)</span>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <FormField
                    label="Teléfono WhatsApp (Formato Internacional)"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ej: +5493512345678"
                    icon={<Phone className="w-4 h-4" />}
                  />
                </div>
                
                <p className="text-[11px] text-[var(--color-text-tertiary)] leading-relaxed">
                  Para recibir alertas sobre réplicas de alumnos, asegurate de cargar tu número de teléfono con el código de país.
                </p>

                <div className="flex flex-col gap-3 pt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyEmail}
                      onChange={(e) => setNotifyEmail(e.target.checked)}
                      className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Recibir notificaciones por Email</span>
                  </label>
                  
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyWhatsapp}
                      onChange={(e) => setNotifyWhatsapp(e.target.checked)}
                      className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Recibir digest de respuestas por WhatsApp (cada 15 min)</span>
                  </label>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving ? 'Guardando...' : 'Guardar Ajustes'}
              </Button>
            </div>
          </form>
        </div>

        {/* User Card info summary */}
        <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">Mi Credencial</span>
            
            <div className="space-y-2">
              <h4 className="text-base font-bold text-[var(--color-text-primary)]">{name}</h4>
              <Badge variant={user?.role === 'super_admin' ? 'accent' : 'info'}>
                {user?.role === 'super_admin' ? 'Super Admin' : user?.role === 'group_admin' ? 'Administrador' : user?.role === 'professor' ? 'Docente' : 'Institucional'}
              </Badge>
            </div>

            <div className="space-y-2 pt-4 border-t border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
              <div className="flex justify-between">
                <span>Email:</span>
                <span className="font-bold text-[var(--color-text-primary)]">{email}</span>
              </div>
              {user?.role === 'professor' && (
                <div className="flex justify-between">
                  <span>WhatsApp:</span>
                  <span className="font-bold text-[var(--color-text-primary)]">{phone || 'No asignado'}</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="pt-6 border-t border-[var(--color-border)] flex items-center gap-2 text-[var(--color-success)] text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Panel Operativo</span>
          </div>
        </div>
      </div>

      {/* Theme selection card */}
      <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-[var(--color-border)]">
          <div className="p-2 bg-[var(--color-accent-muted)] text-[var(--color-accent)] rounded-lg">
            <Paintbrush className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">Personalización del Entorno</h3>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Elegí la paleta de colores del panel web.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {themesList.map((theme) => (
            <button
              key={theme.id}
              onClick={() => handleThemeChange(theme.id)}
              className={`group text-left p-4 rounded-xl border transition-all duration-150 relative flex flex-col justify-between gap-3 cursor-pointer ${
                selectedTheme === theme.id
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]/20 shadow-sm ring-1 ring-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-sidebar)] hover:bg-[var(--color-bg-card-hover)]'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[var(--color-text-primary)]">{theme.name}</span>
                  <Badge variant={theme.type === 'Oscuro' ? 'accent' : 'info'}>{theme.type}</Badge>
                </div>
                <p className="text-xs text-[var(--color-text-tertiary)] leading-relaxed group-hover:text-[var(--color-text-secondary)]">
                  {theme.description}
                </p>
              </div>

              {/* Colors preview */}
              <div className="flex items-center gap-3 mt-1">
                <div className="flex items-center -space-x-1.5">
                  <div className="w-5 h-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: theme.previewBg }} />
                  <div className="w-5 h-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: theme.previewCard }} />
                  <div className="w-5 h-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: theme.previewAccent }} />
                </div>
                <span className="text-[10px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider group-hover:text-[var(--color-text-secondary)]">
                  Vista Previa
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Exam Colors (Only for super_admin or admin roles) */}
      {(user?.role === 'super_admin' || user?.role === 'group_admin') && (
        <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[var(--color-border)]">
            <div className="p-2 bg-[var(--color-accent-muted)] text-[var(--color-accent)] rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">Colores de Exámenes</h3>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Definí el tono visual para los distintos tipos de examen en el calendario.</p>
            </div>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { id: 'evidence', name: 'Evidencia (TPs)' },
              { id: 'abp', name: 'Defensa ABP' },
              { id: 'final', name: 'Examen Final' },
              { id: 'colloquium', name: 'Coloquio' }
            ].map((item) => (
              <div key={item.id} className="flex flex-col gap-2.5 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]">
                <span className="text-xs font-bold text-[var(--color-text-primary)]">{item.name}</span>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={examColors[item.id as keyof typeof examColors] || '#10b981'}
                    onChange={(e) => handleColorChange(item.id, e.target.value)}
                    className="w-10 h-10 rounded-lg border border-[var(--color-border)] cursor-pointer bg-transparent"
                  />
                  <span className="text-xs font-mono text-[var(--color-text-secondary)] uppercase font-semibold">
                    {examColors[item.id as keyof typeof examColors]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
export default SettingsPage;
