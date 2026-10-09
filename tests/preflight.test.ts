import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type DiscordProbe, runPreflightChecks } from "../src/bootstrap/preflight";
import type { AppConfig } from "../src/config";

function createConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    discordToken: "token",
    discordClientId: "123",
    discordGuildId: "999",
    defaultWorkingDir: "/tmp",
    databasePath: "/tmp/bot.sqlite",
    defaultModel: "sonnet",
    autoThreadWorktree: false,
    requireMentionInMultiUserChannels: false,
    worktreeBootstrap: true,
    claudePermissionMode: "bypassPermissions",
    ...overrides,
  };
}

async function checkApplication(getApplication: NonNullable<DiscordProbe["getApplication"]>) {
  const root = await mkdtemp(path.join(tmpdir(), "preflight-application-"));
  try {
    return await runPreflightChecks(
      createConfig({ defaultWorkingDir: root, databasePath: path.join(root, "bot.sqlite") }),
      {
        discordProbe: {
          getBotUser: async () => ({ id: "123", username: "hermes" }),
          getGuild: async () => ({ id: "999", name: "Guild" }),
          getApplication,
        },
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("startup preflight", () => {
  test.each([262144, 524288])("accepts message content intent flag %i", async (flags) => {
    const report = await checkApplication(async () => ({ flags }));
    expect(report.hasFailures).toBe(false);
    expect(
      report.checks.find((check) => check.name === "Discord message content intent")?.status,
    ).toBe("ok");
  });

  test("supports Discord's string flags without losing high bits", async () => {
    const report = await checkApplication(async () => ({
      flags: 0,
      flags_new: String((1n << 60n) | 524288n),
    }));
    expect(report.hasFailures).toBe(false);
    expect(
      report.checks.find((check) => check.name === "Discord message content intent")?.status,
    ).toBe("ok");
  });

  test("fails with an actionable message when message content intent is disabled", async () => {
    const report = await checkApplication(async () => ({ flags: 0 }));
    expect(report.hasFailures).toBe(true);
    expect(
      report.checks.find((check) => check.name === "Discord message content intent"),
    ).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("Privileged Gateway Intents"),
    });
  });

  test.each([
    undefined,
    "not-flags",
  ])("warns rather than failing on unavailable flags: %s", async (flags_new) => {
    const report = await checkApplication(async () => ({ flags_new }));
    expect(report.hasFailures).toBe(false);
    expect(
      report.checks.find((check) => check.name === "Discord message content intent")?.status,
    ).toBe("warn");
  });

  test("detects HTTP interaction routing that prevents gateway commands and buttons", async () => {
    const report = await checkApplication(async () => ({
      flags: 524288,
      interactions_endpoint_url: "https://example.com/interactions",
    }));
    expect(report.hasFailures).toBe(true);
    expect(
      report.checks.find((check) => check.name === "Discord interaction delivery"),
    ).toMatchObject({ status: "fail", detail: expect.stringContaining("Clear that URL") });
  });

  test("keeps guild checks available when application settings cannot be fetched", async () => {
    const report = await checkApplication(async () => {
      throw new Error("Temporary Discord API failure");
    });
    expect(report.hasFailures).toBe(false);
    expect(
      report.checks.find((check) => check.name === "Discord application settings")?.status,
    ).toBe("warn");
    expect(report.checks.find((check) => check.name === "Discord guild access")?.status).toBe("ok");
  });

  test("passes when local paths and discord access are valid", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "preflight-ok-"));
    const workingDir = path.join(root, "work");
    const databasePath = path.join(root, "data", "bot.sqlite");
    await mkdir(workingDir, { recursive: true });

    const report = await runPreflightChecks(
      createConfig({ defaultWorkingDir: workingDir, databasePath }),
      {
        discordProbe: {
          getBotUser: async () => ({ id: "123", username: "hermes" }),
          getGuild: async () => ({ id: "999", name: "Guild" }),
        },
      },
    );

    expect(report.hasFailures).toBe(false);
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  test("fails when token bot id does not match configured client id", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "preflight-mismatch-"));
    const workingDir = path.join(root, "work");
    const databasePath = path.join(root, "data", "bot.sqlite");
    await mkdir(workingDir, { recursive: true });
    let guildChecked = false;
    let applicationChecked = false;

    const report = await runPreflightChecks(
      createConfig({ defaultWorkingDir: workingDir, databasePath }),
      {
        discordProbe: {
          getBotUser: async () => ({ id: "456", username: "wrong-bot" }),
          getApplication: async () => {
            applicationChecked = true;
            return { flags: 524288 };
          },
          getGuild: async () => {
            guildChecked = true;
            return { id: "999", name: "Guild" };
          },
        },
      },
    );

    expect(report.hasFailures).toBe(true);
    expect(guildChecked).toBe(false);
    expect(applicationChecked).toBe(false);
    expect(
      report.checks.some((check) => check.name === "Discord auth" && check.status === "fail"),
    ).toBe(true);
  });

  test("fails auth and skips guild check when token probe throws", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "preflight-auth-"));
    const workingDir = path.join(root, "work");
    const databasePath = path.join(root, "data", "bot.sqlite");
    await mkdir(workingDir, { recursive: true });

    const report = await runPreflightChecks(
      createConfig({ defaultWorkingDir: workingDir, databasePath }),
      {
        discordProbe: {
          getBotUser: async () => {
            throw new Error("401 unauthorized");
          },
          getGuild: async () => ({ id: "999", name: "Guild" }),
        },
      },
    );

    expect(report.hasFailures).toBe(true);
    expect(
      report.checks.some((check) => check.name === "Discord auth" && check.status === "fail"),
    ).toBe(true);
    expect(
      report.checks.some(
        (check) => check.name === "Discord guild access" && check.status === "warn",
      ),
    ).toBe(true);
  });

  test("checks every configured guild id in multi-guild mode", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "preflight-multi-"));
    const workingDir = path.join(root, "work");
    const databasePath = path.join(root, "data", "bot.sqlite");
    await mkdir(workingDir, { recursive: true });

    const requestedGuildIds: string[] = [];
    const report = await runPreflightChecks(
      createConfig({
        defaultWorkingDir: workingDir,
        databasePath,
        discordGuildId: "g1",
        discordGuildIds: ["g1", "g2"],
      }),
      {
        discordProbe: {
          getBotUser: async () => ({ id: "123", username: "hermes" }),
          getGuild: async (guildId) => {
            requestedGuildIds.push(guildId);
            if (guildId === "g2") {
              throw new Error("Missing Access");
            }
            return { id: guildId, name: `Guild ${guildId}` };
          },
        },
      },
    );

    expect(requestedGuildIds).toEqual(["g1", "g2"]);
    expect(report.hasFailures).toBe(true);
    expect(
      report.checks.some(
        (check) => check.name === "Discord guild access (g1)" && check.status === "ok",
      ),
    ).toBe(true);
    expect(
      report.checks.some(
        (check) => check.name === "Discord guild access (g2)" && check.status === "fail",
      ),
    ).toBe(true);
  });
});
