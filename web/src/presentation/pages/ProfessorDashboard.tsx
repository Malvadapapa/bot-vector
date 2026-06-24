import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Spinner } from '../components/atoms/Spinner';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { CalendarWidget } from '../components/organisms/CalendarWidget';
import { DataTable } from '../components/organisms/DataTable';
import { ExamForm } from '../components/organisms/ExamForm';
import { ChatWindow } from '../components/organisms/ChatWindow';
import { SettingsPage } from './SettingsPage';
import { Button } from '../components/atoms/Button';
import { FormField } from '../components/molecules/FormField';
import { DropdownSelector } from '../components/molecules/DropdownSelector';
import { Badge } from '../components/atoms/Badge';
import { ConfirmDialog } from '../components/molecules/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import {
  examRepository,
  messageRepository,
  groupRepository,
  classRepository,
  profileRepository,
} from '../../infrastructure/repositories/instances';
import type { Exam, ChatMessage, Subject, CalendarEvent, Cohort } from '../../domain/entities';
import { Video } from 'lucide-react';
import {
  Calendar as CalendarIcon,
  FileText,
  MessageSquare,
  Plus,
  Send,
  User,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

function normalizeSubjectName(name: string): string {
  if (!name) return '';
  let normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  normalized = normalized.replace(/\biii\b/g, '3');
  normalized = normalized.replace(/\bii\b/g, '2');
  normalized = normalized.replace(/\bi\b/g, '1');
  return normalized.replace(/[^a-z0-9]/g, '');
}

export const ProfessorDataContext = React.createContext<any>(null);

export const useProfessorDataContext = () => {
  const context = React.useContext(ProfessorDataContext);
  if (!context) {
    throw new Error('useProfessorDataContext must be used within a ProfessorDataProvider');
  }
  return context;
};

export const ProfessorDashboard: React.FC = () => {
  const data = useProfessorData();
  const location = useLocation();
  const showFilter = !location.pathname.endsWith('settings') && data.assignments.length > 1;

  return (
    <ProfessorDataContext.Provider value={data}>
      <DashboardLayout title="Panel Docente">
        {showFilter && (
          <div className="mb-6 p-4 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)] rounded-xl flex items-center gap-4">
            <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">
              Filtrar por Materia / Comisión:
            </label>
            <div className="w-64">
              <DropdownSelector
                options={[
                  { value: 'all', label: 'Todas mis materias / comisiones' },
                  ...data.assignments.map((a: any) => ({
                    value: `${a.subject}_${a.commissionId || 'all'}`,
                    label: `${a.subject} - Comisión ${a.commissionLabel || a.commissionId || 'Única'}`
                  }))
                ]}
                selectedValue={data.selectedAssignmentId}
                onChange={data.setSelectedAssignmentId}
              />
            </div>
          </div>
        )}

        <Routes>
          <Route path="calendar" element={<CalendarTab />} />
          <Route path="exams" element={<ExamsTab />} />
          <Route path="classes" element={<ClassesTab />} />
          <Route path="messages" element={<MessagesTab />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<CalendarTab />} />
        </Routes>
      </DashboardLayout>
    </ProfessorDataContext.Provider>
  );
};

// ── CONTEXT SHARER FOR VIEWS ──────────────────────────────────
const useProfessorData = () => {
  const { activeGroup, user } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  const refreshAll = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [latestProfile, assignmentsList] = await Promise.all([
        profileRepository.getProfileMe().catch(() => null),
        profileRepository.getMyAssignments().catch(() => [])
      ]);

      const groupIdsSet = new Set<string>();
      if (latestProfile?.groupIds) {
        latestProfile.groupIds.forEach((id: string) => {
          if (id) groupIdsSet.add(id);
        });
      }
      if (assignmentsList) {
        assignmentsList.forEach((a: any) => {
          if (a.groupId) groupIdsSet.add(a.groupId);
        });
      }
      if (activeGroup?.id) {
        groupIdsSet.add(activeGroup.id);
      }

      const targetGroupIds = Array.from(groupIdsSet);

      const subjectsPromises = targetGroupIds.map(gId => groupRepository.getSubjects(gId).catch(() => []));
      const examsPromises = targetGroupIds.map(gId => examRepository.getAll(gId).catch(() => []));
      const messagesPromises = targetGroupIds.map(gId => messageRepository.getAll(gId).catch(() => []));
      const cohortsPromises = targetGroupIds.map(gId => groupRepository.getCohorts(gId).catch(() => []));
      const globalClassesPromise = classRepository.getByGroup('').catch(() => []);

      const results = await Promise.all([
        Promise.all(subjectsPromises),
        Promise.all(examsPromises),
        Promise.all(messagesPromises),
        Promise.all(cohortsPromises),
        globalClassesPromise
      ]);

      const subsList = results[0].flat();
      const examsList = results[1].flat();
      const messagesList = results[2].flat();
      const cohortsList = results[3].flat();
      const classesList = results[4];

      const uniqueSubjects = Array.from(new Map(subsList.map(item => [item.id, item])).values());
      const uniqueExams = Array.from(new Map(examsList.map(item => [item.id, item])).values());
      const uniqueMessages = Array.from(new Map(messagesList.map(item => [item.id, item])).values());
      const uniqueCohorts = Array.from(new Map(cohortsList.map(item => [item.id, item])).values());

      setAllSubjects(uniqueSubjects);

      const profSubjects = uniqueSubjects.filter((s) => s.professorIds.includes(user.id));
      setSubjects(profSubjects);

      setExams(uniqueExams);

      const profMessages = uniqueMessages.filter((m) => m.authorId === user.id || user.role === 'super_admin');
      setMessages(profMessages);

      setCohorts(uniqueCohorts);
      setClasses(classesList);
      setAssignments(assignmentsList || []);
    } catch {
      toast.error('Error al sincronizar datos del docente.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setSelectedAssignmentId('all');
    refreshAll();
  }, [activeGroup, user]);

  return {
    subjects,
    allSubjects,
    exams,
    messages,
    cohorts,
    classes,
    assignments,
    selectedAssignmentId,
    setSelectedAssignmentId,
    isLoading,
    refreshAll
  };
};

