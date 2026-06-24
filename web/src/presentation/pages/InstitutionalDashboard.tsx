import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Spinner } from '../components/atoms/Spinner';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { CalendarWidget } from '../components/organisms/CalendarWidget';
import { DataTable } from '../components/organisms/DataTable';
import { NoticeForm } from '../components/organisms/NoticeForm';
import { SettingsPage } from './SettingsPage';
import { Button } from '../components/atoms/Button';
import { Badge } from '../components/atoms/Badge';
import { ConfirmDialog } from '../components/molecules/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { DropdownSelector } from '../components/molecules/DropdownSelector';
import {
  noticeRepository,
  examRepository,
  classRepository,
  groupRepository,
} from '../../infrastructure/repositories/instances';
import type { Group, Notice, Exam, WeeklySlot, Subject, CalendarEvent } from '../../domain/entities';
import { Megaphone, Calendar as CalendarIcon, Plus, ToggleLeft, ToggleRight } from 'lucide-react';
import { toast } from 'sonner';
import { SALifecycleTab, SAClassesTab, SASubjectsTab } from './SuperAdminDashboard';

export const InstitutionalDashboard: React.FC = () => {
  return (
    <DashboardLayout title="Panel Institucional">


      <Routes>
        <Route path="notices" element={<NoticesTab />} />
        <Route path="subjects" element={<SASubjectsTab />} />
        <Route path="calendar" element={<CalendarTab />} />
        <Route path="lifecycle" element={<SALifecycleTab />} />
        <Route path="classes" element={<SAClassesTab />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NoticesTab />} />
      </Routes>
    </DashboardLayout>
  );
};

