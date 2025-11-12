import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// Import handlers
import CommandHandler from './handlers/commandsHandler.js';
import SchedulerService from './services/scheduler.js';
import Logger from './utils/logger.js';
import configData from './config.js';

// ES Module __dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
config();

class AbsenBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.config = configData;
    this.logger = new Logger();
    this.commandHandler = new CommandHandler(this.client);
    this.scheduler = null;
  }

  async init() {
    try {
      this.logger.info('Initializing Absen Bot...');

      // Ensure directories exist
      await this.ensureDirectories();

      // Setup event listeners
      this.setupEventListeners();

      // Load commands
      await this.commandHandler.loadCommands();

      // Login to Discord
      await this.client.login(process.env.DISCORD_TOKEN);

      this.logger.success('Bot initialized successfully!');
    } catch (error) {
      this.logger.error('Failed to initialize bot:', error);
      process.exit(1);
    }
  }

  async ensureDirectories() {
    const dirs = [
      './public',
      './public/global',
      './public/logs',
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }

    // Ensure JSON files exist
    const files = {
      './public/user.json': '{}',
      './public/lastMateri.json': '{}',
    };

    for (const [file, defaultContent] of Object.entries(files)) {
      try {
        await fs.access(file);
      } catch {
        await fs.writeFile(file, defaultContent, 'utf-8');
      }
    }

    this.logger.info('Directory structure verified');
  }

  setupEventListeners() {
    // Ready event
    this.client.once(Events.ClientReady, async (client) => {
      this.logger.success(`✓ Logged in as ${client.user.tag}`);
      
      // Set bot status
      client.user.setPresence({
        activities: [{ name: 'SIMA Attendance', type: ActivityType.Watching }],
        status: 'online',
      });

      // Register slash commands
      await this.commandHandler.registerCommands();

      // Leave all guilds (bot hanya untuk User Install)
      await this.leaveAllGuilds();

      // Start scheduler
      this.scheduler = new SchedulerService(this.client);
      await this.scheduler.start();

      this.logger.success('Bot is ready and scheduler started!');
    });

    // Interaction handler
    this.client.on(Events.InteractionCreate, async (interaction) => {
      try {
        await this.commandHandler.handleInteraction(interaction);
      } catch (error) {
        this.logger.error('Interaction error:', error);
        
        const errorMessage = {
          content: '❌ Terjadi kesalahan saat memproses perintah.',
          ephemeral: true,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
    });

    // Guild create event - auto leave
    this.client.on(Events.GuildCreate, async (guild) => {
      this.logger.warn(`Bot added to guild: ${guild.name} (${guild.id})`);
      this.logger.info('Leaving guild...');
      
      try {
        await guild.leave();
        this.logger.success(`Left guild: ${guild.name}`);
      } catch (error) {
        this.logger.error('Failed to leave guild:', error);
      }
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      this.logger.error('Discord client error:', error);
    });

    process.on('unhandledRejection', (error) => {
      this.logger.error('Unhandled promise rejection:', error);
    });

    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async leaveAllGuilds() {
    const guilds = this.client.guilds.cache;
    
    if (guilds.size === 0) {
      this.logger.info('No guilds to leave');
      return;
    }

    this.logger.info(`Found ${guilds.size} guild(s), leaving all...`);

    for (const guild of guilds.values()) {
      try {
        await guild.leave();
        this.logger.success(`Left guild: ${guild.name} (${guild.id})`);
      } catch (error) {
        this.logger.error(`Failed to leave guild ${guild.name}:`, error);
      }
    }
  }

  async shutdown() {
    this.logger.info('Shutting down bot...');

    if (this.scheduler) {
      await this.scheduler.stop();
    }

    await this.client.destroy();
    this.logger.success('Bot shutdown complete');
    process.exit(0);
  }
}

// Start the bot
const bot = new AbsenBot();
bot.init().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export default AbsenBot;