import { constants as fsConstants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { ApplicationFlagsBitField, DiscordAPIError, REST, Routes } from "discord.js";
import type { AppConfig } from "../config";
import { buildInviteUrl } from "./setup";

export type PreflightStatus = "ok" | "warn" | "fail";

export type PreflightCheck = {
  name: string;
  status: PreflightStatus;
  detail: string;
};

export type PreflightReport = {
  checks: PreflightCheck[];
  hasFailures: boolean;
};

export interface DiscordProbe {
  getBotUser(): Promise<{ id: string; username: string }>;
  getGuild(guildId: string): Promise<{ id: string; name: string }>;
  getApplication?(): Promise<{
    flags?: number;
    flags_new?: string;
    interactions_endpoint_url?: string | null;
  }>;
}

function createDiscordProbe(token: string): DiscordProbe {
  const rest = new REST({ version: "10" }).setToken(token);
  return {
    async getBotUser() {
      const response = (await rest.get(Routes.user())) as { id?: string; username?: string };
      if (!response.id || !response.username) {
        throw new Error("Discord API returned incomplete bot user data.");
      }
      return { id: response.id, username: response.username };
    },
    async getGuild(guildId: string) {
      const response = (await rest.get(Routes.guild(guildId))) as { id?: string; name?: string };
      if (!response.id || !response.name) {
        throw new Error("Discord API returned incomplete guild data.");
      }
      return { id: response.id, name: response.name };
    },
    async getApplication() {
      return (await rest.get(Routes.currentApplication())) as {
        flags?: number;
        flags_new?: string;
        interactions_endpoint_url?: string | null;
      };
    },
  };
}

function formatDiscordError(error: unknown): string {
  if (error instanceof DiscordAPIError) {
    return `${error.message} (status ${error.status}, code ${error.code})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function checkWorkingDirectory(workingDir: string): Promise<PreflightCheck> {
  try {
    const info = await stat(workingDir);
    if (!info.isDirectory()) {
      return {
        name: "Working directory",
        status: "fail",
        detail: `${workingDir} exists but is not a directory.`,
      };
    }
    await access(workingDir, fsConstants.R_OK | fsConstants.W_OK);
    return {
      name: "Working directory",
      status: "ok",
      detail: `${workingDir} is readable and writable.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "Working directory",
      status: "fail",
      detail: `${workingDir} is not accessible (${message}).`,
    };
  }
}

