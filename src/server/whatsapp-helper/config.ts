import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface WhatsAppHelperConfig {
  whatsappUrl: string;
  headless: boolean;
  sessionDir: string;
  artifactDir: string;
  enableDebugArtifacts: boolean;
  launchTimeoutMs: number;
  loginTimeoutMs: number;
  navigationTimeoutMs: number;
  joinTimeoutMs: number;
  sendTimeoutMs: number;
  typeDelayMs: number;
  searchSettledDelayMs: number;
}

const moduleRoot = fileURLToPath(new URL(".", import.meta.url));

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadWhatsAppHelperConfig(
  env: NodeJS.ProcessEnv = process.env,
): WhatsAppHelperConfig {
  return {
    whatsappUrl: "https://web.whatsapp.com",
    headless: parseBoolean(env.WHATSAPP_HELPER_HEADLESS, false),
    sessionDir: resolve(
      env.WHATSAPP_HELPER_SESSION_DIR ?? resolve(moduleRoot, "runtime", "session"),
    ),
    artifactDir: resolve(
      env.WHATSAPP_HELPER_ARTIFACT_DIR ?? resolve(moduleRoot, "artifacts"),
    ),
    enableDebugArtifacts: parseBoolean(env.WHATSAPP_HELPER_ENABLE_DEBUG_ARTIFACTS, false),
    launchTimeoutMs: parseNumber(env.WHATSAPP_HELPER_LAUNCH_TIMEOUT_MS, 30_000),
    loginTimeoutMs: parseNumber(env.WHATSAPP_HELPER_LOGIN_TIMEOUT_MS, 180_000),
    navigationTimeoutMs: parseNumber(env.WHATSAPP_HELPER_NAVIGATION_TIMEOUT_MS, 15_000),
    joinTimeoutMs: parseNumber(env.WHATSAPP_HELPER_JOIN_TIMEOUT_MS, 15_000),
    sendTimeoutMs: parseNumber(env.WHATSAPP_HELPER_SEND_TIMEOUT_MS, 10_000),
    typeDelayMs: parseNumber(env.WHATSAPP_HELPER_TYPE_DELAY_MS, 20),
    searchSettledDelayMs: parseNumber(env.WHATSAPP_HELPER_SEARCH_SETTLED_DELAY_MS, 300),
  };
}

export async function ensureWhatsAppHelperDirs(config: WhatsAppHelperConfig): Promise<void> {
  await mkdir(config.sessionDir, { recursive: true });

  if (config.enableDebugArtifacts) {
    await mkdir(config.artifactDir, { recursive: true });
  }
}
