import React, { useState, useEffect, useRef } from 'react';
import type { Cohort, Commission, Notice, NoticeTargetType, Group } from '../../../domain/entities';
import { FormField } from '../molecules/FormField';
import { DropdownSelector } from '../molecules/DropdownSelector';
import { Button } from '../atoms/Button';
import { groupRepository } from '../../../infrastructure/repositories/instances';
import { useAuth } from '../../context/AuthContext';
import { Megaphone } from 'lucide-react';
import { toast } from 'sonner';

interface NoticeFormProps {
  initialNotice?: Notice;
  onSubmit: (data: any) => void | Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export const NoticeForm: React.FC<NoticeFormProps> = ({
  initialNotice,
  onSubmit,
  onCancel,
  isSubmitting = false,
}) => {
  const { activeGroup, user } = useAuth();
  const [title, setTitle] = useState(initialNotice?.title || '');
  const [body, setBody] = useState(initialNotice?.body || '');
  const [targetType, setTargetType] = useState<NoticeTargetType>(
    initialNotice?.targetType === 'all_groups' ? 'all_groups' : 'single_group'
  );
  const [targetId, setTargetId] = useState(initialNotice?.targetId || '');
  const [startDate, setStartDate] = useState(initialNotice?.startDate || '');
  const [endDate, setEndDate] = useState(initialNotice?.endDate || '');
  const [frecuencia, setFrecuencia] = useState(initialNotice?.frecuencia || 'unica');
  
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load all groups on mount
  useEffect(() => {
    groupRepository.getAll().then((list) => {
      setAllGroups(list);
    });
  }, []);

  // Sync targetId when targetType changes
  useEffect(() => {
    if (user?.role === 'group_admin') {
      setTargetType('single_group');
      setTargetId(activeGroup?.id || '');
      return;
    }

    if (initialNotice && initialNotice.targetType === targetType) {
      setTargetId(initialNotice.targetId);
      return;
    }

    if (targetType === 'all_groups') {
      setTargetId('all');
    } else if (targetType === 'single_group') {
      setTargetId(activeGroup?.id || allGroups[0]?.id || '');
    }
  }, [targetType, activeGroup, initialNotice, allGroups, user]);

  const targetTypeOptions = [
    { value: 'all_groups', label: 'Todos los grupos' },
    { value: 'single_group', label: 'Un grupo en particular' },
  ];

  const getTargetOptions = () => {
    if (targetType === 'single_group') {
      return allGroups.map((g) => {
        const yearVal = g.entryYear;
        const ordinalYear = yearVal === 1 ? '1er año' : yearVal === 2 ? '2do año' : yearVal === 3 ? '3er año' : 'General';
        return {
          value: g.id,
          label: `${ordinalYear} - ${g.name}`,
          sublabel: g.institutionName,
        };
      });
    }
    return [];
  };

  const applyFormat = (formatType: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    let formatted = '';
    let offset = 0;

    switch (formatType) {
      case 'bold':
        formatted = `*${selectedText || 'texto'}*`;
        offset = 1;
        break;
      case 'italic':
        formatted = `_${selectedText || 'texto'}_`;
        offset = 1;
        break;
      case 'strikethrough':
        formatted = `~${selectedText || 'texto'}~`;
        offset = 1;
        break;
      case 'mono':
        formatted = `\`\`\`${selectedText || 'texto'}\`\`\``;
        offset = 3;
        break;
      case 'code':
        formatted = `\`${selectedText || 'texto'}\``;
        offset = 1;
        break;
      case 'bullet':
        formatted = selectedText
          ? selectedText.split('\n').map(line => `- ${line}`).join('\n')
          : '- texto';
        break;
      case 'number':
        formatted = selectedText
          ? selectedText.split('\n').map((line, idx) => `${idx + 1}. ${line}`).join('\n')
          : '1. texto';
        break;
      case 'quote':
        formatted = selectedText
          ? selectedText.split('\n').map(line => `> ${line}`).join('\n')
          : '> texto';
        break;
    }

    const newBody = text.substring(0, start) + formatted + text.substring(end);
    setBody(newBody);
    
    // Restore selection and focus
    setTimeout(() => {
      textarea.focus();
      if (selectedText) {
        textarea.setSelectionRange(start, start + formatted.length);
      } else {
        textarea.setSelectionRange(start + offset, start + offset + (formatted.length - 2 * offset));
      }
    }, 0);
  };

  const renderWhatsAppMarkdown = (text: string) => {
    if (!text) return '<span class="text-[var(--color-text-tertiary)] italic">Escribe un mensaje para ver la previsualización...</span>';
    
    // Escape HTML tags to prevent XSS
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 1. Triple backticks (```preformatted```)
    escaped = escaped.replace(/```([\s\S]*?)```/g, '<pre class="font-mono bg-[var(--color-bg-app)] p-2 rounded text-xs border border-[var(--color-border)] whitespace-pre-wrap text-[var(--color-accent)]">$1</pre>');

    // 2. Inline code (`code`)
    escaped = escaped.replace(/`([^`\n]+?)`/g, '<code class="font-mono bg-[var(--color-bg-app)] px-1.5 py-0.5 rounded text-xs border border-[var(--color-border)] text-[var(--color-accent)]">$1</code>');

    // 3. Bold (*bold*)
    escaped = escaped.replace(/\*([^*]+?)\*/g, '<strong>$1</strong>');

    // 4. Italic (_italic_)
    escaped = escaped.replace(/_([^_]+?)_/g, '<em>$1</em>');

    // 5. Strikethrough (~strike~)
    escaped = escaped.replace(/~([^~]+?)~/g, '<del>$1</del>');

    // 6. Lists and blockquotes line-by-line parsing
    const lines = escaped.split('\n');
    const processedLines: string[] = [];
    
    let inBulletList = false;
    let inNumberedList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Blockquote
      if (line.startsWith('&gt; ')) {
        if (inBulletList) { processedLines.push('</ul>'); inBulletList = false; }
        if (inNumberedList) { processedLines.push('</ol>'); inNumberedList = false; }
        processedLines.push(`<blockquote class="border-l-4 border-[var(--color-accent)] pl-3 text-[var(--color-text-secondary)] italic my-1">${line.substring(5)}</blockquote>`);
        continue;
      }
      
      // Bullet list item (* text or - text)
      const bulletMatch = line.match(/^(\*|-)\s+(.+)$/);
      if (bulletMatch) {
        if (inNumberedList) { processedLines.push('</ol>'); inNumberedList = false; }
        if (!inBulletList) { processedLines.push('<ul class="list-disc pl-5 my-1">'); inBulletList = true; }
        processedLines.push(`<li>${bulletMatch[2]}</li>`);
        continue;
      }
      
      // Numbered list item (1. text, 2. text, etc.)
      const numberMatch = line.match(/^(\d+)\.\s+(.+)$/);
      if (numberMatch) {
        if (inBulletList) { processedLines.push('</ul>'); inBulletList = false; }
        if (!inNumberedList) { processedLines.push('<ol class="list-decimal pl-5 my-1">'); inNumberedList = true; }
        processedLines.push(`<li>${numberMatch[2]}</li>`);
        continue;
      }

      // Plain line
      if (inBulletList) { processedLines.push('</ul>'); inBulletList = false; }
      if (inNumberedList) { processedLines.push('</ol>'); inNumberedList = false; }
      processedLines.push(line);
    }
    
    if (inBulletList) processedLines.push('</ul>');
    if (inNumberedList) processedLines.push('</ol>');

    return processedLines.join('\n').replace(/\n/g, '<br />');
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error('Por favor, ingresá un título.');
      return;
    }
    if (!body.trim()) {
      toast.error('Por favor, redactá el cuerpo del aviso.');
      return;
    }
    if (!targetId) {
      toast.error('Por favor, seleccioná el destinatario.');
      return;
    }

    // Determine target name
    let targetName = activeGroup?.name || '';
    if (targetType === 'all_groups') {
      targetName = 'Todos los grupos';
    } else if (targetType === 'single_group') {
      targetName = allGroups.find((g) => g.id === targetId)?.name || activeGroup?.name || 'Grupo específico';
    }

    const payload = {
      title: title.trim(),
      body: body.trim(),
      targetType,
      targetId,
      targetName,
      active: initialNotice?.active ?? true,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      frecuencia,
    };

    onSubmit(payload);
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      <div className="p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-sidebar)] flex gap-3.5">
        <Megaphone className="w-5 h-5 text-[var(--color-accent)] flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-bold text-[var(--color-text-primary)]">
            Avisos de Difusión Masiva
          </h4>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-relaxed">
            Este aviso será disparado inmediatamente como mensaje push y publicado en el bot para los destinatarios seleccionados.
          </p>
        </div>
      </div>

      {user?.role !== 'group_admin' && (
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Target Scope */}
          <DropdownSelector
            label="Destinatarios (Alcance)"
            options={targetTypeOptions}
            selectedValue={targetType}
            onChange={(val) => setTargetType(val as NoticeTargetType)}
            required
          />

          {/* Specific Target Select (Only visible if single group selected) */}
          {targetType === 'single_group' && (
            <DropdownSelector
              label="Seleccionar Destinatario"
              options={getTargetOptions()}
              selectedValue={targetId}
              onChange={setTargetId}
              placeholder="Seleccionar..."
              required
            />
          )}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-3">
        {/* Start Date */}
        <FormField
          label="Inicio de Vigencia (Opcional)"
          type="datetime-local"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />

        {/* End Date */}
        <FormField
          label="Cierre / Límite (Opcional)"
          type="datetime-local"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />

        {/* Frecuencia */}
        <DropdownSelector
          label="Frecuencia de Notificación"
          options={[
            { value: 'unica', label: 'Envío Único (Inmediato)' },
            { value: 'diaria', label: 'Recordatorio Diario' },
            { value: 'semanal', label: 'Recordatorio Semanal' },
          ]}
          selectedValue={frecuencia}
          onChange={setFrecuencia}
          required
        />
      </div>

      {/* Title */}
      <FormField
        label="Título del Aviso"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Ej: Cambio de aula, Suspensión de clases, etc."
        required
      />

      {/* Body with WhatsApp formatting toolbar */}
      <div className="flex flex-col w-full">
        <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1.5 block">
          Cuerpo del Comunicado
        </label>
        
        {/* Toolbar */}
        <div className="flex flex-wrap gap-1 p-1.5 border border-b-0 border-[var(--color-border)] rounded-t-lg bg-[var(--color-bg-sidebar)]">
          <button
            type="button"
            onClick={() => applyFormat('bold')}
            className="px-2.5 py-1 text-xs font-bold rounded hover:bg-[var(--color-bg-app)] text-[var(--color-text-primary)] transition-colors border border-transparent hover:border-[var(--color-border)] animate-fade-in"
            title="Negrita (*texto*)"
          >
            Negrita
          </button>
          <button
            type="button"
            onClick={() => applyFormat('italic')}
            className="px-2.5 py-1 text-xs italic rounded hover:bg-[var(--color-bg-app)] text-[var(--color-text-primary)] transition-colors border border-transparent hover:border-[var(--color-border)] animate-fade-in"
            title="Cursiva (_texto_)"
          >
            Cursiva
          </button>
          <button
            type="button"
            onClick={() => applyFormat('strikethrough')}
            className="px-2.5 py-1 text-xs line-through rounded hover:bg-[var(--color-bg-app)] text-[var(--color-text-primary)] transition-colors border border-transparent hover:border-[var(--color-border)] animate-fade-in"
            title="Tachado (~texto~)"
          >
            Tachado
          </button>
          <span className="w-px h-5 bg-[var(--color-border)] my-auto mx-1" />
          <button
            type="button"
            onClick={() => applyFormat('code')}
            className="px-2.5 py-1 text-xs font-mono rounded hover:bg-[var(--color-bg-app)] text-[var(--color-text-primary)] transition-colors border border-transparent hover:border-[var(--color-border)] animate-fade-in"
            title="Código alineado (`texto`)"
          >
            Código
          </button>
          <button
            type="button"
            onClick={() => applyFormat('mono')}
            className="px-2.5 py-1 text-xs font-mono rounded hover:bg-[var(--color-bg-app)] text-[var(--color-text-primary)] transition-colors border border-transparent hover:border-[var(--color-border)] animate-fade-in"
            title="Monoespaciado (```texto```)"
          >
            Pre
          </button>
          <span className="w-px h-5 bg-[var(--color-border)] my-auto mx-1" />
          <button
            type="button"
            onClick={() => applyFormat('bullet')}
            className="px-2.5 py-1 text-xs rounded hover:bg-[var(--color-bg-app)] text-[var(--color-text-primary)] transition-colors border border-transparent hover:border-[var(--color-border)] animate-fade-in"
            title="Lista con viñetas (- viñeta)"
          >
            • Viñeta
          </button>
          <button
            type="button"
            onClick={() => applyFormat('number')}
            className="px-2.5 py-1 text-xs rounded hover:bg-[var(--color-bg-app)] text-[var(--color-text-primary)] transition-colors border border-transparent hover:border-[var(--color-border)] animate-fade-in"
            title="Lista numerada (1. número)"
          >
            1. Lista
          </button>
          <button
            type="button"
            onClick={() => applyFormat('quote')}
            className="px-2.5 py-1 text-xs rounded hover:bg-[var(--color-bg-app)] text-[var(--color-text-primary)] transition-colors border border-transparent hover:border-[var(--color-border)] animate-fade-in"
            title="Cita (> cita)"
          >
            “ Cita
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Redactá los detalles del aviso acá..."
          rows={6}
          className="w-full px-4 py-2.5 text-sm bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded-b-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] transition-all duration-[var(--transition-fast)] focus:ring-2 focus:ring-offset-0 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-border-focus)] hover:border-[var(--color-border-hover)] resize-y"
          required
        />
      </div>

      {/* Visual Live Preview */}
      <div className="flex flex-col w-full">
        <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1.5 block">
          Previsualización (Formato WhatsApp)
        </label>
        <div 
          className="w-full p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-sidebar)] text-sm text-[var(--color-text-primary)] min-h-[100px] break-words leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderWhatsAppMarkdown(body) }}
        />
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button variant="primary" type="submit" loading={isSubmitting}>
          {initialNotice ? 'Guardar Cambios' : 'Publicar Aviso'}
        </Button>
      </div>
    </form>
  );
};
