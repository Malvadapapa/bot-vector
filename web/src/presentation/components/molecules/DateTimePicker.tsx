import React from 'react';
import { FormField } from './FormField';

interface DateTimePickerProps {
  label: string;
  startDate: string; // ISO String
  onStartDateChange: (date: string) => void;
  endDate?: string;  // ISO String, optional for range
  onEndDateChange?: (date: string) => void;
  required?: boolean;
  error?: string;
  className?: string;
}

export const DateTimePicker: React.FC<DateTimePickerProps> = ({
  label,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  required = false,
  error,
  className = '',
}) => {
  // Convert ISO string to YYYY-MM-DDThh:mm for datetime-local input
  const formatToLocalValue = (isoString: string): string => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      // Offset timezone to local format YYYY-MM-DDTHH:mm
      const pad = (num: number) => String(num).padStart(2, '0');
      const yyyy = date.getFullYear();
      const mm = pad(date.getMonth() + 1);
      const dd = pad(date.getDate());
      const hh = pad(date.getHours());
      const min = pad(date.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    } catch {
      return '';
    }
  };

  const handleLocalChange = (val: string, callback: (iso: string) => void) => {
    if (!val) {
      callback('');
      return;
    }
    const isoString = new Date(val).toISOString();
    callback(isoString);
  };

  const isRange = endDate !== undefined && onEndDateChange !== undefined;

  return (
    <div className={`flex flex-col gap-1 w-full ${className}`}>
      {/* Date picker container */}
      <div className={`grid gap-4 ${isRange ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
        <FormField
          label={isRange ? `${label} (Inicio)` : label}
          type="datetime-local"
          required={required}
          value={formatToLocalValue(startDate)}
          onChange={(e) => handleLocalChange(e.target.value, onStartDateChange)}
          error={!isRange ? error : undefined}
        />
        
        {isRange && (
          <FormField
            label={`${label} (Fin / Cierre)`}
            type="datetime-local"
            required={required}
            value={formatToLocalValue(endDate)}
            onChange={(e) => handleLocalChange(e.target.value, onEndDateChange!)}
            error={error} // If there's an error for the range, show it on the second one
          />
        )}
      </div>
    </div>
  );
};
