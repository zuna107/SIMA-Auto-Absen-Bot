import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js';
import UserManager from '../connection/userManager.js';
import SIMAClient from '../connection/simaClient.js';
import Logger from '../utils/logger.js';
import config from '../config.js';

const logger = new Logger('AbsenCommand');
const userManager = new UserManager();

const command = {
  data: new SlashCommandBuilder()
    .setName('absen')
    .setDescription('Daftarkan akun SIMA untuk sistem absensi otomatis')
    .setIntegrationTypes([0, 1]) // Guild and User Install
    .setContexts([0, 1, 2]), // Guild, BotDM, PrivateChannel

  async execute(interaction) {
    try {
      // Check if user already registered
      const existingUser = await userManager.getUser(interaction.user.id);

      if (existingUser) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('Akun Sudah Terdaftar')
          .setDescription(
            'Akunmu sudah terdaftar dalam sistem.\n\n' +
            `**Nama:** ${existingUser.studentName || 'N/A'}\n` +
            `**NIM:** ${existingUser.nim}\n` +
            `**Status:** ${existingUser.isActive ? '`Aktif`' : '`Nonaktif`'}\n\n` +
            'Gunakan </status:1438192158896291851> untuk melihat detail atau </toggle:1438192158896291852> untuk mengaktifkan/menonaktifkan'
          )
          .setTimestamp();

        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // Show registration modal
      const modal = new ModalBuilder()
        .setCustomId(`absen_modal_${interaction.user.id}`)
        .setTitle('Registrasi Akun SIMA');

      const nimInput = new TextInputBuilder()
        .setCustomId('nim')
        .setLabel('NIM (Nomor Induk Mahasiswa)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Contoh: 2024160008')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(15);

      const passwordInput = new TextInputBuilder()
        .setCustomId('password')
        .setLabel('Password SIMA')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Masukkan password SIMA Anda')
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(50);

      const nimRow = new ActionRowBuilder().addComponents(nimInput);
      const passwordRow = new ActionRowBuilder().addComponents(passwordInput);

      modal.addComponents(nimRow, passwordRow);

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error in absen command:', error);
      throw error;
    }
  },

  async handleModal(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const nim = interaction.fields.getTextInputValue('nim').trim();
      const password = interaction.fields.getTextInputValue('password').trim();

      // Validate input
      if (!/^\d+$/.test(nim)) {
        return await interaction.editReply({
          content: 'NIM harus berisi angka saja!',
        });
      }

      logger.info(`Registration attempt for NIM: ${nim}`);

      // Create status embed
      const statusEmbed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle('Memproses Registrasi')
        .setDescription('Sedang memverifikasi akun SIMA-mu...')
        .addFields(
          { name: 'NIM', value: nim, inline: true },
          { name: 'Status', value: 'Connecting...', inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [statusEmbed] });

      // Attempt to login
      const simaClient = new SIMAClient();
      const loginResult = await simaClient.login(nim, password);

      if (!loginResult.success) {
        logger.error(`Login failed for NIM ${nim}: ${loginResult.error}`);

        const errorEmbed = new EmbedBuilder()
          .setColor(config.colors.error)
          .setTitle('Login Gagal')
          .setDescription(
            `Gagal login ke SIMA:\n\`\`\`${loginResult.error}\`\`\`\n\n` +
            '**Kemungkinan penyebab:**\n' +
            '• NIM atau password salah\n' +
            '• Koneksi ke server SIMA bermasalah\n' +
            '• CAPTCHA tidak dapat di-solve\n\n' +
            'Silakan coba lagi atau hubungi admin jika masalah berlanjut.'
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      // Save user data
      const userData = {
        userId: interaction.user.id,
        username: interaction.user.username,
        studentName: loginResult.studentName || 'Unknown',
        nim: nim,
        password: password,
        cookies: loginResult.cookies,
        isActive: true,
        registeredAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
      };

      await userManager.saveUser(userData);

      logger.success(`User registered successfully: ${nim} (${userData.studentName})`);

      // Fetch initial data
      statusEmbed
        .setDescription('Login berhasil!\nMengambil data mata kuliah...')
        .spliceFields(1, 1, { name: 'Status', value: '✅ Connected', inline: true });

      if (loginResult.studentName) {
        statusEmbed.addFields({ 
          name: 'Nama', 
          value: loginResult.studentName, 
          inline: false 
        });
      }

      await interaction.editReply({ embeds: [statusEmbed] });

      const makul = await simaClient.fetchMakul();
      
      statusEmbed
        .setDescription(
          'Login berhasil!\nData mata kuliah berhasil diambil!\nMengambil data materi...'
        )
        .addFields({ 
          name: 'Mata Kuliah', 
          value: `${makul.length} mata kuliah ditemukan`, 
          inline: false 
        });

      await interaction.editReply({ embeds: [statusEmbed] });

      const successEmbed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle('Registrasi Berhasil!')
        .setDescription(
          'Akun SIMA-mu telah terdaftar dalam sistem absensi otomatis!\n\n' +
          '**Fitur yang aktif:**\n' +
          '- Pengecekan materi baru otomatis\n' +
          '- Absensi mandiri otomatis\n' +
          '- Notifikasi materi baru\n' +
          '- Laporan kehadiran\n\n' +
          `**Interval pengecekan:** Setiap \`${config.scheduler.interval}\` menit`
        )
        .addFields(
          { name: '👤 Nama', value: userData.studentName, inline: false },
          { name: '🎓 NIM', value: nim, inline: true },
          { name: '📚 Mata Kuliah', value: `${makul.length} terdaftar`, inline: true },
          { name: '📊 Status', value: 'Aktif', inline: true }
        )
        .setFooter({ text: 'Gunakan /status untuk melihat detail lengkap' })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });

      // Trigger immediate check
      logger.info(`Triggering immediate check for user ${nim}`);
      
    } catch (error) {
      logger.error('Error in modal handler:', error);

      const errorEmbed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setTitle('Terjadi Kesalahan')
        .setDescription(
          'Terjadi kesalahan saat memproses registrasi.\n\n' +
          `**Error:** \`${error.message}\`\n\n` +
          'Silakan coba lagi nanti.'
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};

export default command;