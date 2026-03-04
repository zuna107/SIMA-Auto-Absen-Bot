import cron from 'node-cron';
import fs from 'fs/promises';
import config from '../config.js';
import Logger from '../utils/logger.js';
import UserManager from '../connection/userManager.js';
import SIMAClient from '../connection/simaClient.js';
import NotificationService from './notifier.js';

class SchedulerService {
  constructor(client) {
    this.client = client;
    this.logger = new Logger('Scheduler');
    this.userManager = new UserManager();
    this.notifier = new NotificationService(client);
    this.task = null;
    this.reminderTask = null;
    this.isRunning = false;
    this.lastMateriDir = config.paths.lastMateri;
    this.maxConcurrentUsers = 3; // Process max 3 users simultaneously
  }

  async start() {
    try {
      this.logger.info(`Starting scheduler with ${config.scheduler.interval} minute interval`);

      // Run immediately on start
      await this.checkAllUsers();

      // Schedule periodic checks
      this.task = cron.schedule(config.scheduler.cronExpression, async () => {
        if (this.isRunning) {
          this.logger.warn('Previous check still running, skipping...');
          return;
        }
        
        await this.checkAllUsers();
      });

      this.logger.success('Scheduler started successfully');
    } catch (error) {
      this.logger.error('Failed to start scheduler:', error);
      throw error;
    }
  }

  async stop() {
    if (this.task) {
      this.task.stop();
      this.logger.info('Scheduler stopped');
    }
  }

