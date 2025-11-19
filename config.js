import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const config = {
  // Discord configuration
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID || 'your_client_id',
  ownerId: process.env.OWNER_ID || 'your_discord_id',

  // File paths
  paths: {
    users: './public/user.json',
    lastMateri: './public/lastMateri.json',
    makul: './public/global/makul.json',
    materi: './public/global/materi.json',
    logs: './public/logs',
  },

  // SIMA configuration
  sima: {
    baseUrl: 'https://sima.unsiq.ac.id',
    loginUrl: 'https://sima.unsiq.ac.id/login.php?l=https://sima.unsiq.ac.id/index.php',
    captchaUrl: 'https://sima.unsiq.ac.id/gen_cap.php',
    loginCheckUrl: 'https://sima.unsiq.ac.id/cekadm.php?l=https://sima.unsiq.ac.id',
    elearningUrl: 'https://sima.unsiq.ac.id/kuliah/',
    timeout: 30000,
  },

  // Scheduler configuration
  scheduler: {
    interval: 10,
    cronExpression: '*/10 * * * *',
    maxRetries: 3,
    retryDelay: 5000,
  },

  // Request configuration
  request: {
    timeout: 30000,
    maxRedirects: 5,
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
    delays: {
      min: 1000,
      max: 3000,
      betweenRequests: 2000,
    },
  },

  // Security configuration
  security: {
    encryptionAlgorithm: 'aes-256-gcm',
    encryptionKey: process.env.ENCRYPTION_KEY || 'default-key-change-this-in-production',
    saltRounds: 10,
    sessionTimeout: 3600000,
  },

  // OCR configuration
  ocr: {
    language: 'eng',
    psm: 7, // Single text line mode
    oem: 3, // Default OCR Engine Mode
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    logPrefix: '[ABSEN BOT]',
    dateFormat: 'YYYY-MM-DD HH:mm:ss',
    maxLogFiles: 1,
  },

  // Discord embed colors
  colors: {
    success: null,
    error: 0xff0000,
    warning: null,
    info: null,
    primary: null,
  },

  // Development mode
  dev: process.env.NODE_ENV !== 'production',
};

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'CLIENT_ID'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please create a .env file with the required variables.');
  process.exit(1);
}

export default config;
