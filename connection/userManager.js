import fs from 'fs/promises';
import crypto from 'crypto';
import config from '../config.js';
import Logger from '../utils/logger.js';

class UserManager {
  constructor() {
    this.logger = new Logger('UserManager');
    this.usersPath = config.paths.users;
    this.encryptionKey = this.deriveKey(config.security.encryptionKey);
  }

  deriveKey(password) {
    // Derive a 32-byte key from the password
    return crypto.scryptSync(password, 'salt', 32);
  }

  encrypt(text) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        config.security.encryptionAlgorithm,
        this.encryptionKey,
        iv
      );

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      return {
        iv: iv.toString('hex'),
        encryptedData: encrypted,
        authTag: authTag.toString('hex'),
      };
    } catch (error) {
      this.logger.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  decrypt(encryptedObj) {
    try {
      const decipher = crypto.createDecipheriv(
        config.security.encryptionAlgorithm,
        this.encryptionKey,
        Buffer.from(encryptedObj.iv, 'hex')
      );

      decipher.setAuthTag(Buffer.from(encryptedObj.authTag, 'hex'));

      let decrypted = decipher.update(encryptedObj.encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  async loadUsers() {
    try {
      const data = await fs.readFile(this.usersPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      this.logger.error('Failed to load users:', error);
      throw error;
    }
  }

  async saveUsers(users) {
    try {
      await fs.writeFile(
        this.usersPath,
        JSON.stringify(users, null, 2),
        'utf-8'
      );
    } catch (error) {
      this.logger.error('Failed to save users:', error);
      throw error;
    }
  }

  async getUser(userId) {
    try {
      const users = await this.loadUsers();
      const userData = users[userId];

      if (!userData) {
        return null;
      }

      // Decrypt sensitive data
      return {
        ...userData,
        password: this.decrypt(userData.encryptedPassword),
        cookies: userData.encryptedCookies 
          ? this.decrypt(userData.encryptedCookies) 
          : null,
      };
    } catch (error) {
      this.logger.error(`Failed to get user ${userId}:`, error);
      throw error;
    }
  }

  async saveUser(userData) {
    try {
      const users = await this.loadUsers();

      // Encrypt sensitive data
      const encryptedData = {
        userId: userData.userId,
        username: userData.username,
        nim: userData.nim,
        encryptedPassword: this.encrypt(userData.password),
        encryptedCookies: userData.cookies 
          ? this.encrypt(JSON.stringify(userData.cookies)) 
          : null,
        isActive: userData.isActive !== undefined ? userData.isActive : true,
        registeredAt: userData.registeredAt || new Date().toISOString(),
        lastLogin: userData.lastLogin || new Date().toISOString(),
        lastCheck: userData.lastCheck || null,
        stats: userData.stats || {
          totalChecks: 0,
          totalAbsences: 0,
          failedAttempts: 0,
        },
      };

      users[userData.userId] = encryptedData;
      await this.saveUsers(users);

      this.logger.success(`User saved: ${userData.nim} (${userData.userId})`);
      return true;
    } catch (error) {
      this.logger.error('Failed to save user:', error);
      throw error;
    }
  }

  async updateUser(userId, updates) {
    try {
      const user = await this.getUser(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      const updatedUser = { ...user, ...updates };
      await this.saveUser(updatedUser);

      this.logger.info(`User updated: ${userId}`);
      return updatedUser;
    } catch (error) {
      this.logger.error(`Failed to update user ${userId}:`, error);
      throw error;
    }
  }

  async deleteUser(userId) {
    try {
      const users = await this.loadUsers();
      
      if (!users[userId]) {
        throw new Error('User not found');
      }

      delete users[userId];
      await this.saveUsers(users);

      this.logger.success(`User deleted: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete user ${userId}:`, error);
      throw error;
    }
  }

  async getAllUsers() {
    try {
      const users = await this.loadUsers();
      const userList = [];

      for (const userId in users) {
        const userData = await this.getUser(userId);
        userList.push(userData);
      }

      return userList;
    } catch (error) {
      this.logger.error('Failed to get all users:', error);
      throw error;
    }
  }

  async getActiveUsers() {
    try {
      const allUsers = await this.getAllUsers();
      return allUsers.filter(user => user.isActive);
    } catch (error) {
      this.logger.error('Failed to get active users:', error);
      throw error;
    }
  }

  async updateCookies(userId, cookies) {
    try {
      return await this.updateUser(userId, { 
        cookies,
        lastLogin: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Failed to update cookies for ${userId}:`, error);
      throw error;
    }
  }

  async incrementStats(userId, statType) {
    try {
      const user = await this.getUser(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      const stats = user.stats || {
        totalChecks: 0,
        totalAbsences: 0,
        failedAttempts: 0,
      };

      stats[statType] = (stats[statType] || 0) + 1;

      await this.updateUser(userId, { stats });
      
      return stats;
    } catch (error) {
      this.logger.error(`Failed to increment stats for ${userId}:`, error);
      throw error;
    }
  }
}

export default UserManager;