// ── CONTEXT SHARER FOR VIEWS ──────────────────────────────────
const useInstitutionalData = () => {
  const { activeGroup } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [classes, setClasses] = useState<(WeeklySlot & { subjectId: string; subjectName: string; commissions?: any[]; teacherName?: string; teacherEmail?: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAll = async () => {
    if (!activeGroup) return;
    setIsLoading(true);
    try {
      const [subsList, examsList, noticesList, classesList] = await Promise.all([
        groupRepository.getSubjects(activeGroup.id),
        examRepository.getAll(activeGroup.id),
        noticeRepository.getAll(activeGroup.id),
        classRepository.getByGroup(activeGroup.id),
      ]);
      setSubjects(subsList);
      setExams(examsList);
      setNotices(noticesList);
      setClasses(classesList);
    } catch {
      toast.error('Error al sincronizar datos del portal.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, [activeGroup]);

  return { subjects, exams, notices, classes, isLoading, refreshAll };
};

// ── SUB-VIEW: NOTICES TAB ────────────────────────────────────
const NoticesTab: React.FC = () => {
  const { notices, isLoading, refreshAll } = useInstitutionalData();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Filters state
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week'>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [groupsList, setGroupsList] = useState<Group[]>([]);

  useEffect(() => {
    groupRepository.getAll().then(setGroupsList).catch(console.error);
  }, []);

  const handleCreateNotice = async (payload: any) => {
    const { activeGroup, user } = useAuth();
    if (!activeGroup || !user) return;
    try {
      await noticeRepository.create({
        ...payload,
        groupId: activeGroup.id,
        authorId: user.id,
        authorName: user.name,
      });
      toast.success('Aviso publicado y enviado por WhatsApp.');
      setIsFormOpen(false);
      refreshAll();
    } catch {
      toast.error('Error al registrar aviso.');
    }
  };

  const handleToggleNotice = async (notice: Notice) => {
    try {
      await noticeRepository.toggleActive(notice.id, !notice.active);
      toast.success(notice.active ? 'Aviso suspendido.' : 'Aviso reactivado.');
      refreshAll();
    } catch {
      toast.error('Error.');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await noticeRepository.delete(deleteId);
      toast.success('Aviso eliminado.');
      setDeleteId(null);
      refreshAll();
    } catch {
      toast.error('Error al borrar.');
    }
  };

  const filteredNotices = notices.filter((n) => {
    // 1. Date filter
    const noticeDate = new Date(n.createdAt);
    if (dateFilter === 'today') {
      const today = new Date();
      if (noticeDate.toDateString() !== today.toDateString()) return false;
    } else if (dateFilter === 'week') {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      if (noticeDate < oneWeekAgo) return false;
    }

    // 2. Group filter
    if (groupFilter !== 'all') {
      if (n.groupId !== groupFilter) return false;
    }

    return true;
  });

  const headers = ['Título del Aviso', 'Alcance', 'Fecha Emisión', 'Estado'];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">Gestión de Comunicados</h3>
        <Button variant="primary" onClick={() => setIsFormOpen(true)} className="flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          Nuevo Aviso
        </Button>
      </div>

      {/* Filtros */}
      <div className="grid gap-4 sm:grid-cols-2 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-sidebar)]">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
            Filtrar por Fecha
          </label>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="w-full px-3 py-2 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-border-focus)] transition-all duration-[var(--transition-fast)]"
          >
            <option value="all">Cualquier fecha</option>
            <option value="today">Enviados hoy</option>
            <option value="week">Enviados última semana</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
            Filtrar por Grupo / Alcance
          </label>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-border-focus)] transition-all duration-[var(--transition-fast)]"
          >
            <option value="all">Todos los alcances</option>
            <option value="todos">Todos los grupos (Broadcast)</option>
            <option value="all">Todos los grupos (all)</option>
            <option value="general">Grupos generales</option>
            {groupsList.map((g) => {
              const yearVal = g.entryYear;
              const ordinalYear = yearVal === 1 ? '1er año' : yearVal === 2 ? '2do año' : yearVal === 3 ? '3er año' : 'General';
              return (
                <option key={g.id} value={g.id}>
                  {`${ordinalYear} - ${g.name}`}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando avisos...</div>
      ) : (
        <DataTable
          headers={headers}
          data={filteredNotices}
          searchPlaceholder="Buscar por título..."
          searchFields={['title']}
          renderRowCells={(n) => [
            <div className="flex flex-col">
              <span className="font-semibold">{n.title}</span>
              <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-sm">{n.body}</span>
            </div>,
            <Badge variant="accent">{n.targetName}</Badge>,
            new Date(n.createdAt).toLocaleDateString(),
            <button
              onClick={() => handleToggleNotice(n)}
              className="flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer"
              title={n.active ? 'Desactivar aviso' : 'Activar aviso'}
            >
              {n.active ? (
                <div className="flex items-center gap-1 text-[var(--color-success)] font-semibold text-xs">
                  <ToggleRight className="w-6 h-6" />
                  <span>Activo</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[var(--color-text-tertiary)] font-semibold text-xs">
                  <ToggleLeft className="w-6 h-6" />
                  <span>Pausado</span>
                </div>
              )}
            </button>,
          ]}
          actions={[
            {
              icon: 'delete',
              label: 'Eliminar comunicado',
              onClick: (n) => setDeleteId(n.id),
            },
          ]}
        />
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsFormOpen(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 overflow-y-auto max-h-[90vh]">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-[var(--color-accent)]" />
              Publicar Aviso Masivo
            </h3>
            <NoticeForm
              onSubmit={handleCreateNotice}
              onCancel={() => setIsFormOpen(false)}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Eliminar Aviso"
        message="¿Estás seguro de que deseas borrar este aviso? Se eliminará de la base de consultas de WhatsApp."
        type="danger"
      />
    </div>
  );
};

// ── SUB-VIEW: CALENDAR TAB ───────────────────────────────────
const CalendarTab: React.FC = () => {
  const { activeGroup } = useAuth();
  const { exams, classes, subjects, isLoading } = useInstitutionalData();
  const [commissionFilter, setCommissionFilter] = useState('all');
  const [commissionsList, setCommissionsList] = useState<any[]>([]);

  useEffect(() => {
    if (activeGroup) {
      groupRepository.getCommissions(activeGroup.id)
        .then(setCommissionsList)
        .catch(console.error);
    }
  }, [activeGroup]);

  const buildCalendarEvents = (): CalendarEvent[] => {
    const list: CalendarEvent[] = [];

    // Map weekly slots
    classes.forEach((c) => {
      if (commissionFilter !== 'all' && (!c.commissions || !c.commissions.some((cm: any) => cm.commissionId === commissionFilter))) {
        return;
      }
      const getNextDayOfWeekDate = (dayIndex: number) => {
        const today = new Date();
        const todayDay = today.getDay();
        const diff = dayIndex - todayDay;
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + diff);
        return targetDate;
      };

      const date = getNextDayOfWeekDate(c.dayOfWeek);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      list.push({
        id: c.id,
        title: `Clase: ${c.subjectName}`,
        start: `${dateStr}T${c.startTime}:00`,
        end: `${dateStr}T${c.endTime}:00`,
        location: c.meetLink,
        description: c.classroom ? `Aula: ${c.classroom}` : undefined,
        calendarId: 'class',
        _type: 'class',
        _entityId: c.id,
      });
    });

    // Map Exams
    exams.forEach((e) => {
      const subject = subjects.find((s) => s.id === e.subjectId);
      list.push({
        id: e.id,
        title: `[${e.type.toUpperCase()}] ${e.title} (${subject?.name || 'Materia'})`,
        start: e.startDate,
        end: e.endDate || e.startDate,
        calendarId: e.type,
        _type: 'exam',
        _entityId: e.id,
        _examType: e.type,
      });
    });

    return list;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[var(--color-bg-sidebar)] p-4 border border-[var(--color-border)] rounded-xl">
        <div>
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">Calendario Institucional</h3>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Vista general e integrada de exámenes, entregables, y horarios de comisiones del grupo.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Filtrar Comisión:</label>
          <div className="w-48">
            <DropdownSelector
              options={[
                { value: 'all', label: 'Todas las Comisiones' },
                ...commissionsList.map((comm) => ({ value: comm.id, label: comm.name }))
              ]}
              selectedValue={commissionFilter}
              onChange={setCommissionFilter}
            />
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="h-96 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando calendario...</div>
      ) : (
        <CalendarWidget events={buildCalendarEvents()} readOnly />
      )}
    </div>
  );
};
export default InstitutionalDashboard;
