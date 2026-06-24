import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../atoms/Input';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Buscar...',
  debounceMs = 300,
  className = '',
}) => {
  const [innerValue, setInnerValue] = useState(value);
  const isFirstRender = useRef(true);

  // Sync state if value changes externally
  useEffect(() => {
    setInnerValue(value);
  }, [value]);

  // Handle debounce
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const handler = setTimeout(() => {
      onChange(innerValue);
    }, debounceMs);

    return () => clearTimeout(handler);
  }, [innerValue, debounceMs, onChange]);

  const handleClear = () => {
    setInnerValue('');
    onChange('');
  };

  return (
    <div className={`relative w-full ${className}`}>
      <Input
        value={innerValue}
        onChange={(e) => setInnerValue(e.target.value)}
        placeholder={placeholder}
        icon={<Search className="w-4 h-4" />}
        rightIcon={
          innerValue ? (
            <button
              onClick={handleClear}
              type="button"
              className="p-1 rounded-full hover:bg-[var(--color-bg-sidebar)] transition-colors"
            >
              <X className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
            </button>
          ) : undefined
        }
      />
    </div>
  );
};
