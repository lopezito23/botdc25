'use strict';

const express = require('express');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
const { LavalinkManager } = require('lavalink-client');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  LAVALINK_HOST,
  LAVALINK_PASSWORD,
} = process.env;
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT || (process.env.LAVALINK_SECURE === 'true' ? 443 : 2333));
const LAVALINK_SECURE = process.env.LAVALINK_SECURE === 'true';
const PORT = Number(process.env.PORT || 10000);

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'LAVALINK_HOST', 'LAVALINK_PASSWORD'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Faltan variables de entorno: ${missing.join(', ')}`);
  process.exit(1);
}
if (LAVALINK_HOST.includes('://') || LAVALINK_HOST.includes('/')) {
  console.error('LAVALINK_HOST debe ser solo el host, sin https:// ni rutas.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName('play').setDescription('Reproducir una canción o enlace').addStringOption(o => o.setName('cancion').setDescription('Nombre o enlace de la canción').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName('join').setDescription('Hacer que el bot entre a tu canal de voz'),
  new SlashCommandBuilder().setName('entrar').setDescription('Hacer que el bot entre a tu canal de voz'),
  new SlashCommandBuilder().setName('skip').setDescription('Saltar la canción actual'),
  new SlashCommandBuilder().setName('pause').setDescription('Pausar la música'),
  new SlashCommandBuilder().setName('resume').setDescription('Reanudar la música'),
  new SlashCommandBuilder().setName('stop').setDescription('Detener la música y limpiar la cola'),
  new SlashCommandBuilder().setName('queue').setDescription('Mostrar la cola de canciones'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Mostrar la canción actual'),
  new SlashCommandBuilder().setName('volume').setDescription('Cambiar el volumen').addIntegerOption(o => o.setName('nivel').setDescription('Volumen del 1 al 100').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('leave').setDescription('Desconectar el bot del canal de voz'),
  new SlashCommandBuilder().setName('salir').setDescription('Desconectar el bot del canal de voz'),
].map(c => c.toJSON());

const app = express();
app.disable('x-powered-by');
app.get('/', (_req, res) => res.status(200).json({ service: 'bot-dc.v10', status: 'ok' }));
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', discord: client.isReady(), lavalink: nodeConnected }));
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Health server escuchando en ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let nodeConnected = false;

client.lavalink = new LavalinkManager({
  nodes: [{
    id: 'render-lavalink',
    host: LAVALINK_HOST,
    port: LAVALINK_PORT,
    authorization: LAVALINK_PASSWORD,
    secure: LAVALINK_SECURE,
    retryAmount: 20,
    retryDelay: 10_000,
  }],
  sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
  client: { id: CLIENT_ID, username: 'bot-dc.v10' },
  autoSkip: true,
  autoSkipOnResolveError: true,
  emitNewSongsOnly: true,
  playerOptions: {
    defaultSearchPlatform: 'ytmsearch',
    clientBasedPositionUpdateInterval: 150,
    onDisconnect: { autoReconnect: true, destroyPlayer: false },
    onEmptyQueue: { destroyAfterMs: 60_000 },
    useUnresolvedData: true,
    maxErrorsPerTime: { threshold: 15_000, maxAmount: 3 },
  },
  queueOptions: { maxPreviousTracks: 15 },
  linksAllowed: true,
  advancedOptions: { debugOptions: { noAudio: false, playerDestroy: { dontThrowError: true, debugLog: true } } },
});

client.on('raw', packet => client.lavalink.sendRawData(packet));
client.on('error', err => console.error('[Discord client]', err));
client.lavalink.nodeManager.on('connect', node => {
  nodeConnected = true;
  console.log(`[Lavalink] Conectado al nodo ${node.id}`);
});
client.lavalink.nodeManager.on('disconnect', (node, reason) => {
  nodeConnected = false;
  console.warn(`[Lavalink] Desconectado de ${node.id}:`, reason || 'sin detalle');
});
client.lavalink.nodeManager.on('reconnecting', node => console.warn(`[Lavalink] Reconectando ${node.id}...`));
client.lavalink.nodeManager.on('error', (node, error) => console.error(`[Lavalink ${node?.id || 'nodo'}]`, error?.message || error));
client.lavalink.on('trackStart', (player, track) => {
  console.log(`[Música] ${track?.info?.title || 'Canción'} | servidor ${player.guildId}`);
});
client.lavalink.on('trackError', (player, track, payload) => {
  console.error(`[Música] Falló ${track?.info?.title || 'una canción'}:`, payload?.exception?.message || payload?.message || 'error de fuente');
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) channel.send(`⚠️ No pude reproducir **${safe(track?.info?.title || 'esa canción')}**. Intentaré continuar con la cola.`).catch(() => {});
});
client.lavalink.on('trackStuck', (player, track, payload) => {
  console.warn(`[Música] Pista atascada: ${track?.info?.title || 'Canción'}`, payload || '');
});
client.lavalink.on('queueEnd', player => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) channel.send('✅ La cola terminó.').catch(() => {});
});

function safe(value) {
  return String(value).replace(/[<>]/g, '').slice(0, 180);
}
function formatTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'En vivo';
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 3600) ? `${Math.floor(sec / 3600)}:` : ''}${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}
function getPlayer(guildId) {
  return client.lavalink.getPlayer(guildId) || null;
}
function requireGuild(interaction) {
  if (!interaction.guildId) throw new Error('Este comando solo funciona dentro de un servidor.');
}
async function getOrCreatePlayer(interaction) {
  const voice = interaction.member?.voice?.channel;
  if (!voice || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(voice.type)) {
    throw new Error('Primero entra a un canal de voz.');
  }
  let player = getPlayer(interaction.guildId);
  if (player && player.voiceChannelId && player.voiceChannelId !== voice.id) {
    throw new Error('Ya estoy reproduciendo en otro canal de voz. Usa `/leave` primero si quieres moverme.');
  }
  if (!player) {
    player = client.lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voice.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: 75,
    });
  }
  if (!player.connected) await player.connect();
  return player;
}
async function respond(interaction, content, ephemeral = true) {
  const payload = typeof content === 'string' ? { content, ephemeral } : { ...content, ephemeral };
  if (interaction.deferred && !interaction.replied) {
    const editPayload = { ...payload };
    delete editPayload.ephemeral;
    return interaction.editReply(editPayload);
  }
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    requireGuild(interaction);
    const command = interaction.commandName;

    if (command === 'play') {
      const query = interaction.options.getString('cancion', true).trim();
      await interaction.deferReply();
      if (!nodeConnected) throw new Error('El motor de música aún está conectando. Espera unos segundos y vuelve a intentarlo.');
      const player = await getOrCreatePlayer(interaction);
      // Enlaces: resolver tal cual. Texto: probar YouTube Music, YouTube y SoundCloud.
      // Algunos nodos devuelven resultados vacíos con la plataforma predeterminada aunque
      // el mismo texto sí funciona cuando se especifica el prefijo de búsqueda.
      const isUrl = /^https?:\/\//i.test(query);
      const searchQueries = isUrl
        ? [query]
        : [`ytmsearch:${query}`, `ytsearch:${query}`, `scsearch:${query}`];
      let result = null;
      let tracks = [];
      let lastSearchError = null;
      for (const searchTerm of searchQueries) {
        try {
          const candidate = await player.search({ query: searchTerm }, interaction.user);
          const candidateTracks = Array.isArray(candidate?.tracks)
            ? candidate.tracks
            : Array.isArray(candidate?.data)
              ? candidate.data
              : Array.isArray(candidate?.data?.tracks)
                ? candidate.data.tracks
                : [];
          console.log(`[Búsqueda] ${searchTerm} | tipo=${candidate?.loadType || 'sin tipo'} | pistas=${candidateTracks.length}`);
          result = candidate;
          if (candidateTracks.length) {
            tracks = candidateTracks;
            break;
          }
          if (candidate?.exception || candidate?.data?.message) {
            lastSearchError = candidate.exception?.message || candidate.data?.message;
          }
        } catch (searchError) {
          lastSearchError = searchError?.message || String(searchError);
          console.warn(`[Búsqueda] Falló ${searchTerm}: ${lastSearchError}`);
        }
      }
      if (!tracks.length) {
        console.error('[Búsqueda] Sin resultados:', JSON.stringify({
          query,
          loadType: result?.loadType,
          resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
          lastSearchError,
        }));
        throw new Error(lastSearchError
          ? `Lavalink no pudo encontrar la canción: ${lastSearchError}`
          : 'Lavalink no devolvió canciones. Prueba con un enlace directo de YouTube o SoundCloud; revisa los logs [Búsqueda] para ver qué fuente respondió.');
      }
      const selected = tracks[0];
      await player.queue.add(selected);
      if (!player.playing) await player.play();
      const isPlaying = Boolean(player.queue.current) || player.playing;
      const embed = new EmbedBuilder()
        .setColor(0x55aaff)
        .setTitle(isPlaying ? '🎶 Canción agregada' : '🎶 Agregada a la cola')
        .setDescription(`[${safe(selected.info?.title || 'Canción')}](${selected.info?.uri || query})`)
        .addFields(
          { name: 'Duración', value: formatTime(selected.info?.duration), inline: true },
          { name: 'Solicitada por', value: interaction.user.toString(), inline: true },
          { name: 'En cola', value: String(player.queue.tracks.length), inline: true },
        );
      if (selected.info?.artworkUrl) embed.setThumbnail(selected.info.artworkUrl);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (command === 'join' || command === 'entrar') {
      await interaction.deferReply({ ephemeral: true });
      if (!nodeConnected) throw new Error('El motor de música aún está conectando. Espera unos segundos y vuelve a intentarlo.');
      const joinedPlayer = await getOrCreatePlayer(interaction);
      await respond(interaction, `✅ Ya entré a <#${joinedPlayer.voiceChannelId}>.`, true);
      return;
    }

    const player = getPlayer(interaction.guildId);
    if (command === 'leave' || command === 'salir') {
      if (player) await player.destroy(`Comando /${command}`, true);
      await respond(interaction, '👋 Me desconecté del canal de voz.', true);
      return;
    }
    if (!player) throw new Error('No hay música activa. Usa `/play` primero.');

    if (command === 'skip') {
      if (!player.queue.current && !player.playing) throw new Error('No hay una canción reproduciéndose.');
      await player.skip();
      await respond(interaction, '⏭️ Canción saltada.');
    } else if (command === 'pause') {
      if (!player.playing || player.paused) throw new Error('No hay una canción activa para pausar.');
      await player.pause();
      await respond(interaction, '⏸️ Música pausada.');
    } else if (command === 'resume') {
      if (!player.paused) throw new Error('La música no está pausada.');
      await player.resume();
      await respond(interaction, '▶️ Música reanudada.');
    } else if (command === 'stop') {
      await player.stopPlaying(true, false);
      await respond(interaction, '⏹️ Música detenida y cola limpiada.');
    } else if (command === 'volume') {
      const volume = interaction.options.getInteger('nivel', true);
      await player.setVolume(volume);
      await respond(interaction, `🔊 Volumen ajustado al **${volume}%**.`);
    } else if (command === 'nowplaying') {
      const track = player.queue.current;
      if (!track) throw new Error('No hay una canción reproduciéndose.');
      const embed = new EmbedBuilder().setColor(0x55aaff).setTitle('🎧 Reproduciendo ahora')
        .setDescription(`[${safe(track.info?.title || 'Canción')}](${track.info?.uri || 'https://discord.com'})`)
        .addFields({ name: 'Duración', value: formatTime(track.info?.duration), inline: true }, { name: 'Volumen', value: `${player.volume}%`, inline: true });
      if (track.info?.artworkUrl) embed.setThumbnail(track.info.artworkUrl);
      await respond(interaction, { embeds: [embed] });
    } else if (command === 'queue') {
      const current = player.queue.current;
      const upcoming = player.queue.getTracks(0, 10);
      if (!current && upcoming.length === 0) throw new Error('La cola está vacía.');
      const lines = [];
      if (current) lines.push(`**Ahora:** ${safe(current.info?.title || 'Canción')} — ${formatTime(current.info?.duration)}`);
      if (upcoming.length) {
        lines.push('', '**Siguientes:**');
        upcoming.forEach((track, i) => lines.push(`${i + 1}. ${safe(track.info?.title || 'Canción')} — ${formatTime(track.info?.duration)}`));
      }
      const embed = new EmbedBuilder().setColor(0x55aaff).setTitle('📜 Cola de reproducción').setDescription(lines.join('\n').slice(0, 4000));
      await respond(interaction, { embeds: [embed] });
    }
  } catch (error) {
    console.error(`[Comando /${interaction.commandName}]`, error?.stack || error);
    const message = error?.message || 'Ocurrió un error inesperado.';
    await respond(interaction, `⚠️ ${message}`).catch(() => {});
  }
});

client.once('clientReady', async () => {
  console.log(`[Discord] Conectado como ${client.user.tag}`);
  try {
    await client.lavalink.init({ ...client.user });
    console.log('[Lavalink] Cliente inicializado; esperando conexión del nodo.');
  } catch (error) {
    console.error('[Lavalink] No se pudo inicializar:', error?.stack || error);
  }
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`[Discord] ${commands.length} comandos registrados en el servidor ${GUILD_ID}.`);
  } catch (error) {
    console.error('[Discord] Error registrando comandos:', error?.stack || error);
  }
});

client.login(DISCORD_TOKEN).catch(error => {
  console.error('[Discord] No se pudo iniciar sesión:', error?.message || error);
  process.exitCode = 1;
});

process.on('unhandledRejection', error => console.error('[Unhandled rejection]', error));
process.on('uncaughtException', error => console.error('[Uncaught exception]', error));
process.on('SIGTERM', async () => {
  console.log('Cerrando bot...');
  try { await client.destroy(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
