import axios from 'axios';
import * as cheerio from 'cheerio';
import Tesseract from 'tesseract.js';
import config from '../config.js';
import Logger from '../utils/logger.js';

class SIMAClient {
  constructor(cookies = null) {
    this.logger = new Logger('SIMAClient');
    this.cookies = cookies;
    this.userAgent = this.getRandomUserAgent();
    
    this.axiosInstance = axios.create({
      timeout: config.sima.timeout,
      maxRedirects: config.request.maxRedirects,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });
  }

  getRandomUserAgent() {
    const agents = config.request.userAgents;
    return agents[Math.floor(Math.random() * agents.length)];
  }

  async delay(ms = null) {
    const delayTime = ms || 
      Math.random() * (config.request.delays.max - config.request.delays.min) + 
      config.request.delays.min;
    
    return new Promise(resolve => setTimeout(resolve, delayTime));
  }

  parseCookies(setCookieHeaders) {
    if (!setCookieHeaders) return {};
    
    const cookies = {};
    const headers = Array.isArray(setCookieHeaders) 
      ? setCookieHeaders 
      : [setCookieHeaders];
    
    headers.forEach(header => {
      const parts = header.split(';')[0].split('=');
      if (parts.length === 2) {
        cookies[parts[0].trim()] = parts[1].trim();
      }
    });
    
    return cookies;
  }

