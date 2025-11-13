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
    this.isRunning = false;
    this.lastMateriPath = config.paths.lastMateri;
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

      for (const user of users) {
        try {
          await this.checkUserMateri(user);
          await this.delay(config.request.delays.betweenRequests);
        } catch (error) {
          this.logger.error(`Error checking user ${user.nim}:`, error);
          await this.notifier.sendError(user.userId, error.message);
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

      // Update last check time
      await this.userManager.updateUser(user.userId, {
        lastCheck: new Date().toISOString(),
      });

      // Increment check counter
      await this.userManager.incrementStats(user.userId, 'totalChecks');

      // Create SIMA client with user's cookies
      const simaClient = new SIMAClient(
        user.cookies ? JSON.parse(user.cookies) : null
      );

      // Try to fetch makul, re-login if session expired
      let makul;
      try {
        makul = await simaClient.fetchMakul();
      } catch (error) {
        this.logger.warn(`Session expired for ${user.nim}, re-logging in...`);
        
        const loginResult = await simaClient.login(user.nim, user.password);
        
        if (!loginResult.success) {
          throw new Error(`Re-login failed: ${loginResult.error}`);
        }

        // Update cookies
        await this.userManager.updateCookies(user.userId, loginResult.cookies);
        
        // Retry fetch
        makul = await simaClient.fetchMakul();
      }

      this.logger.info(`Found ${makul.length} mata kuliah for ${user.nim}`);

      // Load last known materials
      const lastMateriData = await this.loadLastMateri();
      const userLastMateri = lastMateriData[user.userId] || {};

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

            // Process each new materi
            for (const materi of newMateri) {
              const absenceResult = await this.processNewMateri(
                user,
                mk,
                materi,
                simaClient
              );

              if (absenceResult && absenceResult.success) {
                absencesCompleted++;
              }
            }
          }

          // Update last known materials
          userLastMateri[mk.materiId] = materiList.map(m => ({
            id: m.id,
            title: m.title,
            timestamp: m.timestamp,
          }));

          await this.delay(1000);

        } catch (error) {
          this.logger.error(
            `Error processing makul ${mk.nama}:`,
            error
          );
        }
      }

      // Save updated last materi
      lastMateriData[user.userId] = userLastMateri;
      await this.saveLastMateri(lastMateriData);

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
      throw error;
    }
  }

  findNewMateri(currentList, lastKnownList) {
    const lastKnownIds = new Set(lastKnownList.map(m => m.id));
    return currentList.filter(m => !lastKnownIds.has(m.id));
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
        
        //Wait longer for server to process attendance
        await this.delay(3000);

        // Verify attendance
        if (materi.links.kehadiran) {
          //Retry verification up to 3 times
          let kehadiranCheck = null;
          let verificationAttempts = 0;
          const maxVerificationAttempts = 3;

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

            // If not found, wait before retry
            if (verificationAttempts < maxVerificationAttempts) {
              this.logger.warn(
                `Attendance not found yet, waiting before retry...`
              );
              await this.delay(5000);
            }
          }

          //If still not verified after retries, log warning but consider it might be successful
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
    try {
      const data = await fs.readFile(this.lastMateriPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async saveLastMateri(data) {
    try {
      await fs.writeFile(
        this.lastMateriPath,
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