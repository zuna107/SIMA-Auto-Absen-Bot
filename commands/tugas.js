import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

import fs from 'fs/promises';
import config from '../config.js';
import UserManager from '../connection/userManager.js';
import SIMAClient from '../connection/simaClient.js';
import Logger from '../utils/logger.js';

const logger = new Logger('TugasCommand');
const userManager = new UserManager();

const command = {
  data: new SlashCommandBuilder()
    .setName('tugas')
    .setDescription('Lihat daftar tugas yang belum selesai')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const user = await userManager.getUser(interaction.user.id);
      if (!user) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.warning)
              .setTitle('Akun Belum Terdaftar')
              .setDescription('Gunakan /absen untuk mendaftar akun SIMA.')
              .setTimestamp(),
          ],
        });
      }

      // load data
      const raw = await fs.readFile(config.paths.lastMateri, 'utf-8');
      const last = JSON.parse(raw);
      const userData = last[user.userId] || {};

      // ambil makul list dari SIMA
      const sima = new SIMAClient(
        user.cookies ? JSON.parse(user.cookies) : null
      );

      let makul;
      try {
        makul = await sima.fetchMakul();
      } catch (e) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.error)
              .setTitle('Gagal Mengambil Mata Kuliah')
              .setDescription('Tidak dapat mengambil data mata kuliah dari SIMA.')
              .setTimestamp(),
          ],
        });
      }

      const options = makul
        .filter(m => m.materiId)
        .slice(0, 25)
        .map(m =>
          new StringSelectMenuOptionBuilder()
            .setLabel(m.nama.substring(0, 100))
            .setDescription(`${m.kode} - ${m.dosen.split('|')[0]}`)
            .setValue(m.materiId)
        );

      const select = new StringSelectMenuBuilder()
        .setCustomId(`tugas_select_${interaction.user.id}`)
        .setPlaceholder('Pilih Mata Kuliah')
        .addOptions(options);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.info)
            .setTitle('Daftar Tugas')
            .setDescription('Pilih salah satu mata kuliah untuk melihat daftar tugas.')
            .setTimestamp(),
        ],
        components: [new ActionRowBuilder().addComponents(select)],
      });
    } catch (err) {
      logger.error('Error /tugas:', err);
    }
  },

  async handleSelectMenu(interaction) {
    try {
      await interaction.deferUpdate();

      const materiId = interaction.values[0];
      const user = await userManager.getUser(interaction.user.id);
      if (!user) return;

      const raw = await fs.readFile(config.paths.lastMateri, 'utf-8');
      const last = JSON.parse(raw);
      const userData = last[user.userId] || {};

      const tugasList = userData[`tugas_${materiId}`] || [];

      if (tugasList.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.warning)
              .setTitle('Tidak Ada Tugas')
              .setDescription('Tidak ada tugas yang tersimpan untuk mata kuliah ini.')
              .setTimestamp(),
          ],
          components: [],
        });
      }

      const embeds = [];
      let allButtons = [];

      tugasList.forEach((tugas, idx) => {
        let desc = '';

        desc += `**Judul / Soal**\n${tugas.soal || tugas.title || '-'}\n\n`;

        desc += `**Status**\n`;
        desc += `Aktif: ${tugas.isActive ? 'Ya' : 'Tidak'}\n`;
        desc += `Selesai: ${tugas.isCompleted ? 'Ya' : 'Belum'}\n\n`;

        desc += `**Waktu Tugas**\n`;
        desc += `Reguler : ${tugas.waktu?.regular || '-'}\n`;
        desc += `Tenggat  : ${tugas.waktu?.tenggat || '-'}\n\n`;

        if (tugas.berkas?.length > 0) {
          desc += `**Lampiran**\n`;
          tugas.berkas.forEach((b, fidx) => {
            desc += `- ${b.name}\n`;

            allButtons.push(
              new ButtonBuilder()
                .setCustomId(
                  `tugas_dl_${interaction.user.id}_${materiId}_${idx}_${fidx}`
                )
                .setLabel(`Download: ${b.name.substring(0, 60)}`)
                .setStyle(ButtonStyle.Secondary)
            );
          });
        } else {
          desc += '**Lampiran**\nTidak ada\n';
        }

        embeds.push(
          new EmbedBuilder()
            .setColor(config.colors.info)
            .setTitle(`Tugas ${idx + 1}`)
            .setDescription(desc)
            .setTimestamp()
        );
      });

      // button rows max 5
      const rows = [];
      for (let i = 0; i < allButtons.length; i += 5) {
        rows.push(
          new ActionRowBuilder().addComponents(
            ...allButtons.slice(i, i + 5)
          )
        );
      }

      return interaction.editReply({
        embeds,
        components: rows,
      });
    } catch (err) {
      logger.error('Error tugas select:', err);
    }
  },

  async handleButton(interaction) {
    try {
      const parts = interaction.customId.split('_');
      // tugas_dl_USERID_MATERIID_TUGASINDEX_FILEINDEX

      const userId = parts[2];
      if (userId !== interaction.user.id) {
        return interaction.reply({
          content: 'Tombol ini bukan untuk kamu.',
          ephemeral: true,
        });
      }

      const materiId = parts[3];
      const tugasIndex = Number(parts[4]);
      const fileIndex = Number(parts[5]);

      await interaction.deferReply({ ephemeral: true });

      const user = await userManager.getUser(interaction.user.id);
      if (!user)
        return interaction.editReply({
          content: 'Akun tidak ditemukan.',
          ephemeral: true,
        });

      const raw = await fs.readFile(config.paths.lastMateri, 'utf-8');
      const last = JSON.parse(raw);
      const userData = last[user.userId] || {};
      const tugasList = userData[`tugas_${materiId}`];

      if (!tugasList)
        return interaction.editReply({
          content: 'Data tugas tidak ditemukan.',
          ephemeral: true,
        });

      const tugas = tugasList[tugasIndex];
      const berkas = tugas.berkas[fileIndex];

      if (!berkas)
        return interaction.editReply({
          content: 'Berkas tidak ditemukan.',
          ephemeral: true,
        });

      // download via SIMA
      const sima = new SIMAClient(
        user.cookies ? JSON.parse(user.cookies) : null
      );

      const result = await sima.downloadBerkas(berkas.url, berkas.name);
      if (!result.success) {
        return interaction.editReply({
          content: `Gagal mengunduh berkas: ${result.error}`,
          ephemeral: true,
        });
      }

      return interaction.editReply({
        content: `Berkas **${berkas.name}**`,
        files: [{ attachment: result.data, name: berkas.name }],
        ephemeral: true,
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        content: 'Terjadi kesalahan saat mengunduh berkas.',
        ephemeral: true,
      });
    }
  },
};

export default command;
