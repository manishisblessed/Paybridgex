"use client";

import { ReactNode, useEffect, useState } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

/**
 * Animated replacement for native `confirm()` / `prompt()` dialogs.
 * Pass `input` to collect an optional text value alongside the confirmation.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  input,
  extraActions,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (inputValue: string) => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  input?: { label: string; placeholder?: string; required?: boolean };
  /** Extra buttons rendered between Cancel and Confirm. */
  extraActions?: ReactNode;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const danger = tone === "danger";

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          {extraActions}
          <Button
            variant="primary"
            size="sm"
            isLoading={busy}
            disabled={busy || (input?.required ? !value.trim() : false)}
            onClick={() => onConfirm(value.trim())}
            className={cn(
              danger &&
                "from-rose-600 to-rose-500 focus-visible:ring-rose-500"
            )}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-full",
            danger ? "bg-rose-50 text-rose-600" : "bg-brand-50 text-brand-600"
          )}
        >
          {danger ? (
            <AlertTriangle className="h-5 w-5" />
          ) : (
            <HelpCircle className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-semibold text-ink-900">
            {title}
          </h3>
          {description && (
            <div className="mt-1 text-sm text-ink-600">{description}</div>
          )}
          {input && (
            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-ink-500">
                {input.label}
              </label>
              <input
                autoFocus
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={input.placeholder}
                disabled={busy}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
