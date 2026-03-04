import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
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
    this.lastMateriDir = config.paths.lastMateri;
    this.legacyMateriPath = config.paths.lastMateriLegacy;
    this.maxConcurrentUsers = Math.max(1, Number(config.scheduler.maxConcurrentUsers || 3));
  }

  async start() {
    try {
      this.logger.info(`Starting scheduler with ${config.scheduler.interval} minute interval`);

      await this.ensureMateriDirectory();
      await this.migrateLegacyLastMateri();

      // Run once on startup.
      await this.checkAllUsers();

      this.task = cron.schedule(config.scheduler.cronExpression, async () => {
        if (this.isRunning) {
          this.logger.warn('Previous check still running, skipping this tick');
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
      this.task = null;
    }

    this.logger.info('Scheduler stopped');
  }

  async checkAllUsers() {
    this.isRunning = true;
    const startedAt = Date.now();
    this.logger.info('Starting check cycle for all active users');

    try {
      const users = await this.userManager.getActiveUsers();

      if (users.length === 0) {
        this.logger.info('No active users found');
        return;
      }

      this.logger.info(`Checking ${users.length} active user(s)`);

      for (let i = 0; i < users.length; i += this.maxConcurrentUsers) {
        const batch = users.slice(i, i + this.maxConcurrentUsers);
        const batchNumber = Math.floor(i / this.maxConcurrentUsers) + 1;

        this.logger.info(
          `Processing batch ${batchNumber} (${batch.length} user): ${batch.map((user) => user.nim).join(', ')}`
        );

        const results = await Promise.allSettled(batch.map((user) => this.checkUserMateri(user)));
        const failed = results.filter((result) => result.status === 'rejected').length;

        if (failed > 0) {
          this.logger.warn(`Batch ${batchNumber} completed with ${failed} failure(s)`);
        }

        if (i + this.maxConcurrentUsers < users.length) {
          await this.delay(config.request.delays.betweenRequests);
        }
      }

      const elapsedMs = Date.now() - startedAt;
      this.logger.success(`Check cycle completed in ${elapsedMs}ms`);
    } catch (error) {
      this.logger.error('Check cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async checkUserById(userId) {
    try {
      const user = await this.userManager.getUser(userId);
      if (!user || !user.isActive) {
        return false;
      }

      await this.checkUserMateri(user);
      return true;
    } catch (error) {
      this.logger.error(`Manual user check failed for ${userId}:`, error);
      return false;
    }
  }

  async checkUserMateri(user) {
    try {
      this.logger.info(`Checking materials for ${user.nim} (${user.studentName || 'Unknown'})`);

      await this.userManager.updateUser(user.userId, {
        lastCheck: new Date().toISOString(),
      });
      await this.userManager.incrementStats(user.userId, 'totalChecks');

      let simaClient = new SIMAClient(this.parseCookies(user.cookies));
      let makul = [];

      try {
        makul = await simaClient.fetchMakul();
      } catch (error) {
        this.logger.warn(`Session seems invalid for ${user.nim}: ${error.message}`);
        await this.notifier.sendLoginExpired(user.userId);

        const loginResult = await simaClient.login(user.nim, user.password);
        if (!loginResult.success) {
          throw new Error(`Re-login failed: ${loginResult.error}`);
        }

        await this.userManager.updateUser(user.userId, {
          cookies: loginResult.cookies,
          lastLogin: new Date().toISOString(),
          studentName: loginResult.studentName || user.studentName,
        });

        simaClient = new SIMAClient(loginResult.cookies);
        makul = await simaClient.fetchMakul();
      }

      this.logger.info(`Found ${makul.length} mata kuliah for ${user.nim}`);

      const userLastMateri = await this.loadUserMateri(user.userId);
      let newMateriFound = 0;
      let absencesCompleted = 0;

      for (const mk of makul) {
        if (!mk.materiId) {
          continue;
        }

        try {
          const materiList = await simaClient.fetchMateri(mk.materiId);
          const lastKnownMateri = userLastMateri[mk.materiId] || [];
          const newMateri = this.findNewMateri(materiList, lastKnownMateri);

          if (newMateri.length > 0) {
            this.logger.info(`Found ${newMateri.length} new materi in ${mk.nama}`);
            newMateriFound += newMateri.length;

            for (const materi of newMateri) {
              const absenceResult = await this.processNewMateri(user, mk, materi, simaClient);
              if (absenceResult.success && absenceResult.verified) {
                absencesCompleted += 1;
              }
            }
          }

          userLastMateri[mk.materiId] = this.normalizeMateriForCache(materiList);

          if (mk.tugasId) {
            const tugasList = await simaClient.fetchTugas(mk.tugasId);
            const tugasCacheKey = `tugas_${mk.materiId}`;
            const lastKnownTugas = userLastMateri[tugasCacheKey] || [];
            const newTugas = this.findNewTugas(tugasList, lastKnownTugas);

            if (newTugas.length > 0) {
              this.logger.info(`Found ${newTugas.length} new tugas in ${mk.nama}`);
              for (const tugas of newTugas) {
                await this.notifier.sendNewTugasNotification(user.userId, mk, tugas);
              }
            }

            userLastMateri[tugasCacheKey] = this.normalizeTugasForCache(tugasList);
          }

          await this.delay(800);
        } catch (error) {
          this.logger.error(`Error processing makul ${mk.nama}:`, error);
        }
      }

      await this.saveUserMateri(user.userId, userLastMateri);

      if (newMateriFound > 0) {
        await this.notifier.sendCheckSummary(user.userId, newMateriFound, absencesCompleted);
      }

      this.logger.success(
        `Check completed for ${user.nim}: ${newMateriFound} new materi, ${absencesCompleted} verified absence`
      );
    } catch (error) {
      this.logger.error(`Failed to check user ${user.nim}:`, error);
      await this.userManager.incrementStats(user.userId, 'failedAttempts');
      await this.notifier.sendError(user.userId, error.message);
      throw error;
    }
  }

  findNewMateri(currentList, lastKnownList) {
    const lastKnownKeys = new Set(lastKnownList.map((materi) => this.getMateriKey(materi)));
    return currentList.filter((materi) => !lastKnownKeys.has(this.getMateriKey(materi)));
  }

  findNewTugas(currentList, lastKnownList) {
    const lastKnownKeys = new Set(lastKnownList.map((tugas) => this.getTugasKey(tugas)));
    return currentList.filter((tugas) => !lastKnownKeys.has(this.getTugasKey(tugas)));
  }

  getMateriKey(materi) {
    return String(materi.id || `${materi.title || ''}|${materi.waktuKehadiran || ''}`);
  }

  getTugasKey(tugas) {
    return String(tugas.id || `${tugas.title || ''}|${tugas.waktu || ''}`);
  }

  normalizeMateriForCache(materiList) {
    return materiList.map((materi) => ({
      id: materi.id || null,
      title: materi.title || null,
      bahasan: materi.bahasan || null,
      waktuKehadiran: materi.waktuKehadiran || null,
      timestamp: materi.timestamp || new Date().toISOString(),
      berkas: (materi.berkas || []).map((berkas) => ({
        filename: berkas.filename || berkas.name || 'file',
        url: berkas.url || null,
      })),
    }));
  }

  normalizeTugasForCache(tugasList) {
    return tugasList.map((tugas) => ({
      id: tugas.id || null,
      title: tugas.title || null,
      soal: tugas.soal || null,
      waktu: tugas.waktu || null,
      isActive: Boolean(tugas.isActive),
      isSubmitted: Boolean(tugas.isSubmitted),
      nilai: Number.isFinite(tugas.nilai) ? tugas.nilai : null,
      timestamp: tugas.timestamp || new Date().toISOString(),
      berkas: (tugas.berkas || []).map((berkas) => ({
        filename: berkas.filename || berkas.name || 'file',
        url: berkas.url || null,
      })),
    }));
  }

  parseCookies(rawCookies) {
    if (!rawCookies) {
      return null;
    }

    if (typeof rawCookies === 'string') {
      try {
        return JSON.parse(rawCookies);
      } catch {
        return null;
      }
    }

    if (typeof rawCookies === 'object') {
      return rawCookies;
    }

    return null;
  }

  async ensureMateriDirectory() {
    try {
      await fs.mkdir(this.lastMateriDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  getUserMateriPath(userId) {
    return path.join(this.lastMateriDir, `${userId}.json`);
  }

  async loadUserMateri(userId) {
    try {
      const data = await fs.readFile(this.getUserMateriPath(userId), 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn(`Failed to load materi for user ${userId}: ${error.message}`);
      }

      return this.loadLegacyUserMateri(userId);
    }
  }

  async saveUserMateri(userId, data) {
    await this.ensureMateriDirectory();
    await fs.writeFile(this.getUserMateriPath(userId), JSON.stringify(data, null, 2), 'utf-8');
  }

  async loadLegacyUserMateri(userId) {
    try {
      const raw = await fs.readFile(this.legacyMateriPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed[userId] || {};
    } catch {
      return {};
    }
  }

  async migrateLegacyLastMateri() {
    try {
      const raw = await fs.readFile(this.legacyMateriPath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      let migrated = 0;
      for (const [userId, userData] of Object.entries(parsed)) {
        if (!userData || typeof userData !== 'object') {
          continue;
        }

        const targetPath = this.getUserMateriPath(userId);
        try {
          await fs.access(targetPath);
        } catch {
          await fs.writeFile(targetPath, JSON.stringify(userData, null, 2), 'utf-8');
          migrated += 1;
        }
      }

      if (migrated > 0) {
        this.logger.success(`Migrated ${migrated} user cache file(s) from legacy lastMateri.json`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn(`Failed to migrate legacy lastMateri cache: ${error.message}`);
      }
    }
  }

  async checkTugasReminders() {
    try {
      const users = await this.userManager.getActiveUsers();

      if (users.length === 0) {
        return;
      }

      for (const user of users) {
        try {
          const userLastMateri = await this.loadUserMateri(user.userId);
          const incompleteTugas = [];

          for (const key of Object.keys(userLastMateri)) {
            if (!key.startsWith('tugas_')) {
              continue;
            }

            const tugasList = userLastMateri[key];
            for (const tugas of tugasList) {
              if (!tugas.isSubmitted && tugas.title) {
                incompleteTugas.push({
                  ...tugas,
                  materiId: key.replace('tugas_', ''),
                });
              }
            }
          }

          if (incompleteTugas.length > 0) {
            await this.notifier.sendTugasReminder(user.userId, incompleteTugas);
          }
        } catch (error) {
          this.logger.error(`Error checking tugas reminder for ${user.nim}:`, error);
        }

        await this.delay(1500);
      }
    } catch (error) {
      this.logger.error('Failed to check tugas reminders:', error);
    }
  }

  async processNewMateri(user, makul, materi, simaClient) {
    try {
      this.logger.info(`Processing new materi: ${materi.title}`);

      await this.notifier.sendNewMateriNotification(user.userId, makul, materi);

      if (materi.isManual) {
        this.logger.info('Manual attendance by lecturer, skipping auto-absen');
        return { success: false, verified: false, reason: 'manual' };
      }

      if (!materi.isActive) {
        this.logger.info('Attendance period ended, skipping');
        return { success: false, verified: false, reason: 'inactive' };
      }

      if (!materi.links?.diskusi) {
        this.logger.warn('No diskusi link found, cannot auto-absen');
        return { success: false, verified: false, reason: 'no_link' };
      }

      await this.delay(2000);
      const absenResult = await simaClient.absenMateri(materi.links.diskusi);
      if (!absenResult.success) {
        return { success: false, verified: false, reason: 'request_failed' };
      }

      await this.delay(3500);

      if (!materi.links?.kehadiran) {
        await this.userManager.incrementStats(user.userId, 'totalAbsences');
        await this.notifier.sendAbsenceUnverified(user.userId, makul, materi);
        return { success: true, verified: false };
      }

      let kehadiranCheck = null;
      const maxVerificationAttempts = 4;

      for (let attempt = 1; attempt <= maxVerificationAttempts; attempt += 1) {
        this.logger.info(`Verifying attendance for ${materi.title} (${attempt}/${maxVerificationAttempts})`);

        kehadiranCheck = await simaClient.cekKehadiran(materi.links.kehadiran, user.nim);
        if (kehadiranCheck.isPresent) {
          await this.userManager.incrementStats(user.userId, 'totalAbsences');
          await this.notifier.sendAbsenceSuccess(
            user.userId,
            makul,
            materi,
            kehadiranCheck.timestamp
          );

          return { success: true, verified: true };
        }

        if (attempt < maxVerificationAttempts) {
          await this.delay(5000);
        }
      }

      await this.notifier.sendAbsenceUnverified(user.userId, makul, materi);
      return { success: true, verified: false };
    } catch (error) {
      this.logger.error(`Failed to process materi ${materi.title}:`, error);
      await this.notifier.sendError(
        user.userId,
        `Gagal memproses materi "${materi.title}": ${error.message}`
      );
      return { success: false, verified: false, reason: 'error', error: error.message };
    }
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default SchedulerService;
