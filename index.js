const express = require("express");
const cors = require("cors");
const {
  Client, GatewayIntentBits, REST, Routes
} = require("discord.js");
const {
  joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState,
  createAudioPlayer, createAudioResource, AudioPlayerStatus,
  NoSubscriberBehavior, StreamType
} = require("@discordjs/voice");
const play = require("play-dl");

const {
  DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID, WEB_API_TOKEN
} = process.env;

if (![DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID, WEB_API_TOKEN].every(Boolean)) {
  throw new Error("Faltan variables: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID o WEB_API_TOKEN.");
}

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "32kb" }));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
});
let queue = [];
let currentTrack = null;
let textChannelId = null;
let lastError = null;

function getConnection() {
  return getVoiceConnection(GUILD_ID);
}
function publicTrack(track) {
  if (!track) return null;
  return { title: track.title, url: track.url, duration: track.duration || "—", source: track.source || "YouTube" };
}
function queueSnapshot() {
  return { current: publicTrack(currentTrack), queue: queue.map(publicTrack), count: queue.length };
}
function requireApi(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== WEB_API_TOKEN) return res.status(401).json({ error: "Token de API incorrecto o ausente." });
  next();
}
function requireOwner(interaction) {
  return interaction.guildId === GUILD_ID && interaction.user.id === OWNER_ID;
}
async function connectToVoice(channel, guild) {
  if (!channel || !channel.joinable) throw new Error("No encuentro un canal de voz accesible. Revisa los permisos del bot.");
  let connection = getConnection();
  if (connection && connection.joinConfig.channelId !== channel.id) {
    connection.destroy();
    connection = null;
  }
  if (!connection) {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    connection.on("error", err => console.error("Error de voz:", err.message));
  }
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  connection.subscribe(player);
  return connection;
}
async function playNext() {
  if (!queue.length) {
    currentTrack = null;
    return;
  }
  const track = queue.shift();
  try {
    currentTrack = track;
    const stream = await play.stream(track.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type || StreamType.Arbitrary, metadata: track });
    player.play(resource);
    console.log("Reproduciendo:", track.title);
  } catch (err) {
    lastError = `No se pudo reproducir "${track.title}": ${err.message}`;
    console.error(lastError);
    currentTrack = null;
    setImmediate(() => playNext());
  }
}
player.on(AudioPlayerStatus.Idle, () => {
  if (currentTrack) {
    currentTrack = null;
    setImmediate(() => playNext());
  }
});
player.on("error", err => {
  lastError = err.message;
  console.error("Error del reproductor:", err.message);
  currentTrack = null;
  setImmediate(() => playNext());
});

async function searchTracks(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new Error("Escribe el nombre de una canción o pega un enlace de YouTube.");
  if (/^https?:\/\//i.test(trimmed)) {
    if (/spotify\.com/i.test(trimmed)) {
      throw new Error("Spotify no reproduce audio directamente en este bot. Por ahora usa un enlace de YouTube; la importación de listas de Spotify requiere integración adicional con su API oficial.");
    }
    if (!/(youtube\.com|youtu\.be)/i.test(trimmed)) {
      throw new Error("Por ahora acepta enlaces de YouTube o una búsqueda por nombre.");
    }
    if (/youtube\.com\/playlist|list=/i.test(trimmed)) {
      const playlistInfo = await play.playlist_info(trimmed, { incomplete: true });
      const videos = await playlistInfo.all_videos();
      return videos.filter(v => v && v.url).map(v => ({
        title: v.title || "Canción de YouTube",
        url: v.url,
        duration: v.durationRaw || "—",
        source: "YouTube"
      }));
    }
    const info = await play.video_basic_info(trimmed);
    const v = info.video_details;
    return [{ title: v.title || "YouTube", url: v.url || trimmed, duration: v.durationRaw || "—", source: "YouTube" }];
  }
  const results = await play.search(trimmed, { limit: 1, source: { youtube: "video" } });
  if (!results.length) throw new Error("No encontré resultados para esa búsqueda.");
  const v = results[0];
  return [{ title: v.title || trimmed, url: v.url, duration: v.durationRaw || "—", source: "YouTube" }];
}
async function enqueueQuery(query) {
  const tracks = await searchTracks(query);
  if (!tracks.length) throw new Error("La lista no contiene canciones reproducibles.");
  queue.push(...tracks);
  if (!currentTrack || player.state.status === AudioPlayerStatus.Idle) await playNext();
  return { added: tracks.length, first: publicTrack(tracks[0]), snapshot: queueSnapshot() };
}

const commands = [
  { name: "entrar", description: "Conecta el bot al canal de voz donde estás" },
  { name: "salir", description: "Desconecta el bot del canal de voz" },
  { name: "estado", description: "Muestra el estado del bot" },
  { name: "play", description: "Reproduce una canción o playlist de YouTube", options: [{ name: "consulta", description: "Nombre o enlace de YouTube", type: 3, required: true }] },
  { name: "pausa", description: "Pausa la música" },
  { name: "reanudar", description: "Reanuda la música" },
  { name: "saltar", description: "Salta a la siguiente canción" },
  { name: "cola", description: "Muestra las próximas canciones" },
  { name: "parar", description: "Detiene la música y limpia la cola" }
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Comandos de Discord registrados.");
}

