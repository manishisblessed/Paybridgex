"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented PAN input.
 *
 * PAN format is fixed at 10 chars: `AAAAA9999A`
 *   - positions 0-4  → letters  (A-Z)
 *   - positions 5-8  → digits   (0-9)
 *   - position  9    → letter   (A-Z)
 *
 * Each box only accepts the character type valid for its position, auto-upper-
 * cases, auto-advances, supports backspace / arrows / paste, and shows an
 * `A` / `9` placeholder so the expected shape is obvious. Fully controlled via
 * `value` / `onChange` (reports the combined uppercase string).
 */

const PAN_LENGTH = 10;

function isAlphaPos(i: number): boolean {
  return i < 5 || i === 9;
}

/** Returns the sanitized (uppercased) char if valid for this position, else "". */
function sanitizeAt(index: number, ch: string): string {
  const c = ch.toUpperCase();
  if (isAlphaPos(index)) return /[A-Z]/.test(c) ? c : "";
  return /[0-9]/.test(c) ? c : "";
}

export interface PanInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function PanInput({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  className,
}: PanInputProps) {
  const inputsRef = React.useRef<Array<HTMLInputElement | null>>([]);

  const chars = value.toUpperCase().slice(0, PAN_LENGTH).split("");

  React.useEffect(() => {
    if (autoFocus) inputsRef.current[0]?.focus();
    // Focus once on mount when requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusInput(index: number) {
    const clamped = Math.max(0, Math.min(PAN_LENGTH - 1, index));
    const el = inputsRef.current[clamped];
    if (el) {
      el.focus();
      el.select();
    }
  }

  function currentArray() {
    const arr = value.toUpperCase().slice(0, PAN_LENGTH).split("");
    while (arr.length < PAN_LENGTH) arr.push("");
    return arr;
  }

  function handleChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const arr = currentArray();

    if (!raw) {
      arr[index] = "";
      onChange(arr.join(""));
      return;
    }

    // Fill from the current box, keeping only characters valid for the position
    // they land in. An invalid character (e.g. a digit typed into a letter box)
    // is ignored rather than advancing focus.
    let i = index;
    for (const ch of raw) {
      if (i >= PAN_LENGTH) break;
      const s = sanitizeAt(i, ch);
      if (s) {
        arr[i] = s;
        i++;
      }
    }
    onChange(arr.join(""));
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
    const arr = currentArray();
    const pasted = e.clipboardData.getData("text");
    let i = 0;
    for (const ch of pasted) {
      if (i >= PAN_LENGTH) break;
      const s = sanitizeAt(i, ch);
      if (s) {
        arr[i] = s;
        i++;
      }
    }
    onChange(arr.join(""));
    focusInput(i);
  }

  return (
    <div
      className={cn("grid grid-cols-10 gap-1 sm:gap-1.5", className)}
      role="group"
      aria-label="PAN number"
    >
      {Array.from({ length: PAN_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode={isAlphaPos(i) ? "text" : "numeric"}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={1}
          disabled={disabled}
          value={chars[i] ?? ""}
          placeholder={isAlphaPos(i) ? "A" : "9"}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={`PAN character ${i + 1}`}
          className={cn(
            "h-11 w-full rounded-lg border border-ink-200 bg-white text-center text-base font-semibold uppercase text-ink-900 shadow-sm transition sm:text-lg",
            "placeholder:font-normal placeholder:text-ink-300",
            "focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        />
      ))}
    </div>
  );
}
