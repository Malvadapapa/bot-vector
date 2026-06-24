import React, { useState, useEffect, useRef } from 'react';
import type { ChatMessage } from '../../../domain/entities';
import { ChatBubble } from '../molecules/ChatBubble';
import { Button } from '../atoms/Button';
import { Send, ArrowLeft, MessageCircle } from 'lucide-react';
interface ChatWindowProps {
  parentMessage: ChatMessage;
  replies: ChatMessage[];
  onSendReply: (content: string) => void | Promise<void>;
  onBack?: () => void;
  isSending?: boolean;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  parentMessage,
  replies = [],
  onSendReply,
  onBack,
  isSending = false,
}) => {
  const [newReply, setNewReply] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when replies change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [replies]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReply.trim() || isSending) return;
    onSendReply(newReply.trim());
    setNewReply('');
  };

  return (
    <div className="flex flex-col h-full min-h-[400px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-sidebar)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] transition-colors md:hidden"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-[var(--color-accent)] uppercase tracking-wider">
              {parentMessage.targetName || 'Canal'}
            </span>
            <span className="text-sm font-bold text-[var(--color-text-primary)] truncate max-w-[200px] sm:max-w-sm">
              Mensaje: {parentMessage.content}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
          <MessageCircle className="w-4 h-4 text-[var(--color-accent)]" />
          <span>{(replies || []).length} respuestas</span>
        </div>
      </div>

      {/* Parent post details inside the window */}
      <div className="px-6 py-3.5 bg-amber-500/5 border-b border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] leading-relaxed">
        <span className="font-bold text-[var(--color-text-primary)]">Publicación Original:</span> "{parentMessage.content}"
        <div className="text-[10px] text-[var(--color-text-tertiary)] mt-1">
          Enviado por {parentMessage.authorName || 'Usuario'} el {(() => {
            try {
              return new Date(parentMessage.timestamp || new Date()).toLocaleString();
            } catch (e) {
              return 'Fecha desconocida';
            }
          })()}
        </div>
      </div>

      {/* Scrollable chat body */}
      <div className="flex-1 p-6 overflow-y-auto bg-[var(--color-bg-card)] flex flex-col" ref={scrollRef}>
        {(!replies || replies.length === 0) ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-[var(--color-text-tertiary)]">
            <MessageCircle className="w-12 h-12 text-[var(--color-border)] mb-3" />
            <p className="text-sm font-medium">Aún no hay respuestas de alumnos.</p>
            <p className="text-xs mt-1">Cuando los alumnos respondan por WhatsApp verás sus mensajes acá.</p>
          </div>
        ) : (
          replies.map((reply) => {
            // Check if message is from professor (self) or student
            const isSelf = !reply.isFromStudent;
            return (
              <ChatBubble
                key={reply.id}
                message={reply}
                isSelf={isSelf}
              />
            );
          })
        )}
      </div>

      {/* Form input footer */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-[var(--color-border)] bg-[var(--color-bg-sidebar)] flex gap-3">
        <input
          type="text"
          value={newReply}
          onChange={(e) => setNewReply(e.target.value)}
          placeholder="Escribí una réplica para enviar a este canal..."
          className="
            flex-1 px-4 py-2.5 text-sm rounded-lg border border-[var(--color-border)]
            bg-[var(--color-bg-input)] text-[var(--color-text-primary)]
            placeholder:text-[var(--color-text-tertiary)]
            focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-border-focus)]
            transition-all duration-150
          "
        />
        <Button
          variant="primary"
          type="submit"
          disabled={!newReply.trim() || isSending}
          className="!px-4 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
};
