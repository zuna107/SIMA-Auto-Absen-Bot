import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import Logger from '../utils/logger.js';

class NotificationService {
  constructor(client) {
    this.client = client;
    this.logger = new Logger('Notifier');
  }

  async sendDM(userId, embed) {
    try {
      const user = await this.client.users.fetch(userId);
      await user.send({ embeds: [embed] });
      this.logger.info(`Sent DM to user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send DM to user ${userId}:`, error);
      return false;
    }
  }

  async sendNewMateriNotification(userId, makul, materi) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle('Materi Baru Terdeteksi')
      .setDescription(
        `Materi baru telah ditambahkan pada mata kuliah \`${makul.nama}\``
      )
      .addFields(
        { name: 'Mata Kuliah', value: makul.nama, inline: false },
        { name: 'Judul Materi', value: materi.title, inline: false },
        { name: 'Bahasan', value: materi.bahasan || 'N/A', inline: false },
        {
          name: 'Waktu Kehadiran',
          value: materi.waktuKehadiran || 'N/A',
          inline: true,
        },
        {
          name: 'Waktu Diskusi',
          value: materi.waktuDiskusi || 'N/A',
          inline: true,
        },
        {
          name: 'Tipe Absensi',
          value: materi.isManual ? 'Manual (Oleh Dosen)' : 'Mandiri (Oleh Mahasiswa)',
          inline: false,
        }
      )
      .setTimestamp();

    if (!materi.isManual && materi.isActive) {
      embed.setFooter({ text: '🔄 Sistem akan mencoba absen otomatis...' });
    }

    const sent = await this.sendDM(userId, embed);
    if (sent) {
      this.logger.success(
        `Sent new materi notification to ${userId}: ${materi.title}`
      );
    }
    return sent;
  }

  async sendAbsenceSuccess(userId, makul, materi, timestamp) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.success)
      .setTitle('Absen Berhasil!')
      .setDescription(
        `Absensi berhasil dilakukan untuk materi \`${materi.title}\``
      )
      .addFields(
        { name: 'Mata Kuliah', value: makul.nama, inline: false },
        { name: 'Materi', value: materi.title, inline: false },
        {
          name: 'Waktu Absen',
          value: timestamp || 'Tidak diketahui',
          inline: true,
        },
        {
          name: 'Status',
          value: '🟢 Terverifikasi',
          inline: true,
        }
      )
      .setFooter({ text: 'Kehadiranmu telah tercatat dalam sistem SIMA' })
      .setTimestamp();

    const sent = await this.sendDM(userId, embed);
    if (sent) {
      this.logger.success(`Sent absence success to ${userId}`);
    }
    return sent;
  }

  async sendAbsenceUnverified(userId, makul, materi) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle('Absen Dilakukan (Belum Terverifikasi)')
      .setDescription(
        `Sistem telah melakukan absensi untuk materi \`${materi.title}\`, ` +
        `namun belum dapat memverifikasi kehadiran Anda di data SIMA.\n\n` +
        `**Kemungkinan penyebab:**\n` +
        `• Server SIMA sedang lambat memproses\n` +
        `• Format data kehadiran berubah\n` +
        `• Absensi mungkin berhasil namun belum muncul di sistem\n\n` +
        `**Rekomendasi:** Silakan cek manual di SIMA untuk memastikan.`
      )
      .addFields(
        { name: 'Mata Kuliah', value: makul.nama, inline: false },
        { name: 'Materi', value: materi.title, inline: false },
        {
          name: '🔗 Link Kehadiran',
          value: materi.links.kehadiran 
            ? `[Cek Manual](${materi.links.kehadiran})` 
            : 'Tidak tersedia',
          inline: false,
        }
      )
      .setFooter({ text: 'Mohon verifikasi manual melalui SIMA' })
      .setTimestamp();

    const sent = await this.sendDM(userId, embed);
    if (sent) {
      this.logger.info(`Sent unverified absence notification to ${userId}`);
    }
    return sent;
  }

  async sendCheckSummary(userId, newMateriCount, absencesCount) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('Ringkasan Pengecekan')
      .setDescription('Pengecekan materi baru telah selesai')
      .addFields(
        {
          name: 'Materi Baru',
          value: `${newMateriCount} materi`,
          inline: true,
        },
        {
          name: 'Absen Berhasil',
          value: `${absencesCount} absensi`,
          inline: true,
        }
      )
      .setTimestamp();

    await this.sendDM(userId, embed);
  }

  async sendError(userId, errorMessage) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.error)
      .setTitle('Terjadi Kesalahan')
      .setDescription(
        `Terjadi kesalahan saat memproses absensi:\n\`\`\`${errorMessage}\`\`\``
      )
      .setFooter({ text: 'Sistem akan mencoba lagi pada pengecekan berikutnya' })
      .setTimestamp();

    await this.sendDM(userId, embed);
  }

  async sendReloginNotification(userId, nim) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle('Re-login Diperlukan')
      .setDescription(
        `Sesi SIMA untuk NIM **${nim}** telah expired.\n` +
        `Sistem sedang melakukan login ulang...`
      )
      .setTimestamp();

    await this.sendDM(userId, embed);
  }

  async sendReloginSuccess(userId) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.success)
      .setTitle('Re-login Berhasil')
      .setDescription('Sesi SIMA telah diperbarui. Pengecekan dilanjutkan.')
      .setTimestamp();

    await this.sendDM(userId, embed);
  }

  async sendReloginFailed(userId, error) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.error)
      .setTitle('Re-login Gagal')
      .setDescription(
        `Gagal melakukan login ulang ke SIMA:\n\`\`\`${error}\`\`\`\n\n` +
        `Silakan gunakan command \`/update\` untuk memperbarui kredensial Anda.`
      )
      .setTimestamp();

    await this.sendDM(userId, embed);
  }
}

export default NotificationService;