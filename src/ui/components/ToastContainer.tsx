import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import type { Toast } from "./useToasts.js";

const icons: Record<Toast["type"], typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: CircleAlert
};

export function ToastContainer({
  toasts,
  removeToast,
  pauseToast,
  resumeToast,
  language = "en"
}: {
  toasts: Toast[];
  removeToast: (id: string) => void;
  pauseToast: (id: string) => void;
  resumeToast: (id: string) => void;
  language?: "en" | "ar";
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className={`toast-stack ${language === "ar" ? "rtl" : ""}`}
      role="region"
      aria-live="polite"
      aria-label={language === "ar" ? "الإشعارات" : "Notifications"}
    >
      {toasts.map((toast) => {
        const Icon = icons[toast.type];
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            onMouseEnter={() => pauseToast(toast.id)}
            onMouseLeave={() => resumeToast(toast.id)}
            onFocus={() => pauseToast(toast.id)}
            onBlur={() => resumeToast(toast.id)}
          >
            <Icon size={16} aria-hidden="true" className="toast-icon" />
            <span className="toast-message">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              aria-label={language === "ar" ? "إغلاق الإشعار" : "Dismiss notification"}
              className="toast-dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
