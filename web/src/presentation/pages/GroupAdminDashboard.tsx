import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Spinner } from '../components/atoms/Spinner';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { CalendarWidget } from '../components/organisms/CalendarWidget';
import { DataTable } from '../components/organisms/DataTable';
import { ExamForm } from '../components/organisms/ExamForm';
import { NoticeForm } from '../components/organisms/NoticeForm';
import { ChatWindow } from '../components/organisms/ChatWindow';
import { ImpersonationPanel } from '../components/organisms/ImpersonationPanel';
import { SettingsPage } from './SettingsPage';
import { FormField } from '../components/molecules/FormField';
import { DropdownSelector } from '../components/molecules/DropdownSelector';
import { Button } from '../components/atoms/Button';
import { Badge } from '../components/atoms/Badge';
import { ConfirmDialog } from '../components/molecules/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import {
  examRepository,
  noticeRepository,
  classRepository,
  moderationRepository,
  groupRepository,
  messageRepository,
  adminRepository,
} from '../../infrastructure/repositories/instances';
import type { Group, Exam, Notice, WeeklySlot, BannedUser, Subject, CalendarEvent, ChatMessage } from '../../domain/entities';
import { SALifecycleTab, SAClassesTab, SACalendarTab } from './SuperAdminDashboard';
import {
  Calendar as CalendarIcon,
  FileText,
  Clock,
  Megaphone,
  UserX,
  Eye,
  Plus,
  Video,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';

export const GroupAdminDashboard: React.FC = () => {
  return (
    <DashboardLayout title="Panel Administrador de Grupo">


      <Routes>
        <Route path="calendar" element={<SACalendarTab />} />
        <Route path="exams" element={<ExamsTab />} />
        <Route path="classes" element={<SAClassesTab />} />
        <Route path="notices" element={<NoticesTab />} />
        <Route path="moderation" element={<ModerationTab />} />
        <Route path="simulation" element={<ImpersonationPanel />} />
        <Route path="lifecycle" element={<SALifecycleTab />} />
        <Route path="super-admins" element={<AdminsListTab />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<SACalendarTab />} />
      </Routes>
    </DashboardLayout>
  );
};

// ── CONTEXT SHARER FOR VIEWS ──────────────────────────────────
const useGroupData = () => {
  const { activeGroup } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [classes, setClasses] = useState<(WeeklySlot & { subjectId: string; subjectName: string; commissions?: any[]; teacherName?: string; teacherEmail?: string })[]>([]);
  const [bannedUsers, setBannedUsers] = useState<BannedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAll = async () => {
    if (!activeGroup) return;
    setIsLoading(true);
    try {
      const [subsList, examsList, noticesList, classesList, bannedList] = await Promise.all([
        groupRepository.getSubjects(activeGroup.id),
        examRepository.getAll(activeGroup.id),
        noticeRepository.getAll(activeGroup.id),
        classRepository.getByGroup(activeGroup.id),
        moderationRepository.getBanned(activeGroup.id),
      ]);
      setSubjects(subsList);
      setExams(examsList);
      setNotices(noticesList);
      setClasses(classesList);
      setBannedUsers(bannedList);
    } catch {
      toast.error('Error al sincronizar datos del grupo.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, [activeGroup]);

  return { subjects, exams, notices, classes, bannedUsers, isLoading, refreshAll };
};

// ── SUB-VIEW: EXAMS LIST ─────────────────────────────────────
const ExamsTab: React.FC = () => {
  const { exams, subjects, isLoading, refreshAll } = useGroupData();
  const { activeGroup, user } = useAuth();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // CRUD states
  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);

  // Filter states
  const [selectedType, setSelectedType] = useState('all');
  const [selectedSubjectId, setSelectedSubjectId] = useState('all');

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await examRepository.delete(deleteId);
      toast.success('Examen eliminado.');
      setDeleteId(null);
      refreshAll();
      window.dispatchEvent(new Event('refresh-abp-warnings'));
    } catch {
      toast.error('Error al borrar.');
    }
  };

  const handleCreateOrUpdateExam = async (payload: any) => {
    if (!activeGroup || !user) return;
    try {
      if (editingExam) {
        await examRepository.update(editingExam.id, payload);
        toast.success('Examen actualizado con éxito.');
      } else {
        await examRepository.create({ ...payload, groupId: activeGroup.id, createdBy: user.id });
        toast.success('Examen registrado con éxito.');
      }
      setIsExamModalOpen(false);
      setEditingExam(null);
      refreshAll();
      window.dispatchEvent(new Event('refresh-abp-warnings'));
    } catch {
      toast.error('Error al guardar examen.');
    }
  };

  const handleOpenEdit = (exam: Exam) => {
    setEditingExam(exam);
    setIsExamModalOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingExam(null);
    setIsExamModalOpen(true);
  };

  const headers = ['Título Examen', 'Materia', 'Tipo', 'Fecha / Plazo'];

  const typeBadges = {
    evidence: <Badge variant="info">Evidencia</Badge>,
    abp: <Badge variant="success">ABP</Badge>,
    final: <Badge variant="danger">Final</Badge>,
    colloquium: <Badge variant="warning">Coloquio</Badge>,
  };

  // Filter exams array
  const filteredExams = exams.filter((e) => {
    const matchesType = selectedType === 'all' || e.type === selectedType;
    const matchesSubject = selectedSubjectId === 'all' || e.subjectId === selectedSubjectId;
    return matchesType && matchesSubject;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[var(--color-bg-sidebar)] p-4 border border-[var(--color-border)] rounded-xl">
        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Tipo:</label>
            <div className="w-40">
              <DropdownSelector
                options={[
                  { value: 'all', label: 'Todos' },
                  { value: 'evidence', label: 'Evidencia' },
                  { value: 'abp', label: 'ABP' },
                  { value: 'final', label: 'Final' },
                  { value: 'colloquium', label: 'Coloquio' },
                ]}
                selectedValue={selectedType}
                onChange={setSelectedType}
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Materia:</label>
            <div className="w-56">
              <DropdownSelector
                options={[
                  { value: 'all', label: 'Todas las materias' },
                  ...subjects.map(s => ({ value: s.id, label: s.name }))
                ]}
                selectedValue={selectedSubjectId}
                onChange={setSelectedSubjectId}
              />
            </div>
          </div>
        </div>
        
        <Button variant="primary" onClick={handleOpenCreate} className="flex items-center gap-1.5 w-full sm:w-auto justify-center">
          <Plus className="w-4 h-4" />
          Registrar Examen
        </Button>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando exámenes...</div>
      ) : (
        <DataTable
          headers={headers}
          data={filteredExams}
          searchPlaceholder="Buscar por título..."
          searchFields={['title']}
          renderRowCells={(e) => {
            const sub = subjects.find((s) => s.id === e.subjectId);
            return [
              <span className="font-semibold">{e.title}</span>,
              sub?.name || 'Cargando...',
              typeBadges[e.type],
              <span className="text-xs text-[var(--color-text-secondary)]">
                {new Date(e.startDate).toLocaleDateString()}
                {e.endDate && ` al ${new Date(e.endDate).toLocaleDateString()}`}
              </span>,
            ];
          }}
          actions={[
            { icon: 'edit', label: 'Editar evaluación', onClick: (e) => handleOpenEdit(e) },
            { icon: 'delete', label: 'Eliminar evaluación', onClick: (e) => setDeleteId(e.id), variant: 'danger' }
          ]}
        />
      )}

      {isExamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setIsExamModalOpen(false); setEditingExam(null); }} />
          <div className="relative z-10 w-full max-w-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 overflow-y-auto max-h-[90vh]">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
              {editingExam ? 'Editar Examen' : 'Registrar Nuevo Examen'}
            </h3>
            <ExamForm
              subjects={subjects}
              initialExam={editingExam || undefined}
              onSubmit={handleCreateOrUpdateExam}
              onCancel={() => { setIsExamModalOpen(false); setEditingExam(null); }}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Eliminar Examen"
        message="¿Estás seguro de que deseas eliminar este examen del calendario de WhatsApp?"
        type="danger"
      />
    </div>
  );
};

