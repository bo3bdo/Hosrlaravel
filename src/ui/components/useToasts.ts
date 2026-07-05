import { useState, useCallback, useEffect, useRef } from "react";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  createdAt: number;
  duration: number;
}

const DEFAULT_DURATIONS: Record<Toast["type"], number> = {
  success: 4000,
  info: 5000,
  error: 8000
};

let globalAddToast: ((message: string, type?: Toast["type"], duration?: number) => void) | null = null;

export function showToast(message: string, type: Toast["type"] = "info", duration?: number): void {
  globalAddToast?.(message, type, duration);
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Record<string, number>>({});
  const pausedRef = useRef<Record<string, number>>({});

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current[id];
    if (timer) {
      window.clearTimeout(timer);
      delete timersRef.current[id];
    }
  }, []);

  const scheduleRemoval = useCallback((id: string, delay: number) => {
    clearTimer(id);
    timersRef.current[id] = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      delete timersRef.current[id];
    }, delay);
  }, [clearTimer]);

  const addToast = useCallback((message: string, type: Toast["type"] = "info", duration?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedDuration = Math.max(2000, duration ?? DEFAULT_DURATIONS[type]);
    const toast: Toast = { id, message, type, createdAt: Date.now(), duration: resolvedDuration };

    setToasts((current) => {
      const trimmed = current.slice(-5);
      return [...trimmed, toast];
    });
    scheduleRemoval(id, resolvedDuration);
  }, [scheduleRemoval]);

  const removeToast = useCallback((id: string) => {
    clearTimer(id);
    delete pausedRef.current[id];
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, [clearTimer]);

  const pauseToast = useCallback((id: string) => {
    const toast = toasts.find((item) => item.id === id);
    if (!toast || pausedRef.current[id] !== undefined) return;

    clearTimer(id);
    const remaining = Math.max(0, toast.duration - (Date.now() - toast.createdAt));
    pausedRef.current[id] = remaining;
  }, [toasts, clearTimer]);

  const resumeToast = useCallback((id: string) => {
    const remaining = pausedRef.current[id];
    if (remaining === undefined) return;

    delete pausedRef.current[id];
    if (remaining <= 0) {
      removeToast(id);
      return;
    }

    const toast = toasts.find((item) => item.id === id);
    if (!toast) return;

    const now = Date.now();
    const elapsed = toast.duration - remaining;
    setToasts((current) =>
      current.map((item) => (item.id === id ? { ...item, createdAt: now - elapsed } : item))
    );
    scheduleRemoval(id, remaining);
  }, [toasts, removeToast, scheduleRemoval]);

  useEffect(() => {
    globalAddToast = addToast;
    return () => {
      if (globalAddToast === addToast) {
        globalAddToast = null;
      }
      Object.keys(timersRef.current).forEach((id) => clearTimer(id));
    };
  }, [addToast, clearTimer]);

  return { toasts, addToast, removeToast, pauseToast, resumeToast };
}
