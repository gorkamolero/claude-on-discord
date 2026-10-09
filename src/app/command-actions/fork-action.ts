import { ChannelType } from "discord.js";
import type { SessionManager } from "../../claude/session";
import type { Repository } from "../../db/repository";
import { parseThreadBranchMeta } from "../../discord/thread-branch";
import {
  buildForkThreadTitle,
  canCreateForkThread,
  isThreadBootstrapChannel,
  maybeInheritThreadContext,
} from "../thread-lifecycle";
import type { ForkableChannel } from "../thread-lifecycle-channel-utils";

type RunCommand = (command: string[], cwd: string) => Promise<{ exitCode: number; output: string }>;

export type ForkActionResult =
  | { ok: false; message: string }
  | { ok: true; threadId: string; title: string; bootstrapWarning?: string };

export async function runForkAction(input: {
  channel: unknown;
  channelId: string;
  guildId: string;
  requestedTitle: string | null;
  requesterUserId?: string;
  sessions: SessionManager;
  repository: Repository;
  autoThreadWorktree: boolean;
  worktreeBootstrap: boolean;
  worktreeBootstrapCommand?: string;
  runCommand: RunCommand;
  /**
   * Required when `/fork` is run from inside a thread. Used to fetch the parent
   * channel so a sibling thread can be created there.
   */
  fetchParentChannel?: (channelId: string) => Promise<unknown>;
}): Promise<ForkActionResult> {
  if (!input.channel) {
    return { ok: false, message: "Could not resolve the current channel for `/fork`." };
  }

  // When run from inside a thread, create a sibling thread under the same parent.
  if (typeof (input.channel as { isThread?: unknown }).isThread === "function") {
    const isThread = (input.channel as { isThread: () => boolean }).isThread();
    if (isThread) {
      return runSiblingForkAction(input);
    }
  }

  if (!canCreateForkThread(input.channel)) {
    return {
      ok: false,
      message: "This channel type does not support creating threads.",
    };
  }

  const channel = input.channel as ForkableChannel;
  const title = buildForkThreadTitle({
    requested: input.requestedTitle,
    channelName: channel.name,
  });

  const thread = await channel.threads.create({
    name: title,
    type: ChannelType.PublicThread,
    reason: "Fork created via /fork",
  });
  const threadChannel = isThreadBootstrapChannel(thread)
    ? thread
    : {
        id: thread.id,
        parentId: input.channelId,
        name: title,
        isThread: () => true,
      };

  try {
    await maybeInheritThreadContext({
      channel: threadChannel,
      channelId: thread.id,
      guildId: input.guildId,
      sessions: input.sessions,
      repository: input.repository,
      autoThreadWorktree: input.autoThreadWorktree,
      worktreeBootstrap: input.worktreeBootstrap,
      worktreeBootstrapCommand: input.worktreeBootstrapCommand,
      runCommand: input.runCommand,
    });
    return { ok: true, threadId: thread.id, title };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: true,
      threadId: thread.id,
      title,
      bootstrapWarning: detail,
    };
  }
}

/**
 * Creates a sibling thread when `/fork` is invoked from inside an existing thread.
 *
 * The new thread:
 * - is created under the same Discord parent channel (P) as the current thread (A)
 * - inherits conversation context / working-dir from the current thread (A), not from P
 * - shares the same `parentChannelId` as A in thread-branch metadata (true sibling)
 */
async function runSiblingForkAction(input: {
  channel: unknown;
  channelId: string;
  guildId: string;
  requestedTitle: string | null;
  requesterUserId?: string;
  sessions: SessionManager;
  repository: Repository;
  autoThreadWorktree: boolean;
  worktreeBootstrap: boolean;
  worktreeBootstrapCommand?: string;
  runCommand: RunCommand;
  fetchParentChannel?: (channelId: string) => Promise<unknown>;
}): Promise<ForkActionResult> {
  const isPrivateThread = (input.channel as { type?: unknown }).type === ChannelType.PrivateThread;
  if (isPrivateThread && !input.requesterUserId) {
    return {
      ok: false,
      message: "A user is required to create an accessible private fork.",
    };
  }

  // Resolve the parent channel ID. Try the live Discord channel object first
  // (Discord.js threads expose .parentId), then fall back to stored metadata.
  const channelParentId =
    typeof (input.channel as { parentId?: unknown }).parentId === "string"
      ? (input.channel as { parentId: string }).parentId
      : null;

  const metaParentChannelId = parseThreadBranchMeta(
    input.repository.getThreadBranchMeta(input.channelId),
  )?.parentChannelId;

  const parentChannelId = channelParentId ?? metaParentChannelId ?? null;

  if (!parentChannelId) {
    return {
      ok: false,
      message:
        "Could not determine the parent channel for this thread. " +
        "Run `/fork` from the parent channel instead.",
    };
  }

  if (!input.fetchParentChannel) {
    return {
      ok: false,
      message: "Sibling forking from a thread is not supported in this context.",
    };
  }

  let parentChannel: unknown;
  try {
    parentChannel = await input.fetchParentChannel(parentChannelId);
  } catch {
    return {
      ok: false,
      message: "Could not fetch the parent channel to create a sibling thread.",
    };
  }

  if (!canCreateForkThread(parentChannel)) {
    return {
      ok: false,
      message: "The parent channel does not support creating threads.",
    };
  }

  const forkableParent = parentChannel as ForkableChannel;
  const currentThreadName =
    typeof (input.channel as { name?: unknown }).name === "string"
      ? (input.channel as { name: string }).name
      : undefined;

  const title = buildForkThreadTitle({
    requested: input.requestedTitle,
    channelName: currentThreadName ?? forkableParent.name,
  });

  const thread = await forkableParent.threads.create({
    name: title,
    type: isPrivateThread ? ChannelType.PrivateThread : ChannelType.PublicThread,
    reason: "Sibling fork created via /fork",
  });

  if (isPrivateThread && input.requesterUserId) {
    try {
      if (!thread.members) {
        throw new Error("The new private thread does not expose member management.");
      }
      await thread.members.add(input.requesterUserId);
    } catch (error) {
      console.warn(`Could not add fork requester to private thread ${thread.id}: ${error}`);
      return {
        ok: false,
        message:
          `Created private thread <#${thread.id}>, but could not add you to it. ` +
          "Its conversation context was not copied. Check the bot's thread permissions.",
      };
    }
  }

  // threadChannel.parentId = P so the metadata parentChannelId = P (true sibling).
  // overrideContextSourceChannelId = A so context is cloned from the current thread.
  const threadChannel = isThreadBootstrapChannel(thread)
    ? thread
    : {
        id: thread.id,
        parentId: parentChannelId,
        name: title,
        isThread: () => true,
      };

  try {
    await maybeInheritThreadContext({
      channel: threadChannel,
      channelId: thread.id,
      guildId: input.guildId,
      sessions: input.sessions,
      repository: input.repository,
      autoThreadWorktree: input.autoThreadWorktree,
      worktreeBootstrap: input.worktreeBootstrap,
      worktreeBootstrapCommand: input.worktreeBootstrapCommand,
      runCommand: input.runCommand,
      overrideContextSourceChannelId: input.channelId, // clone from current thread A
    });
    return { ok: true, threadId: thread.id, title };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: true,
      threadId: thread.id,
      title,
      bootstrapWarning: detail,
    };
  }
}
