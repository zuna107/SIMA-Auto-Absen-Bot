import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import Logger from '../utils/logger.js';

class NotificationService {
  constructor(client) {
    this.client = client;
    this.logger = new Logger('Notifier');
  }

  resolveColor(color, fallback = 0x3b82f6) {
    if (typeof color === 'number') {
      return color;
    }

    return fallback;
  }

  async sendDM(userId, content) {
    try {
      const user = await this.client.users.fetch(userId);
      await user.send(content);
      this.logger.info(`Sent DM to user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to send DM to ${userId}:`, error);
      throw error;
    }
  }

  async sendNewMateriNotification(userId, makul, materi) {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.info))
        .setTitle('Materi Baru Terdeteksi')
        .setDescription(
          `Materi baru telah ditambahkan pada mata kuliah \`${makul.nama}\``
        )
        .addFields(
          { name: 'Mata Kuliah', value: makul.nama, inline: false },
          { name: 'Judul Materi', value: materi.title, inline: false },
          { name: 'Bahasan', value: materi.bahasan || '-', inline: false },
          { 
            name: 'Waktu Kehadiran', 
            value: materi.waktuKehadiran || '-', 
            inline: true 
          },
          { 
            name: 'Waktu Diskusi', 
            value: materi.waktuDiskusi || '-', 
            inline: true 
          },
          {
            name: 'Tipe Absensi',
            value: materi.isManual 
              ? 'Manual (Oleh Dosen)' 
              : 'Mandiri (Auto)',
            inline: false,
          }
        )
        .setTimestamp();

      if (!materi.isManual && materi.isActive) {
        embed.setFooter({ 
          text: '🔄 Sistem akan mencoba absen otomatis...' 
        });
      } else if (materi.isManual) {
        embed.setFooter({ 
          text: 'Absensi manual oleh dosen, tidak bisa auto-absen' 
        });
      } else {
        embed.setFooter({ 
          text: 'Waktu kehadiran sudah berakhir' 
        });
      }

      await this.sendDM(userId, { embeds: [embed] });
      
      this.logger.success(
        `Sent new materi notification to ${userId}: ${materi.title}`
      );
    } catch (error) {
      this.logger.error('Failed to send new materi notification:', error);
    }
  }

  async sendAbsenceSuccess(userId, makul, materi, timestamp) {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.success, 0x22c55e))
        .setTitle('Absen Berhasil!')
        .setDescription(
          `Absensi berhasil dilakukan untuk materi \`${materi.title}\``
        )
        .addFields(
          { name: 'Mata Kuliah', value: makul.nama, inline: false },
          { name: 'Materi', value: materi.title, inline: false },
          { 
            name: 'Waktu Absen', 
            value: timestamp || 'Baru saja', 
            inline: true 
          },
          { 
            name: 'Status', 
            value: '✅ Hadir', 
            inline: true 
          }
        )
        .setTimestamp();

      await this.sendDM(userId, { embeds: [embed] });
      
      this.logger.success(
        `Sent absence success notification to ${userId}`
      );
    } catch (error) {
      this.logger.error('Failed to send absence success notification:', error);
    }
  }

  async sendCheckSummary(userId, newMateriCount, absencesCount) {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.primary, 0x6366f1))
        .setTitle('Ringkasan Pengecekan')
        .setDescription(
          `Pengecekan otomatis selesai dilakukan.`
        )
        .addFields(
          { 
            name: 'Materi Baru', 
            value: `${newMateriCount} materi`, 
            inline: true 
          },
          { 
            name: 'Absen Berhasil', 
            value: `${absencesCount} absensi`, 
            inline: true 
          }
        )
        .setFooter({ 
          text: `Pengecekan berikutnya dalam ${config.scheduler.interval} menit` 
        })
        .setTimestamp();

      await this.sendDM(userId, { embeds: [embed] });
      
      this.logger.info(
        `Sent check summary to ${userId}: ${newMateriCount} new, ${absencesCount} absences`
      );
    } catch (error) {
      this.logger.error('Failed to send check summary:', error);
    }
  }

  async sendError(userId, errorMessage) {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.error, 0xef4444))
        .setTitle('Terjadi Kesalahan')
        .setDescription(
          `Sistem mengalami kesalahan saat memproses data Anda:\n\n` +
          `\`\`\`${errorMessage}\`\`\``
        )
        .setFooter({ 
          text: 'Sistem akan mencoba lagi pada pengecekan berikutnya' 
        })
        .setTimestamp();

      await this.sendDM(userId, { embeds: [embed] });
      
      this.logger.info(`Sent error notification to ${userId}`);
    } catch (error) {
      this.logger.error('Failed to send error notification:', error);
    }
  }

  async sendRegistrationSuccess(userId, nim, makulCount) {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.success, 0x22c55e))
        .setTitle('Registrasi Berhasil')
        .setDescription(
          'Akun SIMA Anda telah berhasil didaftarkan dalam sistem absensi otomatis!'
        )
        .addFields(
          { name: 'NIM', value: nim, inline: true },
          { name: 'Mata Kuliah', value: `${makulCount} terdaftar`, inline: true },
          { name: 'Status', value: '🟢 Aktif', inline: true },
          {
            name: 'Fitur Aktif',
            value: 
              '- Pengecekan materi baru otomatis\n' +
              '- Absensi mandiri otomatis\n' +
              '- Notifikasi real-time\n' +
              '- Laporan kehadiran',
            inline: false,
          }
        )
        .setFooter({ 
          text: `Pengecekan dilakukan setiap ${config.scheduler.interval} menit` 
        })
        .setTimestamp();

      await this.sendDM(userId, { embeds: [embed] });
      
      this.logger.success(
        `Sent registration success to ${userId}`
      );
    } catch (error) {
      this.logger.error('Failed to send registration success:', error);
    }
  }

  async sendLoginExpired(userId) {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.warning, 0xf59e0b))
        .setTitle('Sesi Login Kadaluarsa')
        .setDescription(
          'Sesi login SIMA Anda telah kadaluarsa. Sistem mencoba login ulang secara otomatis.'
        )
        .setFooter({ 
          text: 'Jika masalah berlanjut, gunakan /absen untuk registrasi ulang' 
        })
        .setTimestamp();

      await this.sendDM(userId, { embeds: [embed] });
      
      this.logger.info(`Sent login expired notification to ${userId}`);
    } catch (error) {
      this.logger.error('Failed to send login expired notification:', error);
    }
  }

  async sendAbsenceUnverified(userId, makul, materi) {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.warning, 0xf59e0b))
        .setTitle('Absensi Terkirim, Belum Terverifikasi')
        .setDescription(
          `Permintaan absensi sudah dikirim untuk materi \`${materi.title}\`, ` +
          'tetapi belum terlihat pada daftar kehadiran saat pengecekan.'
        )
        .addFields(
          { name: 'Mata Kuliah', value: makul.nama || '-', inline: false },
          { name: 'Materi', value: materi.title || '-', inline: false },
          { name: 'Saran', value: 'Cek manual di SIMA beberapa menit lagi.', inline: false }
        )
        .setTimestamp();

      await this.sendDM(userId, { embeds: [embed] });
      this.logger.warn(`Sent unverified absence notification to ${userId}`);
    } catch (error) {
      this.logger.error('Failed to send unverified absence notification:', error);
    }
  }

  async sendNewTugasNotification(userId, makul, tugas) {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.info))
        .setTitle('Tugas Baru Terdeteksi')
        .setDescription(`Tugas baru ditemukan pada mata kuliah \`${makul.nama}\``)
        .addFields(
          { name: 'Mata Kuliah', value: makul.nama || '-', inline: false },
          { name: 'Judul Tugas', value: tugas.title || '-', inline: false },
          { name: 'Waktu', value: tugas.waktu || '-', inline: false },
          { name: 'Status', value: tugas.isSubmitted ? 'Sudah dikerjakan' : 'Belum dikerjakan', inline: true }
        )
        .setTimestamp();

      await this.sendDM(userId, { embeds: [embed] });
      this.logger.info(`Sent new tugas notification to ${userId}: ${tugas.title}`);
    } catch (error) {
      this.logger.error('Failed to send new tugas notification:', error);
    }
  }

  async sendTugasReminder(userId, tugasList) {
    try {
      const maxItems = 10;
      const preview = tugasList
        .slice(0, maxItems)
        .map((tugas, index) => `${index + 1}. ${tugas.title || 'Tanpa judul'}`)
        .join('\n');
      const hasMore = tugasList.length > maxItems;

      const embed = new EmbedBuilder()
        .setColor(this.resolveColor(config.colors.warning, 0xf59e0b))
        .setTitle('Reminder Tugas Belum Selesai')
        .setDescription(
          `Terdapat ${tugasList.length} tugas yang belum dikumpulkan.\n\n${preview}` +
          (hasMore ? `\n...dan ${tugasList.length - maxItems} tugas lainnya` : '')
        )
        .setFooter({ text: 'Gunakan /tugas untuk melihat detail lengkap.' })
        .setTimestamp();

      await this.sendDM(userId, { embeds: [embed] });
      this.logger.info(`Sent tugas reminder to ${userId} (${tugasList.length} items)`);
    } catch (error) {
      this.logger.error('Failed to send tugas reminder:', error);
    }
  }
}

export default NotificationService;
