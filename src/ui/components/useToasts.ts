import { useState, useCallback, useEffect } from "react";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

let globalAddToast: ((message: string, type?: "success" | "error" | "info") => void) | null = null;

export function showToast(message: string, type: "success" | "error" | "info" = "info"): void {
  globalAddToast?.(message, type);
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, message, type }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    globalAddToast = addToast;
    return () => {
      if (globalAddToast === addToast) {
        globalAddToast = null;
      }
    };
  }, [addToast]);

  return { toasts, addToast, removeToast };
}
