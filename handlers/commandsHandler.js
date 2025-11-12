import { REST, Routes, Collection } from 'discord.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import config from '../config.js';
import Logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class CommandHandler {
  constructor(client) {
    this.client = client;
    this.commands = new Collection();
    this.logger = new Logger('CommandHandler');
  }

  async loadCommands() {
    try {
      const commandsPath = join(__dirname, '../commands');
      const commandFiles = await fs.readdir(commandsPath);
      const jsFiles = commandFiles.filter(file => file.endsWith('.js'));

      this.logger.info(`Loading ${jsFiles.length} command(s)...`);

      for (const file of jsFiles) {
        const filePath = join(commandsPath, file);
        const { default: command } = await import(`file://${filePath}`);

        if ('data' in command && 'execute' in command) {
          this.commands.set(command.data.name, command);
          this.logger.success(`✓ Loaded: ${command.data.name}`);
        } else {
          this.logger.warn(`⚠ Invalid command structure: ${file}`);
        }
      }

      this.logger.success(`Loaded ${this.commands.size} command(s) successfully`);
    } catch (error) {
      this.logger.error('Failed to load commands:', error);
      throw error;
    }
  }

  async registerCommands() {
    try {
      const commandsData = Array.from(this.commands.values()).map(cmd => {
        const commandData = cmd.data.toJSON();
        
        // Set integration types for User Install
        commandData.integration_types = [0, 1]; // 0 = Guild, 1 = User
        commandData.contexts = [0, 1, 2]; // 0 = Guild, 1 = BotDM, 2 = PrivateChannel
        
        return commandData;
      });

      const rest = new REST({ version: '10' }).setToken(config.token);

      this.logger.info(`Registering ${commandsData.length} command(s)...`);

      // Register commands globally
      const data = await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commandsData }
      );

      // Clean up old commands that no longer exist
      await this.cleanupOldCommands(rest, data);

      this.logger.success(`Registered ${data.length} command(s) globally`);
    } catch (error) {
      this.logger.error('Failed to register commands:', error);
      throw error;
    }
  }

  async cleanupOldCommands(rest, currentCommands) {
    try {
      const existingCommands = await rest.get(
        Routes.applicationCommands(config.clientId)
      );

      const currentCommandNames = new Set(
        currentCommands.map(cmd => cmd.name)
      );

      const commandsToDelete = existingCommands.filter(
        cmd => !currentCommandNames.has(cmd.name)
      );

      if (commandsToDelete.length === 0) {
        this.logger.info('No old commands to clean up');
        return;
      }

      this.logger.info(`Cleaning up ${commandsToDelete.length} old command(s)...`);

      for (const cmd of commandsToDelete) {
        await rest.delete(
          Routes.applicationCommand(config.clientId, cmd.id)
        );
        this.logger.success(`Deleted: ${cmd.name}`);
      }

      this.logger.success('Command cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup old commands:', error);
    }
  }

  async handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() && !interaction.isModalSubmit()) {
      return;
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      return this.handleModalSubmit(interaction);
    }

    // Handle slash commands
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      this.logger.warn(`Unknown command: ${interaction.commandName}`);
      return await interaction.reply({
        content: 'Command not found.',
        ephemeral: true,
      });
    }

    try {
      this.logger.info(
        `Executing command: ${interaction.commandName} by ${interaction.user.tag}`
      );

      await command.execute(interaction);
    } catch (error) {
      this.logger.error(`Error executing ${interaction.commandName}:`, error);

      const errorMessage = {
        content: 'An error occurred while executing this command.',
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  }

  async handleModalSubmit(interaction) {
    const modalId = interaction.customId;
    
    // Route to appropriate command handler
    if (modalId.startsWith('absen_modal_')) {
      const absenCommand = this.commands.get('absen');
      if (absenCommand && absenCommand.handleModal) {
        await absenCommand.handleModal(interaction);
      }
    }
  }

  getCommand(commandName) {
    return this.commands.get(commandName);
  }

  getAllCommands() {
    return Array.from(this.commands.values());
  }
}

export default CommandHandler;