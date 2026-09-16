import * as listboss from './listboss.js';
import * as syncboss from './syncboss.js';

const commands = new Map([
  [listboss.data.name, listboss],
  [syncboss.data.name, syncboss],
]);

export function registerCommandHandlers(client) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = commands.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction);
    } catch (err) {
      console.error(`[command:${interaction.commandName}]`, err);
      const payload = { content: '❌ 執行指令時發生錯誤', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  });
}

export const commandData = [...commands.values()].map((c) => c.data);
