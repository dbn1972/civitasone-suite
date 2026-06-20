import { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  children: ReactNode;
}

export function FormField({ label, htmlFor, error, helperText, required, children }: FormFieldProps) {
  return (
    <div className="w-full">
      <label htmlFor={htmlFor} className="block text-body-sm font-medium text-text-primary mb-2">
        {label}
        {required && <span className="text-intent-danger ml-1">*</span>}
      </label>
      {children}
      {(error || helperText) && (
        <div className="mt-1.5 flex items-start gap-1.5">
          {error && <AlertCircle className="size-4 text-intent-danger mt-0.5 flex-shrink-0" />}
          <p className={`text-body-sm ${error ? 'text-intent-danger' : 'text-text-muted'}`}>
            {error || helperText}
          </p>
        </div>
      )}
    </div>
  );
}
