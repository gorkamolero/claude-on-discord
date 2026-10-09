import { Writable, type WritableOptions } from "node:stream";

/** Suppresses readline's terminal echo while a credential is entered. */
export class SetupPromptOutput extends Writable {
  muted = false;
  readonly isTTY: boolean;

  constructor(
    private readonly target: NodeJS.WritableStream & { isTTY?: boolean },
    options?: WritableOptions,
  ) {
    super(options);
    this.isTTY = Boolean(target.isTTY);
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.muted) {
      callback();
      return;
    }
    this.target.write(chunk, callback);
  }
}

export async function askSecret(
  rl: { question: (prompt: string) => Promise<string> },
  output: SetupPromptOutput,
  prompt: string,
  fallback = "",
): Promise<string> {
  const suffix = fallback ? " [saved; Enter to keep]" : "";
  const answer = rl.question(`${prompt}${suffix} (input hidden): `);
  output.muted = true;
  try {
    const value = (await answer).trim();
    return value || fallback;
  } finally {
    output.muted = false;
    output.write("\n");
  }
}
