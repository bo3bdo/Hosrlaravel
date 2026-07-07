import {
  FileText,
  Globe,
  LayoutDashboard,
  PanelTopOpen,
  Server,
  Settings
} from "lucide-react";
import type { AppLanguage } from "../types.js";
import type { Section } from "./types.js";

export const sections: Array<{ id: Section; label: string; labelAr: string; icon: typeof Globe }> = [
  { id: "dashboard", label: "Dashboard", labelAr: "لوحة التحكم", icon: LayoutDashboard },
  { id: "sites", label: "Sites", labelAr: "المواقع", icon: Globe },
  { id: "services", label: "Services", labelAr: "الخدمات", icon: Server },
  { id: "tools", label: "Tools", labelAr: "الأدوات", icon: PanelTopOpen },
  { id: "logs", label: "Logs", labelAr: "السجلات", icon: FileText },
  { id: "settings", label: "Settings", labelAr: "الإعدادات", icon: Settings }
];

export const sectionMeta: Record<Section, { subtitleEn: string; subtitleAr: string }> = {
  dashboard: { subtitleEn: "Stack overview and quick actions", subtitleAr: "نظرة عامة وإجراءات سريعة" },
  sites: { subtitleEn: "Domains, commands, and project settings", subtitleAr: "الدومينات والأوامر وإعدادات المشروع" },
  services: { subtitleEn: "PHP, Nginx, database, and Redis", subtitleAr: "PHP وNginx وقاعدة البيانات وRedis" },
  tools: { subtitleEn: "Database, ports, and runtime updates", subtitleAr: "قاعدة البيانات والمنافذ وتحديثات الأدوات" },
  logs: { subtitleEn: "Runtime output and troubleshooting", subtitleAr: "مخرجات التشغيل واستكشاف الأخطاء" },
  settings: { subtitleEn: "Workspace, paths, and security", subtitleAr: "مساحة العمل والمسارات والأمان" }
};

export const shellCopy = {
  en: {
    brandSubtitle: "Windows local dev",
    refresh: "Refresh",
    loading: "Loading laraboxs state...",
    languageButton: "AR",
    live: "Live",
    servicesRunning: "services running",
    sitesCount: "sites"
  },
  ar: {
    brandSubtitle: "بيئة تطوير ويندوز",
    refresh: "تحديث",
    loading: "جار تحميل حالة laraboxs...",
    languageButton: "EN",
    live: "مباشر",
    servicesRunning: "خدمات تعمل",
    sitesCount: "مواقع"
  }
} satisfies Record<AppLanguage, Record<string, string>>;

export const bundledAppVersion = __LARABOXS_APP_VERSION__;

export function sectionLabel(section: { label: string; labelAr: string }, language: AppLanguage): string {
  return language === "ar" ? section.labelAr : section.label;
}

export function appVersionLabel(version: string | undefined): string {
  const normalized = (version ?? bundledAppVersion).trim() || bundledAppVersion;
  return normalized.toLowerCase().startsWith("v") ? normalized : `v${normalized}`;
}
