import { useEffect } from "react";
import { BadgeCheck, CircleAlert, ShieldCheck, Trash2, X } from "lucide-react";
import type { DesktopConfirmOptions } from "../types.js";

export function ConfirmDialog({ options, onResolve }: { options: DesktopConfirmOptions; onResolve: (confirmed: boolean) => void }) {
  const tone = options.tone ?? "default";
  const confirmLabel = options.confirmLabel ?? "Continue";
  const cancelLabel = options.cancelLabel ?? "Cancel";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onResolve(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onResolve]);

  return (
    <div className="desktop-confirm-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onResolve(false)}>
      <section className={`desktop-confirm-panel ${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="desktop-confirm-title">
        <div className="desktop-confirm-header">
          <div className={`desktop-confirm-icon ${tone}`}>
            {tone === "danger" ? <Trash2 size={20} /> : tone === "warning" ? <CircleAlert size={20} /> : <ShieldCheck size={20} />}
          </div>
          <div>
            <strong id="desktop-confirm-title">{options.title}</strong>
            {options.message ? <span>{options.message}</span> : null}
          </div>
        </div>
        {options.details?.length ? (
          <div className="desktop-confirm-details">
            {options.details.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </div>
        ) : null}
        <div className="desktop-confirm-actions">
          <button onClick={() => onResolve(false)}>
            <X size={16} />
            <span>{cancelLabel}</span>
          </button>
          <button className={tone === "danger" ? "danger-confirm-button" : "primary"} onClick={() => onResolve(true)}>
            {tone === "danger" ? <Trash2 size={16} /> : <BadgeCheck size={16} />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
