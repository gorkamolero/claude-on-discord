import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { askSecret, SetupPromptOutput } from "../src/bootstrap/setup-prompt";

function captureOutput() {
  let text = "";
  const target = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { output: new SetupPromptOutput(target), read: () => text };
}

describe("setup credential prompt", () => {
  test("keeps a saved credential without exposing it in the prompt or terminal echo", async () => {
    const capture = captureOutput();
    let resolveAnswer: (answer: string) => void = () => {};
    const result = askSecret(
      {
        question(prompt) {
          capture.output.write(prompt);
          return new Promise((resolve) => {
            resolveAnswer = resolve;
          });
        },
      },
      capture.output,
      "Discord bot token",
      "saved-private-token",
    );
    capture.output.write("typed-private-token");
    resolveAnswer("");
    expect(await result).toBe("saved-private-token");
    expect(capture.read()).toContain("saved; Enter to keep");
    expect(capture.read()).not.toContain("saved-private-token");
    expect(capture.read()).not.toContain("typed-private-token");
    expect(capture.output.muted).toBe(false);
  });

  test("replaces a credential and restores normal output after completion", async () => {
    const capture = captureOutput();
    expect(
      await askSecret(
        { question: async () => "  replacement-private-token  " },
        capture.output,
        "Token",
      ),
    ).toBe("replacement-private-token");
    await new Promise<void>((resolve) => capture.output.write("Setup complete", () => resolve()));
    expect(capture.read()).toContain("Setup complete");
    expect(capture.read()).not.toContain("replacement-private-token");
  });

  test("restores output if credential entry is cancelled", async () => {
    const capture = captureOutput();
    await expect(
      askSecret(
        {
          question: async () => {
            throw new Error("cancelled");
          },
        },
        capture.output,
        "Token",
      ),
    ).rejects.toThrow("cancelled");
    expect(capture.output.muted).toBe(false);
  });
});
