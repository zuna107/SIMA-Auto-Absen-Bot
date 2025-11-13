import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import config from '../config.js';

const command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Cek latency bot')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const sent = await interaction.reply({ 
      content: 'Pinging...', 
      ephemeral: true,
      fetchReply: true 
    });
    
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const wsLatency = interaction.client.ws.ping;
    
    const embed = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle('Pong!')
      .addFields(
        { name: 'Bot Latency', value: `\`${latency}ms\``, inline: true },
        { name: 'WebSocket', value: `\`${wsLatency}ms\``, inline: true },
        { name: 'Status', value: latency < 200 ? '🟢 Good' : latency < 500 ? '🟡 Fair' : '🔴 Poor', inline: true }
      )
      .setTimestamp();
    
    await interaction.editReply({ content: null, embeds: [embed] });
  },
};

export default command;