// ── SUB-VIEW: NOTICES ────────────────────────────────────────
const NoticesTab: React.FC = () => {
  const { notices, isLoading, refreshAll } = useGroupData();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingNotice, setEditingNotice] = useState<Notice | null>(null);
  const [chatNotice, setChatNotice] = useState<Notice | null>(null);
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { activeGroup, user } = useAuth();

  // Filters state
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week'>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [groupsList, setGroupsList] = useState<Group[]>([]);

  useEffect(() => {
    groupRepository.getAll().then(setGroupsList).catch(console.error);
  }, []);

  const handleCreateOrUpdateNotice = async (payload: any) => {
    if (!activeGroup || !user) return;
    try {
      if (editingNotice) {
        await noticeRepository.update(editingNotice.id, payload);
        toast.success('Comunicado actualizado.');
      } else {
        await noticeRepository.create({
          ...payload,
          groupId: activeGroup.id,
          authorId: user.id,
          authorName: user.name,
        });
        toast.success('Comunicado emitido por WhatsApp.');
      }
      setIsFormOpen(false);
      setEditingNotice(null);
      refreshAll();
    } catch {
      toast.error('Error al guardar aviso.');
    }
  };

  const handleCancelForm = () => {
    setIsFormOpen(false);
    setEditingNotice(null);
  };

  const handleToggleNotice = async (notice: Notice) => {
    try {
      await noticeRepository.toggleActive(notice.id, !notice.active);
      toast.success(notice.active ? 'Aviso suspendido' : 'Aviso reactivado');
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

  const handleOpenChat = async (notice: Notice) => {
    setChatNotice(notice);
    try {
      const list = await messageRepository.getReplies(notice.id, true);
      setReplies(list);
      const unreadIds = list.filter((r) => !r.readByProfessor && r.isFromStudent).map((r) => r.id);
      if (unreadIds.length > 0) {
        await messageRepository.markAsRead(unreadIds, true);
        refreshAll();
      }
    } catch {
      toast.error('Error al cargar réplicas.');
    }
  };

  const handleSendNoticeReply = async (content: string) => {
    if (!chatNotice || !user) return;
    setIsSendingReply(true);
    try {
      const reply = await messageRepository.sendReply({
        authorId: user.id,
        authorName: user.name,
        content,
        isFromStudent: false,
        parentMessageId: chatNotice.id,
      }, true);
      setReplies((prev) => [...prev, reply]);
      toast.success('Réplica enviada.');
    } catch {
      toast.error('Error al enviar la réplica.');
    } finally {
      setIsSendingReply(false);
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

  const headers = ['Título Comunicado', 'Alcance', 'Fecha Emisión', 'Estado'];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">Publicaciones de Difusión</h3>
        <Button variant="primary" onClick={() => { setEditingNotice(null); setIsFormOpen(true); }} className="flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          Nuevo Comunicado
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
              <div className="flex items-center gap-2">
                <span className="font-semibold">{n.title}</span>
                {n.unreadRepliesCount && n.unreadRepliesCount > 0 ? (
                  <span className="inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-bold leading-none text-white bg-red-500 rounded-full animate-pulse" title={`${n.unreadRepliesCount} consultas nuevas`}>
                    {n.unreadRepliesCount}
                  </span>
                ) : n.repliesCount && n.repliesCount > 0 ? (
                  <span className="inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-bold leading-none text-[var(--color-text-secondary)] bg-[var(--color-border)] rounded-full" title={`${n.repliesCount} consultas`}>
                    {n.repliesCount}
                  </span>
                ) : null}
              </div>
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
            { icon: 'edit', label: 'Editar aviso', onClick: (n) => { setEditingNotice(n); setIsFormOpen(true); } },
            { icon: 'chat', label: 'Ver réplicas WhatsApp', onClick: (n) => handleOpenChat(n) },
            { icon: 'delete', label: 'Eliminar comunicado', onClick: (n) => setDeleteId(n.id) }
          ]}
        />
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={handleCancelForm} />
          <div className="relative z-10 w-full max-w-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 overflow-y-auto max-h-[90vh]">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-[var(--color-accent)]" />
              {editingNotice ? 'Editar Comunicado' : 'Emitir Aviso Masivo'}
            </h3>
            <NoticeForm
              initialNotice={editingNotice || undefined}
              onSubmit={handleCreateOrUpdateNotice}
              onCancel={handleCancelForm}
            />
          </div>
        </div>
      )}

      {chatNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChatNotice(null)} />
          <div className="relative z-10 w-full max-w-3xl bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-[var(--color-accent)]" />
              Respuestas del Aviso: {chatNotice.title}
            </h3>
            
            <div className="h-[500px] overflow-hidden">
              <ChatWindow
                parentMessage={{
                  id: chatNotice.id,
                  authorId: chatNotice.authorId,
                  authorName: chatNotice.authorName,
                  content: chatNotice.body,
                  timestamp: chatNotice.createdAt,
                  isFromStudent: false,
                  targetType: chatNotice.targetType,
                  targetId: chatNotice.targetId,
                  targetName: chatNotice.targetName,
                }}
                replies={replies}
                onSendReply={handleSendNoticeReply}
                onBack={() => setChatNotice(null)}
                isSending={isSendingReply}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-[var(--color-border)]">
              <Button variant="ghost" type="button" onClick={() => setChatNotice(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Eliminar Aviso"
        message="¿Estás seguro de que deseas borrar este aviso? Ya no estará visible para consultas en el Bot."
        type="danger"
      />
    </div>
  );
};

