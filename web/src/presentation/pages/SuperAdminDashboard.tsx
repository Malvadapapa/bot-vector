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
    groupRepository,
    examRepository,
    noticeRepository,
    classRepository,
    moderationRepository,
    messageRepository,
    adminRepository,
    authorizedEmailRepository,
    academicCycleRepository,
} from '../../infrastructure/repositories/instances';
import type { Group, Cohort, Exam, Notice, Subject, WeeklySlot, CalendarEvent, BannedUser, ChatMessage } from '../../domain/entities';
import {
    Building2, Eye, Settings, Plus, Clock, Calendar as CalendarIcon,
    FileText, Megaphone, UserX, Video, ShieldAlert,
    ToggleLeft, ToggleRight, MessageSquare,
    BookOpen, Search, Save, Check
} from 'lucide-react';
import { toast } from 'sonner';

export const SuperAdminDashboard: React.FC = () => {
    return (
        <DashboardLayout title="Panel Super Admin">

            <Routes>
                <Route path="groups" element={<GroupsManagerView />} />
                <Route path="subjects" element={<SASubjectsTab />} />
                <Route path="admins" element={<SAAdminsTab />} />
                <Route path="authorized-emails" element={<SAAuthorizedEmailsTab />} />
                <Route path="lifecycle" element={<SALifecycleTab />} />
                <Route path="calendar" element={<SACalendarTab />} />
                <Route path="exams" element={<SAExamsTab />} />
                <Route path="classes" element={<SAClassesTab />} />
                <Route path="notices" element={<SANoticesTab />} />
                <Route path="moderation" element={<SAModerationTab />} />
                <Route path="simulation" element={<ImpersonationPanel />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<GroupsManagerView />} />
            </Routes>
        </DashboardLayout>
    );
};

