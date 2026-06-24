import React from 'react';
import { Avatar } from '../atoms/Avatar';
import type { ChatMessage } from '../../../domain/entities';

interface ChatBubbleProps {
  message: ChatMessage;
  isSelf: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ message, isSelf }) => {
  const formattedTime = (() => {
    try {
      return new Date(message.timestamp || new Date()).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return '--:--';
    }
  })();

  const isEmail = message.authorId ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.authorId) : false;

  return (
    <div className={`flex w-full gap-3 ${isSelf ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isSelf && (
        <Avatar
          name={message.authorName}
          size="sm"
          className="mt-1 shadow-sm"
        />
      )}
      
      <div className={`flex flex-col max-w-[70%] ${isSelf ? 'items-end' : 'items-start'}`}>
        {/* Author details */}
        {isSelf ? (
          <span className="text-[11px] text-[var(--color-text-secondary)] font-semibold mb-1 mr-1 flex items-center gap-1.5 justify-end">
            {message.authorName || 'Tú'}
            {isEmail && (
              <span className="text-[var(--color-text-tertiary)] font-normal text-[10px]">
                ({message.authorId})
              </span>
            )}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--color-text-secondary)] font-semibold mb-1 ml-1 flex items-center gap-1.5">
            {message.authorName || 'Alumno'}
            {isEmail ? (
              <span className="text-[var(--color-text-tertiary)] font-normal text-[10px]">
                ({message.authorId})
              </span>
            ) : message.authorPhone ? (
              <span className="text-[var(--color-text-tertiary)] font-normal text-[10px]">
                ({message.authorPhone})
              </span>
            ) : null}
          </span>
        )}

        {/* Message bubble */}
        <div
          className={`
            px-4 py-2.5 rounded-2xl text-sm shadow-sm leading-relaxed
            ${isSelf
              ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] rounded-tr-none'
              : 'bg-[var(--color-bg-card-hover)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-tl-none'
            }
          `}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          <div className={`text-[10px] mt-1.5 flex justify-end ${isSelf ? 'text-emerald-100' : 'text-[var(--color-text-tertiary)]'}`}>
            <span>{formattedTime}</span>
            {isSelf && message.readByProfessor && (
              <span className="ml-1 text-[var(--color-success)] font-bold">✓✓</span>
            )}
          </div>
        </div>
      </div>

      {isSelf && (
        <Avatar
          name={message.authorName || 'Usuario'}
          size="sm"
          className="mt-1 shadow-sm"
        />
      )}
    </div>
  );
};
