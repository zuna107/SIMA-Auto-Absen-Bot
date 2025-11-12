import fs from 'fs/promises';
import path from 'path';
import config from '../config.js';

class Logger {
  constructor(context = 'SYSTEM') {
    this.context = context;
    this.logsDir = config.paths.logs;
  }

  async ensureLogDirectory() {
    try {
      await fs.mkdir(this.logsDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.error('Failed to create logs directory:', error);
      }
    }
  }

  getTimestamp() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').split('.')[0];
  }

  getDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  formatMessage(level, message, data = null) {
    const timestamp = this.getTimestamp();
    const prefix = `[${timestamp}] [${level}] [${this.context}]`;
    
    let formattedMessage = `${prefix} ${message}`;
    
    if (data) {
      if (data instanceof Error) {
        formattedMessage += `\n  Error: ${data.message}\n  Stack: ${data.stack}`;
      } else if (typeof data === 'object') {
        formattedMessage += `\n  Data: ${JSON.stringify(data, null, 2)}`;
      } else {
        formattedMessage += `\n  Data: ${data}`;
      }
    }
    
    return formattedMessage;
  }

  async writeToFile(level, message, data = null) {
    try {
      await this.ensureLogDirectory();
      
      const dateStr = this.getDateString();
      const filename = `${dateStr}.log`;
      const filepath = path.join(this.logsDir, filename);
      
      const formattedMessage = this.formatMessage(level, message, data);
      
      await fs.appendFile(filepath, formattedMessage + '\n', 'utf-8');
      
      // Clean old logs
      await this.cleanOldLogs();
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }

  async cleanOldLogs() {
    try {
      const files = await fs.readdir(this.logsDir);
      const now = Date.now();
      const maxAge = config.logging.maxLogFiles * 24 * 60 * 60 * 1000;
      
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        
        const filepath = path.join(this.logsDir, file);
        const stats = await fs.stat(filepath);
        const age = now - stats.mtime.getTime();
        
        if (age > maxAge) {
          await fs.unlink(filepath);
          console.log(`Deleted old log file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Failed to clean old logs:', error);
    }
  }

  log(level, message, data = null, color = '') {
    const formattedMessage = this.formatMessage(level, message, data);
    
    if (color) {
      console.log(`${color}${formattedMessage}\x1b[0m`);
    } else {
      console.log(formattedMessage);
    }
    
    // Write to file asynchronously
    this.writeToFile(level, message, data).catch(console.error);
  }

  info(message, data = null) {
    this.log('INFO', message, data, '\x1b[36m'); // Cyan
  }

  success(message, data = null) {
    this.log('SUCCESS', message, data, '\x1b[32m'); // Green
  }

  warn(message, data = null) {
    this.log('WARN', message, data, '\x1b[33m'); // Yellow
  }

  error(message, data = null) {
    this.log('ERROR', message, data, '\x1b[31m'); // Red
  }

  debug(message, data = null) {
    if (config.dev) {
      this.log('DEBUG', message, data, '\x1b[35m'); // Magenta
    }
  }
}

export default Logger;