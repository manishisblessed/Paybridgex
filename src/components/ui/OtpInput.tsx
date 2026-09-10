"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface OtpInputProps {
  /** Current OTP value (digits only; may be shorter than `length`). */
  value: string;
  /** Called with the full combined value whenever it changes. */
  onChange: (value: string) => void;
  /** Number of digit boxes. Defaults to 6. */
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Segmented one-time-code input: renders `length` single-digit boxes with
 * auto-advance, backspace-to-previous, arrow-key navigation and paste support.
 *
 * Fully controlled — it derives each box from `value` and reports the combined
 * string via `onChange`, so callers can keep their existing "auto-verify when
 * 6 digits are entered" logic untouched.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  autoFocus = false,
  className,
}: OtpInputProps) {
  const inputsRef = React.useRef<Array<HTMLInputElement | null>>([]);

  const normalized = value.replace(/\D/g, "").slice(0, length);
  const digits = normalized.split("");

  React.useEffect(() => {
    if (autoFocus) inputsRef.current[0]?.focus();
    // Focus once on mount when requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusInput(index: number) {
    const clamped = Math.max(0, Math.min(length - 1, index));
    const el = inputsRef.current[clamped];
    if (el) {
      el.focus();
      el.select();
    }
  }

  function currentArray() {
    const arr = value.replace(/\D/g, "").slice(0, length).split("");
    while (arr.length < length) arr.push("");
    return arr;
  }

  function handleChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "");
    const arr = currentArray();

    if (!raw) {
      arr[index] = "";
      onChange(arr.join("").replace(/\s/g, ""));
      return;
    }

    // Distribute the typed characters starting at the current box. Handles the
    // common single-digit case as well as browser OTP autofill dumping the full
    // code into one box.
    let i = index;
    for (const ch of raw) {
      if (i >= length) break;
      arr[i] = ch;
      i++;
    }
    onChange(arr.join("").slice(0, length));
    focusInput(i);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const arr = currentArray();
      if (arr[index]) {
        arr[index] = "";
        onChange(arr.join(""));
      } else if (index > 0) {
        arr[index - 1] = "";
        onChange(arr.join(""));
        focusInput(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusInput(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusInput(index + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    focusInput(pasted.length >= length ? length - 1 : pasted.length);
  }

  return (
    <div
      className={cn("flex items-center justify-center gap-2 sm:gap-3", className)}
      role="group"
      aria-label={`${length}-digit verification code`}
    >
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          value={digits[i] ?? ""}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            "h-12 w-11 rounded-xl border border-ink-200 bg-white text-center text-xl font-semibold text-ink-900 shadow-sm transition sm:h-14 sm:w-12",
            "focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        />
      ))}
    </div>
  );
}
