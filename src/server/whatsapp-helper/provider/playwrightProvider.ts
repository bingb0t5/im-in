import type { WhatsAppHelperConfig } from "../config";
import { loadWhatsAppHelperConfig } from "../config";
import type {
  WhatsAppHelperHealth,
  WhatsAppHelperProvider,
  WhatsAppJoinInput,
  WhatsAppJoinResult,
  WhatsAppSendInput,
  WhatsAppSendResult,
} from "../types/contracts";
import { toFailureCode, WhatsAppHelperError } from "../types/errors";
import { checkWhatsAppHealth, connectingHealth, offlineHealth } from "./healthCheck";
import { joinGroupViaInviteLink } from "./joinGroup";
import { launchWhatsAppSession, type WhatsAppSessionHandle } from "./launch";
import { sendMessageViaPage } from "./sendMessage";

export class PlaywrightWhatsAppHelperProvider implements WhatsAppHelperProvider {
  private readonly config: WhatsAppHelperConfig;
  private session: WhatsAppSessionHandle | null = null;
  private sessionPromise: Promise<WhatsAppSessionHandle> | null = null;

  constructor(config: WhatsAppHelperConfig = loadWhatsAppHelperConfig()) {
    this.config = config;
  }

  private async getSession(): Promise<WhatsAppSessionHandle> {
    if (this.session && !this.session.page.isClosed()) {
      return this.session;
    }

    if (!this.sessionPromise) {
      this.sessionPromise = launchWhatsAppSession(this.config)
        .then((session) => {
          this.session = session;
          return session;
        })
        .finally(() => {
          this.sessionPromise = null;
        });
    }

    return this.sessionPromise;
  }

  async getHealth(): Promise<WhatsAppHelperHealth> {
    if (this.sessionPromise) {
      return connectingHealth();
    }

    try {
      const session = await this.getSession();
      return await checkWhatsAppHealth(session.page, this.config);
    } catch (error) {
      const code = toFailureCode(error);
      const reason =
        error instanceof WhatsAppHelperError ? error.code : code === "UNKNOWN" ? "UNKNOWN" : code;
      return offlineHealth(reason);
    }
  }

  async close(): Promise<void> {
    this.sessionPromise = null;

    if (!this.session) {
      return;
    }

    const session = this.session;
    this.session = null;
    await session.context.close().catch(() => undefined);
  }

  async joinGroupByInviteLink(input: WhatsAppJoinInput): Promise<WhatsAppJoinResult> {
    try {
      const session = await this.getSession();
      return await joinGroupViaInviteLink(session.page, this.config, input);
    } catch (error) {
      return {
        ok: false,
        failureCode: toFailureCode(error),
      };
    }
  }

  async sendMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    try {
      const session = await this.getSession();
      return await sendMessageViaPage(session.page, this.config, input);
    } catch (error) {
      return {
        ok: false,
        failureCode: toFailureCode(error),
      };
    }
  }
}

export function createPlaywrightWhatsAppHelperProvider(
  config: WhatsAppHelperConfig = loadWhatsAppHelperConfig(),
): WhatsAppHelperProvider {
  return new PlaywrightWhatsAppHelperProvider(config);
}
