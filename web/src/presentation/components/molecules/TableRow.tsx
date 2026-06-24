import { Edit2, Trash2, Eye, MessageSquare } from 'lucide-react';
import { Button } from '../atoms/Button';

interface TableAction {
  icon: 'edit' | 'delete' | 'view' | 'chat';
  label: string;
  onClick: () => void;
  variant?: 'danger' | 'ghost' | 'outline';
  disabled?: boolean;
}

interface TableRowProps {
  cells: React.ReactNode[];
  actions?: TableAction[];
  onClick?: () => void;
  className?: string;
}

export const TableRow: React.FC<TableRowProps> = ({
  cells,
  actions = [],
  onClick,
  className = '',
}) => {
  const iconMap = {
    edit: <Edit2 className="w-4 h-4" />,
    delete: <Trash2 className="w-4 h-4" />,
    view: <Eye className="w-4 h-4" />,
    chat: <MessageSquare className="w-4 h-4" />,
  };

  const buttonVariants = {
    edit: 'ghost' as const,
    delete: 'danger' as const,
    view: 'ghost' as const,
    chat: 'ghost' as const,
  };

  return (
    <tr
      onClick={onClick}
      className={`
        border-b border-[var(--color-border)] bg-[var(--color-bg-card)]
        transition-colors duration-150
        hover:bg-[var(--color-bg-card-hover)]
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {cells.map((cell, idx) => (
        <td
          key={idx}
          className="px-6 py-4 text-sm text-[var(--color-text-primary)] align-middle whitespace-nowrap"
        >
          {cell}
        </td>
      ))}
      
      {actions.length > 0 && (
        <td className="px-6 py-4 text-sm align-middle text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            {actions.map((action, index) => (
              <Button
                key={index}
                size="sm"
                variant={action.variant || buttonVariants[action.icon]}
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.label}
                className="!p-2"
              >
                <span className="sr-only">{action.label}</span>
                {iconMap[action.icon]}
              </Button>
            ))}
          </div>
        </td>
      )}
    </tr>
  );
};
