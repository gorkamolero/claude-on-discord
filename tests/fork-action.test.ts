import { describe, expect, test } from "bun:test";
import { ChannelType, type ChatInputCommandInteraction } from "discord.js";
import { runForkAction } from "../src/app/command-actions/fork-action";
import { handleForkCommand } from "../src/app/slash-commands/fork-command";
import { canCreateForkThread } from "../src/app/thread-lifecycle-channel-utils";
import type { SessionManager } from "../src/claude/session";
import type { Repository } from "../src/db/repository";

const baseInput = {
  channelId: "source-thread",
  guildId: "guild",
  requestedTitle: "private-fork",
  repository: { getThreadBranchMeta: () => null } as unknown as Repository,
  sessions: {} as SessionManager,
  autoThreadWorktree: false,
  worktreeBootstrap: false,
  runCommand: async () => ({ exitCode: 0, output: "" }),
};

const privateSource = {
  isThread: () => true,
  type: ChannelType.PrivateThread,
  parentId: "parent-channel",
};

describe("fork failure handling", () => {
  test("requires a requester before creating a private fork", async () => {
    let fetchedParent = false;
    const result = await runForkAction({
      ...baseInput,
      channel: privateSource,
      fetchParentChannel: async () => {
        fetchedParent = true;
      },
    });
    expect(result.ok).toBe(false);
    expect(fetchedParent).toBe(false);
  });

  test("does not inherit private context if requester membership fails", async () => {
    let addedMember: string | undefined;
    const result = await runForkAction({
      ...baseInput,
      channel: privateSource,
      requesterUserId: "requester",
      fetchParentChannel: async () => ({
        type: ChannelType.GuildText,
        isThread: () => false,
        threads: {
          create: async (options: { type: ChannelType }) => {
            expect(options.type).toBe(ChannelType.PrivateThread);
            return {
              id: "new-private-thread",
              members: {
                add: async (userId: string) => {
                  addedMember = userId;
                  throw new Error("Missing permissions");
                },
              },
            };
          },
        },
      }),
    });
    expect(addedMember).toBe("requester");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("could not add you");
      expect(result.message).toContain("conversation context was not copied");
    }
  });

  test.each([
    ChannelType.GuildForum,
    ChannelType.GuildMedia,
  ])("rejects channel type %s that requires a forum post payload", (type) => {
    expect(
      canCreateForkThread({
        type,
        isThread: () => false,
        threads: { create: async () => ({ id: "unused" }) },
      }),
    ).toBe(false);
  });

  test("finishes the deferred reply when fork validation fails", async () => {
    const calls: string[] = [];
    await handleForkCommand({
      ...baseInput,
      interaction: {
        channel: null,
        options: { getString: () => null },
        deferReply: async () => {
          calls.push("defer");
        },
        editReply: async (content: string) => {
          calls.push(content);
        },
      } as unknown as ChatInputCommandInteraction,
    });
    expect(calls).toEqual(["defer", "Could not resolve the current channel for `/fork`."]);
  });
});
