import { createContext, useContext } from "react";
import type { DesktopConfirmFn } from "../types.js";

export const DesktopConfirmContext = createContext<DesktopConfirmFn | null>(null);

export function useDesktopConfirm(): DesktopConfirmFn {
  const confirm = useContext(DesktopConfirmContext);
  if (!confirm) {
    throw new Error("Desktop confirm dialog is not available.");
  }
  return confirm;
}
