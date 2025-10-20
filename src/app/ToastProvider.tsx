"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

type Toast = {
  id: number;
  message: string;
  kind?: "info" | "success" | "error";
  timeoutMs?: number;
};

type ToastContextValue = {
  show: (message: string, timeoutMs?: number, kind?: Toast["kind"]) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, timeoutMs = 2000, kind: Toast["kind"] = "success") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, timeoutMs, kind }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => {
      setToasts((prev) => prev.filter((p) => p.id !== t.id));
    }, t.timeoutMs ?? 2000));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              (t.kind === "error" ? "bg-red-600" : t.kind === "info" ? "bg-blue-600" : "bg-green-600") +
              " text-white px-3 py-2 rounded shadow"
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}