app.get("/", (_req, res) => res.status(200).send("X23 Music API is running."));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
app.get("/api/status", requireApi, (_req, res) => {
  const connection = getConnection();
  res.json({
    online: client.isReady(),
    bot: client.user ? { id: client.user.id, username: client.user.username } : null,
    voice: connection ? connection.state.status : "disconnected",
    playing: Boolean(currentTrack),
    paused: player.state.status === AudioPlayerStatus.Paused,
    lastError
  });
});
app.get("/api/music/queue", requireApi, (_req, res) => res.json(queueSnapshot()));
app.post("/api/music/play", requireApi, async (req, res) => {
  try {
    const query = req.body && req.body.query;
    if (!client.isReady()) return res.status(503).json({ error: "El bot todavía no está listo." });
    const guild = await client.guilds.fetch(GUILD_ID);
    let connection = getConnection();
    if (!connection) {
      const channelId = req.body && req.body.channelId;
      if (!channelId) return res.status(400).json({ error: "El bot no está en voz. Usa /entrar en Discord o envía channelId." });
      const channel = await guild.channels.fetch(String(channelId));
      await connectToVoice(channel, guild);
    } else {
      connection.subscribe(player);
    }
    const result = await enqueueQuery(query);
    lastError = null;
    res.json({ ok: true, ...result });
  } catch (err) {
    lastError = err.message;
    res.status(400).json({ error: err.message || "No se pudo reproducir." });
  }
});
app.post("/api/music/pause", requireApi, (_req, res) => {
  const ok = player.pause();
  res.status(ok ? 200 : 409).json(ok ? { ok: true, paused: true } : { error: "No hay música reproduciéndose." });
});
app.post("/api/music/resume", requireApi, (_req, res) => {
  const ok = player.unpause();
  res.status(ok ? 200 : 409).json(ok ? { ok: true, paused: false } : { error: "No hay música pausada." });
});
app.post("/api/music/skip", requireApi, (_req, res) => {
  if (!currentTrack) return res.status(409).json({ error: "No hay canción actual." });
  player.stop(true);
  res.json({ ok: true, skipped: true });
});
app.post("/api/music/stop", requireApi, (_req, res) => {
  queue = [];
  currentTrack = null;
  player.stop(true);
  res.json({ ok: true, stopped: true });
});

client.on("ready", () => console.log(`Bot iniciado como ${client.user.tag}`));
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!requireOwner(interaction)) {
    return interaction.reply({ content: "No tienes permiso para controlar este bot.", ephemeral: true });
  }
  try {
    const guild = interaction.guild;
    if (interaction.commandName === "entrar") {
      const member = await guild.members.fetch(interaction.user.id);
      const channel = member.voice.channel;
      if (!channel) return interaction.reply({ content: "Entra primero a un canal de voz.", ephemeral: true });
      await connectToVoice(channel, guild);
      return interaction.reply(`Conectado al canal **${channel.name}**.`);
    }
    if (interaction.commandName === "salir") {
      const connection = getConnection();
      if (!connection) return interaction.reply({ content: "El bot no está conectado a voz.", ephemeral: true });
      player.stop(true); queue = []; currentTrack = null; connection.destroy();
      return interaction.reply("Me desconecté y limpié la cola.");
    }
    if (interaction.commandName === "estado") {
      const connection = getConnection();
      return interaction.reply(`Bot: **${client.isReady() ? "Online" : "Offline"}** · Voz: **${connection ? connection.state.status : "Desconectado"}** · Música: **${currentTrack ? currentTrack.title : "Nada reproduciéndose"}**`);
    }
    if (interaction.commandName === "play") {
      await interaction.deferReply();
      const member = await guild.members.fetch(interaction.user.id);
      if (!getConnection()) {
        if (!member.voice.channel) return interaction.editReply("Entra a un canal de voz primero y usa /entrar.");
        await connectToVoice(member.voice.channel, guild);
      }
      const result = await enqueueQuery(interaction.options.getString("consulta", true));
      return interaction.editReply(`Añadí **${result.added}** canción(es) a la cola. ${result.first ? `Primera: **${result.first.title}**` : ""}`);
    }
    if (interaction.commandName === "pausa") return interaction.reply(player.pause() ? "⏸️ Música pausada." : "No hay música reproduciéndose.");
    if (interaction.commandName === "reanudar") return interaction.reply(player.unpause() ? "▶️ Música reanudada." : "No hay música pausada.");
    if (interaction.commandName === "saltar") return interaction.reply(currentTrack && player.stop(true) ? "⏭️ Canción saltada." : "No hay canción actual.");
    if (interaction.commandName === "cola") {
      const items = queue.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}`).join("\n");
      return interaction.reply({ content: `**Ahora:** ${currentTrack ? currentTrack.title : "Nada"}\n${items ? `**Siguiente:**\n${items}` : "La cola está vacía."}`, ephemeral: true });
    }
    if (interaction.commandName === "parar") {
      queue = []; currentTrack = null; player.stop(true);
      return interaction.reply("⏹️ Música detenida y cola vaciada.");
    }
  } catch (err) {
    console.error("Comando falló:", err);
    const msg = `Error: ${err.message || "revisa los logs del servicio"}`;
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

const PORT = process.env.PORT || 10000;
const httpServer = app.listen(PORT, "0.0.0.0", () => console.log(`API web escuchando en ${PORT}`));

async function start() {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
}
start().catch(err => {
  console.error("No se pudo iniciar:", err);
  process.exit(1);
});

process.on("SIGTERM", () => {
  const connection = getConnection();
  if (connection) connection.destroy();
  client.destroy();
  httpServer.close(() => process.exit(0));
});
