import { type InputHTMLAttributes } from "react";
import InfoHint from "./InfoHint";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

/** labelled text input with an optional info hint. */
export default function Input({
  label,
  hint,
  id,
  className = "",
  ...props
}: InputProps) {
  return (
    <div className="flex flex-col justify-end h-full">
      {label && (
        <label
          htmlFor={id}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          {label}
          {hint && <InfoHint text={hint} label={label} />}
        </label>
      )}
      <input
        id={id}
        className={`w-full px-4 py-2.5 rounded-full text-sm border border-tv-border
          bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted
          focus:outline-none focus:border-tv-accent transition-colors ${className}`}
        {...props}
      />
    </div>
  );
}