const CalendarTab: React.FC = () => {
  const { exams, allSubjects, isLoading, selectedAssignmentId, assignments } = useProfessorDataContext();
  const { user } = useAuth();

  const isMyExam = (e: any) => {
    if (user?.role === 'super_admin') return true;
    const sub = allSubjects.find((s: any) => s.id === e.subjectId);
    if (!sub) return false;
    return assignments.some((a: any) => normalizeSubjectName(a.subject) === normalizeSubjectName(sub.name));
  };

  const buildCalendarEvents = (): CalendarEvent[] => {
    let list = exams.filter(isMyExam);
    if (selectedAssignmentId !== 'all') {
      const [selSubject, selComm] = selectedAssignmentId.split('_');
      list = list.filter((e: any) => {
        const sub = allSubjects.find((s: any) => s.id === e.subjectId);
        const nameMatches = sub && normalizeSubjectName(sub.name) === normalizeSubjectName(selSubject);
        const commMatches = selComm === 'all' || !e.commissionId || String(e.commissionId) === String(selComm);
        return nameMatches && commMatches;
      });
    }

    return list.map((e: any) => {
      const subject = allSubjects.find((s: any) => s.id === e.subjectId);
      return {
        id: e.id,
        title: `[${e.type.toUpperCase()}] ${e.title} (${subject?.name || 'Materia'})`,
        start: e.startDate,
        end: e.endDate || e.startDate,
        calendarId: e.type,
        _type: 'exam',
        _entityId: e.id,
        _examType: e.type,
      };
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">Calendario de Evaluaciones</h3>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
          Vista consolidada de exámenes y entregables de tus materias asignadas.
        </p>
      </div>
      {isLoading ? (
        <div className="h-96 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando calendario...</div>
      ) : (
        <CalendarWidget events={buildCalendarEvents()} readOnly />
      )}
    </div>
  );
};

// ── SUB-VIEW: EXAMS LIST ─────────────────────────────────────
const ExamsTab: React.FC = () => {
  const { activeGroup, user } = useAuth();
  const { exams, subjects, allSubjects, isLoading, refreshAll, assignments, selectedAssignmentId } = useProfessorDataContext();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreateOrUpdate = async (payload: any) => {
    if (!user) return;
    try {
      if (editingExam) {
        await examRepository.update(editingExam.id, payload);
        toast.success('Examen actualizado con éxito.');
      } else {
        const selectedSub = allSubjects.find((s: any) => s.id === payload.subjectId);
        const resolvedGroupId = selectedSub?.groupId || activeGroup?.id;
        
        if (!resolvedGroupId) {
          toast.error('No se pudo determinar el grupo para esta materia.');
          return;
        }

        await examRepository.create({
          ...payload,
          groupId: resolvedGroupId,
          createdBy: user.id,
        });
        toast.success('Examen creado y programado.');
      }
      setIsFormOpen(false);
      setEditingExam(null);
      refreshAll();
      window.dispatchEvent(new Event('refresh-abp-warnings'));
    } catch {
      toast.error('Error al guardar examen.');
    }
  };

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

  const isMyExam = (e: any) => {
    if (user?.role === 'super_admin') return true;
    const sub = allSubjects.find((s: any) => s.id === e.subjectId);
    if (!sub) return false;
    return assignments.some((a: any) => normalizeSubjectName(a.subject) === normalizeSubjectName(sub.name));
  };

  const filteredExams = selectedAssignmentId === 'all'
    ? exams.filter(isMyExam)
    : exams.filter(isMyExam).filter((e: any) => {
        const sub = allSubjects.find((s: any) => s.id === e.subjectId);
        if (!sub) return false;
        const [selSubject, selComm] = selectedAssignmentId.split('_');
        const nameMatches = normalizeSubjectName(sub.name) === normalizeSubjectName(selSubject);
        const commMatches = selComm === 'all' || !e.commissionId || String(e.commissionId) === String(selComm);
        return nameMatches && commMatches;
      });

  const headers = ['Título Examen', 'Materia', 'Tipo', 'Fecha / Plazo'];

  const typeBadges = {
    evidence: <Badge variant="info">Evidencia</Badge>,
    abp: <Badge variant="success">ABP</Badge>,
    final: <Badge variant="danger">Final</Badge>,
    colloquium: <Badge variant="warning">Coloquio</Badge>,
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">Evaluaciones de mis Materias</h3>
        <Button
          variant="primary"
          onClick={() => {
            setEditingExam(null);
            setIsFormOpen(true);
          }}
          className="flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Nuevo Examen
        </Button>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando exámenes...</div>
      ) : (
        <DataTable<any>
          headers={headers}
          data={filteredExams}
          searchPlaceholder="Buscar por título..."
          searchFields={['title']}
          renderRowCells={(e: any) => {
            const sub = allSubjects.find((s: any) => s.id === e.subjectId);
            return [
              <span className="font-semibold">{e.title}</span>,
              sub?.name || 'Cargando...',
              typeBadges[e.type as keyof typeof typeBadges],
              <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                {new Date(e.startDate).toLocaleDateString()}
                {e.endDate && ` al ${new Date(e.endDate).toLocaleDateString()}`}
              </span>,
            ];
          }}
          actions={[
            {
              icon: 'edit',
              label: 'Editar examen',
              onClick: (e: any) => {
                setEditingExam(e);
                setIsFormOpen(true);
              },
              disabled: (e: any) => !isMyExam(e),
            },
            {
              icon: 'delete',
              label: 'Eliminar examen',
              onClick: (e: any) => setDeleteId(e.id),
              variant: 'danger',
              disabled: (e: any) => !isMyExam(e),
            },
          ]}
        />
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsFormOpen(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 overflow-y-auto max-h-[90vh]">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
              {editingExam ? 'Editar Examen' : 'Registrar Nuevo Examen'}
            </h3>
            <ExamForm
              subjects={subjects}
              initialExam={editingExam || undefined}
              onSubmit={handleCreateOrUpdate}
              onCancel={() => setIsFormOpen(false)}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Eliminar Examen"
        message="¿Estás seguro de que deseas eliminar esta evaluación del calendario escolar?"
        type="danger"
      />
    </div>
  );
};

// ── SUB-VIEW: SENT MESSAGES & LIVE CHAT WINDOW ────────────────
const MessagesTab: React.FC = () => {
  const { user, activeGroup } = useAuth();
  const { messages, cohorts, isLoading, refreshAll, assignments, selectedAssignmentId } = useProfessorDataContext();
  
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  
  // New Message Form state
  const [isNewMsgModalOpen, setIsNewMsgModalOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [messageContent, setMessageContent] = useState('');

  const activeAssignment = selectedAssignmentId !== 'all' 
    ? assignments.find((a: any) => `${a.subject}_${a.commissionId || 'all'}` === selectedAssignmentId) 
    : null;

  const availableCohorts = activeAssignment 
    ? cohorts.filter((c: any) => c.groupId === activeAssignment.groupId)
    : cohorts.filter((c: any) => assignments.some((a: any) => a.groupId === c.groupId));

  // Auto-select target cohort if a specific assignment filter is active
  useEffect(() => {
    if (isNewMsgModalOpen) {
      if (selectedAssignmentId !== 'all') {
        const actAssign = assignments.find((a: any) => `${a.subject}_${a.commissionId || 'all'}` === selectedAssignmentId);
        if (actAssign) {
          const matchedCohort = cohorts.find((c: any) => c.groupId === actAssign.groupId);
          if (matchedCohort) {
            setTargetId(matchedCohort.id);
          } else if (actAssign.groupId) {
            setTargetId(actAssign.groupId);
          }
        }
      } else if (availableCohorts.length > 0) {
        setTargetId(availableCohorts[0].id);
      }
    }
  }, [isNewMsgModalOpen, selectedAssignmentId, assignments, cohorts]);

  // Fetch replies when selected message changes
  useEffect(() => {
    if (selectedMessage) {
      messageRepository.getReplies(selectedMessage.id).then((list) => {
        setReplies(list);
        // Mark as read
        const unreadIds = list.filter((r) => !r.readByProfessor).map((r) => r.id);
        if (unreadIds.length > 0) {
          messageRepository.markAsRead(unreadIds).then(() => {
            refreshAll();
          });
        }
      });
    } else {
      setReplies([]);
    }
  }, [selectedMessage]);

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId || !messageContent.trim() || !user) {
      toast.error('Completá destinatario y contenido.');
      return;
    }

    const cohort = cohorts.find((c: any) => c.id === targetId);

    try {
      await messageRepository.send({
        authorId: user.id,
        authorName: user.name,
        content: messageContent.trim(),
        isFromStudent: false,
        targetId,
        targetType: 'cohort',
        targetName: cohort?.name || 'Cohorte',
      });
      toast.success('Mensaje transmitido por WhatsApp.');
      setIsNewMsgModalOpen(false);
      setMessageContent('');
      setTargetId('');
      refreshAll();
    } catch {
      toast.error('Error al enviar mensaje.');
    }
  };

  const handleSendReply = async (content: string) => {
    if (!selectedMessage || !user) return;
    try {
      const reply = await messageRepository.sendReply({
        authorId: user.id,
        authorName: user.name,
        content,
        isFromStudent: false,
        parentMessageId: selectedMessage.id,
      });
      
      // Update replies locally
      setReplies((prev) => [...prev, reply]);
      toast.success('Réplica enviada.');
    } catch {
      toast.error('Error al responder.');
    }
  };

    const filteredMessages = messages.filter((m: any) => {
    if (selectedAssignmentId === 'all') return true;
    const actAssign = assignments.find((a: any) => `${a.subject}_${a.commissionId || 'all'}` === selectedAssignmentId);
    if (!actAssign) return true;
    
    // 1. Direct group match
    if (m.targetId === actAssign.groupId) return true;
    
    // 2. Cohort match
    const cohortObj = cohorts.find((c: any) => c.id === m.targetId);
    if (m.targetType === 'cohort' && cohortObj && cohortObj.groupId === actAssign.groupId) {
      return true;
    }
    
    // 3. Global assignment fallback
    if ((!actAssign.groupId || actAssign.groupId === '') && m.targetId === actAssign.groupId) {
      return true;
    }

    return false;
  });

  return (
    <>
      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando mensajes...</div>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Sent Messages Sidebar Panel */}
          <div className={`md:col-span-1 space-y-4 ${selectedMessage ? 'hidden md:block' : 'block'}`}>
            <div className="flex justify-between items-center pb-2 border-b border-[var(--color-border)]">
              <h4 className="text-sm font-bold text-[var(--color-text-primary)]">Mensajes Enviados</h4>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsNewMsgModalOpen(true)}
                className="flex items-center gap-1 text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Redactar
              </Button>
            </div>

            <div className="space-y-3.5 max-h-[500px] overflow-y-auto pr-1">
              {filteredMessages.length === 0 ? (
                <div className="text-center p-6 text-xs text-[var(--color-text-tertiary)]">
                  No enviaste mensajes de difusión aún o ninguno coincide con el filtro.
                </div>
              ) : (
                filteredMessages.map((m: any) => {
                  const isSelected = selectedMessage?.id === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMessage(m)}
                      className={`
                        w-full text-left p-4 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col gap-1.5 relative overflow-hidden group
                        ${isSelected
                          ? 'bg-[var(--color-accent-muted)]/40 border-[var(--color-accent)]'
                          : 'bg-[var(--color-bg-card)] border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
                        }
                      `}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-[var(--color-accent)] uppercase tracking-wider">
                            {m.targetName}
                          </span>
                          {m.unreadRepliesCount && m.unreadRepliesCount > 0 ? (
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[9px] font-bold leading-none text-white bg-red-500 rounded-full animate-pulse">
                              {m.unreadRepliesCount}
                            </span>
                          ) : m.repliesCount && m.repliesCount > 0 ? (
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[9px] font-bold leading-none text-[var(--color-text-secondary)] bg-[var(--color-border)] rounded-full">
                              {m.repliesCount}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-[10px] text-[var(--color-text-tertiary)]">
                          {new Date(m.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-[var(--color-text-primary)] line-clamp-2 leading-relaxed">
                        {m.content}
                      </p>
                      
                      <div className="flex items-center justify-between pt-1 text-[10px] text-[var(--color-text-tertiary)]">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3 text-[var(--color-accent)]" /> {m.authorName}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-tertiary)] group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Live Chat window Panel */}
          <div className={`md:col-span-2 h-[550px] ${!selectedMessage ? 'hidden md:block' : 'block'}`}>
            {selectedMessage ? (
              <ChatWindow
                parentMessage={selectedMessage}
                replies={replies}
                onSendReply={handleSendReply}
                onBack={() => setSelectedMessage(null)}
              />
            ) : (
              <div className="h-full border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-card)] flex flex-col items-center justify-center text-center p-6 text-[var(--color-text-tertiary)]">
                <MessageSquare className="w-12 h-12 text-[var(--color-border)] mb-3" />
                <h4 className="text-sm font-bold text-[var(--color-text-secondary)]">Bandeja de Réplicas WhatsApp</h4>
                <p className="text-xs mt-1.5 max-w-sm leading-relaxed">
                  Seleccioná un mensaje enviado en el panel izquierdo para ver las consultas de alumnos en tiempo real y enviar tus respuestas directo a sus chats.
                </p>
              </div>
            )}
          </div>

          {/* New Message Form Modal */}
          {isNewMsgModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsNewMsgModalOpen(false)} />
              <div className="relative z-10 w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6">
                <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">Enviar Mensaje de WhatsApp</h3>

                <form onSubmit={handleSendBroadcast} className="space-y-4">
                                    <DropdownSelector
                    label="Enviar a (Destinatario)"
                    options={availableCohorts.map((c: any) => ({ value: c.id, label: `${c.name} (${c.year})` }))}
                    selectedValue={targetId}
                    onChange={setTargetId}
                    required
                  />

                  <FormField
                    label="Cuerpo del Mensaje"
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    placeholder="Escribí el mensaje que recibirán los alumnos..."
                    isTextArea
                    rows={4}
                    required
                  />

                  <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                    <Button variant="ghost" type="button" onClick={() => setIsNewMsgModalOpen(false)}>
                      Cancelar
                    </Button>
                    <Button variant="primary" type="submit" className="flex items-center gap-1">
                      <Send className="w-4 h-4" /> Enviar
                    </Button>
                  </div>
                </form>
            </div>
          </div>
        )}
      </div>
    )}
  </>
);
};
export const ClassesTab: React.FC = () => {
  const { classes, subjects, allSubjects, cohorts, isLoading, refreshAll, assignments, selectedAssignmentId } = useProfessorDataContext();
  const { user } = useAuth();
  
  const [selectedYear, setSelectedYear] = useState('all');
  const [showAllClasses, setShowAllClasses] = useState(false);
  const [isEditMeetModalOpen, setIsEditMeetModalOpen] = useState(false);
  const [editingClassSlot, setEditingClassSlot] = useState<any | null>(null);
  const [newMeetLink, setNewMeetLink] = useState('');
 
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
 
  const getCohortYear = (coh: Cohort): number => {
    if (coh.year && coh.year > 2000) {
      const currentYear = new Date().getFullYear();
      const cursadaYear = currentYear - coh.year + 1;
      if (cursadaYear >= 1 && cursadaYear <= 3) return cursadaYear;
    } else if (coh.year && coh.year >= 1 && coh.year <= 3) {
      return coh.year;
    }
    const combined = coh.name.toLowerCase();
    if (combined.includes('1er') || combined.includes('1to') || combined.includes('1º') || combined.includes('1')) {
      return 1;
    }
    if (combined.includes('2do') || combined.includes('2º') || combined.includes('2')) {
      return 2;
    }
    if (combined.includes('3er') || combined.includes('3º') || combined.includes('3')) {
      return 3;
    }
    return 1;
  };
 
  const handleOpenEditModal = (c: any) => {
    setEditingClassSlot(c);
    setNewMeetLink(c.meetLink || '');
    setIsEditMeetModalOpen(true);
  };
 
  const handleUpdateMeetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClassSlot) return;
    try {
      await classRepository.update(
        editingClassSlot.subjectId,
        editingClassSlot.id,
        {
          meetLink: newMeetLink.trim() || undefined,
          commissionIds: editingClassSlot.commissions ? editingClassSlot.commissions.map((cm: any) => cm.commissionId) : [],
        }
      );
      toast.success('Enlace de Meet actualizado correctamente.');
      setIsEditMeetModalOpen(false);
      setEditingClassSlot(null);
      refreshAll();
    } catch {
      toast.error('Error al actualizar el enlace de Meet.');
    }
  };

  const handleSelfAssign = async (c: any) => {
    if (!user) return;
    try {
      const subjectRow = allSubjects.find((s: any) => normalizeSubjectName(s.name) === normalizeSubjectName(c.subjectName));
      if (!subjectRow) {
        toast.error('No se pudo encontrar la materia en el sistema.');
        return;
      }

      await classRepository.update(
        subjectRow.id,
        c.id,
        {
          teacherEmail: user.email,
          teacherName: user.name,
          commissionIds: c.commissions ? c.commissions.map((cm: any) => cm.commissionId) : [],
        }
      );
      toast.success('Te has asignado correctamente a esta materia.');
      refreshAll();
    } catch {
      toast.error('Error al asignarse a la materia.');
    }
  };
 
  const filteredCohorts = cohorts.filter((coh: any) => {
    if (selectedYear === 'all') return true;
    return getCohortYear(coh) === Number(selectedYear);
  });
 
  const isMyClass = (c: any) => {
    if (user?.role === 'super_admin') return true;
    return assignments.some((a: any) => normalizeSubjectName(a.subject) === normalizeSubjectName(c.subjectName));
  };
 
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[var(--color-bg-sidebar)] p-4 border border-[var(--color-border)] rounded-xl">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Filtrar Año:</label>
          <div className="w-48">
            <DropdownSelector
              options={[
                { value: 'all', label: 'Todos los Años' },
                { value: '1', label: '1er Año' },
                { value: '2', label: '2do Año' },
                { value: '3', label: '3er Año' },
              ]}
              selectedValue={selectedYear}
              onChange={setSelectedYear}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] font-semibold cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAllClasses}
            onChange={(e) => setShowAllClasses(e.target.checked)}
            className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent-muted)] h-4 w-4 cursor-pointer"
          />
          <span>Ver todas las materias de la carrera (Auto-asignación)</span>
        </label>
      </div>
 
      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando clases...</div>
      ) : (
        <div className="flex flex-col gap-6">
          {filteredCohorts.map((coh: any) => {
            const cohortSubjectIds = allSubjects.filter((s: any) => s.cohortId === coh.id).map((s: any) => s.id);
            const cohortClasses = classes.filter((c: any) => cohortSubjectIds.includes(c.subjectId));
            const year = getCohortYear(coh);
 
            let filteredCohortClasses = cohortClasses;
            if (!showAllClasses) {
              filteredCohortClasses = filteredCohortClasses.filter((c: any) => isMyClass(c));
            }
            if (selectedAssignmentId !== 'all') {
              const [selSubject, selComm] = selectedAssignmentId.split('_');
              filteredCohortClasses = filteredCohortClasses.filter((c: any) => {
                const nameMatches = normalizeSubjectName(c.subjectName) === normalizeSubjectName(selSubject);
                const commMatches = selComm === 'all' || !c.commissions || c.commissions.length === 0 || c.commissions.some((cm: any) => String(cm.commissionId) === String(selComm));
                return nameMatches && commMatches;
              });
            }
 
            if (filteredCohortClasses.length === 0) return null;
 
            return (
              <div key={coh.id} className="p-5 border border-[var(--color-border)] bg-[var(--color-bg-card)] rounded-xl flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-[var(--color-text-primary)]">{coh.name}</h4>
                    <Badge variant="accent">{coh.studentCount} Alumnos</Badge>
                  </div>
                  <Badge variant={year === 1 ? 'info' : year === 2 ? 'accent' : 'warning'}>
                    {year}° Año de Cursada
                  </Badge>
                </div>
 
                <DataTable<any>
                  headers={['Materia', 'Día Semana', 'Horario', 'Detalles / Enlace Virtual']}
                  data={filteredCohortClasses}
                  searchPlaceholder="Buscar por materia..."
                  searchFields={['subjectName']}
                  renderRowCells={(c: any) => [
                    <span className="font-semibold">{c.subjectName}</span>,
                    days[c.dayOfWeek],
                    `${c.startTime} a ${c.endTime}hs`,
                    <div className="flex flex-col gap-1.5">
                      {c.meetLink ? (
                        <a href={c.meetLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[var(--color-accent)] hover:underline text-xs font-semibold">
                          <Video className="w-3.5 h-3.5" />
                          Google Meet
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--color-text-secondary)]">Presencial: {c.classroom || 'Aula Común'}</span>
                      )}
                      {c.commissions && c.commissions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.commissions.map((cm: any) => (
                            <Badge key={cm.commissionId} variant="info">{cm.commissionName}</Badge>
                          ))}
                        </div>
                      )}
                      {c.teacherName && (
                        <div className="text-[10px] text-[var(--color-text-tertiary)] font-medium">
                          Prof: {c.teacherName} ({c.teacherEmail})
                        </div>
                      )}
                    </div>,
                  ]}
                  actions={[
                    {
                      icon: 'edit',
                      label: 'Editar enlace Meet',
                      onClick: (c: any) => handleOpenEditModal(c),
                      className: (c: any) => !isMyClass(c) ? 'hidden' : '',
                      disabled: (c: any) => !isMyClass(c),
                    },
                    {
                      icon: 'edit',
                      label: 'Asignarme como Profesor',
                      onClick: (c: any) => handleSelfAssign(c),
                      className: (c: any) => isMyClass(c) ? 'hidden' : '',
                      disabled: (c: any) => isMyClass(c),
                    }
                  ]}
                />
              </div>
            );
          })}
          {filteredCohorts.filter((coh: any) => {
            const cohortSubjectIds = allSubjects.filter((s: any) => s.cohortId === coh.id).map((s: any) => s.id);
            const cohortClasses = classes.filter((c: any) => cohortSubjectIds.includes(c.subjectId));
            
            let filtered = cohortClasses;
            if (!showAllClasses) {
              filtered = filtered.filter((c: any) => isMyClass(c));
            }
            if (selectedAssignmentId !== 'all') {
              const [selSubject, selComm] = selectedAssignmentId.split('_');
              filtered = filtered.filter((c: any) => {
                const nameMatches = normalizeSubjectName(c.subjectName) === normalizeSubjectName(selSubject);
                const commMatches = selComm === 'all' || !c.commissions || c.commissions.length === 0 || c.commissions.some((cm: any) => String(cm.commissionId) === String(selComm));
                return nameMatches && commMatches;
              });
            }
            return filtered.length > 0;
          }).length === 0 && (
            <div className="h-48 border border-dashed border-[var(--color-border)] rounded-xl flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
              No se encontraron grupos para el filtro seleccionado.
            </div>
          )}
        </div>
      )}
 
      {isEditMeetModalOpen && editingClassSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setIsEditMeetModalOpen(false); setEditingClassSlot(null); }} />
          <div className="relative z-10 w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">Editar Enlace de Google Meet</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4">Materia: <strong className="text-[var(--color-text-primary)]">{editingClassSlot.subjectName}</strong></p>
            <form onSubmit={handleUpdateMeetLink} className="flex flex-col gap-4">
              <FormField
                label="Enlace de Videoconferencia"
                value={newMeetLink}
                onChange={(e) => setNewMeetLink(e.target.value)}
                placeholder="https://meet.google.com/abc-defg-hij"
                required
              />
              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                <Button variant="ghost" type="button" onClick={() => { setIsEditMeetModalOpen(false); setEditingClassSlot(null); }}>Cancelar</Button>
                <Button variant="primary" type="submit">Guardar Cambios</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfessorDashboard;
