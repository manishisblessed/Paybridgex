"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { getBrowserLocation } from "@/lib/client/geolocation";

/**
 * Client-side 2FA step-up for admin writes.
 *
 * `fetchWithStepUp` behaves like `fetch`, but:
 *   1. attaches the operator's live geolocation (x-geo-* headers) to the request
 *      for per-action location recording, and
 *   2. transparently handles a step-up challenge — when the server replies with
 *      { stepUp: true } / code STEP_UP_REQUIRED|INVALID, it opens a dialog,
 *      collects a fresh TOTP (or backup) code, and retries with the x-2fa-code
 *      header. Because there is no grace window, a fresh code is required on
 *      every write.
 *
 * Cancelling the dialog resolves with the original challenge Response so callers
 * can surface the error normally.
 */

type StepUpResolver = (code: { code: string; type: "totp" | "backup" } | null) => void;

type StepUpContextValue = {
  fetchWithStepUp: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const StepUpContext = createContext<StepUpContextValue | null>(null);

const STEP_UP_CODES = new Set(["STEP_UP_REQUIRED", "STEP_UP_INVALID", "STEP_UP_NOT_CONFIGURED"]);

async function isStepUpChallenge(res: Response): Promise<{ challenge: boolean; message?: string; notConfigured?: boolean }> {
  if (res.status !== 401 && res.status !== 412) return { challenge: false };
  try {
    const data = await res.clone().json();
    const challenge = data?.stepUp === true || (typeof data?.code === "string" && STEP_UP_CODES.has(data.code));
    return {
      challenge,
      message: typeof data?.error === "string" ? data.error : undefined,
      notConfigured: data?.code === "STEP_UP_NOT_CONFIGURED",
    };
  } catch {
    return { challenge: false };
  }
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const resolverRef = useRef<StepUpResolver | null>(null);

  const promptForCode = useCallback(
    (msg?: string, isNotConfigured?: boolean) =>
      new Promise<{ code: string; type: "totp" | "backup" } | null>((resolve) => {
        setMessage(msg ?? null);
        setNotConfigured(!!isNotConfigured);
        setOpen(true);
        resolverRef.current = resolve;
      }),
    []
  );

  const settle = useCallback((value: { code: string; type: "totp" | "backup" } | null) => {
    setOpen(false);
    setMessage(null);
    setNotConfigured(false);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  const fetchWithStepUp = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const buildHeaders = async (extra?: Record<string, string>) => {
        const headers = new Headers(init?.headers);
        const loc = await getBrowserLocation();
        if (loc) {
          headers.set("x-geo-lat", String(loc.lat));
          headers.set("x-geo-lng", String(loc.lng));
          if (loc.accuracy != null) headers.set("x-geo-acc", String(loc.accuracy));
        }
        if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
        return headers;
      };

      let res = await fetch(input, { ...init, headers: await buildHeaders() });

      // Loop so an invalid code re-prompts until success or cancel.
      // Bounded to avoid an infinite loop on a persistent server error.
      for (let attempt = 0; attempt < 6; attempt++) {
        const { challenge, message: msg, notConfigured: nc } = await isStepUpChallenge(res);
        if (!challenge) return res;

        const entered = await promptForCode(msg, nc);
        if (!entered) return res; // user cancelled → surface the challenge response

        res = await fetch(input, {
          ...init,
          headers: await buildHeaders({
            "x-2fa-code": entered.code,
            "x-2fa-type": entered.type,
          }),
        });
      }
      return res;
    },
    [promptForCode]
  );

  return (
    <StepUpContext.Provider value={{ fetchWithStepUp }}>
      {children}
      <StepUpDialog
        open={open}
        message={message}
        notConfigured={notConfigured}
        onConfirm={(code, type) => settle({ code, type })}
        onCancel={() => settle(null)}
      />
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) {
    throw new Error("useStepUp must be used within a <StepUpProvider>");
  }
  return ctx;
}

function StepUpDialog({
  open,
  message,
  notConfigured,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string | null;
  notConfigured: boolean;
  onConfirm: (code: string, type: "totp" | "backup") => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);

  if (!open) return null;

  const submit = () => {
    const trimmed = code.trim();
    if (trimmed.length < 4) return;
    onConfirm(trimmed, useBackup ? "backup" : "totp");
    setCode("");
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-ink-900/50 px-4 py-8 backdrop-blur"
      role="dialog"
      aria-modal
      aria-label="Confirm it's you"
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-glow">
        <button
          type="button"
          onClick={() => {
            setCode("");
            onCancel();
          }}
          aria-label="Cancel"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-700 hover:bg-ink-200"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pb-6 pt-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink-900">Confirm it&apos;s you</h2>
          <p className="mt-1 text-sm text-ink-500">
            Enter your two-factor code to authorise this action.
          </p>
        </div>

        <div className="border-t border-ink-100 bg-ink-50/50 px-6 py-6">
          {notConfigured ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This action requires two-factor authentication. Enable 2FA in
                Security settings, then try again.
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="stepup-code">
                  {useBackup ? "Backup code" : "Two-factor code"}
                </Label>
                <Input
                  id="stepup-code"
                  inputMode={useBackup ? "text" : "numeric"}
                  maxLength={useBackup ? 14 : 8}
                  placeholder={useBackup ? "Backup code" : "6-digit code"}
                  value={code}
                  onChange={(e) =>
                    setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, ""))
                  }
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  className="text-center font-mono tracking-[0.3em]"
                />
              </div>

              {message && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{message}</span>
                </div>
              )}

              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={code.trim().length < 4}
                onClick={submit}
              >
                Verify &amp; continue
              </Button>

              <button
                type="button"
                onClick={() => {
                  setUseBackup((v) => !v);
                  setCode("");
                }}
                className="block w-full text-center text-[11px] font-semibold text-brand-700 hover:underline"
              >
                {useBackup ? "Use an authenticator code instead" : "Use a backup code instead"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