  getCookieString() {
    if (!this.cookies) return '';
    return Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  async solveCaptcha(imageBuffer) {
    try {
      this.logger.info('Solving CAPTCHA...');

      const { data: { text } } = await Tesseract.recognize(
        imageBuffer,
        'eng',
        {
          logger: () => {}, // Suppress tesseract logs
        }
      );

      let cleanText = text.trim()
        .replace(/×/g, 'x')
        .replace(/X/g, 'x')
        .replace(/\s+/g, '');

      this.logger.debug('OCR result:', cleanText);

      // Try to parse the math expression
      const match = cleanText.match(/(\d+)\s*([+\-xX*])\s*(\d+)/);

      if (!match) {
        // Fallback for single digit operations
        if (cleanText.length === 3 && 
            /\d/.test(cleanText[0]) && 
            /\d/.test(cleanText[2])) {
          const a = parseInt(cleanText[0]);
          const op = cleanText[1];
          const b = parseInt(cleanText[2]);
          return this.calculateCaptcha(a, op, b);
        }
        throw new Error(`Failed to parse CAPTCHA: ${cleanText}`);
      }

      const a = parseInt(match[1]);
      const op = match[2];
      const b = parseInt(match[3]);

      return this.calculateCaptcha(a, op, b);
    } catch (error) {
      this.logger.error('CAPTCHA solve failed:', error);
      throw new Error(`CAPTCHA solve error: ${error.message}`);
    }
  }

  calculateCaptcha(a, operator, b) {
    switch (operator) {
      case 'x':
      case 'X':
      case '*':
        return a * b;
      case '+':
        return a + b;
      case '-':
        return a - b;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }

  async login(nim, password, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.logger.info(`Login attempt ${attempt}/${retries} for NIM: ${nim}`);

        // Step 1: Get initial session
        await this.delay();
        const initResponse = await this.axiosInstance.get(config.sima.loginUrl);
        
        this.cookies = this.parseCookies(initResponse.headers['set-cookie']);
        this.logger.debug('Session cookies obtained');

        // Step 2: Get CAPTCHA image
        await this.delay();
        const captchaResponse = await this.axiosInstance.get(
          config.sima.captchaUrl,
          {
            headers: { Cookie: this.getCookieString() },
            responseType: 'arraybuffer',
          }
        );

        // Step 3: Solve CAPTCHA
        const captchaAnswer = await this.solveCaptcha(captchaResponse.data);
        this.logger.success(`CAPTCHA solved: ${captchaAnswer}`);

        // Step 4: Submit login
        await this.delay();
        const loginPayload = new URLSearchParams({
          txUser: nim,
          txPass: password,
          kdc: captchaAnswer.toString(),
        });

        const loginResponse = await this.axiosInstance.post(
          config.sima.loginCheckUrl,
          loginPayload,
          {
            headers: {
              Cookie: this.getCookieString(),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            maxRedirects: 0,
            validateStatus: (status) => status < 400,
          }
        );

        // Update cookies
        const newCookies = this.parseCookies(loginResponse.headers['set-cookie']);
        this.cookies = { ...this.cookies, ...newCookies };

        // Step 5: Verify login
        const $ = cheerio.load(loginResponse.data);
        
        // Check for error messages
        const errorMsg = $('.alert-danger, .error').text().trim();
        if (errorMsg && errorMsg.toLowerCase().includes('salah')) {
          throw new Error('NIM atau password salah');
        }

        // Check if redirected to dashboard
        if (loginResponse.request.res.responseUrl?.includes('index.php') || 
            loginResponse.data.includes('Dashboard') ||
            $('title').text().includes('Dashboard')) {
          
          this.logger.success(`Login successful for NIM: ${nim}`);
          
          return {
            success: true,
            cookies: this.cookies,
            message: 'Login berhasil',
          };
        }

        throw new Error('Login verification failed');

      } catch (error) {
        this.logger.warn(`Login attempt ${attempt} failed:`, error.message);
        
        if (attempt === retries) {
          return {
            success: false,
            error: error.message || 'Login failed after all retries',
          };
        }

        await this.delay(config.scheduler.retryDelay);
      }
    }

    return {
      success: false,
      error: 'Maximum login attempts reached',
    };
  }

  async fetchMakul() {
    try {
      this.logger.info('Fetching mata kuliah list...');
      
      await this.delay();
      const response = await this.axiosInstance.get(
        config.sima.elearningUrl,
        {
          headers: { Cookie: this.getCookieString() },
        }
      );

      const $ = cheerio.load(response.data);
      const makulList = [];

      $('.room-box').each((i, element) => {
        const $element = $(element);
        const title = $element.find('h4.text-primary b').text().trim();
        
        if (!title) return;

        const parts = title.split('|').map(s => s.trim());
        const dosenInfo = $element.find('name').text().trim();
        const contactInfo = $element.find('p.message').first().text().trim();
        
        // Extract button links
        const materiLink = $element.find('a[href*="?m="]').attr('href');
        const tugasLink = $element.find('a[href*="?t="]').attr('href');
        const diskusiLink = $element.find('a[href*="?dk="]').attr('href');
        
        const makul = {
          semester: parts[0] || '',
          kode: parts[1] || '',
          nama: parts[2] || '',
          sks: parts[3] || '',
          kelas: parts[4] || '',
          dosen: dosenInfo,
          kontak: contactInfo,
          links: {
            materi: materiLink ? `${config.sima.elearningUrl}${materiLink}` : null,
            tugas: tugasLink ? `${config.sima.elearningUrl}${tugasLink}` : null,
            diskusi: diskusiLink ? `${config.sima.elearningUrl}${diskusiLink}` : null,
          },
          materiId: materiLink ? materiLink.replace('?m=', '') : null,
        };

        makulList.push(makul);
      });

      this.logger.success(`Found ${makulList.length} mata kuliah`);
      return makulList;

    } catch (error) {
      this.logger.error('Failed to fetch makul:', error);
      throw error;
    }
  }

  async fetchMateri(materiId) {
    try {
      this.logger.info(`Fetching materi for ID: ${materiId}`);
      
      await this.delay();
      const url = `${config.sima.elearningUrl}?m=${materiId}`;
      const response = await this.axiosInstance.get(url, {
        headers: { Cookie: this.getCookieString() },
      });

      const $ = cheerio.load(response.data);
      const materiList = [];

      $('.room-box').each((i, element) => {
        const $element = $(element);
        const title = $element.find('h4.text-primary b').text().trim();
        
        if (!title) return;

        const bahasan = $element.find('.form-group')
          .filter((_, el) => $(el).find('label').text().includes('Bahasan'))
          .find('.controls')
          .text()
          .trim();

        const waktuKehadiran = $element.find('.form-group')
          .filter((_, el) => $(el).find('label').text().includes('Waktu Kehadiran'))
          .find('.controls')
          .text()
          .trim();

        const waktuDiskusi = $element.find('.form-group')
          .filter((_, el) => $(el).find('label').text().includes('Waktu Diskusi'))
          .find('.controls')
          .text()
          .trim();

        const diskusiLink = $element.find('a[href*="?dm="]').attr('href');
        const kehadiranLink = $element.find('a[href*="materi_hadir.php"]').attr('href');

        const isManual = waktuKehadiran.toLowerCase().includes('manual');
        const isActive = !waktuKehadiran.toLowerCase().includes('selesai');

        const materi = {
          id: diskusiLink ? diskusiLink.replace('?dm=', '') : null,
          title,
          bahasan,
          waktuKehadiran,
          waktuDiskusi,
          isManual,
          isActive,
          links: {
            diskusi: diskusiLink ? `${config.sima.elearningUrl}${diskusiLink}` : null,
            kehadiran: kehadiranLink ? `${config.sima.baseUrl}/kuliah/${kehadiranLink}` : null,
          },
          timestamp: new Date().toISOString(),
        };

        materiList.push(materi);
      });

      this.logger.success(`Found ${materiList.length} materi`);
      return materiList;

    } catch (error) {
      this.logger.error('Failed to fetch materi:', error);
      throw error;
    }
  }

  async absenMateri(diskusiUrl) {
    try {
      this.logger.info(`Attending materi: ${diskusiUrl}`);
      
      await this.delay();
      const response = await this.axiosInstance.get(diskusiUrl, {
        headers: { Cookie: this.getCookieString() },
      });

      // Just accessing the discussion page should register attendance
      const $ = cheerio.load(response.data);
      const pageTitle = $('h4.text-primary b').text().trim();

      this.logger.success(`Successfully accessed discussion page: ${pageTitle}`);
      
      return {
        success: true,
        message: 'Berhasil absen',
        pageTitle,
      };

    } catch (error) {
      this.logger.error('Failed to absen materi:', error);
      throw error;
    }
  }

  async cekKehadiran(kehadiranUrl, nim) {
    try {
      this.logger.info(`Checking attendance: ${kehadiranUrl}`);
      
      await this.delay();
      const response = await this.axiosInstance.get(kehadiranUrl, {
        headers: { Cookie: this.getCookieString() },
      });

      const $ = cheerio.load(response.data);
      
      // Find the row with the NIM
      let isPresent = false;
      let timestamp = null;

      $('table tr').each((i, row) => {
        const $row = $(row);
        const nimCell = $row.find('td').eq(0).text().trim();
        
        if (nimCell === nim) {
          isPresent = true;
          timestamp = $row.find('td').eq(2).text().trim();
          return false; // break
        }
      });

      this.logger.info(`Attendance status for ${nim}: ${isPresent ? 'Present' : 'Absent'}`);
      
      return {
        isPresent,
        timestamp,
      };

    } catch (error) {
      this.logger.error('Failed to check kehadiran:', error);
      throw error;
    }
  }
}

export default SIMAClient;