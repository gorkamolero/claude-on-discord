import type { ChatInputCommandInteraction } from "discord.js";
import type { Repository } from "../../db/repository";
import { GLOBAL_INSTANT_MODE_KEY } from "../../db/repository-helpers";

export function isInstantModeOn(repository: Pick<Repository, "getSetting">): boolean {
  return repository.getSetting(GLOBAL_INSTANT_MODE_KEY) === "on";
}

export async function handleInstantCommand(input: {
  interaction: ChatInputCommandInteraction;
  repository: Repository;
}): Promise<void> {
  const mode = input.interaction.options.getString("mode", true);
  if (mode === "on" || mode === "off") {
    input.repository.setSetting(GLOBAL_INSTANT_MODE_KEY, mode);
  }
  const on = isInstantModeOn(input.repository);
  await input.interaction.reply(
    on
      ? "Instant mode is **on** for every channel and server. Claude answers without thinking."
      : "Instant mode is **off**. Claude thinks before answering, as usual.",
  );
}