  async checkAllUsers() {
    this.isRunning = true;
    this.logger.info('Starting check cycle for all users...');

    try {
      const users = await this.userManager.getActiveUsers();
      
      if (users.length === 0) {
        this.logger.info('No active users to check');
        return;
      }

      this.logger.info(`Checking ${users.length} active user(s)`);

      // Process users in batches (parallel processing)
      for (let i = 0; i < users.length; i += this.maxConcurrentUsers) {
        const batch = users.slice(i, i + this.maxConcurrentUsers);
        
        this.logger.info(
          `Processing batch ${Math.floor(i / this.maxConcurrentUsers) + 1}: ` +
          `${batch.map(u => u.nim).join(', ')}`
        );

        // Process batch in parallel
        await Promise.allSettled(
          batch.map(user => this.checkUserMateri(user))
        );

        // Delay between batches
        if (i + this.maxConcurrentUsers < users.length) {
          await this.delay(config.request.delays.betweenRequests);
        }
      }

      this.logger.success('Check cycle completed');
    } catch (error) {
      this.logger.error('Check cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async checkUserMateri(user) {
    try {
      this.logger.info(`Checking materials for ${user.nim} (${user.studentName || 'Unknown'})...`);

      await this.userManager.updateUser(user.userId, {
        lastCheck: new Date().toISOString(),
      });

      await this.userManager.incrementStats(user.userId, 'totalChecks');

      // Create SIMA client with fresh cookies
      let simaClient = new SIMAClient(
        user.cookies ? JSON.parse(user.cookies) : null
      );

      // Always try to fetch, and re-login if needed
      let makul;
      let loginAttempted = false;
      
      try {
        makul = await simaClient.fetchMakul();
      } catch (error) {
        this.logger.warn(`Session likely expired for ${user.nim} (${error.message}), re-logging in...`);
        loginAttempted = true;
        
        const loginResult = await simaClient.login(user.nim, user.password);
        
        if (!loginResult.success) {
          throw new Error(`Re-login failed: ${loginResult.error}`);
        }

        // Update cookies and create new client
        await this.userManager.updateCookies(user.userId, loginResult.cookies);
        simaClient = new SIMAClient(loginResult.cookies);
        
        // Retry fetch with new session
        makul = await simaClient.fetchMakul();
      }

      this.logger.info(`Found ${makul.length} mata kuliah for ${user.nim}`);

      // Load user-specific materi data
      const userLastMateri = await this.loadUserMateri(user.userId);

      let newMateriFound = 0;
      let absencesCompleted = 0;

      // Check each mata kuliah
      for (const mk of makul) {
        if (!mk.materiId) continue;

        try {
          const materiList = await simaClient.fetchMateri(mk.materiId);
          const lastKnownMateri = userLastMateri[mk.materiId] || [];

          // Find new materials
          const newMateri = this.findNewMateri(materiList, lastKnownMateri);

          if (newMateri.length > 0) {
            this.logger.info(
              `Found ${newMateri.length} new materi in ${mk.nama}`
            );
            newMateriFound += newMateri.length;

            for (const materi of newMateri) {
              const absenceResult = await this.processNewMateri(
                user,
                mk,
                materi,
                simaClient
              );

              if (absenceResult && absenceResult.success && absenceResult.verified) {
                absencesCompleted++;
              }
            }
          }

          // Fetch tugas if available
          if (mk.tugasId) {
            try {
              const tugasList = await simaClient.fetchTugas(mk.tugasId);
              const lastKnownTugas = userLastMateri[`tugas_${mk.materiId}`] || [];

              const newTugas = this.findNewTugas(tugasList, lastKnownTugas);

              if (newTugas.length > 0) {
                this.logger.info(
                  `Found ${newTugas.length} new tugas in ${mk.nama}`
                );

                for (const tugas of newTugas) {
                  await this.notifier.sendNewTugasNotification(
                    user.userId,
                    mk,
                    tugas
                  );
                }
              }

              // Store tugas data with berkas
              userLastMateri[`tugas_${mk.materiId}`] = tugasList.map(t => ({
                id: t.id,
                title: t.title,
                timestamp: t.timestamp,
                isSubmitted: t.isSubmitted,
                berkas: t.berkas || [],
              }));
            } catch (tugasError) {
              this.logger.warn(`Failed to fetch tugas for ${mk.nama}:`, tugasError.message);
            }
          }

          // Update last known materials with berkas
          userLastMateri[mk.materiId] = materiList.map(m => ({
            id: m.id,
            title: m.title,
            timestamp: m.timestamp,
            berkas: m.berkas || [],
          }));

          await this.delay(800); // Shorter delay

        } catch (error) {
          this.logger.error(
            `Error processing makul ${mk.nama}:`,
            error
          );
        }
      }

      // Save updated user materi data
      await this.saveUserMateri(user.userId, userLastMateri);

      // Send summary if there were new materials
      if (newMateriFound > 0) {
        await this.notifier.sendCheckSummary(
          user.userId,
          newMateriFound,
          absencesCompleted
        );
      }

      this.logger.success(
        `Check completed for ${user.nim}: ` +
        `${newMateriFound} new, ${absencesCompleted} absences`
      );

    } catch (error) {
      this.logger.error(`Failed to check user ${user.nim}:`, error);
      await this.userManager.incrementStats(user.userId, 'failedAttempts');
      await this.notifier.sendError(user.userId, error.message);
      throw error;
    }
  }

  findNewMateri(currentList, lastKnownList) {
    const lastKnownIds = new Set(lastKnownList.map(m => m.id));
    return currentList.filter(m => !lastKnownIds.has(m.id));
  }

  findNewTugas(currentList, lastKnownList) {
    const lastKnownIds = new Set(lastKnownList.map(t => t.id));
    return currentList.filter(t => !lastKnownIds.has(t.id));
  }

  async ensureMateriDirectory() {
    try {
      await fs.mkdir(this.lastMateriDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        this.logger.error('Failed to create materi directory:', error);
      }
    }
  }

  async loadUserMateri(userId) {
    try {
      await this.ensureMateriDirectory();
      const filePath = `${this.lastMateriDir}/${userId}.json`;
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      this.logger.warn(`Failed to load materi for user ${userId}:`, error.message);
      return {};
    }
  }

  async saveUserMateri(userId, data) {
    try {
      await this.ensureMateriDirectory();
      const filePath = `${this.lastMateriDir}/${userId}.json`;
      await fs.writeFile(
        filePath,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch (error) {
      this.logger.error(`Failed to save materi for user ${userId}:`, error);
      throw error;
    }
  }

  async checkTugasReminders() {
    try {
      const users = await this.userManager.getActiveUsers();
      
      if (users.length === 0) {
        this.logger.info('No active users for tugas reminder');
        return;
      }

      this.logger.info(`Checking tugas reminders for ${users.length} user(s)`);

      for (const user of users) {
        try {
          const userLastMateri = await this.loadUserMateri(user.userId);
          const incompleteTugas = [];

          // Check all tugas data
          for (const key in userLastMateri) {
            if (key.startsWith('tugas_')) {
              const tugasList = userLastMateri[key];
              
              for (const tugas of tugasList) {
                if (!tugas.isSubmitted && tugas.title) {
                  const materiId = key.replace('tugas_', '');
                  
                  incompleteTugas.push({
                    ...tugas,
                    materiId,
                  });
                }
              }
            }
          }

          if (incompleteTugas.length > 0) {
            this.logger.info(
              `Sending reminder for ${incompleteTugas.length} incomplete tugas to ${user.nim}`
            );

            await this.notifier.sendTugasReminder(
              user.userId,
              incompleteTugas
            );
          }

          await this.delay(2000);

        } catch (error) {
          this.logger.error(`Error checking tugas for ${user.nim}:`, error);
        }
      }

      this.logger.success('Tugas reminder check completed');

    } catch (error) {
      this.logger.error('Failed to check tugas reminders:', error);
    }
  }

  findNewTugas(currentList, lastKnownList) {
    const lastKnownIds = new Set(lastKnownList.map(t => t.id));
    return currentList.filter(t => !lastKnownIds.has(t.id));
  }

  async checkTugasReminders() {
    try {
      const users = await this.userManager.getActiveUsers();
      
      if (users.length === 0) {
        this.logger.info('No active users for tugas reminder');
        return;
      }

      this.logger.info(`Checking tugas reminders for ${users.length} user(s)`);

      for (const user of users) {
        try {
          const lastMateriData = await this.loadLastMateri();
          const userLastMateri = lastMateriData[user.userId] || {};

          const incompleteTugas = [];

          // Check all tugas data
          for (const key in userLastMateri) {
            if (key.startsWith('tugas_')) {
              const tugasList = userLastMateri[key];
              
              for (const tugas of tugasList) {
                if (!tugas.isCompleted && tugas.title) {
                  // Extract makul info from key
                  const materiId = key.replace('tugas_', '');
                  
                  incompleteTugas.push({
                    ...tugas,
                    materiId,
                  });
                }
              }
            }
          }

          if (incompleteTugas.length > 0) {
            this.logger.info(
              `Sending reminder for ${incompleteTugas.length} incomplete tugas to ${user.nim}`
            );

            await this.notifier.sendTugasReminder(
              user.userId,
              incompleteTugas
            );
          }

          await this.delay(2000);

        } catch (error) {
          this.logger.error(`Error checking tugas for ${user.nim}:`, error);
        }
      }

      this.logger.success('Tugas reminder check completed');

    } catch (error) {
      this.logger.error('Failed to check tugas reminders:', error);
    }
  }

  async processNewMateri(user, makul, materi, simaClient) {
    try {
      this.logger.info(`Processing new materi: ${materi.title}`);

      // Notify user about new materi
      await this.notifier.sendNewMateriNotification(
        user.userId,
        makul,
        materi
      );

      // Check if attendance is required and possible
      if (materi.isManual) {
        this.logger.info('Manual attendance by lecturer, skipping auto-absen');
        return { success: false, reason: 'manual' };
      }

      if (!materi.isActive) {
        this.logger.info('Attendance period ended, skipping');
        return { success: false, reason: 'inactive' };
      }

      if (!materi.links.diskusi) {
        this.logger.warn('No discussion link found, cannot auto-absen');
        return { success: false, reason: 'no_link' };
      }

      // Perform auto-attendance
      this.logger.info('Attempting auto-attendance...');
      
      await this.delay(2000); // Wait a bit before attending
      
      const absenResult = await simaClient.absenMateri(materi.links.diskusi);

      if (absenResult.success) {
        this.logger.success('Attendance request completed');
        
        // Wait longer for server to process attendance
        await this.delay(4000);

        // Verify attendance with retry
        if (materi.links.kehadiran) {
          let kehadiranCheck = null;
          let verificationAttempts = 0;
          const maxVerificationAttempts = 4; // Increased from 3

          while (verificationAttempts < maxVerificationAttempts) {
            verificationAttempts++;
            
            this.logger.info(
              `Verifying attendance (attempt ${verificationAttempts}/${maxVerificationAttempts})...`
            );

            kehadiranCheck = await simaClient.cekKehadiran(
              materi.links.kehadiran,
              user.nim
            );

            if (kehadiranCheck.isPresent) {
              this.logger.success(
                `✓ Attendance verified for ${materi.title}` +
                (kehadiranCheck.timestamp ? ` at ${kehadiranCheck.timestamp}` : '')
              );
              
              await this.userManager.incrementStats(user.userId, 'totalAbsences');
              
              await this.notifier.sendAbsenceSuccess(
                user.userId,
                makul,
                materi,
                kehadiranCheck.timestamp
              );

              return { success: true, verified: true };
            }

            // If not found, wait longer before retry
            if (verificationAttempts < maxVerificationAttempts) {
              this.logger.warn(
                `Attendance not found yet, waiting before retry...`
              );
              await this.delay(6000); // Increased delay
            }
          }

          // If still not verified after retries
          this.logger.warn(
            `⚠ Attendance not verified after ${maxVerificationAttempts} attempts. ` +
            `This might be a parsing issue or server delay.`
          );
          
          // Still notify user but mention it's unverified
          await this.notifier.sendAbsenceUnverified(
            user.userId,
            makul,
            materi
          );

          return { success: true, verified: false };
        } else {
          // No verification link available
          this.logger.info('No verification link available, assuming success');
          await this.userManager.incrementStats(user.userId, 'totalAbsences');
          return { success: true, verified: false };
        }
      } else {
        this.logger.error('Attendance request failed');
        return { success: false, reason: 'request_failed' };
      }

    } catch (error) {
      this.logger.error(`Failed to process materi ${materi.title}:`, error);
      await this.notifier.sendError(
        user.userId,
        `Gagal memproses materi "${materi.title}": ${error.message}`
      );
      return { success: false, reason: 'error', error: error.message };
    }
  }

  async loadLastMateri() {
    // Fallback untuk backward compatibility
    try {
      const data = await fs.readFile(`${this.lastMateriDir}.json`, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async saveLastMateri(data) {
    // Not used anymore, but kept for backward compatibility
    try {
      await fs.writeFile(
        `${this.lastMateriDir}.json`,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch (error) {
      this.logger.error('Failed to save last materi:', error);
      throw error;
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default SchedulerService;