async function checkDatabasePath(databasePath: string): Promise<PreflightCheck> {
  const dbDir = path.dirname(databasePath);
  try {
    await mkdir(dbDir, { recursive: true });
    await access(dbDir, fsConstants.R_OK | fsConstants.W_OK);
    return {
      name: "Database path",
      status: "ok",
      detail: `Database directory is ready: ${dbDir}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "Database path",
      status: "fail",
      detail: `Cannot prepare database directory ${dbDir} (${message}).`,
    };
  }
}

async function checkDiscordApplication(probe: DiscordProbe): Promise<PreflightCheck[]> {
  if (!probe.getApplication) {
    return [];
  }
  try {
    const application = await probe.getApplication();
    const checks: PreflightCheck[] = [];
    const rawFlags = application.flags_new ?? application.flags;
    let flags: bigint | null = null;
    if (typeof rawFlags === "number" && Number.isSafeInteger(rawFlags) && rawFlags >= 0) {
      flags = BigInt(rawFlags);
    } else if (typeof rawFlags === "string" && /^\d+$/.test(rawFlags)) {
      flags = BigInt(rawFlags);
    }

    // Discord accepts the full or limited intent flag depending on the app's size.
    // https://docs.discord.com/developers/resources/application#application-flags
    const messageContentFlags = BigInt(
      ApplicationFlagsBitField.Flags.GatewayMessageContent |
        ApplicationFlagsBitField.Flags.GatewayMessageContentLimited,
    );
    checks.push({
      name: "Discord message content intent",
      status: flags === null ? "warn" : (flags & messageContentFlags) !== 0n ? "ok" : "fail",
      detail:
        flags === null
          ? "Discord did not return usable application flags. Verify Message Content Intent is enabled on the application's Bot page."
          : (flags & messageContentFlags) !== 0n
            ? "Message Content Intent is enabled for this application."
            : "Message Content Intent is disabled. Enable it in Discord Developer Portal > your application > Bot > Privileged Gateway Intents, then restart.",
    });

    const usesHttpInteractions = Boolean(application.interactions_endpoint_url?.trim());
    checks.push({
      name: "Discord interaction delivery",
      status: usesHttpInteractions ? "fail" : "ok",
      detail: usesHttpInteractions
        ? "An Interactions Endpoint URL is configured, so Discord sends slash commands and buttons there instead of this bot. Clear that URL on the application's General Information page to use gateway interactions."
        : "Slash commands and buttons use the Discord gateway.",
    });
    return checks;
  } catch (error) {
    return [
      {
        name: "Discord application settings",
        status: "warn",
        detail: `Could not verify Message Content Intent or interaction delivery: ${formatDiscordError(error)}. Check these settings in Discord Developer Portal.`,
      },
    ];
  }
}

async function checkDiscordAccess(
  config: AppConfig,
  probe: DiscordProbe,
): Promise<PreflightCheck[]> {
  const guildIds = (
    config.discordGuildIds && config.discordGuildIds.length > 0
      ? config.discordGuildIds
      : [config.discordGuildId]
  )
    .map((value) => value.trim())
    .filter(Boolean);
  const resolveGuildCheckName = (guildId: string): string =>
    guildIds.length === 1 ? "Discord guild access" : `Discord guild access (${guildId})`;

  try {
    const botUser = await probe.getBotUser();
    const checks: PreflightCheck[] = [];
    if (botUser.id !== config.discordClientId) {
      checks.push({
        name: "Discord auth",
        status: "fail",
        detail: `Token belongs to bot id ${botUser.id}, but DISCORD_CLIENT_ID/APPLICATION_ID is ${config.discordClientId}.`,
      });
      for (const guildId of guildIds) {
        checks.push({
          name: resolveGuildCheckName(guildId),
          status: "warn",
          detail: "Skipped guild check because app id does not match token.",
        });
      }
      return checks;
    }

    checks.push({
      name: "Discord auth",
      status: "ok",
      detail: `Authenticated as bot ${botUser.username} (${botUser.id}).`,
    });

    checks.push(...(await checkDiscordApplication(probe)));

    for (const guildId of guildIds) {
      try {
        const guild = await probe.getGuild(guildId);
        checks.push({
          name: resolveGuildCheckName(guildId),
          status: "ok",
          detail: `Bot can access guild ${guild.name} (${guild.id}).`,
        });
      } catch (error) {
        const inviteUrl = buildInviteUrl({
          applicationId: config.discordClientId,
          guildId,
        });
        checks.push({
          name: resolveGuildCheckName(guildId),
          status: "fail",
          detail: `Bot cannot access guild ${guildId}: ${formatDiscordError(error)}. Re-invite: ${inviteUrl}`,
        });
      }
    }

    return checks;
  } catch (error) {
    return [
      {
        name: "Discord auth",
        status: "fail",
        detail: `Bot token check failed: ${formatDiscordError(error)}`,
      },
      ...guildIds.map(
        (guildId) =>
          ({
            name: resolveGuildCheckName(guildId),
            status: "warn",
            detail: "Skipped guild check because authentication failed.",
          }) satisfies PreflightCheck,
      ),
    ];
  }
}

export async function runPreflightChecks(
  config: AppConfig,
  options: { discordProbe?: DiscordProbe } = {},
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  checks.push(await checkWorkingDirectory(config.defaultWorkingDir));
  checks.push(await checkDatabasePath(config.databasePath));

  const discordChecks = await checkDiscordAccess(
    config,
    options.discordProbe ?? createDiscordProbe(config.discordToken),
  );
  checks.push(...discordChecks);

  return {
    checks,
    hasFailures: checks.some((check) => check.status === "fail"),
  };
}

export function renderPreflightReport(report: PreflightReport): string {
  const lines = ["Preflight checks:"];
  for (const check of report.checks) {
    const icon = check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
    lines.push(`[${icon}] ${check.name}: ${check.detail}`);
  }
  return lines.join("\n");
}
