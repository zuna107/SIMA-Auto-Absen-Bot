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
    // CRITICAL: Check if interaction is still valid before doing anything
    const now = Date.now();
    const interactionTime = interaction.createdTimestamp;
    const timeSinceCreation = now - interactionTime;
    
    logger.debug(`Modal interaction age: ${timeSinceCreation}ms`);
    
    // If interaction is older than 2.5 seconds, it's too risky to defer
    if (timeSinceCreation > 2500) {
      logger.error(`Interaction too old (${timeSinceCreation}ms), cannot process`);
      
      // Try to send a DM to user explaining what happened
      try {
        const user = await interaction.client.users.fetch(interaction.user.id);
        await user.send({
          content: '**Registrasi Timeout**\n\n' +
            'Proses registrasi memakan waktu terlalu lama dan Discord membatalkan request.\n\n' +
            '**Solusi:**\n' +
            '• Coba lagi command `/absen`\n' +
            '• Pastikan koneksi internet stabil\n' +
            '• Jika masalah berlanjut, hubungi admin'
        });
      } catch (dmError) {
        logger.error('Failed to send DM:', dmError);
      }
      return;
    }

    // Defer immediately
    let deferred = false;
    
    try {
      await interaction.deferReply({ ephemeral: true });
      deferred = true;
      logger.debug(`Interaction deferred successfully after ${Date.now() - interactionTime}ms`);
    } catch (error) {
      logger.error('Failed to defer reply:', error);
      
      // Try to send error via DM as fallback
      try {
        const user = await interaction.client.users.fetch(interaction.user.id);
        await user.send({
          content: '**Gagal Memproses Registrasi**\n\n' +
            'Sistem tidak dapat merespons registrasi Anda tepat waktu.\n\n' +
            '**Silakan coba lagi:**\n' +
            '1. Ketik `/absen`\n' +
            '2. Isi form dengan cepat\n' +
            '3. Submit sesegera mungkin\n\n' +
            'Jika masalah berlanjut, hubungi admin.'
        });
        logger.info('Sent fallback DM to user');
      } catch (dmError) {
        logger.error('Failed to send fallback DM:', dmError);
      }
      return;
    }

    try {
      const nim = interaction.fields.getTextInputValue('nim').trim();
      const password = interaction.fields.getTextInputValue('password').trim();

      // Validate input
      if (!/^\d+$/.test(nim)) {
        return await interaction.editReply({
          content: 'NIM harus berisi angka saja!',
        });
      }

      logger.info(`Registration attempt for NIM: ${nim}`);

      // Create initial status embed
      const statusEmbed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle('Memproses Registrasi')
        .setDescription('Sedang memverifikasi akun SIMA-mu...')
        .addFields(
          { name: 'NIM', value: `\`${nim}\``, inline: true },
          { name: 'Status', value: '🔄 Connecting...', inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [statusEmbed] });

      // Update status helper
      const updateStatus = async (description, statusText) => {
        try {
          statusEmbed.setDescription(description);
          statusEmbed.spliceFields(1, 1, { 
            name: 'Status', 
            value: statusText, 
            inline: true 
          });
          await interaction.editReply({ embeds: [statusEmbed] });
        } catch (error) {
          logger.warn('Failed to update status:', error.message);
        }
      };

      // Attempt to login with progress updates
      await updateStatus(
        'Mengakses server SIMA...\nMohon tunggu, proses ini memakan waktu 10-30 detik.',
        '🔄 Initializing...'
      );

      const simaClient = new SIMAClient();
      
      // Start login process
      const loginPromise = simaClient.login(nim, password);
      
      // Create a progress updater
      let progressInterval;
      let progressStep = 0;
      const progressMessages = [
        'Mendapatkan session...',
        'Mengambil CAPTCHA...',
        'Menyelesaikan CAPTCHA...',
        'Mengirim data login...',
        'Memverifikasi...'
      ];

      progressInterval = setInterval(async () => {
        if (progressStep < progressMessages.length) {
          await updateStatus(
            'Login ke SIMA sedang berlangsung...\nMohon tunggu, proses ini memakan waktu.',
            progressMessages[progressStep]
          );
          progressStep++;
        }
      }, 5000); // Update every 5 seconds

      // Wait for login to complete
      const loginResult = await loginPromise;
      
      // Clear progress interval
      clearInterval(progressInterval);

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

      // Login successful - save user data
      await updateStatus(
        'Login berhasil!\nMenyimpan data...',
        '✅ Authenticated'
      );

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
      await updateStatus(
        'Data tersimpan!\nMengambil data mata kuliah...',
        '🔄 Fetching courses...'
      );

      const makul = await simaClient.fetchMakul();
      
      await updateStatus(
        'Data mata kuliah berhasil diambil!\nFinalisasi...',
        `Found ${makul.length} courses`
      );

      // Success embed
      const successEmbed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle('🎉 Registrasi Berhasil!')
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
          { name: '🎓 NIM', value: `\`${nim}\``, inline: true },
          { name: '📚 Mata Kuliah', value: `${makul.length} terdaftar`, inline: true },
          { name: '📊 Status', value: '🟢 Aktif', inline: true }
        )
        .setFooter({ text: 'Gunakan /status untuk melihat detail lengkap' })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });

      logger.info(`Registration complete for user ${nim}`);
      
    } catch (error) {
      logger.error('Error in modal handler:', error);

      if (!deferred) {
        return;
      }

      try {
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
      } catch (replyError) {
        logger.error('Failed to send error message:', replyError);
      }
    }
  },
};

export default command;