import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import UserManager from '../connection/userManager.js';
import Logger from '../utils/logger.js';
import config from '../config.js';

const logger = new Logger('ToggleCommand');
const userManager = new UserManager();

const command = {
  data: new SlashCommandBuilder()
    .setName('toggle')
    .setDescription('Aktifkan atau nonaktifkan sistem absensi otomatis')
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
            'Gunakan </absen:1438192158896291850> untuk mendaftar terlebih dahulu.'
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Toggle status
      const newStatus = !user.isActive;
      await userManager.updateUser(interaction.user.id, {
        isActive: newStatus,
      });

      const embed = new EmbedBuilder()
        .setColor(newStatus ? config.colors.success : config.colors.warning)
        .setTitle(newStatus ? 'Sistem Diaktifkan' : 'Sistem Dinonaktifkan')
        .setDescription(
          newStatus
            ? '🟢 Sistem absensi otomatis telah **DIAKTIFKAN**\n\n' +
              '**Fitur aktif:**\n' +
              '- Pengecekan materi baru otomatis\n' +
              '- Absensi mandiri otomatis\n' +
              '- Notifikasi real-time\n\n' +
              `Pengecekan akan dilakukan setiap ${config.scheduler.interval} menit.`
            : '🔴 Sistem absensi otomatis telah **DINONAKTIFKAN**\n\n' +
              '**Status:**\n' +
              '- Pengecekan otomatis dihentikan\n' +
              '- Tidak ada absensi otomatis\n' +
              '- Notifikasi ditangguhkan\n\n' +
              'Datamu tetap tersimpan dan aman.'
        )
        .addFields({
          name: 'Status',
          value: newStatus ? '🟢 Aktif' : '🔴 Nonaktif',
          inline: true,
        })
        .setFooter({
          text: newStatus
            ? 'Gunakan /toggle lagi untuk menonaktifkan'
            : 'Gunakan /toggle lagi untuk mengaktifkan kembali',
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logger.info(
        `User ${user.nim} ${newStatus ? 'activated' : 'deactivated'} system`
      );
    } catch (error) {
      logger.error('Error in toggle command:', error);
      throw error;
    }
  },
};

export default command;