import React, { useState, useRef, useEffect } from 'react';

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  error?: boolean;
}

export const OTPInput: React.FC<OTPInputProps> = ({
  length = 6,
  value,
  onChange,
  onComplete,
  error = false,
}) => {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(''));
  const inputsRef = useRef<HTMLInputElement[]>([]);

  // Sync state with incoming value string
  useEffect(() => {
    const valDigits = value.split('').slice(0, length);
    const newDigits = [...valDigits, ...Array(length - valDigits.length).fill('')];
    setDigits(newDigits);
  }, [value, length]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const val = e.target.value;
    if (!val) return;

    // Capture only the last digit (useful when user types multiple characters)
    const char = val.slice(-1);
    const newDigits = [...digits];
    newDigits[index] = char;

    const newValue = newDigits.join('');
    onChange(newValue);

    // Focus next input if there's any
    if (index < length - 1 && char) {
      inputsRef.current[index + 1]?.focus();
    }

    // Call onComplete when fully filled
    if (newValue.length === length && onComplete) {
      onComplete(newValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      const newDigits = [...digits];
      
      if (!digits[index] && index > 0) {
        // Current input is already empty, focus and clear the previous input
        inputsRef.current[index - 1]?.focus();
        newDigits[index - 1] = '';
      } else {
        // Clear current input
        newDigits[index] = '';
      }
      
      const newValue = newDigits.join('');
      onChange(newValue);
      e.preventDefault();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    // Filter numbers only
    const cleanText = pastedText.replace(/[^0-9]/g, '').slice(0, length);
    
    if (cleanText) {
      onChange(cleanText);
      const parts = cleanText.split('');
      parts.forEach((char, idx) => {
        if (inputsRef.current[idx]) {
          inputsRef.current[idx]!.value = char;
        }
      });
      
      const lastIdx = Math.min(cleanText.length, length - 1);
      inputsRef.current[lastIdx]?.focus();

      if (cleanText.length === length && onComplete) {
        onComplete(cleanText);
      }
    }
    e.preventDefault();
  };

  return (
    <div className="flex justify-between gap-2 max-w-sm mx-auto" onPaste={handlePaste}>
      {Array(length)
        .fill(0)
        .map((_, idx) => (
          <input
            key={idx}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digits[idx] || ''}
            onChange={(e) => handleChange(e, idx)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            ref={(el) => {
              if (el) inputsRef.current[idx] = el;
            }}
            className={`
              w-12 h-14 text-center text-xl font-bold rounded-xl border
              bg-[var(--color-bg-input)] text-[var(--color-text-primary)]
              focus:ring-2 focus:ring-offset-0 focus:outline-none transition-all duration-200
              ${
                error
                  ? 'border-[var(--color-border-danger)] focus:ring-[var(--color-danger-muted)] focus:border-[var(--color-border-danger)]'
                  : 'border-[var(--color-border)] focus:ring-[var(--color-accent-muted)] focus:border-[var(--color-border-focus)]'
              }
            `}
          />
        ))}
    </div>
  );
};
