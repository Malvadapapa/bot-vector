import React, { useState, useEffect } from 'react';
import type { Subject, Exam, ExamType, AlertTiming } from '../../../domain/entities';
import { DropdownSelector } from '../molecules/DropdownSelector';
import { DateTimePicker } from '../molecules/DateTimePicker';
import { Button } from '../atoms/Button';
import { Label } from '../atoms/Label';
import { Toggle } from '../atoms/Toggle';
import { manageExamsUseCase } from '../../../infrastructure/repositories/instances';
import { AlertCircle, Calendar } from 'lucide-react';
import { toast } from 'sonner';

interface ExamFormProps {
  subjects: Subject[];
  initialExam?: Exam;
  onSubmit: (data: any) => void | Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export const ExamForm: React.FC<ExamFormProps> = ({
  subjects,
  initialExam,
  onSubmit,
  onCancel,
  isSubmitting = false,
}) => {
  const [subjectId, setSubjectId] = useState(initialExam?.subjectId || '');
  const [type, setType] = useState<ExamType>(initialExam?.type || 'evidence');
  const [startDate, setStartDate] = useState(initialExam?.startDate || '');
  const [endDate, setEndDate] = useState(initialExam?.endDate || '');
  const [evidenceNumber, setEvidenceNumber] = useState<number>(
    initialExam?.evidenceNumber || 1
  );
  
  // Find selected subject
  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const isAnnual = selectedSubject?.isAnnual || false;
  const evidenceOptions = isAnnual ? [1, 2, 3, 4, 5, 6] : [1, 2, 3];

  // Reset evidence number if it exceeds available options
  useEffect(() => {
    if (evidenceNumber > evidenceOptions.length) {
      setEvidenceNumber(1);
    }
  }, [subjectId, isAnnual, evidenceOptions.length, evidenceNumber]);

  // Alerts config state
  const [timings, setTimings] = useState<AlertTiming[]>(
    initialExam?.alerts.timings || ['7d', '3d', '1d']
  );
  const [notifyAtRangeStart, setNotifyAtRangeStart] = useState(
    initialExam?.alerts.notifyAtRangeStart ?? true
  );
  const [notifyBeforeDeadline, setNotifyBeforeDeadline] = useState(
    initialExam?.alerts.notifyBeforeDeadline ?? true
  );

  // Warnings
  const [validationWarning, setValidationWarning] = useState<string | null>(null);

  // Map subjects for Dropdown
  const subjectOptions = subjects.map((s) => ({
    value: s.id,
    label: s.name,
    sublabel: `Código: ${s.code} ${s.isAnnual ? '(Anual)' : '(Cuatrimestral)'}`,
  }));

  // Map exam type for Dropdown
  const typeOptions = [
    { value: 'evidence', label: 'Evidencia (Entregable / TP)' },
    { value: 'abp', label: 'Defensa ABP' },
    { value: 'final', label: 'Examen Final' },
    { value: 'colloquium', label: 'Coloquio' },
  ];

  // Perform checks when subject or type changes
  useEffect(() => {
    if (!subjectId) {
      setValidationWarning(null);
      return;
    }

    const runChecks = async () => {
      if (type === 'evidence') {
        const count = await manageExamsUseCase.countEvidences(subjectId);
        // Exclude the current editing exam from the count
        const isEditingCurrentType = initialExam && initialExam.subjectId === subjectId && initialExam.type === 'evidence';
        const adjustCount = isEditingCurrentType ? count - 1 : count;
        const maxEvidences = isAnnual ? 6 : 3;
        if (adjustCount >= maxEvidences) {
          setValidationWarning(
            `Atención: Esta materia ya cuenta con las ${maxEvidences} evidencias máximas recomendadas para el ${isAnnual ? 'año' : 'cuatrimestre'}.`
          );
        } else {
          setValidationWarning(null);
        }
      } else if (type === 'abp') {
        const hasABP = await manageExamsUseCase.hasABPDefense(subjectId);
        const isEditingCurrentType = initialExam && initialExam.subjectId === subjectId && initialExam.type === 'abp';
        if (hasABP && !isEditingCurrentType) {
          setValidationWarning(
            'Atención: Esta materia ya tiene programada una defensa ABP. Solo se permite 1 ABP por cuatrimestre.'
          );
        } else {
          setValidationWarning(null);
        }
      } else {
        setValidationWarning(null);
      }
    };

    runChecks();
  }, [subjectId, type, initialExam, isAnnual]);

  const handleTimingToggle = (timing: AlertTiming) => {
    if (timings.includes(timing)) {
      setTimings(timings.filter((t) => t !== timing));
    } else {
      setTimings([...timings, timing]);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!subjectId) {
      toast.error('Por favor, seleccioná una materia.');
      return;
    }
    if (!startDate) {
      toast.error('Por favor, seleccioná una fecha.');
      return;
    }
    if (type === 'evidence' && !endDate) {
      toast.error('Las evidencias requieren un rango de fecha. Por favor, cargá la fecha de cierre.');
      return;
    }

    const selectedSubject = subjects.find((s) => s.id === subjectId);
    const subjectName = selectedSubject ? selectedSubject.name : '';
    let computedTitle = '';
    if (type === 'evidence') {
      computedTitle = `Evidencia ${evidenceNumber} - ${subjectName}`;
    } else if (type === 'abp') {
      computedTitle = `Defensa ABP - ${subjectName}`;
    } else if (type === 'final') {
      computedTitle = `Examen Final - ${subjectName}`;
    } else if (type === 'colloquium') {
      computedTitle = `Coloquio - ${subjectName}`;
    }

    const payload = {
      subjectId,
      type,
      title: computedTitle,
      startDate,
      endDate: type === 'evidence' ? endDate : undefined,
      evidenceNumber: type === 'evidence' ? evidenceNumber : undefined,
      alerts: {
        timings,
        notifyAtRangeStart: type === 'evidence' ? notifyAtRangeStart : false,
        notifyBeforeDeadline,
      },
    };

    onSubmit(payload);
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Subject selector */}
        <DropdownSelector
          label="Materia"
          options={subjectOptions}
          selectedValue={subjectId}
          onChange={setSubjectId}
          placeholder="Seleccioná una materia"
          searchable
          required
        />

        {/* Exam Type */}
        <DropdownSelector
          label="Tipo de Examen"
          options={typeOptions}
          selectedValue={type}
          onChange={(val) => setType(val as ExamType)}
          required
        />
      </div>

      {/* Warnings Banner */}
      {validationWarning && (
        <div className="flex gap-2.5 p-3.5 rounded-lg bg-amber-500/10 border border-[var(--color-warning)] text-[var(--color-warning)] text-xs leading-relaxed">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{validationWarning}</span>
        </div>
      )}

      {/* Evidence number */}
      {type === 'evidence' && (
        <div className="flex flex-col">
          <Label required>Número de Evidencia</Label>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-1.5">
            {evidenceOptions.map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setEvidenceNumber(num)}
                className={`
                  py-2.5 rounded-lg border text-sm font-semibold transition-all duration-150 cursor-pointer text-center
                  ${evidenceNumber === num
                    ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] border-[var(--color-accent)] shadow-md shadow-[var(--color-accent)]/20'
                    : 'bg-[var(--color-bg-card)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] hover:text-[var(--color-text-primary)]'
                  }
                `}
              >
                E{num}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* DateTime Picker */}
      <DateTimePicker
        label={type === 'evidence' ? 'Plazo de Entrega' : 'Fecha y Hora'}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={type === 'evidence' ? endDate : undefined}
        onEndDateChange={setEndDate}
        required
      />

      {/* Alert configuration section */}
      <div className="p-5 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-sidebar)] space-y-4">
        <h4 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[var(--color-accent)]" />
          Configuración de Alertas WhatsApp
        </h4>

        {/* Alert timing checkboxes */}
        <div className="flex flex-col">
          <span className="text-xs text-[var(--color-text-secondary)] mb-2 font-medium">
            ¿Con cuánta anticipación enviar recordatorios a los estudiantes?
          </span>
          <div className="flex flex-wrap gap-3">
            {(['7d', '3d', '2d', '1d'] as const).map((t) => (
              <label
                key={t}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all duration-150
                  ${timings.includes(t)
                    ? 'bg-[var(--color-accent-muted)] border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'bg-[var(--color-bg-card)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]'
                  }
                `}
              >
                <input
                  type="checkbox"
                  checked={timings.includes(t)}
                  onChange={() => handleTimingToggle(t)}
                  className="hidden"
                />
                {t === '7d' && '7 días antes'}
                {t === '3d' && '3 días antes'}
                {t === '2d' && '2 días antes'}
                {t === '1d' && '1 día antes'}
              </label>
            ))}
          </div>
        </div>

        {/* Specific switches */}
        <div className="grid gap-4 pt-2 sm:grid-cols-2">
          {type === 'evidence' && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]">
              <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                Notificar al abrir plazo de entrega
              </span>
              <Toggle checked={notifyAtRangeStart} onChange={setNotifyAtRangeStart} size="sm" />
            </div>
          )}
          
          <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]">
            <span className="text-xs text-[var(--color-text-secondary)] font-medium">
              Notificar antes de finalizar plazo / cierre
            </span>
            <Toggle checked={notifyBeforeDeadline} onChange={setNotifyBeforeDeadline} size="sm" />
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button variant="primary" type="submit" loading={isSubmitting}>
          {initialExam ? 'Guardar Cambios' : 'Crear Examen'}
        </Button>
      </div>
    </form>
  );
};
