import React from 'react';

interface FormFieldProps {
  label: string;
  name: string;
  type?: 'text' | 'textarea' | 'select';
  placeholder?: string;
  helpText?: string;
  options?: string[];
  rows?: number;
}

export function FormField({ label, name, type = 'text', placeholder, helpText, options, rows = 3 }: FormFieldProps) {
  const baseInputClasses =
    'w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-phx-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-phx-cyan/40 focus:border-phx-cyan transition-colors';

  return (
    <div>
      <label htmlFor={name} className="block text-sm font-semibold text-phx-navy mb-1.5">
        {label}
      </label>
      {type === 'textarea' ? (
        <textarea id={name} name={name} rows={rows} placeholder={placeholder} className={baseInputClasses} />
      ) : type === 'select' ? (
        <select id={name} name={name} className={baseInputClasses} defaultValue="">
          <option value="" disabled>
            Select {label.toLowerCase()}
          </option>
          {options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input id={name} name={name} type="text" placeholder={placeholder} className={baseInputClasses} />
      )}
      {helpText && <p className="mt-1.5 text-xs text-gray-400">{helpText}</p>}
    </div>
  );
}
