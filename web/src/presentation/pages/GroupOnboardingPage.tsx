import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/atoms/Button';
import { FormField } from '../components/molecules/FormField';
import { DropdownSelector } from '../components/molecules/DropdownSelector';
import { Spinner } from '../components/atoms/Spinner';
import { Building2, Save, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export const GroupOnboardingPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const urlGroupId = searchParams.get('group_id') || '';

  const [isValidating, setIsValidating] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('¡Bienvenidos al grupo de cursada!');
  const [year, setYear] = useState('1');
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsValidating(false);
        return;
      }
      try {
        const res = await fetch(`/api/onboarding/validate?token=${token}`);
        if (!res.ok) {
          throw new Error('Token inválido');
        }
        const data = await res.json();
        if (data.success && data.groupId) {
          setGroupId(data.groupId);
          // Fetch group display name
          const groupRes = await fetch('/api/groups');
          if (groupRes.ok) {
            const groups = await groupRes.json();
            const matched = groups.find((g: any) => g.id === data.groupId);
            if (matched) {
              setGroupName(matched.name);
            } else {
              setGroupName(data.groupId);
            }
          }
        }
      } catch (e) {
        toast.error('Token de onboarding inválido o vencido.');
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId) return;

    setIsSaving(true);
    try {
      // 1. Update group configurations
      const updateRes = await fetch(`/api/groups/${groupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` // Token behaves as temporary Bearer
        },
        body: JSON.stringify({
          name: groupName,
          entryYear: Number(year),
          config: {
            welcomeMessage
          }
        })
      });

      if (!updateRes.ok) {
        throw new Error('Error al actualizar el grupo.');
      }

      // 2. Complete onboarding
      const completeRes = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ groupId, token })
      });

      if (!completeRes.ok) {
        throw new Error('Error al finalizar onboarding.');
      }

      toast.success('¡Configuración guardada y grupo activado con éxito!');
      setIsCompleted(true);
    } catch (err: any) {
      toast.error(err.message || 'Error al completar la configuración.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isValidating) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
        <Spinner size="lg" />
        <p className="mt-4 text-sm font-semibold text-[var(--color-text-secondary)]">Validando token de acceso seguro...</p>
      </div>
    );
  }

  if (!groupId) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] p-4">
        <div className="w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl shadow-xl p-8 text-center flex flex-col items-center gap-4">
          <AlertTriangle className="w-16 h-16 text-red-500" />
          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Token Inválido o Vencido</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] leading-relaxed">
            El enlace de acceso que utilizaste ya no es válido o ha expirado. Por favor, solicita un nuevo enlace de configuración desde el bot de WhatsApp enviando *!config-grupo*.
          </p>
          <Button variant="primary" onClick={() => navigate('/login')} className="mt-4 w-full">
            Ir al Login del Panel
          </Button>
        </div>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] p-4">
        <div className="w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl shadow-xl p-8 text-center flex flex-col items-center gap-4">
          <CheckCircle className="w-16 h-16 text-emerald-500" />
          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">¡Configuración Exitosa!</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] leading-relaxed">
            El grupo *{groupName}* ha sido configurado y activado. A partir de ahora, Vectorito comenzará a interactuar con los alumnos y responderá sus consultas de cursado.
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] italic bg-[var(--color-bg-app)] p-3 border border-[var(--color-border)] rounded-lg w-full">
            Podés cerrar esta pestaña o ir al panel principal si ya tenés un usuario registrado.
          </p>
          <Button variant="primary" onClick={() => navigate('/login')} className="mt-4 w-full">
            Ir al Panel Principal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-8 py-6 border-b border-[var(--color-border)] bg-[var(--color-bg-sidebar)] flex items-center gap-4">
          <div className="p-3 bg-[var(--color-accent-muted)]/30 rounded-xl text-[var(--color-accent)]">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[var(--color-text-primary)]">Configuración Inicial del Grupo</h1>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Asociá las materias, profesores y configurá la bienvenida.</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-4">
            <FormField
              label="Nombre Visible del Grupo"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Ej: 1er Año Tecnicatura Desarrollo IA"
              required
            />

            <DropdownSelector
              label="Año de Cursada de los Alumnos"
              options={[
                { value: '1', label: '1er Año (Ingresantes)' },
                { value: '2', label: '2do Año' },
                { value: '3', label: '3er Año (Próximos a egresar)' }
              ]}
              selectedValue={year}
              onChange={setYear}
              required
            />

            <FormField
              label="Mensaje de Bienvenida del Grupo"
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="Escribí un mensaje cálido de bienvenida para el inicio de clases..."
              isTextArea
              rows={4}
              required
            />
          </div>

          <div className="border-t border-[var(--color-border)] pt-6 flex justify-end gap-3">
            <Button
              variant="primary"
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2"
            >
              {isSaving ? (
                <Spinner size="sm" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Guardar y Activar Grupo
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
export default GroupOnboardingPage;
