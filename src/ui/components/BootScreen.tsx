import { useEffect, useState } from "react";
import { LoaderCircle, RotateCw } from "lucide-react";

const bootMessages = [
  "Checking runtimes and services...",
  "Discovering parked projects...",
  "Reading local configuration...",
  "Preparing dashboard..."
];

export function BootScreen({ error, busy, refresh }: { error: string | null; busy: boolean; refresh: () => Promise<void> }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (error) return;
    const messageTimer = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % bootMessages.length);
    }, 1400);
    return () => window.clearInterval(messageTimer);
  }, [error]);

  useEffect(() => {
    if (error) return;
    const start = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const eased = 90 * (1 - Math.exp(-elapsed / 1800));
      setProgress(Math.min(90, Math.round(eased)));
    }, 120);
    return () => window.clearInterval(timer);
  }, [error]);

  return (
    <div className="boot-shell">
      <div className="boot-glow" aria-hidden="true" />
      <div className="boot-panel desktop-panel">
        <div className="brand">
          <div className="brand-mark">
            <span>L</span>
          </div>
          <div>
            <strong>laraboxs</strong>
            <span>Windows local dev</span>
          </div>
        </div>
        <div className="boot-status">
          <LoaderCircle className="spin" size={22} />
          <div>
            <strong>{error ? "Could not load laraboxs" : "Loading local stack state"}</strong>
            <span>{error ?? bootMessages[messageIndex]}</span>
          </div>
        </div>
        <div className="boot-progress-track" aria-hidden="true">
          <div
            className={`boot-progress-fill ${error ? "boot-progress-error" : ""}`}
            style={error ? undefined : { width: `${progress}%`, transition: "width 120ms linear" }}
          />
        </div>
        <button onClick={() => void refresh()} disabled={busy} className={error ? "primary" : ""}>
          <RotateCw size={18} />
          <span>{error ? "Retry" : "Refresh"}</span>
        </button>
      </div>
    </div>
  );
}
