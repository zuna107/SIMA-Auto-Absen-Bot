import axios from 'axios';
import * as cheerio from 'cheerio';
import Tesseract from 'tesseract.js';
import http from 'http';
import https from 'https';
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
      // HTTP Keep-Alive untuk reuse connections
      httpAgent: new http.Agent({ 
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 50,
        maxFreeSockets: 10,
      }),
      httpsAgent: new https.Agent({ 
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 50,
        maxFreeSockets: 10,
      }),
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Add axios interceptor to capture cookies from all requests
    this.axiosInstance.interceptors.response.use(
      (response) => {
        if (response.headers['set-cookie']) {
          const newCookies = this.parseCookies(response.headers['set-cookie']);
          this.cookies = { ...this.cookies, ...newCookies };
        }
        return response;
      },
      (error) => {
        if (error.response && error.response.headers['set-cookie']) {
          const newCookies = this.parseCookies(error.response.headers['set-cookie']);
          this.cookies = { ...this.cookies, ...newCookies };
        }
        return Promise.reject(error);
      }
    );
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

  extractStudentName($, nim) {
    try {
      // Method 1: Extract from logo-normal div structure
      const logoNormal = $('.logo-normal, .simple-text.logo-normal');
      if (logoNormal.length > 0) {
        const divContent = logoNormal.find('div font');
        if (divContent.length > 0) {
          const text = divContent.text().trim();
          const parts = text.split(nim);
          if (parts.length > 1) {
            const name = parts[1].trim();
            if (name && name.length > 3) {
              this.logger.info('Student name extracted:', name);
              return name;
            }
          }
        }
      }

      // Method 2: Look for profile section with NIM
      const profileText = $('body').text();
      const nimIndex = profileText.indexOf(nim);
      if (nimIndex !== -1) {
        const afterNim = profileText.substring(nimIndex + nim.length, nimIndex + nim.length + 100);
        const lines = afterNim.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 0 && lines[0].length > 3) {
          const name = lines[0].trim();
          this.logger.info('Student name extracted (method 2):', name);
          return name;
        }
      }

      // Method 3: Look for common patterns near NIM
      let foundName = null;
      $('div, span, font').each((i, el) => {
        const text = $(el).text().trim();
        if (text.includes(nim)) {
          const parts = text.split(nim);
          if (parts.length > 1) {
            const potentialName = parts[1].trim().split('\n')[0].trim();
            if (potentialName.length > 3 && potentialName.length < 50) {
              this.logger.info('Student name extracted (method 3):', potentialName);
              foundName = potentialName;
              return false;
            }
          }
        }
      });
      
      if (foundName) return foundName;

      this.logger.warn('Could not extract student name from page');
      return null;
    } catch (error) {
      this.logger.error('Error extracting student name:', error);
      return null;
    }
  }

  async login(nim, password, retries = 3, timeoutMs = 25000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      let startTime = Date.now();
      
      try {
        this.logger.info(`Login attempt ${attempt}/${retries} for NIM: ${nim}`);
        this.cookies = {};

        // Step 1: Get initial session with proper URL parameter
        await this.delay(1000);
        const initResponse = await this.axiosInstance.get(config.sima.loginUrl);
        
        this.logger.debug('Session cookies obtained:', Object.keys(this.cookies).join(', '));

        // Step 2: Get FCKING CAPTCHA image
        await this.delay();
        const captchaResponse = await this.axiosInstance.get(
          config.sima.captchaUrl,
          {
            headers: { Cookie: this.getCookieString() },
            responseType: 'arraybuffer',
          }
        );

        // Step 3: Solve FCKING CAPTCHA BRO
        const captchaAnswer = await this.solveCaptcha(captchaResponse.data);
        this.logger.success(`CAPTCHA solved: ${captchaAnswer}`);

        // Step 4: Submit login with proper URL
        await this.delay(1000);
        const loginPayload = new URLSearchParams({
          txUser: nim,
          txPass: password,
          kdc: captchaAnswer.toString(),
        });

        // Use the full URL with parameter
        const loginUrl = `${config.sima.baseUrl}/cekadm.php?l=${config.sima.baseUrl}`;
        
        const loginResponse = await this.axiosInstance.post(
          loginUrl,
          loginPayload.toString(),
          {
            headers: {
              Cookie: this.getCookieString(),
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': config.sima.loginUrl,
            },
            maxRedirects: 10,
            validateStatus: (status) => status < 400,
          }
        );

        this.logger.debug('Login response URL:', loginResponse.request.res.responseUrl || loginUrl);
        this.logger.debug('Login response status:', loginResponse.status);

        // Step 5: Verify login
        const $ = cheerio.load(loginResponse.data);
        
        // Check for error messages
        const errorMsg = $('.alert-danger, .error, .alert').text().trim();
        if (errorMsg && (
          errorMsg.toLowerCase().includes('salah') ||
          errorMsg.toLowerCase().includes('gagal') ||
          errorMsg.toLowerCase().includes('error')
        )) {
          this.logger.warn('Error message found:', errorMsg);
          throw new Error('NIM atau password salah');
        }

        // Better login verification
        const finalUrl = loginResponse.request.res.responseUrl || loginUrl;
        const pageTitle = $('title').text().toLowerCase();
        const bodyText = $('body').text().toLowerCase();
        
        const isLoggedIn = 
          finalUrl.includes('index.php') ||
          finalUrl.includes('/kuliah/') ||
          pageTitle.includes('dashboard') ||
          bodyText.includes('dashboard') ||
          bodyText.includes('selamat datang') ||
          $('a[href*="logout"]').length > 0 ||
          $('.user-panel').length > 0;

        if (isLoggedIn) {
          const elapsedTime = Date.now() - startTime;
          this.logger.success(`Login successful for NIM: ${nim} (${elapsedTime}ms)`);
          
          // Extract student name
          const studentName = this.extractStudentName($, nim);
          
          return {
            success: true,
            cookies: this.cookies,
            message: 'Login berhasil',
            studentName: studentName,
            elapsedTime,
          };
        }

        this.logger.debug('Page title:', pageTitle);
        this.logger.debug('Has logout link:', $('a[href*="logout"]').length > 0);
        this.logger.debug('Response length:', loginResponse.data.length);

        throw new Error('Login verification failed - tidak ditemukan indikator login sukses');

      } catch (error) {
        const elapsedTime = Date.now() - startTime;
        this.logger.warn(
          `Login attempt ${attempt} failed (${elapsedTime}ms):`, 
          error.message
        );
        
        // Check if timeout exceeded
        if (elapsedTime >= timeoutMs) {
          return {
            success: false,
            error: 'Login timeout - server took too long to respond',
          };
        }
        
        if (attempt === retries) {
          return {
            success: false,
            error: error.message || 'Login failed after all retries',
          };
        }

        await this.delay(2000);
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
          tugasId: tugasLink ? tugasLink.replace('?t=', '') : null,
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

        // Extract berkas/files
        const berkasLinks = [];
        $element.find('.form-group').each((_, group) => {
          const $group = $(group);
          const label = $group.find('label').text().trim();
          
          if (label.includes('Berkas')) {
            $group.find('a[href*="materi_view.php"]').each((_, link) => {
              const $link = $(link);
              const href = $link.attr('href');
              const filename = $link.text().trim();
              
              if (href && filename) {
                berkasLinks.push({
                  filename,
                  url: `${config.sima.baseUrl}/kuliah/${href}`,
                });
              }
            });
          }
        });

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
          berkas: berkasLinks,
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

  async fetchTugas(tugasId) {
    try {
      this.logger.info(`Fetching tugas for ID: ${tugasId}`);
      
      await this.delay();
      const url = `${config.sima.elearningUrl}?t=${tugasId}`;
      const response = await this.axiosInstance.get(url, {
        headers: { Cookie: this.getCookieString() },
      });

      const $ = cheerio.load(response.data);
      const tugasList = [];

      $('.room-box').each((i, element) => {
        const $element = $(element);
        const title = $element.find('h4.text-primary b').text().trim();
        
        if (!title) return;

        // Extract soal/perintah
        const soal = $element.find('.form-group')
          .filter((_, el) => $(el).find('label').text().includes('Soal/Perintah'))
          .find('.controls')
          .text()
          .trim();

        // Extract waktu
        const waktu = $element.find('.form-group')
          .filter((_, el) => $(el).find('label').text().includes('Waktu'))
          .find('.controls')
          .text()
          .trim();

        // Check if already submitted
        const hasJawaban = $element.find('a[href*="materi_view.php?j=tj"]').length > 0;
        const hasFormJawabUlang = $element.find('button').text().includes('Form Jawab Ulang');
        const isSubmitted = hasJawaban || hasFormJawabUlang;

        // Extract nilai if available
        let nilai = null;
        $element.find('.form-group').each((_, group) => {
          const $group = $(group);
          const label = $group.find('label').text().trim();
          
          if (label.includes('Nilai')) {
            const nilaiText = $group.find('.controls p').text().trim();
            if (nilaiText && !isNaN(nilaiText)) {
              nilai = parseInt(nilaiText);
            }
          }
        });

        // Extract tugas ID from hidden input
        const tugasIdInput = $element.find('input[name="txTugasID"]').attr('value');

        const isActive = waktu.toLowerCase().includes('aktif') || 
                        !waktu.toLowerCase().includes('selesai');

        const tugas = {
          id: tugasIdInput || null,
          title,
          soal,
          waktu,
          isActive,
          isSubmitted,
          nilai,
          timestamp: new Date().toISOString(),
        };

        tugasList.push(tugas);
      });

      this.logger.success(
        `Found ${tugasList.length} tugas ` +
        `(${tugasList.filter(t => !t.isSubmitted && t.isActive).length} pending)`
      );
      return tugasList;

    } catch (error) {
      this.logger.error('Failed to fetch tugas:', error);
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
      
      let isPresent = false;
      let timestamp = null;
      let nama = null;

      // Method 1: Standard table with td elements
      $('table tr').each((i, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        
        if (cells.length > 0) {
          const cellTexts = [];
          cells.each((j, cell) => {
            cellTexts.push($(cell).text().trim());
          });
          
          const nimIndex = cellTexts.findIndex(text => text.includes(nim));
          
          if (nimIndex !== -1) {
            isPresent = true;
            nama = cellTexts[nimIndex + 1] || cellTexts[1] || null;
            
            if (cellTexts.length >= 3) {
              for (let j = 2; j < cellTexts.length; j++) {
                if (cellTexts[j].match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/)) {
                  timestamp = cellTexts[j];
                  break;
                }
              }
              if (!timestamp) {
                timestamp = cellTexts[cellTexts.length - 1];
              }
            }
            
            this.logger.debug(`Found NIM ${nim} in row:`, cellTexts.join(' | '));
            return false;
          }
        }
      });

      // Method 2: Fallback
      if (!isPresent) {
        const tableText = $('table').text();
        if (tableText.includes(nim)) {
          isPresent = true;
          this.logger.debug('NIM found in table text but not parsed properly');
          
          const timestampMatch = tableText.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
          if (timestampMatch) {
            timestamp = timestampMatch[1];
          }
        }
      }

      if (!isPresent) {
        this.logger.debug('Table HTML structure:', $('table').html()?.substring(0, 500));
      }

      this.logger.info(
        `Attendance status for ${nim}: ${isPresent ? 'Present ✓' : 'Absent ✗'}` +
        (timestamp ? ` at ${timestamp}` : '')
      );
      
      return {
        isPresent,
        timestamp,
        nama,
      };

    } catch (error) {
      this.logger.error('Failed to check kehadiran:', error);
      throw error;
    }
  }
}

export default SIMAClient;