// ── SUB-VIEW: MODERATION (BAN / UNBAN) ───────────────────────
const ModerationTab: React.FC = () => {
  const { bannedUsers, isLoading, refreshAll } = useGroupData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Ban form state
  const [phone, setPhone] = useState('');
  const [studentName, setStudentName] = useState('');
  const [reason, setReason] = useState('');

  const [unbanId, setUnbanId] = useState<string | null>(null);

  const handleBan = async (e: React.FormEvent) => {
    const { activeGroup, user } = useAuth();
    e.preventDefault();
    if (!phone.trim() || !reason.trim()) {
      toast.error('Completá teléfono y causa de baneo.');
      return;
    }
    if (!activeGroup || !user) return;

    try {
      await moderationRepository.ban({
        phone: phone.trim(),
        studentName: studentName.trim() || undefined,
        reason: reason.trim(),
        groupId: activeGroup.id,
        bannedBy: user.id,
        bannedByName: user.name,
      });
      toast.success('Número de WhatsApp bloqueado en el bot.');
      setIsModalOpen(false);
      setPhone('');
      setStudentName('');
      setReason('');
      refreshAll();
    } catch {
      toast.error('Error al registrar baneo.');
    }
  };

  const handleUnban = async () => {
    if (!unbanId) return;
    try {
      await moderationRepository.unban(unbanId);
      toast.success('Número de WhatsApp desbloqueado.');
      setUnbanId(null);
      refreshAll();
    } catch {
      toast.error('Error al remover baneo.');
    }
  };

  const headers = ['Alumno / Teléfono', 'Razón Bloqueo', 'Fecha Bloqueo', 'Moderador'];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">Restricciones de Acceso (Baneos)</h3>
        <Button variant="primary" onClick={() => setIsModalOpen(true)} className="flex items-center gap-1.5 bg-[var(--color-danger)] hover:bg-[var(--color-danger-hover)]">
          <UserX className="w-4 h-4" />
          Bloquear Teléfono
        </Button>
      </div>

      <div className="p-4 border border-[var(--color-border-danger)]/20 rounded-xl bg-[var(--color-danger-muted)]/10 flex gap-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        <ShieldAlert className="w-4 h-4 text-[var(--color-danger)] flex-shrink-0" />
        <span>
          Los números bloqueados en esta lista recibirán un aviso automático de expulsión/moderación en WhatsApp
          cuando intenten interactuar con el chatbot.
        </span>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando baneos...</div>
      ) : (
        <DataTable
          headers={headers}
          data={bannedUsers}
          searchPlaceholder="Buscar por teléfono o nombre..."
          searchFields={['phone', 'studentName']}
          renderRowCells={(b) => [
            <div className="flex flex-col">
              <span className="font-semibold">{b.studentName || 'Alumno Anónimo'}</span>
              <span className="text-xs text-[var(--color-text-secondary)] font-mono">{b.phone}</span>
            </div>,
            b.reason,
            new Date(b.bannedAt).toLocaleDateString(),
            b.bannedByName,
          ]}
          actions={[
            {
              icon: 'delete',
              label: 'Desbloquear número',
              onClick: (b) => setUnbanId(b.id),
              variant: 'outline',
            },
          ]}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          <div className="relative z-10 w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4 flex items-center gap-2 text-[var(--color-danger)]">
              <UserX className="w-5 h-5" />
              Bloquear Cuenta WhatsApp
            </h3>

            <form onSubmit={handleBan} className="space-y-4">
              <FormField
                label="Número de WhatsApp (Con código de país)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ej: +5491112345678"
                required
              />
              <FormField
                label="Nombre del Estudiante (Opcional)"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Ej: Juan Pérez"
              />
              <FormField
                label="Motivo del Bloqueo"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: Consultas SPAM continuas, lenguaje inapropiado."
                isTextArea
                rows={3}
                required
              />

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" type="submit" className="bg-[var(--color-danger)] hover:bg-[var(--color-danger-hover)]">
                  Confirmar Bloqueo
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!unbanId}
        onClose={() => setUnbanId(null)}
        onConfirm={handleUnban}
        title="Desbloquear Estudiante"
        message="¿Estás seguro de que deseas desbloquear este número? Volverá a tener acceso al Chatbot de WhatsApp de forma normal."
        confirmText="Desbloquear"
        type="warning"
      />
    </div>
  );
};

const AdminsListTab: React.FC = () => {
  const [admins, setAdmins] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAdmins = async () => {
    setIsLoading(true);
    try {
      const list = await adminRepository.getAll();
      setAdmins(list);
    } catch {
      toast.error('Error al cargar administradores.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  return (
    <div className="space-y-6">
      <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Administradores del Sistema</h2>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Vista de los administradores y superadministradores asignados al sistema.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner size="md" /></div>
        ) : (
          <div className="border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border)] bg-[var(--color-bg-card)]">
            {admins.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--color-text-tertiary)] italic">
                No hay administradores registrados.
              </div>
            ) : (
              admins.map((admin) => (
                <div key={admin.userId} className="p-4 flex flex-wrap items-center justify-between hover:bg-[var(--color-bg-sidebar)] transition-colors gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[var(--color-text-primary)]">{admin.name}</span>
                      <Badge variant={admin.isSuperAdmin ? 'accent' : 'info'}>
                        {admin.isSuperAdmin ? 'Super Admin' : 'Admin de Grupo'}
                      </Badge>
                      {!admin.isSuperAdmin && admin.groupName && (
                        <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                          Grupo: <strong>{admin.groupName}</strong>
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-[var(--color-text-tertiary)]">{admin.email}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupAdminDashboard;
