const express = require('express');
const cors = require('cors');
const path = require('node:path');
const {
  Client, GatewayIntentBits, REST, Routes, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const {
  joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState,
  createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, StreamType
} = require('@discordjs/voice');
const play = require('play-dl');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID, WEB_API_TOKEN } = process.env;
const missing = ['DISCORD_TOKEN','CLIENT_ID','GUILD_ID','OWNER_ID','WEB_API_TOKEN'].filter(k => !process.env[k]);
if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}. Configúralas en Render > Environment.`);

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '32kb' }));
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
let queue = [], currentTrack = null, lastError = null, processing = false;
const pendingSearches = new Map();
const SEARCH_TIMEOUT_MS = 15000;
const STREAM_TIMEOUT_MS = 25000;

function timeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}
function getConnection() { return getVoiceConnection(GUILD_ID); }
function publicTrack(t) { return t ? { title: t.title || 'Canción', url: t.url, duration: t.duration || '—', source: t.source || 'YouTube', thumbnail: t.thumbnail || null } : null; }
function snapshot() { return { current: publicTrack(currentTrack), queue: queue.map(publicTrack), count: queue.length, paused: player.state.status === AudioPlayerStatus.Paused }; }
function requireApi(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token || token !== WEB_API_TOKEN) return res.status(401).json({ error: 'Token de API incorrecto o ausente.' });
  next();
}
function isOwner(i) { return i.guildId === GUILD_ID && i.user.id === OWNER_ID; }
async function connectToVoice(channel, guild) {
  if (!channel || !channel.isVoiceBased?.() || !channel.joinable) {
    throw new Error('No puedo entrar a ese canal de voz. Comprueba que el bot tenga permisos de Ver canal, Conectar y Hablar.');
  }
  let conn = getConnection();
  if (conn && conn.joinConfig.channelId !== channel.id) {
    conn.destroy();
    conn = null;
  }
  if (!conn) {
    conn = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
      debug: true
    });
    conn.on('debug', message => console.log(`[Voice Debug] ${message}`));
    conn.on('stateChange', (oldState, newState) => {
      console.log(`[Voice State] ${oldState.status} -> ${newState.status}`);
    });
    conn.on('error', e => {
      lastError = `Voz: ${e.message}`;
      console.error(lastError);
    });
    conn.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(conn, VoiceConnectionStatus.Signalling, 5000),
          entersState(conn, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        if (getConnection() === conn) conn.destroy();
      }
    });
  }
  try {
    // entersState already has its own timeout. Translate its AbortError into a useful message.
    await entersState(conn, VoiceConnectionStatus.Ready, 25000);
  } catch (e) {
    if (getConnection() === conn) conn.destroy();
    const detail = e?.name === 'AbortError' || e?.code === 'ABORT_ERR'
      ? 'Discord no completó el handshake de voz en 25 segundos.'
      : (e?.message || 'Error desconocido de conexión de voz.');
    lastError = `No se pudo conectar al canal de voz: ${detail}`;
    console.error(lastError);
    throw new Error(`${lastError} Revisa los logs [Voice State] y los permisos del bot; vuelve a probar /entrar.`);
  }
  conn.subscribe(player);
  return conn;
}

function normalizeVideo(v) {
  return { title: v.title || 'Video de YouTube', url: v.url, duration: v.durationRaw || '—', source: 'YouTube', thumbnail: v.thumbnails?.[0]?.url || null };
}
async function searchTracks(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Escribe el nombre de una canción o pega un enlace de YouTube.');
  if (q.length > 300) throw new Error('La búsqueda es demasiado larga.');
  if (/^https?:\/\//i.test(q)) {
    if (/spotify\.com/i.test(q)) throw new Error('Spotify no entrega audio directamente. Pega el enlace de Spotify solo cuando esté activada la importación de metadatos; por ahora usa YouTube.');
    if (!/(youtube\.com|youtu\.be)/i.test(q)) throw new Error('Por ahora acepta búsquedas por nombre o enlaces de YouTube.');
    if (/youtube\.com\/playlist|[?&]list=/i.test(q)) {
      const info = await timeout(play.playlist_info(q, { incomplete: true }), SEARCH_TIMEOUT_MS, 'La playlist tardó demasiado en cargar. Prueba con un enlace de YouTube más corto.');
      const videos = await timeout(info.all_videos(), SEARCH_TIMEOUT_MS, 'No pude cargar las canciones de esa playlist.');
      return videos.filter(v => v?.url).map(normalizeVideo).slice(0, 100);
    }
    const info = await timeout(play.video_basic_info(q), SEARCH_TIMEOUT_MS, 'YouTube tardó demasiado en responder. Inténtalo otra vez.');
    return [normalizeVideo(info.video_details)];
  }
  const results = await timeout(play.search(q, { limit: 5, source: { youtube: 'video' } }), SEARCH_TIMEOUT_MS, 'La búsqueda tardó demasiado. Prueba de nuevo en unos segundos.');
  const tracks = results.filter(v => v?.url).map(normalizeVideo);
  if (!tracks.length) throw new Error('No encontré canciones. Prueba con el nombre y el artista.');
  return tracks;
}
async function startNext() {
  if (processing || !queue.length) { if (!queue.length && !processing && player.state.status === AudioPlayerStatus.Idle) currentTrack = null; return; }
  processing = true;
  const track = queue.shift();
  currentTrack = track;
  try {
    const stream = await timeout(play.stream(track.url), STREAM_TIMEOUT_MS, 'YouTube tardó demasiado en preparar el audio. Salté esa canción.');
    const resource = createAudioResource(stream.stream, { inputType: stream.type || StreamType.Arbitrary, metadata: track });
    player.play(resource);
    lastError = null;
    console.log(`Reproduciendo: ${track.title}`);
  } catch (e) {
    lastError = `No se pudo reproducir “${track.title}”: ${e.message}`;
    console.error(lastError);
    currentTrack = null;
    processing = false;
    setImmediate(startNext);
    return;
  }
  processing = false;
}
function addTracks(tracks) {
  if (!tracks.length) throw new Error('No hay canciones válidas para añadir.');
  queue.push(...tracks);
  if (!currentTrack && player.state.status === AudioPlayerStatus.Idle && !processing) setImmediate(startNext);
  return { added: tracks.length, first: publicTrack(tracks[0]), snapshot: snapshot() };
}
player.on(AudioPlayerStatus.Idle, () => {
  if (currentTrack) currentTrack = null;
  if (!processing && queue.length) setImmediate(startNext);
});
player.on('error', e => {
  lastError = `Error de audio: ${e.message}`; console.error(lastError); currentTrack = null;
  if (!processing && queue.length) setImmediate(startNext);
});

const commands = [
  { name: 'entrar', description: 'Conecta el bot al canal de voz donde estás' },
  { name: 'salir', description: 'Desconecta el bot del canal de voz' },
  { name: 'estado', description: 'Muestra el estado del bot' },
  { name: 'play', description: 'Busca una canción y muestra sugerencias', options: [{ name: 'consulta', description: 'Nombre de canción o enlace de YouTube', type: 3, required: true }] },
  { name: 'pausa', description: 'Pausa la música' }, { name: 'reanudar', description: 'Reanuda la música' },
  { name: 'saltar', description: 'Salta la canción actual' }, { name: 'cola', description: 'Muestra la cola de canciones' },
  { name: 'parar', description: 'Detiene la música y limpia la cola' }
];
async function registerCommands() { const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN); await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands }); console.log('Comandos slash registrados.'); }

app.get('/', (_req,res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/styles.css', (_req,res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.get('/app.js', (_req,res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/health', (_req,res) => res.status(200).json({ status: 'ok' }));
app.get('/api/status', requireApi, (_req,res) => { const c = getConnection(); res.json({ online: client.isReady(), bot: client.user ? { id: client.user.id, username: client.user.username } : null, voice: c ? c.state.status : 'disconnected', playing: Boolean(currentTrack), paused: player.state.status === AudioPlayerStatus.Paused, lastError }); });
app.get('/api/music/queue', requireApi, (_req,res) => res.json(snapshot()));
app.get('/api/music/search', requireApi, async (req,res) => { try { const tracks = await searchTracks(req.query.q); res.json({ results: tracks.slice(0, 10).map((t,i) => ({ ...publicTrack(t), id: String(i) })) }); } catch(e) { res.status(422).json({ error: e.message || 'Falló la búsqueda.' }); } });
app.post('/api/music/play', requireApi, async (req,res) => {
  try {
    if (!client.isReady()) return res.status(503).json({ error: 'El bot todavía está iniciando. Espera unos segundos.' });
    const guild = await client.guilds.fetch(GUILD_ID);
    let conn = getConnection();
    if (!conn) { const id = req.body?.channelId; if (!id) return res.status(409).json({ error: 'El bot no está en voz. Usa /entrar en Discord primero.' }); await connectToVoice(await guild.channels.fetch(String(id)), guild); }
    else conn.subscribe(player);
    let tracks;
    if (req.body?.track?.url) tracks = [req.body.track];
    else tracks = await searchTracks(req.body?.query);
    const result = addTracks(tracks);
    res.json({ ok: true, ...result });
  } catch(e) { lastError = e.message; res.status(422).json({ error: e.message || 'No se pudo añadir la canción.' }); }
});
app.post('/api/music/pause', requireApi, (_req,res) => { const ok = player.pause(); res.status(ok ? 200 : 409).json(ok ? { ok:true, paused:true } : { error:'No hay música reproduciéndose.' }); });
app.post('/api/music/resume', requireApi, (_req,res) => { const ok = player.unpause(); res.status(ok ? 200 : 409).json(ok ? { ok:true, paused:false } : { error:'No hay música pausada.' }); });
app.post('/api/music/skip', requireApi, (_req,res) => { if (!currentTrack) return res.status(409).json({ error:'No hay canción actual.' }); player.stop(true); res.json({ ok:true, skipped:true }); });
app.post('/api/music/stop', requireApi, (_req,res) => { queue=[]; currentTrack=null; processing=false; player.stop(true); res.json({ ok:true, stopped:true }); });

client.once('ready', () => console.log(`Bot iniciado como ${client.user.tag}`));
client.on('interactionCreate', async i => {
  if (i.isStringSelectMenu() && i.customId.startsWith('x23pick:')) {
    if (!isOwner(i)) return i.reply({ content:'No tienes permiso para controlar este bot.', ephemeral:true });
    const tracks = pendingSearches.get(i.customId.slice('x23pick:'.length));
    const track = tracks?.[Number(i.values[0])];
    if (!track) return i.update({ content:'Esta búsqueda caducó. Ejecuta /play otra vez.', components:[] });
    try { const result = addTracks([track]); await i.update({ content:`✅ Añadí **${track.title}** a la cola.`, components:[] }); }
    catch(e) { await i.update({ content:`❌ ${e.message}`, components:[] }); }
    return;
  }
  if (!i.isChatInputCommand()) return;
  if (!isOwner(i)) return i.reply({ content:'No tienes permiso para controlar este bot.', ephemeral:true });
  try {
    // Acknowledge every slash command immediately so Discord does not time it out.
    await i.deferReply();
    const guild = i.guild;
    if (i.commandName === 'entrar') { const member=await guild.members.fetch(i.user.id); if(!member.voice.channel) return i.editReply('Entra primero a un canal de voz y vuelve a usar /entrar.'); await connectToVoice(member.voice.channel,guild); return i.editReply(`✅ Conectado a **${member.voice.channel.name}**.`); }
    if (i.commandName === 'salir') { const c=getConnection(); if(!c) return i.editReply({content:'El bot no está conectado a voz.'}); queue=[];currentTrack=null;processing=false;player.stop(true);c.destroy();return i.editReply('Me desconecté y limpié la cola.'); }
    if (i.commandName === 'estado') { const c=getConnection(); return i.editReply(`Bot: **${client.isReady()?'Online':'Offline'}** · Voz: **${c?c.state.status:'Desconectado'}** · Música: **${currentTrack?currentTrack.title:'Nada reproduciéndose'}**`); }
    if (i.commandName === 'play') {
      const member=await guild.members.fetch(i.user.id);
      if (!getConnection()) { if(!member.voice.channel) return i.editReply('Entra a un canal de voz y vuelve a usar /play.'); await connectToVoice(member.voice.channel,guild); }
      const q=i.options.getString('consulta',true);
      const tracks=await searchTracks(q);
      if (/^https?:\/\//i.test(q) || tracks.length===1) { addTracks(tracks); return i.editReply(`✅ Añadí **${tracks[0].title}** a la cola.`); }
      const menu = new StringSelectMenuBuilder().setCustomId(`x23pick:${i.id}`).setPlaceholder('Elige la canción que querías').addOptions(tracks.slice(0,5).map((t,n)=>({ label:t.title.slice(0,100), description:`${t.duration || 'Duración desconocida'} · YouTube`.slice(0,100), value:String(n) })));
      const row=new ActionRowBuilder().addComponents(menu);
      const msg=await i.editReply({ content:'🔎 **Encontré estas canciones. Elige una para reproducir:**', components:[row] });
      pendingSearches.set(i.id, tracks);
      const collector=msg.createMessageComponentCollector({ time:60000, max:1, filter: ci=>ci.customId===`x23pick:${i.id}` && ci.user.id===OWNER_ID });
      collector.on('end', collected=>{ pendingSearches.delete(i.id); if(!collected.size) i.editReply({content:'⌛ La búsqueda caducó. Usa /play para buscar otra vez.',components:[]}).catch(()=>{}); });
      return;
    }
    if (i.commandName === 'pausa') return i.editReply(player.pause()?'⏸️ Música pausada.':'No hay música reproduciéndose.');
    if (i.commandName === 'reanudar') return i.editReply(player.unpause()?'▶️ Música reanudada.':'No hay música pausada.');
    if (i.commandName === 'saltar') return i.editReply(currentTrack && player.stop(true)?'⏭️ Canción saltada.':'No hay canción actual.');
    if (i.commandName === 'cola') { const items=queue.slice(0,10).map((t,n)=>`${n+1}. ${t.title}`).join('\n'); return i.editReply({content:`**Ahora:** ${currentTrack?currentTrack.title:'Nada'}\n${items?`**Siguiente:**\n${items}`:'La cola está vacía.'}`}); }
    if (i.commandName === 'parar') { queue=[];currentTrack=null;processing=false;player.stop(true);return i.editReply('⏹️ Música detenida y cola vaciada.'); }
  } catch(e) { console.error('Comando falló:',e); lastError=e.message; const message=`❌ ${e.message || 'Ocurrió un error. Revisa los logs de Render.'}`; if(i.deferred||i.replied) await i.editReply({content:message,components:[]}).catch(()=>{}); else await i.reply({content:message,ephemeral:true}).catch(()=>{}); }
});
const server=app.listen(process.env.PORT||10000,'0.0.0.0',()=>console.log('API escuchando.'));
async function start(){ await registerCommands(); await client.login(DISCORD_TOKEN); }
start().catch(e=>{ console.error('No se pudo iniciar:',e); process.exit(1); });
process.on('SIGTERM',()=>{const c=getConnection();if(c)c.destroy();client.destroy();server.close(()=>process.exit(0));});
