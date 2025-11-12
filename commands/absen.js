import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("absen")
    .setDescription("Login ke SIMA dan lakukan absen otomatis"),

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId("absenModal")
      .setTitle("Login SIMA UNSIQ");

    const nimInput = new TextInputBuilder()
      .setCustomId("nim")
      .setLabel("Masukkan NIM")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const passInput = new TextInputBuilder()
      .setCustomId("password")
      .setLabel("Masukkan Password")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const firstRow = new ActionRowBuilder().addComponents(nimInput);
    const secondRow = new ActionRowBuilder().addComponents(passInput);

    modal.addComponents(firstRow, secondRow);

    await interaction.showModal(modal);
  }
};
