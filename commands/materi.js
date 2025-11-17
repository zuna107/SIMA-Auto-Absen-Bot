import { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  StringSelectMenuBuilder, 
  ActionRowBuilder 
} from 'discord.js';
import UserManager from '../connection/userManager.js';
import Logger from '../utils/logger.js';
import config from '../config.js';
import fs from 'fs/promises';

const logger = new Logger('MateriCommand');
const userManager = new UserManager();

const command = {
  data: new SlashCommandBuilder()
    .setName('materi')
    .setDescription('Lihat daftar materi dan berkas dari mata kuliah')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const user = await userManager.getUser(interaction.user.id);

      if (!user) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('Akun Belum Terdaftar')
          .setDescription(
            'Kamu belum mendaftarkan akun SIMA.\n\n' +
            'Gunakan `/absen` untuk mendaftar terlebih dahulu.'
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Load materi cache
      const materiCache = await loadMateriCache();
      const userMateri = materiCache[user.userId];

      if (!userMateri || Object.keys(userMateri).length === 0) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('Belum Ada Data Materi')
          .setDescription(
            'Data materi belum tersedia. Sistem akan mengumpulkan data pada pengecekan berikutnya.\n\n' +
            `**Waktu pengecekan:** Setiap ${config.scheduler.interval} menit\n` +
            'Silakan coba lagi nanti.'
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Create dropdown menu for makul selection
      const makulOptions = Object.entries(userMateri).map(([materiId, data]) => ({
        label: data.makulNama.substring(0, 100),
        description: `${data.materiList.length} materi tersedia`,
        value: materiId,
      }));

      if (makulOptions.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('Tidak Ada Mata Kuliah')
          .setDescription('Tidak ditemukan mata kuliah yang tersedia.')
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`materi_select_${interaction.user.id}`)
        .setPlaceholder('Pilih Mata Kuliah')
        .addOptions(makulOptions.slice(0, 25)); // Discord limit: 25 options

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle('Daftar Materi & Berkas')
        .setDescription(
          `Pilih mata kuliah untuk melihat daftar materi dan berkas yang tersedia.\n\n` +
          `**Total Mata Kuliah:** ${makulOptions.length}`
        )
        .setTimestamp();

      await interaction.editReply({ 
        embeds: [embed], 
        components: [row] 
      });

      logger.info(`Materi menu displayed for ${user.nim}`);
    } catch (error) {
      logger.error('Error in materi command:', error);
      throw error;
    }
  },
};

async function loadMateriCache() {
  try {
    const data = await fs.readFile(config.paths.materi, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export default command;