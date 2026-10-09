import { describe, expect, test } from "bun:test";
import { isInstantModeOn } from "../src/app/slash-commands/instant-command";
import { GLOBAL_INSTANT_MODE_KEY } from "../src/db/repository-helpers";
import { getSlashCommandDefinitions } from "../src/discord/commands";

function fakeRepository(values: Record<string, string>) {
  return { getSetting: (key: string) => values[key] ?? null };
}

describe("instant mode", () => {
  test("is off unless the global setting says on", () => {
    expect(isInstantModeOn(fakeRepository({}))).toBe(false);
    expect(isInstantModeOn(fakeRepository({ [GLOBAL_INSTANT_MODE_KEY]: "off" }))).toBe(false);
    expect(isInstantModeOn(fakeRepository({ [GLOBAL_INSTANT_MODE_KEY]: "on" }))).toBe(true);
  });

  test("/instant takes on, off or show", () => {
    const instant = getSlashCommandDefinitions().find((command) => command.name === "instant");
    const mode = (instant?.options ?? [])[0] as { name?: string; choices?: { value: string }[] };
    expect(mode.name).toBe("mode");
    expect(mode.choices?.map((choice) => choice.value)).toEqual(["on", "off", "show"]);
  });
});
