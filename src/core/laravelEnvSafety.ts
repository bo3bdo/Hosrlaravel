import { loadConfig } from "./config.js";
import { installPhpExtension, phpExtensionLoaded } from "./phpExtensions.js";

export const safeLocalLaravelDriverValues = {
  SESSION_DRIVER: "file",
  CACHE_STORE: "file",
  QUEUE_CONNECTION: "sync"
};

export async function ensureRedisPhpClientAvailable(phpVersion?: string): Promise<boolean> {
  const config = await loadConfig();
  const version = phpVersion ?? config.globalPhpVersion;
  if (phpExtensionLoaded("redis", version)) {
    return true;
  }

  const status = await installPhpExtension("redis", version);
  return status.loaded === true || phpExtensionLoaded("redis", version);
}
