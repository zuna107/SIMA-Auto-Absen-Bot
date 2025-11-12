import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import UserManager from '../connection/userManager.js';
import Logger from '../utils/logger.js';
import config from '../config.js';

const logger = new Logger('StatusCommand');
const userManager = new UserManager();

const command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Lihat status akun dan statistik absensi Anda')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const user = await userManager.getUser(interaction.user.id);

      if (!user) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('⚠️ Belum Terdaftar')
          .setDescription(
            'Anda belum mendaftarkan akun SIMA.\n\n' +
            'Gunakan `/absen` untuk mendaftar dan mengaktifkan sistem absensi otomatis.'
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Calculate uptime
      const registeredDate = new Date(user.registeredAt);
      const now = new Date();
      const daysSinceRegistration = Math.floor(
        (now - registeredDate) / (1000 * 60 * 60 * 24)
      );

      // Format last check time
      let lastCheckStr = 'Belum pernah';
      if (user.lastCheck) {
        const lastCheck = new Date(user.lastCheck);
        const minutesAgo = Math.floor((now - lastCheck) / (1000 * 60));
        
        if (minutesAgo < 60) {
          lastCheckStr = `${minutesAgo} menit yang lalu`;
        } else if (minutesAgo < 1440) {
          lastCheckStr = `${Math.floor(minutesAgo / 60)} jam yang lalu`;
        } else {
          lastCheckStr = lastCheck.toLocaleString('id-ID');
        }
      }

      // Calculate success rate
      const stats = user.stats || { totalChecks: 0, totalAbsences: 0, failedAttempts: 0 };
      const successRate = stats.totalChecks > 0
        ? ((stats.totalChecks - stats.failedAttempts) / stats.totalChecks * 100).toFixed(1)
        : 100;

      const embed = new EmbedBuilder()
        .setColor(user.isActive ? config.colors.success : config.colors.error)
        .setTitle('📊 Status Akun & Statistik')
        .setDescription(
          user.isActive
            ? '🟢 Sistem absensi otomatis **AKTIF**'
            : '🔴 Sistem absensi otomatis **NONAKTIF**'
        )
        .addFields(
          {
            name: '👤 Informasi Akun',
            value:
              `**NIM:** ${user.nim}\n` +
              `**Username:** ${user.username}\n` +
              `**Status:** ${user.isActive ? '✅ Aktif' : '❌ Nonaktif'}`,
            inline: false,
          },
          {
            name: '📅 Waktu',
            value:
              `**Terdaftar:** ${registeredDate.toLocaleDateString('id-ID')}\n` +
              `**Hari Aktif:** ${daysSinceRegistration} hari\n` +
              `**Cek Terakhir:** ${lastCheckStr}`,
            inline: false,
          },
          {
            name: '📈 Statistik',
            value:
              `**Total Pengecekan:** ${stats.totalChecks}\n` +
              `**Total Absensi:** ${stats.totalAbsences}\n` +
              `**Gagal:** ${stats.failedAttempts}\n` +
              `**Success Rate:** ${successRate}%`,
            inline: false,
          },
          {
            name: '⚙️ Konfigurasi',
            value:
              `**Interval:** Setiap ${config.scheduler.interval} menit\n` +
              `**Auto-Absen:** ${user.isActive ? 'Aktif' : 'Nonaktif'}\n` +
              `**Notifikasi:** Aktif`,
            inline: false,
          }
        )
        .setFooter({
          text: user.isActive
            ? `Pengecekan berikutnya dalam ~${config.scheduler.interval} menit`
            : 'Gunakan /toggle untuk mengaktifkan',
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logger.info(`Status checked by ${user.nim}`);
    } catch (error) {
      logger.error('Error in status command:', error);
      throw error;
    }
  },
};

export default command;