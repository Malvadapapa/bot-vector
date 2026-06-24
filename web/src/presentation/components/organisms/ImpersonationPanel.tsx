import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { groupRepository, adminRepository, impersonationRepository } from '../../../infrastructure/repositories/instances';
import type { SimulatedStudent, Cohort } from '../../../domain/entities';
import { DropdownSelector } from '../molecules/DropdownSelector';
import { FormField } from '../molecules/FormField';
import { Button } from '../atoms/Button';
import { Toggle } from '../atoms/Toggle';
import { Eye, RefreshCw, Smartphone, Users, UserCheck, Megaphone } from 'lucide-react';
import { toast } from 'sonner';

export const ImpersonationPanel: React.FC = () => {
  const {
    user,
    originalUser,
    impersonateStaff,
    stopImpersonatingStaff,
    activeGroup,
    impersonation,
    activateImpersonation,
    deactivateImpersonation,
    updateImpersonationQueryLimit,
    resetImpersonationQueries,
    setImpersonationCommission,
  } = useAuth();

  const [students, setStudents] = useState<SimulatedStudent[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedCommissionId, setSelectedCommissionId] = useState('');
  const [queryLimit, setQueryLimit] = useState(20);

  // Staff simulation states
  const [staffQuery, setStaffQuery] = useState('');
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [isStaffSearching, setIsStaffSearching] = useState(false);

  // Simulated Alert Trigger states
  const [alertGroups, setAlertGroups] = useState<any[]>([]);
  const [alertSubjects, setAlertSubjects] = useState<any[]>([]);
  const [selectedAlertGroupId, setSelectedAlertGroupId] = useState('');
  const [selectedAlertSubjectId, setSelectedAlertSubjectId] = useState('');
  const [alertType, setAlertType] = useState<'examen' | 'clase' | 'ciclo_lectivo'>('examen');
  const [examVariant, setExamVariant] = useState<'evidence' | 'abp' | 'final' | 'colloquium'>('evidence');
  const [alertTiming, setAlertTiming] = useState('franja-start');
  const [isTriggering, setIsTriggering] = useState(false);

  useEffect(() => {
    groupRepository.getAll().then(setAlertGroups).catch(() => {});
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    fetch('/api/subjects/preseeded', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then((res) => {
        if (res.ok) return res.json();
        return [];
      })
      .then((data) => {
        setAlertSubjects(data);
      })
      .catch(() => {});
  }, []);

  const handleTriggerAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlertGroupId) {
      toast.error('Por favor, seleccioná un grupo destino de WhatsApp.');
      return;
    }
    if (alertType !== 'ciclo_lectivo' && !selectedAlertSubjectId) {
      toast.error('Por favor, seleccioná una materia asociada.');
      return;
    }

    setIsTriggering(true);
    try {
      const res = await impersonationRepository.triggerSimulatedAlert({
        alertType,
        variant: alertType === 'examen' ? examVariant : undefined,
        timing: alertTiming,
        subjectId: alertType !== 'ciclo_lectivo' ? selectedAlertSubjectId : undefined,
        groupId: selectedAlertGroupId
      });

      if (res.success) {
        toast.success('¡Alerta de prueba enviada con éxito!');
      } else {
        toast.error('Fallo al disparar la alerta.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al disparar alerta de prueba.');
    } finally {
      setIsTriggering(false);
    }
  };

  // Load students and cohorts for the active group
  useEffect(() => {
    if (activeGroup) {
      groupRepository.getStudents(activeGroup.id)
        .then((loadedStudents) => {
          setStudents(loadedStudents);
          if (loadedStudents.length > 0) {
            setSelectedStudentId(loadedStudents[0].id);
          } else {
            setSelectedStudentId('');
          }
        })
        .catch(() => {});
      groupRepository.getCohorts(activeGroup.id).then(setCohorts).catch(() => {});
      setSelectedCommissionId('');
    }
  }, [activeGroup]);

  // Automatically select the first commission for the selected student
  useEffect(() => {
    if (selectedStudentId && !selectedCommissionId && !impersonation?.active) {
      const student = students.find((s) => s.id === selectedStudentId);
      if (student) {
        const cohort = cohorts.find((c) => c.id === student.cohortId);
        if (cohort && cohort.commissions && cohort.commissions.length > 0) {
          setSelectedCommissionId(cohort.commissions[0].id);
        }
      }
    }
  }, [selectedStudentId, cohorts, students, impersonation, selectedCommissionId]);

  // Sync state with active impersonation profile
  useEffect(() => {
    if (impersonation?.active) {
      const student = students.find((s) => s.phone === impersonation.studentPhone);
      if (student) {
        setSelectedStudentId(student.id);
      }
      setSelectedCommissionId(impersonation.commissionId || '');
      setQueryLimit(impersonation.dailyQueryLimit);
    }
  }, [impersonation, students]);

  const studentOptions = students.map((s) => {
    const cohort = cohorts.find((c) => c.id === s.cohortId);
    return {
      value: s.id,
      label: s.name,
      sublabel: `Tel: ${s.phone} ${cohort ? `| Cohorte: ${cohort.name}` : ''}`,
    };
  });

  const getCommissionOptions = () => {
    if (!selectedStudentId) return [];
    const student = students.find((s) => s.id === selectedStudentId);
    if (!student) return [];

    const cohort = cohorts.find((c) => c.id === student.cohortId);
    if (!cohort || !cohort.commissions) return [];

    return cohort.commissions.map((c) => ({
      value: c.id,
      label: c.name,
    }));
  };

  const handleToggleActive = (checked: boolean) => {
    if (checked) {
      if (!selectedStudentId) {
        toast.error('No hay alumnos registrados en este grupo para simular.');
        return;
      }
      const student = students.find((s) => s.id === selectedStudentId);
      if (!student) return;

      const cohort = cohorts.find((c) => c.id === student.cohortId);
      const commissionList = cohort?.commissions || [];
      const commission = commissionList.find((c) => c.id === selectedCommissionId) || commissionList[0];

      groupRepository.getSubjectsByCohort(student.cohortId).then((subjects) => {
        activateImpersonation({
          studentName: student.name,
          studentPhone: student.phone,
          cohortId: student.cohortId,
          cohortName: cohort?.name || 'Cohorte',
          commissionId: commission?.id,
          commissionName: commission?.name,
          dailyQueryLimit: queryLimit,
          subjectIds: subjects.map((s) => s.id),
        });
      });
    } else {
      deactivateImpersonation();
    }
  };

  const handleCommissionChange = (commId: string) => {
    setSelectedCommissionId(commId);
    if (impersonation?.active) {
      const commOptions = getCommissionOptions();
      const commOpt = commOptions.find((c) => c.value === commId);
      if (commOpt) {
        setImpersonationCommission(commId, commOpt.label);
      }
    }
  };

  const handleUpdateLimit = (e: React.FormEvent) => {
    e.preventDefault();
    if (impersonation?.active) {
      updateImpersonationQueryLimit(queryLimit);
      toast.success(`Límite diario actualizado a ${queryLimit} consultas.`);
    } else {
      toast.info('Activá la simulación para aplicar el nuevo límite.');
    }
  };

  const handleStaffSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffQuery.trim()) return;
    setIsStaffSearching(true);
    try {
      const list = await adminRepository.searchUsers(staffQuery);
      setStaffResults(list);
      if (list.length === 0) {
        toast.info('No se encontraron usuarios registrados con ese término.');
      }
    } catch {
      toast.error('Error al buscar usuarios.');
    } finally {
      setIsStaffSearching(false);
    }
  };

  const handleStartStaffSimulation = async (email: string) => {
    await impersonateStaff(email);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-3">
        {/* Simulation form configuration */}
        <div className="md:col-span-2 p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[var(--color-accent-muted)] rounded-xl text-[var(--color-accent)]">
                <Eye className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                  Simulación de Alumnos
                </h3>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  Probar el comportamiento del chatbot respondiendo como si fueras un alumno.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                {impersonation?.active ? 'Activo' : 'Inactivo'}
              </span>
              <Toggle checked={!!impersonation?.active} onChange={handleToggleActive} />
            </div>
          </div>

          <div className="max-w-md">
            <DropdownSelector
              label="Comisión Asignada (Temporal)"
              options={getCommissionOptions()}
              selectedValue={selectedCommissionId}
              onChange={handleCommissionChange}
              placeholder={selectedStudentId ? "Seleccionar comisión" : "No hay comisiones disponibles"}
              disabled={!selectedStudentId}
            />
          </div>

          <form onSubmit={handleUpdateLimit} className="p-5 border border-[var(--color-border)] bg-[var(--color-bg-sidebar)] rounded-xl flex flex-col sm:flex-row sm:items-end gap-4">
            <FormField
              label="Límite Diario de Consultas (AI)"
              type="number"
              min={0}
              max={500}
              value={queryLimit}
              onChange={(e) => setQueryLimit(Number(e.target.value))}
              className="sm:w-48"
            />
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" type="submit" className="flex-1 sm:flex-none">
                Guardar Límite
              </Button>
              {impersonation?.active && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={resetImpersonationQueries}
                  className="flex-1 sm:flex-none text-[var(--color-success)] hover:bg-[var(--color-success)]/10"
                >
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                  Reiniciar Consultas
                </Button>
              )}
            </div>
          </form>
        </div>

        {/* Simulated Student Live Dashboard card */}
        <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex flex-col justify-between relative overflow-hidden">
          {impersonation?.active ? (
            <>
              <div className="space-y-4">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">
                  Ficha Técnica Simulación
                </span>
                
                <div className="flex items-center gap-3">
                  <Smartphone className="w-10 h-10 text-[var(--color-text-secondary)] bg-[var(--color-bg-sidebar)] p-2 rounded-lg border border-[var(--color-border)]" />
                  <div>
                    <h4 className="text-sm font-bold text-[var(--color-text-primary)]">
                      {impersonation.studentName}
                    </h4>
                    <span className="text-xs text-[var(--color-text-tertiary)] flex items-center mt-0.5">
                      WhatsApp: {impersonation.studentPhone}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                  <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                    <span>Cohorte:</span>
                    <span className="font-bold text-[var(--color-text-primary)]">{impersonation.cohortName}</span>
                  </div>
                  <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                    <span>Comisión:</span>
                    <span className="font-bold text-[var(--color-text-primary)]">
                      {impersonation.commissionName || 'Ninguna'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                    <span>Materias Habilitadas:</span>
                    <span className="font-bold text-[var(--color-text-primary)]">
                      {impersonation.subjectIds.length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--color-border)] space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] mb-1">
                  <span>Cupo Consultas WhatsApp AI:</span>
                  <span className="font-bold text-[var(--color-text-primary)]">
                    {impersonation.queriesUsed} / {impersonation.dailyQueryLimit}
                  </span>
                </div>
                <div className="w-full bg-[var(--color-border)] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[var(--color-accent)] h-full transition-all duration-300"
                    style={{
                      width: `${Math.min((impersonation.queriesUsed / impersonation.dailyQueryLimit) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-[var(--color-text-tertiary)]">
              <Eye className="w-12 h-12 text-[var(--color-border)] mb-3" />
              <h4 className="text-sm font-bold text-[var(--color-text-secondary)]">Simulación Inactiva</h4>
              <p className="text-xs mt-1.5 max-w-[200px] leading-relaxed">
                Hacé click en el switch de arriba para iniciar la simulación de alumnos.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Staff Simulation Card */}
      <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--color-accent-muted)] rounded-xl text-[var(--color-accent)]">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                Simulación de Personal (Docentes y Administradores)
              </h3>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                Ingresá temporalmente al panel de cualquier otro docente o administrador para operar en su lugar sobre datos reales.
              </p>
            </div>
          </div>
          {originalUser && (
            <Button variant="danger" size="sm" onClick={stopImpersonatingStaff}>
              Detener Simulación
            </Button>
          )}
        </div>

        {originalUser ? (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3 animate-fade-in">
            <UserCheck className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-sm font-bold text-[var(--color-text-primary)]">
                Simulación en Curso
              </p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Estás visualizando el sistema como <strong>{user?.name}</strong> ({user?.email}).
                Para regresar a tu perfil de Super Admin, presioná el botón "Detener Simulación".
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-1 flex flex-col gap-4">
              <form onSubmit={handleStaffSearchSubmit} className="flex gap-2">
                <FormField
                  label="Buscar por Nombre o Email"
                  value={staffQuery}
                  onChange={(e) => setStaffQuery(e.target.value)}
                  placeholder="Ej: Tatiana, Ramiro..."
                  className="flex-1"
                  required
                />
                <Button variant="primary" type="submit" className="self-end" disabled={isStaffSearching}>
                  {isStaffSearching ? '...' : 'Buscar'}
                </Button>
              </form>
            </div>

            <div className="md:col-span-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] block mb-3">
                Resultados de Búsqueda
              </span>

              {staffResults.length === 0 ? (
                <div className="h-24 border border-dashed border-[var(--color-border)] rounded-xl flex items-center justify-center text-xs text-[var(--color-text-tertiary)] italic">
                  Escribí un nombre o correo institucional para buscar personal.
                </div>
              ) : (
                <div className="border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border)] bg-[var(--color-bg-sidebar)]">
                  {staffResults.map((item) => (
                    <div key={item.userId} className="p-4 flex items-center justify-between hover:bg-[var(--color-bg-card)] transition-colors">
                      <div>
                        <p className="text-sm font-bold text-[var(--color-text-primary)]">{item.name}</p>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{item.email}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => handleStartStaffSimulation(item.email)}>
                        Simular Panel
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Test Alert Trigger Section */}
      <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
        <div className="flex items-center pb-4 border-b border-[var(--color-border)]">
          <div className="p-2.5 bg-[var(--color-accent-muted)] rounded-xl text-[var(--color-accent)]">
            <Megaphone className="w-5 h-5" />
          </div>
          <div className="ml-3">
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">
              Disparador de Alertas de Prueba (WhatsApp)
            </h3>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              Simulá el envío de avisos inteligentes de clases, exámenes y eventos académicos para probar su redacción en tus grupos de WhatsApp.
            </p>
          </div>
        </div>

        <form onSubmit={handleTriggerAlert} className="grid gap-6 md:grid-cols-3">
          <div className="space-y-4">
            <DropdownSelector
              label="Tipo de Alerta"
              options={[
                { value: 'examen', label: 'Alerta de Examen' },
                { value: 'clase', label: 'Alerta de Clase' },
                { value: 'ciclo_lectivo', label: 'Ciclo Lectivo' }
              ]}
              selectedValue={alertType}
              onChange={(val) => {
                setAlertType(val as any);
                if (val === 'examen') setAlertTiming('franja-start');
                else if (val === 'clase') setAlertTiming('clase-10m');
                else setAlertTiming('welcome');
              }}
            />

            {alertType === 'examen' && (
              <DropdownSelector
                label="Variante de Examen"
                options={[
                  { value: 'evidence', label: 'Evidencia de Aprendizaje' },
                  { value: 'abp', label: 'Defensa ABP' },
                  { value: 'final', label: 'Examen Final' },
                  { value: 'colloquium', label: 'Coloquio' }
                ]}
                selectedValue={examVariant}
                onChange={(val) => setExamVariant(val as any)}
              />
            )}
          </div>

          <div className="space-y-4">
            <DropdownSelector
              label="Momento / Timing"
              options={
                alertType === 'examen'
                  ? [
                      { value: 'franja-start', label: 'Inicio de Franja Horaria' },
                      { value: 'franja-end', label: 'Cierre de Franja Horaria' },
                      { value: 'recordatorio-7d', label: 'Recordatorio (7 días antes)' },
                      { value: 'recordatorio-3d', label: 'Recordatorio (3 días antes)' },
                      { value: 'recordatorio-1d', label: 'Recordatorio (1 día antes)' },
                      { value: 'recordatorio-20m', label: 'Recordatorio (20 minutos antes)' },
                      { value: 'carga-24h', label: 'Carga Examen (< 24 horas)' },
                      { value: 'carga-48h', label: 'Carga Examen (< 48 horas)' }
                    ]
                  : alertType === 'clase'
                  ? [
                      { value: 'clase-10m', label: 'Recordatorio (10 minutos antes)' },
                      { value: 'clase-feriado', label: 'Aviso Feriado (Gentil / Sin clase)' }
                    ]
                  : [
                      { value: 'welcome', label: 'Bienvenida Ciclo Lectivo' },
                      { value: 'winter_break', label: 'Receso de Invierno' },
                      { value: 'end_of_year', label: 'Fin del Ciclo Lectivo' },
                      { value: 'graduation', label: 'Colación y Graduación' },
                      { value: 'reinicio-7d', label: 'Reinicio de Clases (7 días antes)' }
                    ]
              }
              selectedValue={alertTiming}
              onChange={(val) => setAlertTiming(val)}
            />

            {alertType !== 'ciclo_lectivo' && (
              <DropdownSelector
                label="Materia Asociada"
                options={alertSubjects.map((s) => ({ value: s.id, label: s.name }))}
                selectedValue={selectedAlertSubjectId}
                onChange={(val) => setSelectedAlertSubjectId(val)}
                placeholder="Seleccioná una materia"
                searchable
              />
            )}
          </div>

          <div className="flex flex-col justify-between space-y-4">
            <DropdownSelector
              label="Grupo Destino (WhatsApp)"
              options={alertGroups.map((g) => ({ value: g.id, label: g.name }))}
              selectedValue={selectedAlertGroupId}
              onChange={(val) => setSelectedAlertGroupId(val)}
              placeholder="Seleccioná un grupo"
              searchable
            />

            <div className="pt-2">
              <Button
                variant="primary"
                type="submit"
                className="w-full py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                loading={isTriggering}
              >
                Disparar Alerta de Prueba
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
export default ImpersonationPanel;
