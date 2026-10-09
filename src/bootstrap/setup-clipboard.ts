type ClipboardCommand = (cmd: string[], text: string) => Promise<boolean>;

async function runClipboardCommand(cmd: string[], text: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const child = Bun.spawn({
      cmd,
      stdin: new Blob([text]),
      stdout: "ignore",
      stderr: "ignore",
    });
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 3000);
    });
    return await Promise.race([child.exited.then((code) => code === 0), timedOut]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function copyInviteUrlToClipboard(
  url: string,
  options: { platform?: string; runCommand?: ClipboardCommand } = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const runCommand = options.runCommand ?? runClipboardCommand;
  const commands =
    platform === "darwin"
      ? [["pbcopy"]]
      : platform === "win32"
        ? [
            [
              "powershell.exe",
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
            ],
          ]
        : platform === "linux"
          ? [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]]
          : [];

  for (const cmd of commands) {
    try {
      if (await runCommand(cmd, url)) {
        return true;
      }
    } catch {
      // An unavailable clipboard must not stop installation or the next fallback.
    }
  }
  return false;
}
