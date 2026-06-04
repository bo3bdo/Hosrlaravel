import { X } from "lucide-react";
import type { Toast } from "./useToasts.js";

export function ToastContainer({
  toasts,
  removeToast,
  language = "en"
}: {
  toasts: Toast[];
  removeToast: (id: string) => void;
  language?: "en" | "ar";
}) {
  if (toasts.length === 0) return null;

  return (
    <div className={`toast-stack ${language === "ar" ? "rtl" : ""}`} role="region" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <span>{toast.message}</span>
          <button onClick={() => removeToast(toast.id)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
