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

function buildDownloadCustomId(userId, materiId, tugasIndex, fileIndex) {
  const encodedMateriId = encodeURIComponent(materiId);
  return `tugas_dl_${userId}_${encodedMateriId}_${tugasIndex}_${fileIndex}`;
}

function parseDownloadCustomId(customId) {
  const parts = customId.split('_');
  if (parts.length < 6 || parts[0] !== 'tugas' || parts[1] !== 'dl') {
    return null;
  }

  const userId = parts[2];
  const fileIndex = Number(parts[parts.length - 1]);
  const tugasIndex = Number(parts[parts.length - 2]);
  const encodedMateriId = parts.slice(3, parts.length - 2).join('_');

  if (Number.isNaN(tugasIndex) || Number.isNaN(fileIndex)) {
    return null;
  }

  return {
    userId,
    materiId: decodeURIComponent(encodedMateriId),
    tugasIndex,
    fileIndex,
  };
}

const command = {
  data: new SlashCommandBuilder()
    .setName('tugas')
    .setDescription('Lihat daftar tugas dari mata kuliah')
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
              .setDescription('Gunakan /absen untuk mendaftarkan akun SIMA.')
              .setTimestamp(),
          ],
        });
      }

      const sima = new SIMAClient(user.cookies ? JSON.parse(user.cookies) : null);
      let makul = [];
      try {
        makul = await sima.fetchMakul();
      } catch (error) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.error)
              .setTitle('Gagal Mengambil Mata Kuliah')
              .setDescription(`Tidak dapat mengambil data mata kuliah dari SIMA.\n\n\`${error.message}\``)
              .setTimestamp(),
          ],
        });
      }

      const options = makul
        .filter((m) => m.materiId)
        .slice(0, 25)
        .map((m) =>
          new StringSelectMenuOptionBuilder()
            .setLabel((m.nama || 'Tanpa Nama').substring(0, 100))
            .setDescription(`${m.kode || '-'} - ${(m.dosen || '-').split('|')[0].substring(0, 60)}`)
            .setValue(m.materiId)
        );

      if (options.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.warning)
              .setTitle('Tidak Ada Mata Kuliah')
              .setDescription('Tidak ditemukan mata kuliah dengan data tugas.')
              .setTimestamp(),
          ],
        });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`tugas_select_${interaction.user.id}`)
        .setPlaceholder('Pilih mata kuliah')
        .addOptions(options);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.info)
            .setTitle('Daftar Tugas')
            .setDescription('Pilih mata kuliah untuk menampilkan daftar tugas yang tersimpan.')
            .setTimestamp(),
        ],
        components: [new ActionRowBuilder().addComponents(select)],
      });
    } catch (error) {
      logger.error('Error /tugas:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Terjadi kesalahan saat menjalankan command.',
          ephemeral: true,
        });
      }
    }
  },

  async handleSelectMenu(interaction) {
    try {
      await interaction.deferUpdate();

      const materiId = interaction.values[0];
      const user = await userManager.getUser(interaction.user.id);
      if (!user) return;

      const userMateri = await loadUserMateriCache(user.userId);
      const tugasList = userMateri[`tugas_${materiId}`] || [];

      if (tugasList.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.warning)
              .setTitle('Tidak Ada Tugas')
              .setDescription('Belum ada data tugas yang tersimpan untuk mata kuliah ini.')
              .setTimestamp(),
          ],
          components: [],
        });
      }

      const embeds = [];
      const allButtons = [];

      tugasList.forEach((tugas, idx) => {
        const descLines = [];
        descLines.push(`**Judul**\n${tugas.title || '-'}\n`);
        descLines.push(`**Soal/Perintah**\n${tugas.soal || '-'}\n`);
        descLines.push(
          `**Status**\nAktif: ${tugas.isActive ? 'Ya' : 'Tidak'}\nTerkumpul: ${tugas.isSubmitted ? 'Ya' : 'Belum'}\n`
        );
        descLines.push(`**Waktu**\n${tugas.waktu || '-'}\n`);

        if (Number.isFinite(tugas.nilai)) {
          descLines.push(`**Nilai**\n${tugas.nilai}\n`);
        }

        const berkas = tugas.berkas || [];
        if (berkas.length > 0) {
          descLines.push(
            `**Lampiran (${berkas.length})**\n${berkas
              .map((file, fileIdx) => `${fileIdx + 1}. ${file.filename || file.name || 'file'}`)
              .join('\n')}`
          );

          berkas.forEach((file, fileIdx) => {
            if (allButtons.length >= 25) {
              return;
            }

            allButtons.push(
              new ButtonBuilder()
                .setCustomId(buildDownloadCustomId(interaction.user.id, materiId, idx, fileIdx))
                .setLabel(`File ${fileIdx + 1}: ${(file.filename || file.name || 'file').substring(0, 70)}`)
                .setStyle(ButtonStyle.Secondary)
            );
          });
        } else {
          descLines.push('**Lampiran**\nTidak ada');
        }

        embeds.push(
          new EmbedBuilder()
            .setColor(config.colors.info)
            .setTitle(`Tugas ${idx + 1}/${tugasList.length}`)
            .setDescription(descLines.join('\n'))
            .setTimestamp()
        );
      });

      const rows = [];
      for (let i = 0; i < allButtons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(...allButtons.slice(i, i + 5)));
      }

      return interaction.editReply({
        embeds,
        components: rows,
      });
    } catch (error) {
      logger.error('Error tugas select:', error);
    }
  },

  async handleButton(interaction) {
    try {
      const parsed = parseDownloadCustomId(interaction.customId);
      if (!parsed) {
        return interaction.reply({
          content: 'Format tombol tidak valid.',
          ephemeral: true,
        });
      }

      if (parsed.userId !== interaction.user.id) {
        return interaction.reply({
          content: 'Tombol ini bukan untuk kamu.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const user = await userManager.getUser(interaction.user.id);
      if (!user) {
        return interaction.editReply({ content: 'Akun tidak ditemukan.' });
      }

      const userMateri = await loadUserMateriCache(user.userId);
      const tugasList = userMateri[`tugas_${parsed.materiId}`];
      if (!Array.isArray(tugasList)) {
        return interaction.editReply({ content: 'Data tugas tidak ditemukan.' });
      }

      const tugas = tugasList[parsed.tugasIndex];
      const berkas = tugas?.berkas?.[parsed.fileIndex];
      if (!berkas?.url) {
        return interaction.editReply({ content: 'Berkas tidak ditemukan atau URL kosong.' });
      }

      const sima = new SIMAClient(user.cookies ? JSON.parse(user.cookies) : null);
      const filename = berkas.filename || berkas.name || 'file';
      const result = await sima.downloadBerkas(berkas.url, filename);

      if (!result.success) {
        return interaction.editReply({ content: `Gagal mengunduh berkas: ${result.error}` });
      }

      return interaction.editReply({
        content: `Berkas **${filename}**`,
        files: [{ attachment: result.data, name: filename }],
      });
    } catch (error) {
      logger.error('Error tugas button:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          content: 'Terjadi kesalahan saat mengunduh berkas.',
        });
      }
    }
  },
};

export default command;