// ── SHARED DATA HOOK ─────────────────────────────────────────
const useSAGroupData = () => {
    const { activeGroup } = useAuth();
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [exams, setExams] = useState<Exam[]>([]);
    const [notices, setNotices] = useState<Notice[]>([]);
    const [classes, setClasses] = useState<(WeeklySlot & { subjectId: string; subjectName: string; commissions?: any[]; teacherName?: string; teacherEmail?: string })[]>([]);
    const [bannedUsers, setBannedUsers] = useState<BannedUser[]>([]);
    const [cohorts, setCohorts] = useState<Cohort[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const refreshAll = async () => {
        if (!activeGroup) return;
        setIsLoading(true);
        try {
            const [subsList, examsList, noticesList, classesList, bannedList, cohortsList] = await Promise.all([
                groupRepository.getSubjects(activeGroup.id),
                examRepository.getAll(activeGroup.id),
                noticeRepository.getAll(activeGroup.id),
                classRepository.getByGroup(activeGroup.id),
                moderationRepository.getBanned(activeGroup.id),
                groupRepository.getCohorts(activeGroup.id),
            ]);
            setSubjects(subsList);
            setExams(examsList);
            setNotices(noticesList);
            setClasses(classesList);
            setBannedUsers(bannedList);
            setCohorts(cohortsList);
        } catch {
            toast.error('Error al sincronizar datos del grupo.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshAll();
    }, [activeGroup]);

    return { subjects, exams, notices, classes, bannedUsers, cohorts, isLoading, refreshAll };
};

// ── CALENDAR TAB ─────────────────────────────────────────────
export const SACalendarTab: React.FC = () => {
    const { activeGroup, user } = useAuth();
    const { exams, classes, subjects, notices, isLoading, refreshAll } = useSAGroupData();

    // Modal & Edit states
    const [isExamModalOpen, setIsExamModalOpen] = useState(false);
    const [editingExam, setEditingExam] = useState<Exam | null>(null);
    const [selectedDate, setSelectedDate] = useState('');

    const [isNoticeFormOpen, setIsNoticeFormOpen] = useState(false);
    const [editingNotice, setEditingNotice] = useState<Notice | null>(null);

    const [selectedEventForDetails, setSelectedEventForDetails] = useState<CalendarEvent | null>(null);

    const [deleteExamId, setDeleteExamId] = useState<string | null>(null);
    const [deleteNoticeId, setDeleteNoticeId] = useState<string | null>(null);

    const [commissionFilter, setCommissionFilter] = useState('all');
    const [commissionsList, setCommissionsList] = useState<any[]>([]);

    useEffect(() => {
        if (activeGroup) {
            groupRepository.getCommissions(activeGroup.id).then(setCommissionsList).catch(console.error);
        }
    }, [activeGroup]);

    const handleDoubleClickDate = (dateIso: string) => {
        setSelectedDate(dateIso);
        setEditingExam(null);
        setIsExamModalOpen(true);
    };

    const handleCreateOrUpdateExam = async (payload: any) => {
        if (!activeGroup || !user) return;
        try {
            if (editingExam) {
                await examRepository.update(editingExam.id, payload);
                toast.success('Examen actualizado con éxito.');
            } else {
                await examRepository.create({ ...payload, groupId: activeGroup.id, createdBy: user.id });
                toast.success('Examen creado con éxito.');
            }
            setIsExamModalOpen(false);
            setEditingExam(null);
            refreshAll();
            window.dispatchEvent(new Event('refresh-abp-warnings'));
        } catch {
            toast.error('Error al guardar examen.');
        }
    };

    const handleCreateOrUpdateNotice = async (payload: any) => {
        if (!activeGroup || !user) return;
        try {
            if (editingNotice) {
                await noticeRepository.update(editingNotice.id, payload);
                toast.success('Comunicado actualizado.');
            } else {
                await noticeRepository.create({ ...payload, groupId: activeGroup.id, authorId: user.id, authorName: user.name });
                toast.success('Comunicado emitido por WhatsApp.');
            }
            setIsNoticeFormOpen(false);
            setEditingNotice(null);
            refreshAll();
        } catch {
            toast.error('Error al guardar aviso.');
        }
    };

    const handleDeleteExam = async () => {
        if (!deleteExamId) return;
        try {
            await examRepository.delete(deleteExamId);
            toast.success('Examen eliminado.');
            setDeleteExamId(null);
            refreshAll();
            window.dispatchEvent(new Event('refresh-abp-warnings'));
        } catch {
            toast.error('Error al eliminar examen.');
        }
    };

    const handleDeleteNotice = async () => {
        if (!deleteNoticeId) return;
        try {
            await noticeRepository.delete(deleteNoticeId);
            toast.success('Aviso eliminado.');
            setDeleteNoticeId(null);
            refreshAll();
        } catch {
            toast.error('Error al eliminar aviso.');
        }
    };

    const handleSelectEvent = (e: CalendarEvent) => {
        setSelectedEventForDetails(e);
    };

    const buildCalendarEvents = (): CalendarEvent[] => {
        const list: CalendarEvent[] = [];
        classes.forEach((c) => {
            if (commissionFilter !== 'all' && (!c.commissions || !c.commissions.some((cm: any) => cm.commissionId === commissionFilter))) {
                return;
            }
            const getNextDayOfWeekDate = (dayIndex: number) => {
                const today = new Date();
                const diff = dayIndex - today.getDay();
                const t = new Date(today);
                t.setDate(today.getDate() + diff);
                return t;
            };
            const date = getNextDayOfWeekDate(c.dayOfWeek);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            list.push({
                id: c.id,
                title: `Clase: ${c.subjectName}`,
                start: `${dateStr}T${c.startTime}:00`,
                end: `${dateStr}T${c.endTime}:00`,
                location: c.meetLink,
                description: c.classroom ? `Aula: ${c.classroom}` : undefined,
                calendarId: 'class',
                _type: 'class',
                _entityId: c.id
            });
        });
        exams.forEach((e) => {
            const sub = subjects.find((s) => s.id === e.subjectId);
            list.push({
                id: e.id,
                title: `[${e.type.toUpperCase()}] ${e.title} (${sub?.name || 'Materia'})`,
                start: e.startDate,
                end: e.endDate || e.startDate,
                calendarId: e.type,
                _type: 'exam',
                _entityId: e.id,
                _examType: e.type,
                description: `Examen tipo ${e.type.toUpperCase()}. Alertas configuradas: ${e.alerts.timings.join(', ')}.`
            });
        });
        notices.forEach((n) => {
            if (n.startDate) {
                list.push({
                    id: n.id,
                    title: `[AVISO] ${n.title}`,
                    start: n.startDate,
                    end: n.endDate || n.startDate,
                    calendarId: 'notice',
                    _type: 'notice',
                    _entityId: n.id,
                    _noticeType: n.groupId === 'general' ? 'general' : 'professor',
                    description: n.body
                });
            }
        });
        return list;
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[var(--color-bg-sidebar)] p-4 border border-[var(--color-border)] rounded-xl">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Filtrar Comisión:</label>
                    <div className="w-48">
                        <DropdownSelector
                            options={[
                                { value: 'all', label: 'Todas las Comisiones' },
                                ...commissionsList.map(c => ({ value: c.id, label: c.name }))
                            ]}
                            selectedValue={commissionFilter}
                            onChange={setCommissionFilter}
                        />
                    </div>
                </div>
                <Button variant="primary" onClick={() => handleDoubleClickDate(new Date().toISOString())} className="flex items-center gap-1.5 w-full sm:w-auto justify-center">
                    <Plus className="w-4 h-4" />
                    Registrar Examen
                </Button>
            </div>

            {isLoading ? (
                <div className="h-96 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando calendario...</div>
            ) : (
                <CalendarWidget events={buildCalendarEvents()} onSelectEvent={handleSelectEvent} onDoubleClickDateTime={handleDoubleClickDate} />
            )}

            {/* Details modal */}
            {selectedEventForDetails && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedEventForDetails(null)} />
                    <div className="relative z-10 w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6">
                        <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-3 mb-4">
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${selectedEventForDetails._type === 'class' ? 'bg-blue-500/10 text-blue-400' :
                                    selectedEventForDetails._type === 'notice' ? 'bg-fuchsia-500/10 text-fuchsia-400' : 'bg-emerald-500/10 text-emerald-400'
                                }`}>
                                {selectedEventForDetails._type === 'class' ? 'Clase' : selectedEventForDetails._type === 'notice' ? 'Aviso' : `Examen: ${selectedEventForDetails._examType?.toUpperCase()}`}
                            </span>
                            <h4 className="text-sm font-bold text-[var(--color-text-primary)] truncate flex-1">
                                Detalles del Evento
                            </h4>
                        </div>

                        <div className="space-y-4 text-sm">
                            <div>
                                <span className="text-[11px] font-bold text-[var(--color-text-tertiary)] uppercase block mb-1">Título</span>
                                <p className="font-semibold text-[var(--color-text-primary)]">{selectedEventForDetails.title}</p>
                            </div>

                            {selectedEventForDetails.description && (
                                <div>
                                    <span className="text-[11px] font-bold text-[var(--color-text-tertiary)] uppercase block mb-1">Detalles / Descripción</span>
                                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line bg-[var(--color-bg-app)] p-3 border border-[var(--color-border)] rounded-lg">{selectedEventForDetails.description}</p>
                                </div>
                            )}

                            {selectedEventForDetails.location && (
                                <div>
                                    <span className="text-[11px] font-bold text-[var(--color-text-tertiary)] uppercase block mb-1">Aula / Enlace</span>
                                    {selectedEventForDetails.location.startsWith('http') ? (
                                        <a href={selectedEventForDetails.location} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-accent)] hover:underline break-all font-semibold flex items-center gap-1 bg-[var(--color-bg-app)] p-3 border border-[var(--color-border)] rounded-lg">
                                            <Video className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                                            {selectedEventForDetails.location}
                                        </a>
                                    ) : (
                                        <p className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg-app)] p-3 border border-[var(--color-border)] rounded-lg">{selectedEventForDetails.location}</p>
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <span className="text-[11px] font-bold text-[var(--color-text-tertiary)] uppercase block mb-1">Inicio</span>
                                    <p className="text-xs text-[var(--color-text-secondary)] font-mono">{new Date(selectedEventForDetails.start).toLocaleString()}</p>
                                </div>
                                <div>
                                    <span className="text-[11px] font-bold text-[var(--color-text-tertiary)] uppercase block mb-1">Fin</span>
                                    <p className="text-xs text-[var(--color-text-secondary)] font-mono">{new Date(selectedEventForDetails.end || selectedEventForDetails.start).toLocaleString()}</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-5 mt-5 border-t border-[var(--color-border)]">
                            {selectedEventForDetails._type !== 'class' && (
                                <>
                                    <Button
                                        variant="danger"
                                        size="sm"
                                        onClick={() => {
                                            const id = selectedEventForDetails._entityId;
                                            setSelectedEventForDetails(null);
                                            if (selectedEventForDetails._type === 'exam') {
                                                setDeleteExamId(id);
                                            } else {
                                                setDeleteNoticeId(id);
                                            }
                                        }}
                                    >
                                        Eliminar
                                    </Button>
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => {
                                            const id = selectedEventForDetails._entityId;
                                            setSelectedEventForDetails(null);
                                            if (selectedEventForDetails._type === 'exam') {
                                                const exam = exams.find((ex) => ex.id === id);
                                                if (exam) {
                                                    setEditingExam(exam);
                                                    setIsExamModalOpen(true);
                                                }
                                            } else {
                                                const notice = notices.find((nt) => nt.id === id);
                                                if (notice) {
                                                    setEditingNotice(notice);
                                                    setIsNoticeFormOpen(true);
                                                }
                                            }
                                        }}
                                    >
                                        Corregir / Editar
                                    </Button>
                                </>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => setSelectedEventForDetails(null)}>
                                Cerrar
                            </Button>
                        </div>
                    </div>
                </div>
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
                            initialExam={editingExam || (selectedDate ? ({ startDate: selectedDate, alerts: { timings: ['3d', '1d'] } } as any) : undefined)}
                            onSubmit={handleCreateOrUpdateExam}
                            onCancel={() => { setIsExamModalOpen(false); setEditingExam(null); }}
                        />
                    </div>
                </div>
            )}

            {isNoticeFormOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setIsNoticeFormOpen(false); setEditingNotice(null); }} />
                    <div className="relative z-10 w-full max-w-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 overflow-y-auto max-h-[90vh]">
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
                            <Megaphone className="w-5 h-5 text-[var(--color-accent)]" />
                            {editingNotice ? 'Editar Comunicado' : 'Emitir Aviso Masivo'}
                        </h3>
                        <NoticeForm initialNotice={editingNotice || undefined} onSubmit={handleCreateOrUpdateNotice} onCancel={() => { setIsNoticeFormOpen(false); setEditingNotice(null); }} />
                    </div>
                </div>
            )}

            <ConfirmDialog isOpen={!!deleteExamId} onClose={() => setDeleteExamId(null)} onConfirm={handleDeleteExam} title="Eliminar Examen" message="¿Estás seguro de que deseas eliminar este examen del calendario?" type="danger" />
            <ConfirmDialog isOpen={!!deleteNoticeId} onClose={() => setDeleteNoticeId(null)} onConfirm={handleDeleteNotice} title="Eliminar Aviso" message="¿Estás seguro de que deseas eliminar este aviso del calendario?" type="danger" />
        </div>
    );
};

// ── EXAMS TAB ────────────────────────────────────────────────
const SAExamsTab: React.FC = () => {
    const { exams, subjects, isLoading, refreshAll } = useSAGroupData();
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

    const typeBadges: Record<string, React.ReactNode> = {
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
        <div className="flex flex-col gap-5">
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
                    headers={['Título Examen', 'Materia', 'Tipo', 'Fecha / Plazo']}
                    data={filteredExams}
                    searchPlaceholder="Buscar por título..."
                    searchFields={['title']}
                    renderRowCells={(e) => {
                        const sub = subjects.find((s) => s.id === e.subjectId);
                        return [
                            <span className="font-semibold">{e.title}</span>,
                            sub?.name || 'Cargando...',
                            typeBadges[e.type],
                            <span className="text-xs text-[var(--color-text-secondary)]">{new Date(e.startDate).toLocaleDateString()}{e.endDate && ` al ${new Date(e.endDate).toLocaleDateString()}`}</span>,
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
                message="¿Estás seguro de que deseas eliminar este examen?"
                type="danger"
            />
        </div>
    );
};

export const SAClassesTab: React.FC = () => {
    const { classes, subjects, cohorts, isLoading, refreshAll } = useSAGroupData();
    const { activeGroup } = useAuth();

    const [selectedYear, setSelectedYear] = useState('all');
    const [commissionFilter, setCommissionFilter] = useState('all');
    const [commissionsList, setCommissionsList] = useState<any[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditMeetModalOpen, setIsEditMeetModalOpen] = useState(false);

    // Class slot form states
    const [subjectId, setSubjectId] = useState('');
    const [dayOfWeek, setDayOfWeek] = useState(1);
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('11:00');
    const [meetLink, setMeetLink] = useState('');
    const [classroom, setClassroom] = useState('');
    const [selectedCommissions, setSelectedCommissions] = useState<string[]>([]);
    const [teacherEmail, setTeacherEmail] = useState('');
    const [teacherName, setTeacherName] = useState('');
    const [commissionOverrides, setCommissionOverrides] = useState<Record<string, {
        dayOfWeek?: number;
        startTime?: string;
        endTime?: string;
        meetLink?: string;
        teacherName?: string;
        teacherEmail?: string;
    }>>({});

    // Editing state for Google Meet / class schedule
    const [editingClassSlot, setEditingClassSlot] = useState<{
        subjectId: string;
        slotId: string;
        subjectName: string;
        meetLink: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        commissionIds: string[];
        teacherEmail: string;
        teacherName: string;
        commissionOverrides?: Record<string, {
            dayOfWeek?: number;
            startTime?: string;
            endTime?: string;
            meetLink?: string;
            teacherName?: string;
            teacherEmail?: string;
        }>;
    } | null>(null);

    const [deleteSlotId, setDeleteSlotId] = useState<{ subId: string; slotId: string } | null>(null);

    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    const fetchCommissions = async () => {
        if (!activeGroup) return;
        try {
            const list = await groupRepository.getCommissions(activeGroup.id);
            setCommissionsList(list);
        } catch (err) {
            console.error('Error fetching commissions:', err);
        }
    };

    useEffect(() => {
        fetchCommissions();
    }, [activeGroup]);

    const getCohortYear = (coh: Cohort): number => {
        if (coh.year && coh.year > 2000) {
            const currentYear = new Date().getFullYear();
            const cursadaYear = currentYear - coh.year + 1;
            if (cursadaYear >= 1 && cursadaYear <= 3) return cursadaYear;
        } else if (coh.year && coh.year >= 1 && coh.year <= 3) {
            return coh.year;
        }
        const combined = (coh.name + ' ' + (activeGroup?.name || '')).toLowerCase();
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

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!subjectId) { toast.error('Elegí una materia.'); return; }
        try {
            await classRepository.create(subjectId, {
                dayOfWeek,
                startTime,
                endTime,
                meetLink: meetLink.trim() || undefined,
                classroom: classroom.trim() || undefined,
                commissionIds: selectedCommissions,
                teacherEmail: teacherEmail.trim() || undefined,
                teacherName: teacherName.trim() || undefined,
                commissionOverrides: Object.keys(commissionOverrides).length > 0 ? commissionOverrides : undefined
            } as any);
            toast.success('Horario de clase guardado.');
            setIsModalOpen(false);
            // Reset
            setSubjectId('');
            setMeetLink('');
            setClassroom('');
            setSelectedCommissions([]);
            setTeacherEmail('');
            setTeacherName('');
            setCommissionOverrides({});
            refreshAll();
        } catch {
            toast.error('Error al guardar horario.');
        }
    };

    const handleOpenEditMeetModal = (c: any) => {
        const overrides: Record<string, any> = {};
        if (c.commissions && c.commissions.length > 0) {
            c.commissions.forEach((cm: any) => {
                const hasDiffDay = cm.dayOfWeek !== c.dayOfWeek;
                const hasDiffTime = cm.startTime !== c.startTime;
                const hasDiffMeet = cm.meetLink !== c.meetLink;
                const hasDiffTeacher = cm.teacherName !== c.teacherName || cm.teacherEmail !== c.teacherEmail;

                if (hasDiffDay || hasDiffTime || hasDiffMeet || hasDiffTeacher) {
                    overrides[cm.commissionId] = {
                        dayOfWeek: hasDiffDay ? cm.dayOfWeek : undefined,
                        startTime: hasDiffTime ? cm.startTime : undefined,
                        endTime: hasDiffTime ? cm.endTime : undefined,
                        meetLink: hasDiffMeet ? cm.meetLink : undefined,
                        teacherName: hasDiffTeacher ? cm.teacherName : undefined,
                        teacherEmail: hasDiffTeacher ? cm.teacherEmail : undefined,
                    };
                }
            });
        }

        setEditingClassSlot({
            subjectId: c.subjectId,
            slotId: c.id,
            subjectName: c.subjectName,
            meetLink: c.meetLink || '',
            dayOfWeek: c.dayOfWeek,
            startTime: c.startTime,
            endTime: c.endTime,
            commissionIds: c.commissions ? c.commissions.map((cm: any) => cm.commissionId) : [],
            teacherEmail: c.teacherEmail || '',
            teacherName: c.teacherName || '',
            commissionOverrides: overrides
        });
        setIsEditMeetModalOpen(true);
    };

    const handleUpdateMeetLink = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingClassSlot) return;
        try {
            await classRepository.update(
                editingClassSlot.subjectId,
                editingClassSlot.slotId,
                {
                    meetLink: editingClassSlot.meetLink.trim() || undefined,
                    dayOfWeek: editingClassSlot.dayOfWeek,
                    startTime: editingClassSlot.startTime,
                    endTime: editingClassSlot.endTime,
                    commissionIds: editingClassSlot.commissionIds,
                    teacherEmail: editingClassSlot.teacherEmail.trim() || undefined,
                    teacherName: editingClassSlot.teacherName.trim() || undefined,
                    commissionOverrides: editingClassSlot.commissionOverrides
                } as any
            );
            toast.success('Horario de clase actualizado correctamente.');
            setIsEditMeetModalOpen(false);
            setEditingClassSlot(null);
            refreshAll();
        } catch {
            toast.error('Error al actualizar el horario.');
        }
    };

    const handleDelete = async () => {
        if (!deleteSlotId) return;
        try {
            await classRepository.delete(deleteSlotId.subId, deleteSlotId.slotId);
            toast.success('Horario eliminado.');
            setDeleteSlotId(null);
            refreshAll();
        } catch {
            toast.error('Error al eliminar.');
        }
    };

    const filteredCohorts = cohorts.filter(coh => {
        if (selectedYear === 'all') return true;
        return getCohortYear(coh) === Number(selectedYear);
    });

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[var(--color-bg-sidebar)] p-4 border border-[var(--color-border)] rounded-xl">
                <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                    <div className="flex items-center gap-3">
                        <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Filtrar Año:</label>
                        <div className="w-40">
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

                    <div className="flex items-center gap-3">
                        <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Filtrar Comisión:</label>
                        <div className="w-40">
                            <DropdownSelector
                                options={[
                                    { value: 'all', label: 'Todas' },
                                    ...commissionsList.map(c => ({ value: c.id, label: c.name }))
                                ]}
                                selectedValue={commissionFilter}
                                onChange={setCommissionFilter}
                            />
                        </div>
                    </div>
                </div>

                <Button variant="primary" onClick={() => setIsModalOpen(true)} className="flex items-center gap-1.5 w-full sm:w-auto justify-center">
                    <Plus className="w-4 h-4" />
                    Nueva Clase
                </Button>
            </div>

            {isLoading ? (
                <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando clases...</div>
            ) : (
                <div className="flex flex-col gap-6">
                    {filteredCohorts.map(coh => {
                        const cohortSubjectIds = subjects.filter(s => s.cohortId === coh.id).map(s => s.id);
                        const cohortClasses = classes.filter(c => {
                            const matchesCohort = cohortSubjectIds.includes(c.subjectId);
                            if (!matchesCohort) return false;
                            if (commissionFilter === 'all') return true;
                            return c.commissions && c.commissions.some((cm: any) => cm.commissionId === commissionFilter);
                        });
                        const year = getCohortYear(coh);

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

                                {cohortClasses.length === 0 ? (
                                    <div className="py-6 text-center text-xs text-[var(--color-text-tertiary)] italic">
                                        No hay clases registradas para este grupo.
                                    </div>
                                ) : (
                                    <DataTable
                                        headers={['Materia', 'Día Semana', 'Horario', 'Detalles / Enlace Virtual']}
                                        data={cohortClasses}
                                        searchPlaceholder="Buscar por materia..."
                                        searchFields={['subjectName']}
                                        renderRowCells={(c) => {
                                            const getCommissionDifferences = () => {
                                                if (!c.commissions || c.commissions.length <= 1) return null;
                                                const ref = c.commissions[0];
                                                const diffs = new Set<string>();
                                                for (let i = 1; i < c.commissions.length; i++) {
                                                    const curr = c.commissions[i];
                                                    if (curr.dayOfWeek !== ref.dayOfWeek || curr.startTime !== ref.startTime) {
                                                        diffs.add('Horario');
                                                    }
                                                    if (curr.meetLink !== ref.meetLink) {
                                                        diffs.add('Meet');
                                                    }
                                                    if (curr.teacherName !== ref.teacherName || curr.teacherEmail !== ref.teacherEmail) {
                                                        diffs.add('Profesor');
                                                    }
                                                }
                                                return diffs.size > 0 ? Array.from(diffs) : null;
                                            };
                                            const diffFields = getCommissionDifferences();

                                            return [
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
                                                            {diffFields && (
                                                                <Badge variant="warning">
                                                                    Diferencias: {diffFields.join(', ')}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    )}
                                                    {c.teacherName && (
                                                        <div className="text-[10px] text-[var(--color-text-tertiary)] font-medium">
                                                            Prof: {c.teacherName} ({c.teacherEmail})
                                                        </div>
                                                    )}
                                                    {diffFields && c.commissions && (
                                                        <div className="mt-2 pl-2 border-l-2 border-[var(--color-warning)] text-[10px] text-[var(--color-text-secondary)] flex flex-col gap-1 bg-[var(--color-bg-sidebar)] p-1.5 rounded">
                                                            {c.commissions.map((cm: any) => (
                                                                <div key={cm.commissionId}>
                                                                    <span className="font-semibold text-[var(--color-text-primary)]">{cm.commissionName}:</span>{' '}
                                                                    {days[cm.dayOfWeek]} {cm.startTime}hs
                                                                    {cm.teacherName ? ` (Prof: ${cm.teacherName})` : ''}
                                                                    {cm.meetLink ? ' [Meet]' : ''}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>,
                                            ];
                                        }}
                                        actions={[
                                            {
                                                icon: 'edit',
                                                label: 'Editar horario',
                                                onClick: (c) => handleOpenEditMeetModal(c),
                                            },
                                            {
                                                icon: 'delete',
                                                label: 'Eliminar horario',
                                                onClick: (c) => setDeleteSlotId({ subId: c.subjectId, slotId: c.id }),
                                            }
                                        ]}
                                    />
                                )}
                            </div>
                        );
                    })}
                    {filteredCohorts.length === 0 && (
                        <div className="h-48 border border-dashed border-[var(--color-border)] rounded-xl flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
                            No se encontraron grupos para el filtro seleccionado.
                        </div>
                    )}
                </div>
            )}

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
                    <div className="relative z-10 w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">Configurar Horario de Cursada</h3>
                        <form onSubmit={handleCreate} className="flex flex-col gap-4">
                            <DropdownSelector label="Materia" options={subjects.map(s => ({ value: s.id, label: s.name }))} selectedValue={subjectId} onChange={setSubjectId} required searchable />
                            <DropdownSelector label="Día de Cursada" options={days.map((d, i) => ({ value: String(i), label: d }))} selectedValue={String(dayOfWeek)} onChange={(val) => setDayOfWeek(Number(val))} />
                            <div className="grid gap-4 grid-cols-2">
                                <FormField label="Hora de Inicio" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
                                <FormField label="Hora de Fin" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
                            </div>
                            <FormField label="Enlace de Videoconferencia" value={meetLink} onChange={(e) => setMeetLink(e.target.value)} placeholder="https://meet.google.com/abc-defg" />
                            <FormField label="Aula Física" value={classroom} onChange={(e) => setClassroom(e.target.value)} placeholder="Ej: Aula 302" />

                            <FormField
                                label="Nombre del Profesor"
                                value={teacherName}
                                onChange={(e) => setTeacherName(e.target.value)}
                                placeholder="Ej: Ing. Juan Pérez"
                            />
                            <FormField
                                label="Email del Profesor"
                                type="email"
                                value={teacherEmail}
                                onChange={(e) => setTeacherEmail(e.target.value)}
                                placeholder="ejemplo@ispc.edu.ar"
                            />

                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase">Comisiones</label>
                                <div className="flex flex-wrap gap-2.5 mt-1">
                                    {commissionsList.map((comm) => (
                                        <label key={comm.id} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selectedCommissions.includes(comm.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedCommissions(prev => [...prev, comm.id]);
                                                    } else {
                                                        setSelectedCommissions(prev => prev.filter(id => id !== comm.id));
                                                    }
                                                }}
                                                className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent-muted)] h-4 w-4"
                                            />
                                            <span>{comm.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {selectedCommissions.length > 1 && (
                                <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex flex-col gap-3">
                                    <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase">Personalizar Comisiones Adicionales (Opcional)</label>
                                    <p className="text-[10px] text-[var(--color-text-tertiary)] -mt-1.5">Si se dejan vacíos, heredarán los valores configurados arriba.</p>
                                    <div className="flex flex-col gap-4">
                                        {selectedCommissions.slice(1).map((commId) => {
                                            const comm = commissionsList.find(c => c.id === commId);
                                            if (!comm) return null;
                                            const override = commissionOverrides[commId] || {};
                                            return (
                                                <div key={commId} className="p-3 bg-[var(--color-bg-sidebar)] rounded-lg border border-[var(--color-border)] flex flex-col gap-3">
                                                    <span className="text-xs font-bold text-[var(--color-accent)]">{comm.name}</span>
                                                    <DropdownSelector
                                                        label="Día de Cursada"
                                                        options={[
                                                            { value: '', label: `Heredado (${days[dayOfWeek]})` },
                                                            ...days.map((d, i) => ({ value: String(i), label: d }))
                                                        ]}
                                                        selectedValue={override.dayOfWeek !== undefined ? String(override.dayOfWeek) : ''}
                                                        onChange={(val) => {
                                                            setCommissionOverrides(prev => ({
                                                                ...prev,
                                                                [commId]: {
                                                                    ...prev[commId],
                                                                    dayOfWeek: val !== '' ? Number(val) : undefined
                                                                }
                                                            }));
                                                        }}
                                                    />
                                                    <div className="grid gap-2 grid-cols-2">
                                                        <FormField
                                                            label="Hora de Inicio"
                                                            type="time"
                                                            value={override.startTime || ''}
                                                            onChange={(e) => {
                                                                setCommissionOverrides(prev => ({
                                                                    ...prev,
                                                                    [commId]: {
                                                                        ...prev[commId],
                                                                        startTime: e.target.value || undefined
                                                                    }
                                                                }));
                                                            }}
                                                            placeholder={`Heredado (${startTime})`}
                                                        />
                                                        <FormField
                                                            label="Hora de Fin"
                                                            type="time"
                                                            value={override.endTime || ''}
                                                            onChange={(e) => {
                                                                setCommissionOverrides(prev => ({
                                                                    ...prev,
                                                                    [commId]: {
                                                                        ...prev[commId],
                                                                        endTime: e.target.value || undefined
                                                                    }
                                                                }));
                                                            }}
                                                            placeholder={`Heredado (${endTime})`}
                                                        />
                                                    </div>
                                                    <FormField
                                                        label="Enlace de Videoconferencia"
                                                        value={override.meetLink || ''}
                                                        onChange={(e) => {
                                                            setCommissionOverrides(prev => ({
                                                                ...prev,
                                                                [commId]: {
                                                                    ...prev[commId],
                                                                    meetLink: e.target.value || undefined
                                                                }
                                                            }));
                                                        }}
                                                        placeholder={meetLink ? `Heredado (${meetLink})` : 'https://meet.google.com/...'}
                                                    />
                                                    <FormField
                                                        label="Nombre del Profesor"
                                                        value={override.teacherName || ''}
                                                        onChange={(e) => {
                                                            setCommissionOverrides(prev => ({
                                                                ...prev,
                                                                [commId]: {
                                                                    ...prev[commId],
                                                                    teacherName: e.target.value || undefined
                                                                }
                                                            }));
                                                        }}
                                                        placeholder={teacherName ? `Heredado (${teacherName})` : 'Profesor'}
                                                    />
                                                    <FormField
                                                        label="Email del Profesor"
                                                        type="email"
                                                        value={override.teacherEmail || ''}
                                                        onChange={(e) => {
                                                            setCommissionOverrides(prev => ({
                                                                ...prev,
                                                                [commId]: {
                                                                    ...prev[commId],
                                                                    teacherEmail: e.target.value || undefined
                                                                }
                                                            }));
                                                        }}
                                                        placeholder={teacherEmail ? `Heredado (${teacherEmail})` : 'email@ispc.edu.ar'}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                                <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                                <Button variant="primary" type="submit">Crear Horario</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isEditMeetModalOpen && editingClassSlot && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setIsEditMeetModalOpen(false); setEditingClassSlot(null); }} />
                    <div className="relative z-10 w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">Editar Horario de Cursada</h3>
                        <p className="text-xs text-[var(--color-text-secondary)] mb-4">Materia: <strong className="text-[var(--color-text-primary)]">{editingClassSlot.subjectName}</strong></p>
                        <form onSubmit={handleUpdateMeetLink} className="flex flex-col gap-4">
                            <DropdownSelector
                                label="Día de Cursada"
                                options={days.map((d, i) => ({ value: String(i), label: d }))}
                                selectedValue={String(editingClassSlot.dayOfWeek)}
                                onChange={(val) => setEditingClassSlot(prev => prev ? { ...prev, dayOfWeek: Number(val) } : null)}
                            />
                            <div className="grid gap-4 grid-cols-2">
                                <FormField
                                    label="Hora de Inicio"
                                    type="time"
                                    value={editingClassSlot.startTime}
                                    onChange={(e) => setEditingClassSlot(prev => prev ? { ...prev, startTime: e.target.value } : null)}
                                    required
                                />
                                <FormField
                                    label="Hora de Fin"
                                    type="time"
                                    value={editingClassSlot.endTime}
                                    onChange={(e) => setEditingClassSlot(prev => prev ? { ...prev, endTime: e.target.value } : null)}
                                    required
                                />
                            </div>
                            <FormField
                                label="Enlace de Videoconferencia"
                                value={editingClassSlot.meetLink}
                                onChange={(e) => setEditingClassSlot(prev => prev ? { ...prev, meetLink: e.target.value } : null)}
                                placeholder="https://meet.google.com/abc-defg-hij"
                            />

                            <FormField
                                label="Nombre del Profesor"
                                value={editingClassSlot.teacherName}
                                onChange={(e) => setEditingClassSlot(prev => prev ? { ...prev, teacherName: e.target.value } : null)}
                                placeholder="Ej: Ing. Juan Pérez"
                            />
                            <FormField
                                label="Email del Profesor"
                                type="email"
                                value={editingClassSlot.teacherEmail}
                                onChange={(e) => setEditingClassSlot(prev => prev ? { ...prev, teacherEmail: e.target.value } : null)}
                                placeholder="ejemplo@ispc.edu.ar"
                            />

                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase">Comisiones</label>
                                <div className="flex flex-wrap gap-2.5 mt-1">
                                    {commissionsList.map((comm) => (
                                        <label key={comm.id} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={editingClassSlot.commissionIds.includes(comm.id)}
                                                onChange={(e) => {
                                                    const current = editingClassSlot.commissionIds;
                                                    const updated = e.target.checked
                                                        ? [...current, comm.id]
                                                        : current.filter(id => id !== comm.id);
                                                    setEditingClassSlot(prev => prev ? { ...prev, commissionIds: updated } : null);
                                                }}
                                                className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent-muted)] h-4 w-4"
                                            />
                                            <span>{comm.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {editingClassSlot.commissionIds.length > 1 && (
                                <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex flex-col gap-3">
                                    <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase">Personalizar Comisiones Adicionales (Opcional)</label>
                                    <p className="text-[10px] text-[var(--color-text-tertiary)] -mt-1.5">Si se dejan vacíos, heredarán los valores configurados arriba.</p>
                                    <div className="flex flex-col gap-4">
                                        {editingClassSlot.commissionIds.slice(1).map((commId) => {
                                            const comm = commissionsList.find(c => c.id === commId);
                                            if (!comm) return null;
                                            const overrides = editingClassSlot.commissionOverrides || {};
                                            const override = overrides[commId] || {};
                                            return (
                                                <div key={commId} className="p-3 bg-[var(--color-bg-sidebar)] rounded-lg border border-[var(--color-border)] flex flex-col gap-3">
                                                    <span className="text-xs font-bold text-[var(--color-accent)]">{comm.name}</span>
                                                    <DropdownSelector
                                                        label="Día de Cursada"
                                                        options={[
                                                            { value: '', label: `Heredado (${days[editingClassSlot.dayOfWeek]})` },
                                                            ...days.map((d, i) => ({ value: String(i), label: d }))
                                                        ]}
                                                        selectedValue={override.dayOfWeek !== undefined ? String(override.dayOfWeek) : ''}
                                                        onChange={(val) => {
                                                            const newOverrides = {
                                                                ...overrides,
                                                                [commId]: {
                                                                    ...override,
                                                                    dayOfWeek: val !== '' ? Number(val) : undefined
                                                                }
                                                            };
                                                            setEditingClassSlot(prev => prev ? { ...prev, commissionOverrides: newOverrides } : null);
                                                        }}
                                                    />
                                                    <div className="grid gap-2 grid-cols-2">
                                                        <FormField
                                                            label="Hora de Inicio"
                                                            type="time"
                                                            value={override.startTime || ''}
                                                            onChange={(e) => {
                                                                const newOverrides = {
                                                                    ...overrides,
                                                                    [commId]: {
                                                                        ...override,
                                                                        startTime: e.target.value || undefined
                                                                    }
                                                                };
                                                                setEditingClassSlot(prev => prev ? { ...prev, commissionOverrides: newOverrides } : null);
                                                            }}
                                                            placeholder={`Heredado (${editingClassSlot.startTime})`}
                                                        />
                                                        <FormField
                                                            label="Hora de Fin"
                                                            type="time"
                                                            value={override.endTime || ''}
                                                            onChange={(e) => {
                                                                const newOverrides = {
                                                                    ...overrides,
                                                                    [commId]: {
                                                                        ...override,
                                                                        endTime: e.target.value || undefined
                                                                    }
                                                                };
                                                                setEditingClassSlot(prev => prev ? { ...prev, commissionOverrides: newOverrides } : null);
                                                            }}
                                                            placeholder={`Heredado (${editingClassSlot.endTime})`}
                                                        />
                                                    </div>
                                                    <FormField
                                                        label="Enlace de Videoconferencia"
                                                        value={override.meetLink || ''}
                                                        onChange={(e) => {
                                                            const newOverrides = {
                                                                ...overrides,
                                                                [commId]: {
                                                                    ...override,
                                                                    meetLink: e.target.value || undefined
                                                                }
                                                            };
                                                            setEditingClassSlot(prev => prev ? { ...prev, commissionOverrides: newOverrides } : null);
                                                        }}
                                                        placeholder={editingClassSlot.meetLink ? `Heredado (${editingClassSlot.meetLink})` : 'https://meet.google.com/...'}
                                                    />
                                                    <FormField
                                                        label="Nombre del Profesor"
                                                        value={override.teacherName || ''}
                                                        onChange={(e) => {
                                                            const newOverrides = {
                                                                ...overrides,
                                                                [commId]: {
                                                                    ...override,
                                                                    teacherName: e.target.value || undefined
                                                                }
                                                            };
                                                            setEditingClassSlot(prev => prev ? { ...prev, commissionOverrides: newOverrides } : null);
                                                        }}
                                                        placeholder={editingClassSlot.teacherName ? `Heredado (${editingClassSlot.teacherName})` : 'Profesor'}
                                                    />
                                                    <FormField
                                                        label="Email del Profesor"
                                                        type="email"
                                                        value={override.teacherEmail || ''}
                                                        onChange={(e) => {
                                                            const newOverrides = {
                                                                ...overrides,
                                                                [commId]: {
                                                                    ...override,
                                                                    teacherEmail: e.target.value || undefined
                                                                }
                                                            };
                                                            setEditingClassSlot(prev => prev ? { ...prev, commissionOverrides: newOverrides } : null);
                                                        }}
                                                        placeholder={editingClassSlot.teacherEmail ? `Heredado (${editingClassSlot.teacherEmail})` : 'email@ispc.edu.ar'}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                                <Button variant="ghost" type="button" onClick={() => { setIsEditMeetModalOpen(false); setEditingClassSlot(null); }}>Cancelar</Button>
                                <Button variant="primary" type="submit">Guardar Cambios</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmDialog isOpen={!!deleteSlotId} onClose={() => setDeleteSlotId(null)} onConfirm={handleDelete} title="Eliminar Horario" message="¿Estás seguro de que deseas eliminar este bloque horario semanal?" type="danger" />
        </div>
    );
};


// ── NOTICES TAB ──────────────────────────────────────────────
const SANoticesTab: React.FC = () => {
    const { activeGroup, user } = useAuth();
    const { notices, isLoading, refreshAll } = useSAGroupData();

    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingNotice, setEditingNotice] = useState<Notice | null>(null);
    const [chatNotice, setChatNotice] = useState<Notice | null>(null);
    const [replies, setReplies] = useState<ChatMessage[]>([]);
    const [isSendingReply, setIsSendingReply] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);

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
                await noticeRepository.create({ ...payload, groupId: activeGroup.id, authorId: user.id, authorName: user.name });
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

    return (
        <div className="flex flex-col gap-5">
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
                    headers={['Título Comunicado', 'Alcance', 'Fecha Emisión', 'Estado']}
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
                        <button onClick={() => handleToggleNotice(n)} className="flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer" title={n.active ? 'Desactivar aviso' : 'Activar aviso'}>
                            {n.active ? (
                                <div className="flex items-center gap-1 text-[var(--color-success)] font-semibold text-xs"><ToggleRight className="w-6 h-6" /><span>Activo</span></div>
                            ) : (
                                <div className="flex items-center gap-1 text-[var(--color-text-tertiary)] font-semibold text-xs"><ToggleLeft className="w-6 h-6" /><span>Pausado</span></div>
                            )}
                        </button>,
                    ]}
                    actions={[
                        { icon: 'edit', label: 'Editar aviso', onClick: (n) => { setEditingNotice(n); setIsFormOpen(true); } },
                        { 
                            icon: 'chat', 
                            label: 'Ver réplicas WhatsApp', 
                            onClick: (n) => handleOpenChat(n),
                            className: (n) => n.unreadRepliesCount && n.unreadRepliesCount > 0 
                                ? '!text-emerald-600 hover:!text-emerald-700 !bg-emerald-500/10 hover:!bg-emerald-500/20 !border-emerald-500/30' 
                                : '',
                            badgeCount: (n) => n.unreadRepliesCount || 0
                        },
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
                        <NoticeForm initialNotice={editingNotice || undefined} onSubmit={handleCreateOrUpdateNotice} onCancel={handleCancelForm} />
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

            <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Eliminar Aviso" message="¿Estás seguro de que deseas borrar este aviso?" type="danger" />
        </div>
    );
};

// ── MODERATION TAB ───────────────────────────────────────────
const SAModerationTab: React.FC = () => {
    const { activeGroup, user } = useAuth();
    const { bannedUsers, isLoading, refreshAll } = useSAGroupData();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [phone, setPhone] = useState('');
    const [studentName, setStudentName] = useState('');
    const [reason, setReason] = useState('');
    const [unbanId, setUnbanId] = useState<string | null>(null);

    const handleBan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!phone.trim() || !reason.trim()) { toast.error('Completá teléfono y causa de baneo.'); return; }
        if (!activeGroup || !user) return;
        try {
            await moderationRepository.ban({ phone: phone.trim(), studentName: studentName.trim() || undefined, reason: reason.trim(), groupId: activeGroup.id, bannedBy: user.id, bannedByName: user.name });
            toast.success('Número de WhatsApp bloqueado en el bot.');
            setIsModalOpen(false);
            setPhone(''); setStudentName(''); setReason('');
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

    return (
        <div className="flex flex-col gap-5">
            <div className="flex justify-between items-center">
                <h3 className="text-base font-bold text-[var(--color-text-primary)]">Restricciones de Acceso (Baneos)</h3>
                <Button variant="primary" onClick={() => setIsModalOpen(true)} className="flex items-center gap-1.5 bg-[var(--color-danger)] hover:bg-[var(--color-danger-hover)]">
                    <UserX className="w-4 h-4" />
                    Bloquear Teléfono
                </Button>
            </div>

            <div className="p-4 border border-[var(--color-danger)]/20 rounded-xl bg-[var(--color-danger-muted)] flex gap-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                <ShieldAlert className="w-4 h-4 text-[var(--color-danger)] flex-shrink-0" />
                <span>Los números bloqueados recibirán un aviso automático de expulsión cuando intenten interactuar con el chatbot.</span>
            </div>

            {isLoading ? (
                <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando baneos...</div>
            ) : (
                <DataTable
                    headers={['Alumno / Teléfono', 'Razón Bloqueo', 'Fecha Bloqueo', 'Moderador']}
                    data={bannedUsers}
                    searchPlaceholder="Buscar por teléfono o nombre..."
                    searchFields={['phone', 'studentName']}
                    renderRowCells={(b) => [
                        <div className="flex flex-col"><span className="font-semibold">{b.studentName || 'Alumno Anónimo'}</span><span className="text-xs text-[var(--color-text-secondary)] font-mono">{b.phone}</span></div>,
                        b.reason,
                        new Date(b.bannedAt).toLocaleDateString(),
                        b.bannedByName,
                    ]}
                    actions={[{ icon: 'delete', label: 'Desbloquear número', onClick: (b) => setUnbanId(b.id), variant: 'outline' }]}
                />
            )}

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
                    <div className="relative z-10 w-full max-w-md bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6">
                        <h3 className="text-lg font-bold text-[var(--color-danger)] mb-4 flex items-center gap-2">
                            <UserX className="w-5 h-5" />
                            Bloquear Cuenta WhatsApp
                        </h3>
                        <form onSubmit={handleBan} className="flex flex-col gap-4">
                            <FormField label="Número de WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5491112345678" required />
                            <FormField label="Nombre del Alumno (Opcional)" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Ej: Juan Pérez" />
                            <FormField label="Razón de Bloqueo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: Spam masivo" isTextArea rows={3} required />
                            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                                <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                                <Button variant="danger" type="submit">Confirmar Bloqueo</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmDialog isOpen={!!unbanId} onClose={() => setUnbanId(null)} onConfirm={handleUnban} title="Desbloquear Número" message="¿Estás seguro de que deseas desbloquear este número?" type="danger" />
        </div>
    );
};

const GroupsManagerView: React.FC = () => {
    const { activeGroup, setActiveGroup } = useAuth();
    const [groups, setGroups] = useState<Group[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState<Group | null>(null);

    // Modal fields
    const [cohortYear, setCohortYear] = useState(2026);
    const [entryYear, setEntryYear] = useState(1);
    const [yearsConfig, setYearsConfig] = useState<{ year: number; commissionCount: number }[]>([]);
    const [commissionsCount, setCommissionsCount] = useState<number>(1);

    // Filtering
    const [filterType, setFilterType] = useState<'all' | 'cursada' | 'general'>('all');

    // Deletion states
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [deleteStep, setDeleteStep] = useState<1 | 2>(1);

    const fetchGroups = async () => {
        setIsLoading(true);
        try {
            const allGroups = await groupRepository.getAll();
            const config = await groupRepository.getYearsConfig();
            setYearsConfig(config);
            const groupsWithCohorts = await Promise.all(
                allGroups.map(async (g) => {
                    const cohortsList = await groupRepository.getCohorts(g.id);
                    const derivedCohortYear = cohortsList[0]?.year || (g.name.includes('2024') ? 2024 : g.name.includes('2025') ? 2025 : 2026);
                    return {
                        ...g,
                        cohortYear: derivedCohortYear
                    };
                })
            );
            setGroups(groupsWithCohorts);
        } catch {
            toast.error('Error al cargar grupos.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchGroups(); }, []);

    const handleOpenEditModal = (group: Group) => {
        setEditingGroup(group);
        setCohortYear(group.cohortYear || 2026);
        const y = group.entryYear || 1;
        setEntryYear(y);
        const match = yearsConfig.find(c => c.year === y);
        setCommissionsCount(match ? match.commissionCount : 1);
        setIsModalOpen(true);
    };

    const handleEntryYearChange = (newYearVal: string) => {
        const y = Number(newYearVal);
        setEntryYear(y);
        const match = yearsConfig.find(c => c.year === y);
        setCommissionsCount(match ? match.commissionCount : 1);
    };

    const handleSaveGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingGroup) return;
        try {
            await groupRepository.update(editingGroup.id, {
                entryYear: editingGroup.type === 'cursada' ? entryYear : undefined,
                cohortYear,
                commissionsCount: editingGroup.type === 'cursada' ? commissionsCount : undefined,
            });
            toast.success('Configuración de grupo guardada.');
            setIsModalOpen(false);
            fetchGroups();
        } catch {
            toast.error('Error al guardar grupo.');
        }
    };

    const handleDeleteGroup = async () => {
        if (!deleteConfirmId) return;
        try {
            await groupRepository.delete(deleteConfirmId);
            toast.success('Grupo eliminado.');
            setDeleteConfirmId(null);
            fetchGroups();
        } catch {
            toast.error('Error al eliminar.');
        }
    };

    const filteredGroups = groups.filter((g) => {
        if (filterType === 'cursada') return g.type === 'cursada';
        if (filterType === 'general') return g.type === 'general';
        return true;
    });

    const handleDeleteClick = (groupId: string) => {
        setDeleteConfirmId(groupId);
        setDeleteStep(1);
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[var(--color-bg-sidebar)] p-4 border border-[var(--color-border)] rounded-xl">
                <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">Grupos Académicos (WhatsApp)</h3>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Los grupos son sincronizados automáticamente desde el Bot. Aquí puedes configurar sus parámetros operativos.</p>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Mostrar:</label>
                    <div className="w-48">
                        <DropdownSelector
                            options={[
                                { value: 'all', label: 'Todos los Grupos' },
                                { value: 'cursada', label: 'Grupos de Cursada' },
                                { value: 'general', label: 'Grupos Generales' },
                            ]}
                            selectedValue={filterType}
                            onChange={(val) => setFilterType(val as any)}
                        />
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando grupos...</div>
            ) : (
                <DataTable
                    headers={['✓', 'Grupo / Curso', 'Cohorte', 'Año de cursada']}
                    data={filteredGroups}
                    searchPlaceholder="Buscar por nombre de grupo o institución..."
                    searchFields={['name', 'institutionName']}
                    renderRowCells={(g) => [
                        <div className="flex justify-center">
                            <input
                                type="checkbox"
                                checked={activeGroup?.id === g.id}
                                onChange={() => setActiveGroup(g)}
                                className="w-4.5 h-4.5 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] cursor-pointer"
                            />
                        </div>,
                        <div className="flex items-center gap-2.5">
                            <div className={`p-2 rounded-lg font-bold text-[10px] ${g.type === 'general' ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                {g.type === 'general' ? 'GEN' : 'CUR'}
                            </div>
                            <div className="flex flex-col">
                                <span className="font-semibold text-sm">{g.name}</span>
                                <span className="text-[11px] text-[var(--color-text-tertiary)]">{g.institutionName}</span>
                            </div>
                        </div>,
                        <span className="font-medium text-sm">{g.cohortYear || '—'}</span>,
                        <span className="font-medium text-sm">{g.type === 'cursada' ? `${g.entryYear || '1'}er Año` : '—'}</span>,
                    ]}
                    actions={[
                        { icon: 'edit', label: 'Editar Configuración', onClick: (g) => handleOpenEditModal(g) },
                        { icon: 'delete', label: 'Eliminar Grupo', onClick: (g) => handleDeleteClick(g.id), variant: 'danger' },
                    ]}
                />
            )}

            {isModalOpen && editingGroup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
                    <div className="relative z-10 w-full max-w-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 overflow-y-auto max-h-[90vh]">
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">Editar Configuración de Grupo</h3>
                        <form onSubmit={handleSaveGroup} className="flex flex-col gap-4">
                            {/* Read-only info (set by developer/bot, not editable here) */}
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1 block">Grupo (WhatsApp)</label>
                                    <p className="text-sm font-bold text-[var(--color-text-primary)] bg-[var(--color-bg-app)] border border-[var(--color-border)] rounded-lg px-3 py-2.5">{editingGroup.name || '—'}</p>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1 block">Institución</label>
                                    <p className="text-sm font-bold text-[var(--color-text-primary)] bg-[var(--color-bg-app)] border border-[var(--color-border)] rounded-lg px-3 py-2.5">{editingGroup.institutionName || '—'}</p>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1 block">Administradores del Bot</label>
                                {editingGroup.admins && editingGroup.admins.length > 0 ? (
                                    <div className="flex flex-col gap-1.5 bg-[var(--color-bg-app)] border border-[var(--color-border)] rounded-lg p-3">
                                        {editingGroup.admins.map((adm, i) => (
                                            <div key={i} className="flex justify-between text-xs font-semibold">
                                                <span className="text-[var(--color-text-primary)]">{adm.name}</span>
                                                <span className="text-[var(--color-text-tertiary)] font-mono">{adm.phone}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-[var(--color-text-tertiary)] italic">No hay administradores registrados.</p>
                                )}
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-[var(--color-border)]">
                                <DropdownSelector
                                    label="Cohorte"
                                    options={[
                                        { value: '2024', label: 'Cohorte 2024' },
                                        { value: '2025', label: 'Cohorte 2025' },
                                        { value: '2026', label: 'Cohorte 2026' },
                                        { value: '2027', label: 'Cohorte 2027' },
                                        { value: '2028', label: 'Cohorte 2028' },
                                    ]}
                                    selectedValue={String(cohortYear)}
                                    onChange={(val) => setCohortYear(Number(val))}
                                    required
                                />

                                {editingGroup.type === 'cursada' && (
                                    <DropdownSelector
                                        label="Año de Cursada"
                                        options={[
                                            { value: '1', label: '1er Año' },
                                            { value: '2', label: '2do Año' },
                                            { value: '3', label: '3er Año' },
                                        ]}
                                        selectedValue={String(entryYear)}
                                        onChange={handleEntryYearChange}
                                        required
                                    />
                                )}
                            </div>

                            {editingGroup.type === 'cursada' && (
                                <div>
                                    <DropdownSelector
                                        label="Cantidad de Comisiones"
                                        options={[
                                            { value: '1', label: 'Única Comisión' },
                                            { value: '2', label: '2 Comisiones' },
                                            { value: '3', label: '3 Comisiones' },
                                            { value: '4', label: '4 Comisiones' },
                                        ]}
                                        selectedValue={String(commissionsCount)}
                                        onChange={(val) => setCommissionsCount(Number(val))}
                                        required
                                    />
                                </div>
                            )}

                            <p className="text-[11px] text-[var(--color-text-tertiary)] bg-[var(--color-bg-app)] p-3 border border-[var(--color-border)] rounded-lg leading-relaxed">
                                <strong>Importante:</strong> Al modificar la cohorte o el año de cursada, se resetearán las materias, enlaces de clase y exámenes asociados a este grupo.
                            </p>

                            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                                <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                                <Button variant="primary" type="submit">Guardar Cambios</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {deleteConfirmId && deleteStep === 1 && (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setDeleteConfirmId(null)}
                    onConfirm={() => setDeleteStep(2)}
                    title="Eliminar Grupo Académico - Paso 1/2"
                    message="Al eliminar este grupo, se desvinculará de la base de datos local y se perderán todos los horarios y exámenes asociados. ¿Seguro que desea proceder?"
                    confirmText="Siguiente paso"
                    type="danger"
                />
            )}

            {deleteConfirmId && deleteStep === 2 && (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setDeleteConfirmId(null)}
                    onConfirm={handleDeleteGroup}
                    title="Confirmación Requerida - Paso 2/2"
                    message="¡ADVERTENCIA DE SEGURIDAD! Esta acción es drástica e irreversible. Desvinculará las clases y exámenes asociados al grupo. ¿Desea eliminar el grupo de verdad?"
                    confirmText="Eliminar permanentemente"
                    type="danger"
                />
            )}
        </div>
    );
};

// ── SETTINGS ─────────────────────────────────────────────────
const SettingsView: React.FC = () => {
    const [aiQuestionsEnabled, setAiQuestionsEnabled] = useState(() => {
        const saved = localStorage.getItem('ai_questions_enabled');
        return saved !== 'false';
    });

    const [selectedTheme, setSelectedTheme] = useState(() => {
        return localStorage.getItem('app_theme') || 'classic-dark';
    });

    const [examColors, setExamColors] = useState(() => {
        const saved = localStorage.getItem('exam_colors');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) { }
        }
        return {
            evidence: '#10b981',
            abp: '#8b5cf6',
            final: '#ef4444',
            colloquium: '#f59e0b'
        };
    });

    const [themeTypeFilter, setThemeTypeFilter] = useState<'all' | 'Oscuro' | 'Claro'>('all');

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
            previewCard: '#ffffff',
            previewAccent: '#345288',
            description: 'Tonos cálidos de tierra con contrastes fríos de agua.'
        }
    ];

    const filteredThemes = themesList.filter((t) => {
        if (themeTypeFilter === 'all') return true;
        return t.type === themeTypeFilter;
    });

    const handleThemeChange = (themeId: string) => {
        setSelectedTheme(themeId);
        localStorage.setItem('app_theme', themeId);
        if (themeId === 'classic-dark') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', themeId);
        }
        window.dispatchEvent(new Event('theme-changed'));
        toast.success(`Tema cambiado a ${themesList.find(t => t.id === themeId)?.name}`);
    };

    const handleColorChange = (type: string, color: string) => {
        const newColors = { ...examColors, [type]: color };
        setExamColors(newColors);
        localStorage.setItem('exam_colors', JSON.stringify(newColors));
        window.dispatchEvent(new Event('exam-colors-changed'));
    };

    const handleSave = () => {
        localStorage.setItem('ai_questions_enabled', String(aiQuestionsEnabled));
        toast.success('Ajustes guardados correctamente.');
    };

    return (
        <div className="flex flex-col gap-6">
            {/* AI Settings */}
            <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex flex-col gap-6">
                <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">Integración de Inteligencia Artificial</h3>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Controla la disponibilidad del motor de IA para las consultas de alumnos.</p>
                </div>

                <div className="flex items-center gap-3 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-sidebar)]">
                    <input
                        id="ai-toggle-checkbox"
                        type="checkbox"
                        checked={aiQuestionsEnabled}
                        onChange={(e) => setAiQuestionsEnabled(e.target.checked)}
                        className="w-4.5 h-4.5 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] cursor-pointer"
                    />
                    <label htmlFor="ai-toggle-checkbox" className="text-sm font-semibold text-[var(--color-text-primary)] cursor-pointer select-none">
                        Habilitar preguntas con IA
                    </label>
                </div>

                <div className="pt-4 border-t border-[var(--color-border)]">
                    <Button variant="primary" onClick={handleSave}>Guardar Ajustes</Button>
                </div>
            </div>

            {/* Theme Settings */}
            <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[var(--color-border)] pb-4 mb-2">
                    <div>
                        <h3 className="text-base font-bold text-[var(--color-text-primary)]">Diseño y Tema Visual</h3>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Personaliza el aspecto general del panel de administración.</p>
                    </div>
                    <div className="flex items-center gap-2.5 w-full sm:w-auto">
                        <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase whitespace-nowrap">Filtrar:</span>
                        <div className="w-40">
                            <DropdownSelector
                                options={[
                                    { value: 'all', label: 'Todos los Temas' },
                                    { value: 'Oscuro', label: 'Temas Oscuros' },
                                    { value: 'Claro', label: 'Temas Claros' },
                                ]}
                                selectedValue={themeTypeFilter}
                                onChange={(val) => setThemeTypeFilter(val as any)}
                            />
                        </div>
                    </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredThemes.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => handleThemeChange(t.id)}
                            className={`
                text-left p-4 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col justify-between h-40 group hover:shadow-md
                ${selectedTheme === t.id
                                    ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30 bg-[var(--color-bg-card-hover)]'
                                    : 'border-[var(--color-border)] bg-[var(--color-bg-sidebar)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-card-hover)]'
                                }
              `}
                        >
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-[var(--color-text-primary)]">{t.name}</span>
                                    <Badge variant={t.type === 'Oscuro' ? 'accent' : 'info'}>{t.type}</Badge>
                                </div>
                                <p className="text-xs text-[var(--color-text-tertiary)] leading-relaxed group-hover:text-[var(--color-text-secondary)]">
                                    {t.description}
                                </p>
                            </div>

                            {/* Colors preview line */}
                            <div className="flex items-center gap-3 mt-3">
                                <div className="flex items-center -space-x-1.5">
                                    <div className="w-5 h-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: t.previewBg }} title="Fondo" />
                                    <div className="w-5 h-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: t.previewCard }} title="Tarjeta" />
                                    <div className="w-5 h-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: t.previewAccent }} title="Acento" />
                                </div>
                                <span className="text-[10px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider group-hover:text-[var(--color-text-secondary)]">
                                    Vista previa
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Custom Exam Colors */}
            <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex flex-col gap-4">
                <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">Colores Personalizados de Exámenes</h3>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Elige el color identificativo único para cada tipo de examen en el almanaque.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                        { id: 'evidence', name: 'Evidencia (Entregables / TPs)' },
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
        </div>
    );
};
const SAAdminsTab: React.FC = () => {
    const [admins, setAdmins] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeDemoteUserId, setActiveDemoteUserId] = useState<string | null>(null);

    const fetchAdminsAndGroups = async () => {
        setIsLoading(true);
        try {
            const [adminList, groupList] = await Promise.all([
                adminRepository.getAll(),
                groupRepository.getAll(),
            ]);
            setAdmins(adminList);
            setGroups(groupList);
        } catch {
            toast.error('Error al cargar datos.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAdminsAndGroups();
    }, []);

    // Real-time search with debounce
    useEffect(() => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }
        const delayDebounceFn = setTimeout(async () => {
            setIsSearching(true);
            try {
                const results = await adminRepository.searchUsers(searchQuery);
                setSearchResults(results);
            } catch {
                toast.error('Error al buscar usuarios.');
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [searchQuery]);

    const handleAddAdmin = async (asSuper: boolean) => {
        if (!selectedUser) return;
        if (!asSuper && !selectedGroupId) {
            toast.error('Por favor, selecciona un grupo.');
            return;
        }
        try {
            await adminRepository.createOrUpdate(selectedUser.userId, asSuper, asSuper ? undefined : selectedGroupId);
            toast.success('Administrador designado con éxito.');
            setSelectedUser(null);
            setSearchQuery('');
            setSearchResults([]);
            fetchAdminsAndGroups();
        } catch {
            toast.error('Error al designar administrador.');
        }
    };

    const handleRemoveAdmin = async (userId: string, email: string) => {
        if (email === 'cristian.v62@gmail.com') return;
        if (!window.confirm(`¿Estás seguro de que deseas eliminar a este administrador del sistema?`)) {
            return;
        }
        try {
            await adminRepository.delete(userId);
            toast.success('Administrador eliminado.');
            fetchAdminsAndGroups();
        } catch {
            toast.error('Error al eliminar administrador.');
        }
    };

    const handlePromoteToSuper = async (userId: string) => {
        if (!window.confirm('¿Estás seguro de que deseas ascender a este administrador a Super Admin? Tendrá acceso a todos los grupos.')) {
            return;
        }
        try {
            await adminRepository.createOrUpdate(userId, true);
            toast.success('Administrador ascendido a Super Admin.');
            fetchAdminsAndGroups();
        } catch {
            toast.error('Error al ascender administrador.');
        }
    };

    const handleDemoteToGroupAdmin = async (userId: string, groupId: string) => {
        if (!groupId) return;
        try {
            await adminRepository.createOrUpdate(userId, false, groupId);
            toast.success('Rol cambiado a Administrador de Grupo.');
            setActiveDemoteUserId(null);
            fetchAdminsAndGroups();
        } catch {
            toast.error('Error al cambiar rol.');
        }
    };

    return (
        <div className="space-y-6">
            <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
                <div>
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Administradores del Sistema</h2>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                        Gestioná quiénes tienen permisos para administrar grupos o todo el sistema.
                    </p>
                </div>

                {isLoading ? (
                    <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando administradores...</div>
                ) : (
                    <div className="border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border)] bg-[var(--color-bg-card)]">
                        {admins.length === 0 ? (
                            <div className="p-6 text-center text-xs text-[var(--color-text-tertiary)] italic">
                                No hay administradores registrados.
                            </div>
                        ) : (
                            admins.map((admin) => {
                                const isCreator = admin.email === 'cristian.v62@gmail.com';
                                return (
                                    <div key={admin.userId} className="p-4 flex flex-wrap items-center justify-between hover:bg-[var(--color-bg-sidebar)] transition-colors gap-4">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-[var(--color-text-primary)]">{admin.name}</span>
                                                {isCreator ? (
                                                    <Badge variant="accent">Creador del Sistema</Badge>
                                                ) : (
                                                    <Badge variant={admin.isSuperAdmin ? 'accent' : 'info'}>
                                                        {admin.isSuperAdmin ? 'Super Admin' : 'Admin de Grupo'}
                                                    </Badge>
                                                )}
                                                {!admin.isSuperAdmin && admin.groupName && (
                                                    <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                                                        Grupo: <strong>{admin.groupName}</strong>
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs text-[var(--color-text-tertiary)]">{admin.email}</span>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            {!isCreator && (
                                                <>
                                                    {admin.isSuperAdmin ? (
                                                        <div className="flex items-center gap-2">
                                                            {activeDemoteUserId === admin.userId ? (
                                                                <div className="flex items-center gap-1.5 animate-fade-in">
                                                                    <select
                                                                        onChange={(e) => handleDemoteToGroupAdmin(admin.userId, e.target.value)}
                                                                        defaultValue=""
                                                                        className="text-xs bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                                                                    >
                                                                        <option value="" disabled>Asignar a Grupo...</option>
                                                                        {groups.map((g) => (
                                                                            <option key={g.id} value={g.id}>{g.name}</option>
                                                                        ))}
                                                                    </select>
                                                                    <Button size="sm" variant="ghost" onClick={() => setActiveDemoteUserId(null)}>
                                                                        Cancelar
                                                                    </Button>
                                                                </div>
                                                            ) : (
                                                                <Button size="sm" variant="outline" onClick={() => setActiveDemoteUserId(admin.userId)}>
                                                                    Cambiar a Admin de Grupo
                                                                </Button>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <Button size="sm" variant="outline" onClick={() => handlePromoteToSuper(admin.userId)}>
                                                            Ascender a Super Admin
                                                        </Button>
                                                    )}
                                                    <Button variant="danger" size="sm" onClick={() => handleRemoveAdmin(admin.userId, admin.email || '')}>
                                                        Remover
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
                <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">Designar Nuevo Administrador</h3>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                        Filtrá primero por el grupo que administrará, luego buscá un usuario registrado para otorgarle permisos.
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="max-w-md">
                        <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1.5 block">
                            Seleccionar Grupo *
                        </label>
                        <select
                            value={selectedGroupId}
                            onChange={(e) => {
                                setSelectedGroupId(e.target.value);
                                setSelectedUser(null);
                                setSearchQuery('');
                                setSearchResults([]);
                            }}
                            className="w-full px-3 py-2 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-border-focus)] transition-all duration-[var(--transition-fast)]"
                        >
                            <option value="" disabled>Elegí un grupo...</option>
                            {groups.map((g) => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </select>
                    </div>

                    {selectedGroupId && (
                        <div className="grid gap-6 md:grid-cols-2 animate-fade-in">
                            <div className="space-y-4">
                                <FormField
                                    label="Buscar Usuario"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Escribí nombre, teléfono o email..."
                                    className="w-full"
                                />

                                {isSearching ? (
                                    <div className="text-xs text-[var(--color-text-tertiary)] italic">Buscando usuarios...</div>
                                ) : (
                                    searchResults.length > 0 && (
                                        <div className="border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border)] bg-[var(--color-bg-sidebar)] max-h-60 overflow-y-auto">
                                            {searchResults.map((usr) => (
                                                <button
                                                    key={usr.userId}
                                                    type="button"
                                                    onClick={() => setSelectedUser(usr)}
                                                    className={`w-full p-3 text-left flex justify-between items-center hover:bg-[var(--color-bg-card)] transition-colors ${selectedUser?.userId === usr.userId ? 'bg-[var(--color-accent-muted)]/20 border-l-4 border-[var(--color-accent)]' : ''
                                                        }`}
                                                >
                                                    <div>
                                                        <p className="text-xs font-bold text-[var(--color-text-primary)]">{usr.name}</p>
                                                        <p className="text-[10px] text-[var(--color-text-tertiary)]">{usr.email || usr.userId}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )
                                )}
                            </div>

                            {selectedUser && (
                                <div className="p-5 border border-[var(--color-border)] bg-[var(--color-bg-sidebar)] rounded-xl space-y-4 animate-fade-in self-start">
                                    <div>
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">Designar como Administrador</h4>
                                        <p className="text-sm font-bold text-[var(--color-text-primary)] mt-2">
                                            ¿Querés designar a {selectedUser.name} como Administrador del grupo {groups.find(g => g.id === selectedGroupId)?.name}?
                                        </p>
                                        <p className="text-xs text-[var(--color-text-secondary)] mt-1">{selectedUser.email}</p>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="primary" size="sm" onClick={() => handleAddAdmin(false)}>
                                            Confirmar como Admin de Grupo
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => handleAddAdmin(true)}>
                                            Designar como Super Admin (Global)
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => setSelectedUser(null)}>
                                            Cancelar
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const SAAuthorizedEmailsTab: React.FC = () => {
    const [emails, setEmails] = useState<any[]>([]);
    const [newEmail, setNewEmail] = useState('');
    const [description, setDescription] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const fetchEmails = async () => {
        setIsLoading(true);
        try {
            const list = await authorizedEmailRepository.getAll();
            setEmails(list);
        } catch {
            toast.error('Error al cargar correos autorizados.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchEmails();
    }, []);

    const handleAddEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEmail.trim()) return;
        setIsSaving(true);
        try {
            await authorizedEmailRepository.create(newEmail.trim().toLowerCase(), description);
            toast.success('Correo autorizado agregado con éxito.');
            setNewEmail('');
            setDescription('');
            fetchEmails();
        } catch {
            toast.error('Error al agregar correo.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemoveEmail = async (email: string) => {
        try {
            await authorizedEmailRepository.delete(email);
            toast.success('Correo autorizado eliminado.');
            fetchEmails();
        } catch {
            toast.error('Error al eliminar correo.');
        }
    };

    return (
        <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6">
                <div>
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Emails Autorizados</h2>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                        Lista de correos institucionales cuyos mensajes se enviarán automáticamente a los grupos de WhatsApp correspondientes con cabecera institucional.
                    </p>
                </div>

                {isLoading ? (
                    <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando emails autorizados...</div>
                ) : (
                    <div className="border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border)] bg-[var(--color-bg-sidebar)]">
                        {emails.length === 0 ? (
                            <div className="p-6 text-center text-xs text-[var(--color-text-tertiary)] italic">
                                No hay correos autorizados registrados.
                            </div>
                        ) : (
                            emails.map((item) => (
                                <div key={item.email} className="p-4 flex items-center justify-between hover:bg-[var(--color-bg-card)] transition-colors">
                                    <div>
                                        <span className="text-sm font-bold text-[var(--color-text-primary)]">{item.email}</span>
                                        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{item.description || 'Sin descripción'}</p>
                                    </div>
                                    <Button variant="danger" size="sm" onClick={() => handleRemoveEmail(item.email)}>
                                        Eliminar
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex flex-col gap-5">
                <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">Autorizar Nuevo Email</h3>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                        Registrá una dirección de correo institucional para permitirle enviar alertas con membrete oficial.
                    </p>
                </div>
                <form onSubmit={handleAddEmail} className="space-y-4">
                    <FormField
                        label="Correo Electrónico"
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="ejemplo@institucion.edu"
                        required
                    />
                    <FormField
                        label="Descripción / Área (Opcional)"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ej: Bedelía de Informática"
                    />
                    <Button type="submit" variant="primary" className="w-full" loading={isSaving}>
                        Autorizar Email
                    </Button>
                </form>
            </div>
        </div>
    );
};

export const SALifecycleTab: React.FC = () => {
    const { user } = useAuth();
    const canEdit = user?.role === 'super_admin' || user?.role === 'institutional';
    const currentYearVal = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYearVal);
    const [holidays, setHolidays] = useState<Array<{ id?: number; start_date: string; event_name: string }>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [newHolidayDate, setNewHolidayDate] = useState('');
    const [newHolidayName, setNewHolidayName] = useState('');

    const [eventDates, setEventDates] = useState<{
        [key: string]: { start_date: string; end_date: string; event_name: string };
    }>({
        start_classes_advanced: { start_date: '', end_date: '', event_name: 'Inicio Clases (2° y 3° Año)' },
        start_classes_first_year: { start_date: '', end_date: '', event_name: 'Inicio Clases (1er Año)' },
        end_first_semester: { start_date: '', end_date: '', event_name: 'Fin del 1er Cuatrimestre' },
        start_second_semester: { start_date: '', end_date: '', event_name: 'Inicio del 2do Cuatrimestre' },
        end_second_semester: { start_date: '', end_date: '', event_name: 'Fin del 2do Cuatrimestre' },
        graduation: { start_date: '', end_date: '', event_name: 'Colación y Graduación' },
    });

    const fetchLifecycle = async () => {
        setIsLoading(true);
        try {
            const list = await academicCycleRepository.getEvents(selectedYear);

            const newDates = {
                start_classes_advanced: { start_date: '', end_date: '', event_name: 'Inicio Clases (2° y 3° Año)' },
                start_classes_first_year: { start_date: '', end_date: '', event_name: 'Inicio Clases (1er Año)' },
                end_first_semester: { start_date: '', end_date: '', event_name: 'Fin del 1er Cuatrimestre' },
                start_second_semester: { start_date: '', end_date: '', event_name: 'Inicio del 2do Cuatrimestre' },
                end_second_semester: { start_date: '', end_date: '', event_name: 'Fin del 2do Cuatrimestre' },
                graduation: { start_date: '', end_date: '', event_name: 'Colación y Graduación' },
            };

            const holidayList: any[] = [];

            list.forEach((evt) => {
                const type = evt.eventType || evt.event_type;
                const name = evt.eventName || evt.event_name;
                const start = evt.startDate || evt.start_date;
                const end = evt.endDate || evt.end_date;

                if (type === 'holiday') {
                    holidayList.push({
                        id: evt.id,
                        start_date: start ? start.substring(0, 10) : '',
                        event_name: name || ''
                    });
                } else if (newDates[type as keyof typeof newDates]) {
                    newDates[type as keyof typeof newDates].start_date = start ? start.substring(0, 10) : '';
                    newDates[type as keyof typeof newDates].end_date = end ? end.substring(0, 10) : '';
                    if (name) {
                        newDates[type as keyof typeof newDates].event_name = name;
                    }
                }
            });

            holidayList.sort((a, b) => a.start_date.localeCompare(b.start_date));

            setEventDates(newDates);
            setHolidays(holidayList);
        } catch {
            toast.error('Error al obtener ciclo académico.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchLifecycle();
    }, [selectedYear]);

    const handleDateChange = (type: string, field: 'start_date' | 'end_date', value: string) => {
        setEventDates((prev) => ({
            ...prev,
            [type]: {
                ...prev[type],
                [field]: value,
            },
        }));
    };

    const handleAddHoliday = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newHolidayDate || !newHolidayName.trim()) {
            toast.error('Completá la fecha y el nombre del feriado.');
            return;
        }

        const newH = {
            start_date: newHolidayDate,
            event_name: newHolidayName.trim()
        };

        const updated = [...holidays, newH];
        updated.sort((a, b) => a.start_date.localeCompare(b.start_date));
        setHolidays(updated);
        setNewHolidayDate('');
        setNewHolidayName('');
        toast.success('Feriado agregado temporalmente. Guardá los cambios para confirmar.');
    };

    const handleRemoveHoliday = (idx: number) => {
        const updated = holidays.filter((_, i) => i !== idx);
        setHolidays(updated);
        toast.info('Feriado removido temporalmente. Guardá los cambios para confirmar.');
    };

    const handleSaveAll = async () => {
        setIsSaving(true);
        try {
            const combined: any[] = [];

            Object.entries(eventDates).forEach(([type, data]) => {
                if (data.start_date) {
                    combined.push({
                        event_type: type,
                        event_name: data.event_name,
                        start_date: data.start_date,
                        end_date: null
                    });
                }
            });

            // Automatically calculate winter_break (receso de invierno) from end of 1st semester to start of 2nd semester
            if (eventDates.end_first_semester && eventDates.end_first_semester.start_date) {
                try {
                    const endFirstDate = new Date(eventDates.end_first_semester.start_date + 'T00:00:00');
                    const getMonday = (d: Date) => {
                        const result = new Date(d);
                        const day = result.getDay();
                        if (day === 1) return result;
                        const distance = (day === 0) ? 1 : (8 - day);
                        result.setDate(result.getDate() + distance);
                        return result;
                    };
                    const winterStart = getMonday(endFirstDate);
                    const winterEnd = new Date(winterStart);
                    winterEnd.setDate(winterEnd.getDate() + 11); // 2-week break ending on the second Friday (11 days later)

                    combined.push({
                        event_type: 'winter_break',
                        event_name: 'Receso de Invierno',
                        start_date: winterStart.toISOString().substring(0, 10),
                        end_date: winterEnd.toISOString().substring(0, 10)
                    });
                } catch (err) {
                    console.error('Error calculating winter_break:', err);
                }
            }

            // Automatically calculate end_of_year (receso de verano starts around mid Dec)
            if (eventDates.end_second_semester && eventDates.end_second_semester.start_date) {
                combined.push({
                    event_type: 'end_of_year',
                    event_name: 'Fin del Ciclo Lectivo',
                    start_date: `${selectedYear}-12-10`,
                    end_date: `${selectedYear}-12-23`
                });
            }

            holidays.forEach((h) => {
                combined.push({
                    event_type: 'holiday',
                    event_name: h.event_name,
                    start_date: h.start_date,
                    end_date: null
                });
            });

            await academicCycleRepository.saveEvents(selectedYear, combined);
            toast.success('Calendario académico guardado con éxito.');
            fetchLifecycle();
        } catch (e: any) {
            toast.error(e.message || 'Error al guardar el calendario.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Calendario y Ciclo Académico</h2>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                        Configurá las fechas clave del año lectivo, el receso invernal, el inicio de clases (diferenciado para 1er año) y los días feriados.
                    </p>
                </div>
                <div className="flex items-center gap-2.5">
                    <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase">Año Lectivo:</label>
                    <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(Number(e.target.value))}
                        className="px-3 py-1.5 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)] rounded-lg text-xs font-semibold text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                    >
                        {[currentYearVal - 1, currentYearVal, currentYearVal + 1, currentYearVal + 2].map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>
            </div>

            {isLoading ? (
                <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando ciclo lectivo...</div>
            ) : (
                <>
                    <div className="grid gap-6 sm:grid-cols-2">
                        {Object.entries(eventDates).map(([type, data]) => (
                            <div key={type} className="p-5 border border-[var(--color-border)] bg-[var(--color-bg-card)] rounded-xl space-y-4 flex flex-col justify-between hover:shadow-sm transition-all duration-[var(--transition-fast)]">
                                <div>
                                    <h4 className="text-sm font-bold text-[var(--color-text-primary)]">{data.event_name}</h4>
                                    <div className="mt-4">
                                        <FormField
                                            label="Fecha"
                                            type="date"
                                            value={data.start_date}
                                            onChange={(e) => handleDateChange(type, 'start_date', e.target.value)}
                                            required
                                            disabled={!canEdit}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="grid gap-6 md:grid-cols-3">
                        <div className={`${canEdit ? 'md:col-span-2' : 'md:col-span-3'} p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm space-y-6`}>
                            <div>
                                <h3 className="text-base font-bold text-[var(--color-text-primary)]">Feriados y Días No Laborables ({selectedYear})</h3>
                                <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                                    El bot no enviará enlaces de clases en estos días. A la hora de inicio, notificará gentilmente sobre el feriado a los alumnos.
                                </p>
                            </div>

                            <div className="border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border)] bg-[var(--color-bg-sidebar)] max-h-80 overflow-y-auto">
                                {holidays.length === 0 ? (
                                    <div className="p-6 text-center text-xs text-[var(--color-text-tertiary)] italic">
                                        No hay feriados cargados para este año.
                                    </div>
                                ) : (
                                    holidays.map((item, index) => {
                                        const [y, m, d] = item.start_date.split('-');
                                        const dateFormatted = `${d}/${m}/${y}`;
                                        return (
                                            <div key={index} className="p-4 flex items-center justify-between hover:bg-[var(--color-bg-card)] transition-colors">
                                                <div>
                                                    <span className="text-sm font-bold text-[var(--color-text-primary)]">{item.event_name}</span>
                                                    <p className="text-xs text-[var(--color-text-accent)] font-semibold mt-0.5">{dateFormatted}</p>
                                                </div>
                                                {canEdit && (
                                                    <Button variant="danger" size="sm" onClick={() => handleRemoveHoliday(index)}>
                                                        Remover
                                                    </Button>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {canEdit && (
                            <div className="p-6 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex flex-col justify-between">
                                <div className="space-y-4">
                                    <div>
                                        <h3 className="text-base font-bold text-[var(--color-text-primary)]">Cargar Feriado</h3>
                                        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Agregá un día feriado o asueto al calendario lectivo.</p>
                                    </div>
                                    <form onSubmit={handleAddHoliday} className="space-y-4">
                                        <FormField
                                            label="Fecha del Feriado"
                                            type="date"
                                            value={newHolidayDate}
                                            onChange={(e) => setNewHolidayDate(e.target.value)}
                                            required
                                        />
                                        <FormField
                                            label="Conmemoración / Motivo"
                                            value={newHolidayName}
                                            onChange={(e) => setNewHolidayName(e.target.value)}
                                            placeholder="Ej: Día de la Independencia"
                                            required
                                        />
                                        <Button type="submit" variant="outline" className="w-full">
                                            Añadir al Listado
                                        </Button>
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>

                    {canEdit && (
                        <div className="p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm flex justify-end gap-3">
                            <Button variant="ghost" onClick={fetchLifecycle} disabled={isSaving}>Restablecer</Button>
                            <Button variant="primary" onClick={handleSaveAll} loading={isSaving}>
                                Guardar Cambios del Calendario
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

// ── SUBJECTS & TEACHERS TAB ─────────────────────────────────
interface SubjectTeacherRow {
  id: string;
  name: string;
  year: number;
  commissions: Record<string, {
    teacherName: string;
    teacherEmail: string;
    meetLink: string;
  }>;
  isDirty: boolean;
  isSaving: boolean;
}

export const SASubjectsTab: React.FC = () => {
  const [subjects, setSubjects] = useState<SubjectTeacherRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedComm, setSelectedComm] = useState<Record<string, string>>({}); // subjectId -> commissionLabel
  const [yearsConfig, setYearsConfig] = useState<{ year: number; commissionCount: number }[]>([]);

  const getHeaders = () => {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const fetchYearsConfig = async () => {
    try {
      const data = await groupRepository.getYearsConfig();
      setYearsConfig(data);
    } catch (err) {
      console.error('[SASubjectsTab] Error al obtener comisiones por año:', err);
    }
  };

  const fetchSubjects = async () => {
    if (yearFilter === 0) {
      setSubjects([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      await fetchYearsConfig();
      const url = `/api/subjects/preseeded?year=${yearFilter}`;
      const res = await fetch(url, { headers: getHeaders() });
      const data = await res.json();
      const mapped: SubjectTeacherRow[] = data.map((s: any) => ({
        id: s.id,
        name: s.name,
        year: s.year || 1,
        commissions: s.commissions || {
          'A': { teacherName: s.teacherName || '', teacherEmail: s.teacherEmail || '', meetLink: s.meetLink || '' },
          'B': { teacherName: '', teacherEmail: '', meetLink: '' },
          'C': { teacherName: '', teacherEmail: '', meetLink: '' },
          'D': { teacherName: '', teacherEmail: '', meetLink: '' }
        },
        isDirty: false,
        isSaving: false,
      }));
      setSubjects(mapped);
    } catch {
      toast.error('Error al cargar materias.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, [yearFilter]);

  const updateField = (id: string, comm: string, field: string, value: string) => {
    setSubjects(prev => prev.map(s => {
      if (s.id !== id) return s;
      return {
        ...s,
        commissions: {
          ...s.commissions,
          [comm]: {
            ...s.commissions[comm],
            [field]: value
          }
        },
        isDirty: true
      };
    }));
  };

  const handleSave = async (subject: SubjectTeacherRow, comm: string) => {
    const commData = subject.commissions[comm] || { teacherName: '', teacherEmail: '', meetLink: '' };
    setSubjects(prev => prev.map(s => s.id === subject.id ? { ...s, isSaving: true } : s));
    try {
      const res = await fetch(`/api/subjects/${subject.id}/teacher`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          teacherName: commData.teacherName,
          teacherEmail: commData.teacherEmail,
          meetLink: commData.meetLink,
          commissionLabel: comm
        }),
      });
      if (!res.ok) throw new Error('Error al guardar');
      toast.success(`Profesor de ${subject.name} (Comisión ${comm}) guardado.`);
      setSubjects(prev => prev.map(s => s.id === subject.id ? { ...s, isDirty: false, isSaving: false } : s));
    } catch {
      toast.error('Error al guardar profesor.');
      setSubjects(prev => prev.map(s => s.id === subject.id ? { ...s, isSaving: false } : s));
    }
  };

  const handleUpdateCommissions = async (year: number, count: number) => {
    try {
      await groupRepository.updateYearConfig(year, count);
      toast.success(`Configuración actualizada a ${count === 1 ? 'única comisión' : `${count} comisiones`}.`);
      await fetchYearsConfig();
    } catch {
      toast.error('Error al actualizar comisiones por año.');
    }
  };

  const yearLabels: Record<number, string> = { 1: '1er Año', 2: '2do Año', 3: '3er Año' };

  const filteredSubjects = subjects.filter(s => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) ||
        Object.values(s.commissions).some(c => 
          c.teacherName.toLowerCase().includes(q) || 
          c.teacherEmail.toLowerCase().includes(q)
        );
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[var(--color-bg-sidebar)] p-4 border border-[var(--color-border)] rounded-xl">
        <div>
          <h3 className="text-base font-bold text-[var(--color-text-primary)] flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[var(--color-accent)]" />
            Materias y Profesores
          </h3>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Gestión global de materias, profesores, emails y enlaces de clase. Estos datos se heredan a los grupos al configurarlos.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              type="text"
              placeholder="Buscar materia o profesor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-52 pl-9 pr-3 py-2 bg-[var(--color-bg-app)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <div className="w-40">
            <DropdownSelector
              options={[
                { value: '0', label: 'Seleccionar Año...' },
                { value: '1', label: '1er Año' },
                { value: '2', label: '2do Año' },
                { value: '3', label: '3er Año' },
              ]}
              selectedValue={String(yearFilter)}
              onChange={(val) => setYearFilter(Number(val))}
            />
          </div>
        </div>
      </div>

      {/* Commission configuration per year (only if year is selected) */}
      {yearFilter > 0 && (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[var(--color-bg-sidebar)] p-4 border border-[var(--color-border)] rounded-xl">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-[var(--color-text-primary)]">Cantidad de Comisiones</span>
            <span className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
              Define cuántas comisiones tiene el {yearLabels[yearFilter]}. Esto afectará a todas las materias de este año.
            </span>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map(count => {
              const currentYearConfig = yearsConfig.find(c => c.year === yearFilter) || { year: yearFilter, commissionCount: 1 };
              const activeCommissionsCount = currentYearConfig.commissionCount;
              return (
                <button
                  key={count}
                  type="button"
                  onClick={() => handleUpdateCommissions(yearFilter, count)}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border
                    ${activeCommissionsCount === count
                      ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] border-[var(--color-accent)]'
                      : 'bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-bg-app)]'
                    }
                  `}
                >
                  {count === 1 ? 'Única' : `${count} comisiones`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      {yearFilter === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-[var(--color-text-tertiary)] gap-2 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl p-6">
          <BookOpen className="w-10 h-10 opacity-40 text-[var(--color-accent)]" />
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">Por favor, seleccione un año de cursada para comenzar a gestionar sus materias y profesores.</p>
        </div>
      ) : isLoading ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-secondary)]">Cargando materias...</div>
      ) : filteredSubjects.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-[var(--color-text-tertiary)] gap-2">
          <BookOpen className="w-10 h-10 opacity-40" />
          <p className="text-sm">No se encontraron materias.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].filter(y => y === yearFilter).map(year => {
            const yearSubjects = filteredSubjects.filter(s => s.year === year);
            if (yearSubjects.length === 0) return null;
            return (
              <div key={year} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-bold text-[var(--color-accent)] uppercase tracking-wider">
                    {yearLabels[year] || `Año ${year}`}
                  </span>
                  <div className="flex-1 h-px bg-[var(--color-border)]" />
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    {yearSubjects.length} materias
                  </span>
                </div>
                {yearSubjects.map(subject => {
                  const currentYearConfig = yearsConfig.find(c => c.year === subject.year) || { year: subject.year, commissionCount: 1 };
                  const activeCommissionsCount = currentYearConfig.commissionCount;
                  const activeCommLabels = ['A', 'B', 'C', 'D'].slice(0, activeCommissionsCount);
                  const currentComm = activeCommLabels.includes(selectedComm[subject.id]) ? selectedComm[subject.id] : 'A';
                  const commData = subject.commissions[currentComm] || { teacherName: '', teacherEmail: '', meetLink: '' };

                  return (
                    <div
                      key={subject.id}
                      className={`
                        bg-[var(--color-bg-card)] border rounded-xl p-4 transition-all duration-200
                        ${subject.isDirty
                          ? 'border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent-muted)]'
                          : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
                        }
                      `}
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-muted)] flex items-center justify-center flex-shrink-0">
                            <BookOpen className="w-4 h-4 text-[var(--color-accent)]" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-[var(--color-text-primary)]">{subject.name}</h4>
                            <span className="text-[10px] text-[var(--color-text-tertiary)]">ID: {subject.id}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleSave(subject, currentComm)}
                          disabled={!subject.isDirty || subject.isSaving}
                          className={`
                            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer
                            ${subject.isDirty
                              ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:opacity-90'
                              : 'bg-[var(--color-bg-app)] text-[var(--color-text-tertiary)] cursor-not-allowed opacity-50'
                            }
                          `}
                        >
                          {subject.isSaving ? (
                            <Spinner className="w-3.5 h-3.5" />
                          ) : subject.isDirty ? (
                            <Save className="w-3.5 h-3.5" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          {subject.isSaving ? 'Guardando...' : subject.isDirty ? 'Guardar' : 'Guardado'}
                        </button>
                      </div>

                      {/* Commission tabs */}
                      {activeCommissionsCount > 1 && (
                        <div className="flex items-center gap-1.5 mb-3.5">
                          <span className="text-[10px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">Comisión:</span>
                          <div className="flex gap-1">
                            {activeCommLabels.map(lbl => (
                              <button
                                key={lbl}
                                type="button"
                                onClick={() => setSelectedComm(prev => ({ ...prev, [subject.id]: lbl }))}
                                className={`
                                  px-2.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer
                                  ${currentComm === lbl
                                    ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)]'
                                    : 'bg-[var(--color-bg-app)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
                                  }
                                `}
                              >
                                Comisión {lbl}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="text-[10px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1 block">
                            Nombre del Profesor
                          </label>
                          <input
                            type="text"
                            value={commData.teacherName}
                            onChange={(e) => updateField(subject.id, currentComm, 'teacherName', e.target.value)}
                            placeholder="Ej: Juan Pérez"
                            className="w-full px-3 py-2 bg-[var(--color-bg-app)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1 block">
                            Email del Profesor
                          </label>
                          <input
                            type="email"
                            value={commData.teacherEmail}
                            onChange={(e) => updateField(subject.id, currentComm, 'teacherEmail', e.target.value)}
                            placeholder="Ej: profesor@ispc.edu.ar"
                            className="w-full px-3 py-2 bg-[var(--color-bg-app)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1 block">
                            Enlace de Meet
                          </label>
                          <input
                            type="url"
                            value={commData.meetLink}
                            onChange={(e) => updateField(subject.id, currentComm, 'meetLink', e.target.value)}
                            placeholder="https://meet.google.com/..."
                            className="w-full px-3 py-2 bg-[var(--color-bg-app)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SuperAdminDashboard;

