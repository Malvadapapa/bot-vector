import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface DropdownSelectorProps {
  label?: string;
  options: DropdownOption[];
  selectedValue: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  required?: boolean;
  disabled?: boolean;
}

export const DropdownSelector: React.FC<DropdownSelectorProps> = ({
  label,
  options,
  selectedValue,
  onChange,
  placeholder = 'Seleccionar...',
  searchable = false,
  className = '',
  required = false,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === selectedValue);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizeStr = (str: string) =>
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const filteredOptions = searchable
    ? options.filter(
        (o) =>
          normalizeStr(o.label).includes(normalizeStr(searchQuery)) ||
          (o.sublabel && normalizeStr(o.sublabel).includes(normalizeStr(searchQuery)))
      )
    : options;

  const handleSelect = (value: string) => {
    onChange(value);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className={`relative flex flex-col w-full ${className}`} ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
          {label}
          {required && <span className="text-[var(--color-danger)] ml-1">*</span>}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center justify-between w-full px-4 py-2.5 text-sm text-left
          bg-[var(--color-bg-input)] border rounded-lg shadow-sm
          text-[var(--color-text-primary)]
          transition-all duration-[var(--transition-fast)]
          focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-border-focus)]
          ${isOpen ? 'border-[var(--color-border-focus)] ring-2 ring-[var(--color-accent-muted)]' : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'}
          ${disabled ? 'opacity-50 cursor-not-allowed border-[var(--color-border)]' : ''}
        `}
      >
        <div className="flex flex-col">
          {selectedOption ? (
            <>
              <span className="font-medium">{selectedOption.label}</span>
              {selectedOption.sublabel && (
                <span className="text-xs text-[var(--color-text-tertiary)]">{selectedOption.sublabel}</span>
              )}
            </>
          ) : (
            <span className="text-[var(--color-text-tertiary)]">{placeholder}</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-[var(--color-text-tertiary)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Options Menu */}
      {isOpen && (
        <div
          className="
            absolute z-50 w-full mt-2 overflow-hidden
            bg-[var(--color-bg-card)] border border-[var(--color-border-focus)] rounded-lg shadow-xl
            animate-fade-in
          "
          style={{ top: '100%' }}
        >
          {searchable && (
            <div className="flex items-center px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-sidebar)]">
              <Search className="w-4 h-4 mr-2 text-[var(--color-text-tertiary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar..."
                className="w-full text-sm bg-transparent border-0 outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:ring-0 focus:outline-none"
              />
            </div>
          )}

          <ul className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={`
                      flex flex-col w-full px-4 py-2 text-left text-sm
                      transition-colors duration-150
                      ${option.value === selectedValue
                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-semibold'
                        : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card-hover)]'}
                    `}
                  >
                    <span>{option.label}</span>
                    {option.sublabel && (
                      <span className="text-xs text-[var(--color-text-tertiary)] font-normal">{option.sublabel}</span>
                    )}
                  </button>
                </li>
              ))
            ) : (
              <li className="px-4 py-3 text-sm text-[var(--color-text-tertiary)] text-center">
                Sin resultados
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
