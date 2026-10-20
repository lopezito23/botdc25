const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require("@discordjs/voice");

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  OWNER_ID
} = process.env;

if (![DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID].every(Boolean)) {
  throw new Error(
    "Faltan variables de entorno: DISCORD_TOKEN, CLIENT_ID, GUILD_ID u OWNER_ID."
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const commands = [
  {
    name: "entrar",
    description: "Conecta el bot al canal de voz donde estás"
  },
  {
    name: "salir",
    description: "Desconecta el bot del canal de voz"
  },
  {
    name: "estado",
    description: "Muestra el estado de conexión de voz"
  }
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Comandos registrados en el servidor configurado.");
}

client.once("ready", () => {
  console.log(`Bot iniciado como ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.guildId !== GUILD_ID || interaction.user.id !== OWNER_ID) {
    return interaction.reply({
      content: "No tienes permiso para controlar este bot.",
      ephemeral: true
    });
  }

  try {
    if (interaction.commandName === "entrar") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const channel = member.voice.channel;

      if (!channel) {
        return interaction.reply({
          content: "Entra primero a un canal de voz y vuelve a usar /entrar.",
          ephemeral: true
        });
      }

      if (!channel.joinable) {
        return interaction.reply({
          content: "No tengo permiso para entrar a ese canal de voz.",
          ephemeral: true
        });
      }

      const previous = getVoiceConnection(GUILD_ID);
      if (previous) previous.destroy();

      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: GUILD_ID,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true
      });

      connection.on("error", error => {
        console.error("Error de conexión de voz:", error.message);
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        return interaction.reply(`Conectado al canal **${channel.name}**.`);
      } catch {
        connection.destroy();
        return interaction.reply({
          content: "No se pudo establecer la conexión de voz. Revisa los permisos y los logs.",
          ephemeral: true
        });
      }
    }

    if (interaction.commandName === "salir") {
      const connection = getVoiceConnection(GUILD_ID);

      if (!connection) {
        return interaction.reply({
          content: "El bot no está conectado a voz.",
          ephemeral: true
        });
      }

      connection.destroy();
      return interaction.reply("Me desconecté del canal de voz.");
    }

    if (interaction.commandName === "estado") {
      const connection = getVoiceConnection(GUILD_ID);
      const status = connection ? connection.state.status : "Desconectado";
      return interaction.reply(`Estado de voz: **${status}**`);
    }
  } catch (error) {
    console.error("Error procesando comando:", error);

    const response = {
      content: "Ocurrió un error. Revisa los logs de Render.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

async function start() {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
}

start().catch(error => {
  console.error("No se pudo iniciar el bot:", error);
  process.exit(1);
});

process.on("SIGTERM", () => {
  const connection = getVoiceConnection(GUILD_ID);
  if (connection) connection.destroy();
  client.destroy();
  process.exit(0);
});
