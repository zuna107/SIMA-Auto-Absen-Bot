import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from 'discord.js';
import UserManager from '../connection/userManager.js';
import SIMAClient from '../connection/simaClient.js';
import Logger from '../utils/logger.js';
import config from '../config.js';
import fs from 'fs/promises';

const logger = new Logger('MateriCommand');
const userManager = new UserManager();
const getUserMateriPath = (userId) => `${config.paths.lastMateri}/${userId}.json`;

async function loadUserMateriCache(userId) {
  try {
    const raw = await fs.readFile(getUserMateriPath(userId), 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    try {
      const legacyRaw = await fs.readFile(config.paths.lastMateriLegacy, 'utf-8');
      const legacy = JSON.parse(legacyRaw);
      return legacy[userId] || {};
    } catch {
      return {};
    }
  }
}

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
            'Gunakan /absen untuk mendaftar terlebih dahulu.'
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Get makul list
      const simaClient = new SIMAClient(
        user.cookies ? JSON.parse(user.cookies) : null
      );

      let makul;
      try {
        makul = await simaClient.fetchMakul();
      } catch (error) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.error)
          .setTitle('Gagal Mengambil Data')
          .setDescription(
            'Gagal mengambil data mata kuliah dari SIMA.\n\n' +
            `Error: ${error.message}\n\n` +
            'Silakan coba lagi nanti.'
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      if (makul.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('Tidak Ada Mata Kuliah')
          .setDescription('Tidak ditemukan mata kuliah yang terdaftar.')
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Create selector menu
      const options = makul
        .filter(mk => mk.materiId)
        .slice(0, 25) // Discord limit
        .map(mk => 
          new StringSelectMenuOptionBuilder()
            .setLabel(mk.nama.substring(0, 100))
            .setDescription(`${mk.kode} - ${mk.dosen.split('|')[0].substring(0, 50)}`)
            .setValue(mk.materiId)
        );

      if (options.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('Tidak Ada Materi')
          .setDescription('Tidak ada mata kuliah dengan materi yang tersedia.')
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`materi_select_${interaction.user.id}`)
        .setPlaceholder('Pilih Mata Kuliah')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle('Daftar Mata Kuliah')
        .setDescription(
          'Pilih mata kuliah dari menu di bawah untuk melihat daftar materi dan berkas.'
        )
        .addFields({
          name: 'Total Mata Kuliah',
          value: `${makul.length} mata kuliah`,
          inline: true,
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      logger.info(`Materi selector sent to ${user.nim}`);

    } catch (error) {
      logger.error('Error in materi command:', error);
      throw error;
    }
  },

  async handleSelectMenu(interaction) {
    try {
      await interaction.deferUpdate();

      const materiId = interaction.values[0];
      const user = await userManager.getUser(interaction.user.id);

      if (!user) return;

      const userLastMateri = await loadUserMateriCache(user.userId);

      const materiList = userLastMateri[materiId] || [];

      if (materiList.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('Tidak Ada Materi')
          .setDescription('Belum ada materi yang tercatat untuk mata kuliah ini.')
          .setTimestamp();

        return await interaction.editReply({
          embeds: [embed],
          components: [],
        });
      }

      // Create embed dengan daftar materi
      const fields = [];

      materiList.forEach((materi, index) => {
        let materiText = materi.title;

        if (materi.berkas && materi.berkas.length > 0) {
          const berkasText = materi.berkas
            .map(b => `- ${b.filename || b.name || 'file'}`)
            .join('\n');
          
          materiText += `\n\nBerkas:\n${berkasText}`;
        } else {
          materiText += '\n\nBerkas: Tidak ada';
        }

        fields.push({
          name: `Materi ${index + 1}`,
          value: materiText,
          inline: false,
        });
      });

      // Split into multiple embeds if too many fields
      const maxFieldsPerEmbed = 5;
      const embeds = [];

      for (let i = 0; i < fields.length; i += maxFieldsPerEmbed) {
        const embedFields = fields.slice(i, i + maxFieldsPerEmbed);
        
        const embed = new EmbedBuilder()
          .setColor(config.colors.info)
          .setTitle(
            i === 0 
              ? `Daftar Materi (${materiList.length} materi)` 
              : `Daftar Materi (lanjutan)`
          )
          .addFields(embedFields)
          .setTimestamp();

        embeds.push(embed);
      }

      await interaction.editReply({
        embeds: embeds,
        components: [],
      });

      logger.info(`Displayed ${materiList.length} materi for user ${user.nim}`);

    } catch (error) {
      logger.error('Error handling materi select:', error);
    }
  },
};

export default command;
