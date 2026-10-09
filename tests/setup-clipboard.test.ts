import { describe, expect, test } from "bun:test";
import { copyInviteUrlToClipboard } from "../src/bootstrap/setup-clipboard";

const inviteUrl =
  "https://discord.com/oauth2/authorize?client_id=123&scope=bot+applications.commands&guild_id=456";

describe("setup invite clipboard", () => {
  test("passes the complete URL to macOS clipboard as input, without shell interpolation", async () => {
    let received: { cmd: string[]; text: string } | undefined;
    expect(
      await copyInviteUrlToClipboard(inviteUrl, {
        platform: "darwin",
        runCommand: async (cmd, text) => {
          received = { cmd, text };
          return true;
        },
      }),
    ).toBe(true);
    expect(received).toEqual({ cmd: ["pbcopy"], text: inviteUrl });
  });

  test("keeps URL characters out of the Windows PowerShell command", async () => {
    expect(
      await copyInviteUrlToClipboard(inviteUrl, {
        platform: "win32",
        runCommand: async (cmd, text) => {
          expect(cmd[0]).toBe("powershell.exe");
          expect(cmd.join(" ")).not.toContain(inviteUrl);
          expect(cmd.at(-1)).toContain("[Console]::In.ReadToEnd()");
          expect(text).toBe(inviteUrl);
          return true;
        },
      }),
    ).toBe(true);
  });

  test("falls back from Wayland through available X11 clipboard tools", async () => {
    const attempts: string[] = [];
    expect(
      await copyInviteUrlToClipboard(inviteUrl, {
        platform: "linux",
        runCommand: async (cmd) => {
          attempts.push(cmd[0] ?? "");
          if (cmd[0] === "wl-copy") throw new Error("missing command");
          return cmd[0] === "xsel";
        },
      }),
    ).toBe(true);
    expect(attempts).toEqual(["wl-copy", "xclip", "xsel"]);
  });

  test("does not fail setup on a machine with no working clipboard", async () => {
    expect(
      await copyInviteUrlToClipboard(inviteUrl, {
        platform: "linux",
        runCommand: async () => false,
      }),
    ).toBe(false);
  });

  test("does not run platform commands on an unsupported system", async () => {
    let called = false;
    expect(
      await copyInviteUrlToClipboard(inviteUrl, {
        platform: "unknown",
        runCommand: async () => {
          called = true;
          return true;
        },
      }),
    ).toBe(false);
    expect(called).toBe(false);
  });
});
