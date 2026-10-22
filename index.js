const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  Client, GatewayIntentBits, REST, Routes, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const {
  joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState,
  createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, StreamType
} = require('@discordjs/voice');
const FFMPEG_PATH = require('ffmpeg-static');
const YTDLP_PATH = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
let activeAudioProcesses = null;

<<<<<<< HEAD
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID, WEB_API_TOKEN, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SOUNDCLOUD_CLIENT_ID } = process.env;
const missing = ['DISCORD_TOKEN','CLIENT_ID','GUILD_ID','OWNER_ID','WEB_API_TOKEN'].filter(k => !process.env[k]);
if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}. Configúralas en Render > Environment.`);
=======
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
>>>>>>> 1baab75febe6410a312505620d726ee122916102

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '32kb' }));
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
let queue = [], currentTrack = null, lastError = null, processing = false;
let repeatMode = 'off'; // off | track | queue
let autoplayEnabled = false, volumeLevel = 0.7, skipRequested = false;
const history = [];
const MAX_QUEUE = 200;
const pendingSearches = new Map();
const SEARCH_TIMEOUT_MS = 45000;
const STREAM_TIMEOUT_MS = 25000;

function timeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}
function getConnection() { return getVoiceConnection(GUILD_ID); }
function publicTrack(t) { return t ? { title: t.title || 'Canción', url: t.url, duration: t.duration || '—', source: t.source || 'YouTube', thumbnail: t.thumbnail || null } : null; }
function snapshot() { return { current: publicTrack(currentTrack), queue: queue.map((t, index) => ({ ...publicTrack(t), index })), count: queue.length, paused: player.state.status === AudioPlayerStatus.Paused, repeatMode, autoplayEnabled, volume: Math.round(volumeLevel * 100), history: history.slice(0, 10).map(publicTrack) }; }
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
      debug: false
    });
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

<<<<<<< HEAD
function ytDlpCommand() {
  if (fs.existsSync(YTDLP_PATH)) return { command: YTDLP_PATH, prefix: [] };
  // Fallback for Render deployments where the standalone release binary could not download.
  return { command: process.env.PYTHON || 'python3', prefix: ['-m', 'yt_dlp'] };
}
function runYtDlp(args, timeoutMs = SEARCH_TIMEOUT_MS) {
  const { command, prefix } = ytDlpCommand();
  // Keep the JS challenge solver enabled and use clients that are less dependent
  // on YouTube's changing default client list. Render must still be able to reach YouTube.
  const ytArgs = [...prefix, '--js-runtimes', 'node', '--remote-components', 'ejs:github', ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(command, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('yt-dlp agotó el tiempo de espera.')); }, timeoutMs);
    const finish = (err, value) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(value); };
    child.stdout.on('data', chunk => { if (stdout.length < 8_000_000) stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { if (stderr.length < 1_000_000) stderr += chunk.toString(); });
    child.on('error', err => finish(new Error(`No se pudo ejecutar yt-dlp. Revisa la instalación de dependencias: ${err.message}`)));
    child.on('close', code => {
      if (code === 0) return finish(null, stdout.trim());
      const details = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 500);
      const rate = /429|too many requests|rate.?limit/i.test(details);
      finish(new Error(rate ? 'YouTube limitó temporalmente las solicitudes (HTTP 429). Espera un poco o prueba un enlace de SoundCloud.' : `yt-dlp no pudo obtener la pista${details ? `: ${details}` : ` (código ${code})`}`));
    });
  });
}
function cleanTrack(entry, sourceHint = 'YouTube') {
  if (!entry || typeof entry !== 'object') return null;
  let url = entry.webpage_url || entry.original_url || entry.url || '';
  if (url && !/^https?:\/\//i.test(url) && entry.id && /youtube/i.test(sourceHint)) url = `https://www.youtube.com/watch?v=${entry.id}`;
  if (!/^https?:\/\//i.test(url)) return null;
  const durationSeconds = Number(entry.duration);
  const duration = entry.duration_string || (Number.isFinite(durationSeconds) && durationSeconds >= 0 ? `${Math.floor(durationSeconds / 60)}:${String(Math.floor(durationSeconds % 60)).padStart(2, '0')}` : '—');
  const extractor = String(entry.extractor_key || entry.extractor || sourceHint);
  const source = /soundcloud/i.test(extractor + ' ' + url) ? 'SoundCloud' : /youtube/i.test(extractor + ' ' + url) ? 'YouTube' : sourceHint;
  return { title: entry.title || entry.fulltitle || 'Pista de audio', url, duration, source, thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url || null };
}
async function ytSearch(query, limit = 5) {
  const q = String(query || '').trim();
  if (!q) return [];
  const json = await runYtDlp(['--dump-single-json','--flat-playlist','--no-warnings',`ytsearch${Math.max(1, Math.min(limit, 10))}:${q}`], SEARCH_TIMEOUT_MS);
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('yt-dlp devolvió una respuesta de búsqueda inválida.'); }
  const entries = Array.isArray(data.entries) ? data.entries : [data];
  return entries.map(e => cleanTrack(e, 'YouTube')).filter(Boolean).slice(0, limit);
}
async function soundCloudSearch(query, limit = 5) {
  const q = String(query || '').trim();
  if (!q) return [];
  const json = await runYtDlp(['--dump-single-json','--flat-playlist','--no-warnings',`scsearch${Math.max(1, Math.min(limit, 10))}:${q}`], SEARCH_TIMEOUT_MS);
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('yt-dlp devolvió una respuesta de búsqueda de SoundCloud inválida.'); }
  const entries = Array.isArray(data.entries) ? data.entries : [data];
  return entries.map(e => cleanTrack(e, 'SoundCloud')).filter(Boolean).slice(0, limit);
}
async function resolveDirectUrl(url) {
  const json = await runYtDlp(['--dump-single-json','--no-warnings','--no-playlist',url], SEARCH_TIMEOUT_MS);
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('No pude leer los datos de ese enlace.'); }
  const track = cleanTrack(data, /soundcloud/i.test(url) ? 'SoundCloud' : 'YouTube');
  if (!track) throw new Error('El enlace no devolvió una pista reproducible.');
  return [track];
}
let spotifyToken = null, spotifyTokenExpiresAt = 0;
async function getSpotifyToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('Spotify no está configurado todavía. Añade SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en Render > Environment.');
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt - 60000) return spotifyToken;
  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', { method:'POST', headers:{Authorization:`Basic ${credentials}`,'Content-Type':'application/x-www-form-urlencoded'}, body:'grant_type=client_credentials', signal:AbortSignal.timeout(12000) });
  const data = await response.json().catch(()=>({}));
  if (!response.ok || !data.access_token) throw new Error(`Spotify no autorizó la API (${response.status}). Revisa las credenciales en Render.`);
  spotifyToken=data.access_token; spotifyTokenExpiresAt=Date.now()+(Number(data.expires_in)||3600)*1000; return spotifyToken;
}
function spotifyId(url) { const m=String(url).match(/open\.spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/i); return m?{type:m[1].toLowerCase(),id:m[2]}:null; }
async function spotifyItems(url) {
  const parsed=spotifyId(url);
  if(!parsed) throw new Error('Pega un enlace válido de canción, álbum o playlist de Spotify.');
  const token=await getSpotifyToken(), headers={Authorization:`Bearer ${token}`};
  if(parsed.type==='track'){
    const r=await fetch(`https://api.spotify.com/v1/tracks/${parsed.id}`,{headers,signal:AbortSignal.timeout(12000)}), data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`No pude leer la canción de Spotify (${r.status}).`);
    return {playlist:false,tracks:[data]};
  }
  let next=parsed.type==='playlist'?`https://api.spotify.com/v1/playlists/${parsed.id}/tracks?limit=100&fields=items(track(name,artists(name),is_local,type)),next`:`https://api.spotify.com/v1/albums/${parsed.id}/tracks?limit=50`;
  const tracks=[];
  while(next&&tracks.length<100){
    const r=await fetch(next,{headers,signal:AbortSignal.timeout(15000)}), data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`No pude leer la playlist/álbum de Spotify (${r.status}). Comprueba que sea público y accesible.`);
    for(const item of (data.items||[])){const t=parsed.type==='playlist'?item.track:item;if(t?.name&&t.type!=='episode'&&!t.is_local)tracks.push(t);if(tracks.length>=100)break;}
    next=data.next||null;
  }
  if(!tracks.length)throw new Error('Spotify no devolvió canciones. Comprueba que la playlist sea pública y accesible.');
  return {playlist:true,tracks};
}
function spotifyQuery(t){return `${t.name||''} ${(t.artists||[]).map(a=>a.name).filter(Boolean).join(' ')}`.trim();}
async function spotifyToPlayable(t){
  const q=spotifyQuery(t);if(!q)return null;
  const displayTitle=`${t.name||q.split(' ').slice(0,4).join(' ')} — ${(t.artists||[]).map(a=>a.name).join(', ')}`;
  const found=await ytSearch(q,1);
  return found[0]?{...found[0],source:'Spotify → '+found[0].source,title:displayTitle}:null;
}
async function searchTracks(query) {
  const q=String(query||'').trim();
  if(!q)throw new Error('Escribe una canción o pega un enlace de YouTube, SoundCloud o Spotify.');
  if(q.length>300)throw new Error('La búsqueda es demasiado larga.');
  if(/^https?:\/\//i.test(q)){
    if(/spotify\.com/i.test(q)){
      const imported=await spotifyItems(q), input=imported.tracks.slice(0,imported.playlist?50:1), mapped=[];
      for(const track of input){try{const match=await spotifyToPlayable(track);if(match)mapped.push(match);}catch(e){console.warn(`No se encontró coincidencia para ${spotifyQuery(track)}: ${e.message}`);}}
      if(!mapped.length)throw new Error('Leí Spotify, pero no encontré coincidencias reproducibles.');
      return mapped;
    }
    const isPlaylist=/youtube\.com\/playlist|[?&]list=/i.test(q);
    if(isPlaylist){
      const json=await runYtDlp(['--dump-single-json','--flat-playlist','--no-warnings','--playlist-end','100',q],SEARCH_TIMEOUT_MS);
      let data;try{data=JSON.parse(json);}catch{throw new Error('No pude leer esa playlist.');}
      const tracks=(data.entries||[]).map(e=>cleanTrack(e,'YouTube')).filter(Boolean).slice(0,100);
      if(!tracks.length)throw new Error('La playlist no contiene canciones reproducibles.');
      return tracks;
=======
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
>>>>>>> 1baab75febe6410a312505620d726ee122916102
    }
    return resolveDirectUrl(q);
  }
  try {
    const youtube = await ytSearch(q, 5);
    if (youtube.length) return youtube;
  } catch (e) {
    console.warn(`Búsqueda de YouTube falló; probando SoundCloud: ${e.message}`);
  }
  const soundcloud = await soundCloudSearch(q, 5);
  if (soundcloud.length) {
    console.log(`Búsqueda alternativa: SoundCloud (${soundcloud.length} resultados).`);
    return soundcloud;
  }
  throw new Error('No encontré resultados reproducibles en YouTube ni SoundCloud. Prueba con otro nombre o enlace.');
}
function createYtDlpAudio(track) {
  if (!FFMPEG_PATH) throw new Error('No se encontró FFmpeg. Revisa la instalación de ffmpeg-static en Render.');
  const { command, prefix } = ytDlpCommand();
  const yt = spawn(command, [...prefix, '--js-runtimes','node','--remote-components','ejs:github','--no-playlist','--no-warnings','-f','bestaudio/best','-o','-','--',track.url], { stdio: ['ignore','pipe','pipe'] });
  const ff = spawn(FFMPEG_PATH, ['-hide_banner','-loglevel','error','-i','pipe:0','-vn','-c:a','libopus','-b:a','128k','-f','ogg','pipe:1'], { stdio: ['pipe','pipe','pipe'] });
  let ytErr='', ffErr='', didCleanup=false;
  yt.stderr.on('data', c => { if (ytErr.length < 1000) ytErr += c.toString(); });
  ff.stdin.on('error', () => {});
  ff.stderr.on('data', c => { if (ffErr.length < 1000) ffErr += c.toString(); });
  yt.stdout.pipe(ff.stdin);
  const cleanup = () => {
    if (didCleanup) return; didCleanup=true;
    try { yt.stdout.unpipe(ff.stdin); } catch {}
    for (const child of [yt,ff]) { if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL'); }
  };
  yt.on('error', e => { console.error('yt-dlp stream error:',e.message); ff.stdin.destroy(e); });
  yt.on('close', code => {
    if (code !== 0 && !didCleanup) {
      const msg = /429|too many requests/i.test(ytErr)
        ? 'YouTube/SoundCloud limitó la solicitud (HTTP 429).'
        : ytErr.trim().split('\n').slice(-4).join(' ').slice(-500);
      lastError = `yt-dlp: ${msg || `terminó con código ${code}`}`;
      console.error(lastError);
      // Si falla YouTube, intenta una alternativa de SoundCloud una sola vez.
      // Se pausa el avance de la cola mientras se busca el respaldo.
      if (/youtube/i.test(String(track.source || '') + ' ' + String(track.url || '')) && !track._soundCloudFallbackTried) {
        track._soundCloudFallbackTried = true;
        processing = true;
        const query = String(track.title || '').replace(/\s*\[(?:Official Video|YouTube|Video Oficial|Lyrics|Letras)[^\]]*\]/ig, '').trim();
        soundCloudSearch(query, 5).then(found => {
          // SoundCloud puede devolver pistas protegidas por DRM. No podemos saber
          // cuáles son reproducibles hasta intentar extraerlas, así que probamos
          // varios resultados en orden en vez de quedarnos con el primero.
          const seen = new Set();
          const alternatives = found.filter(item => {
            const url = String(item.url || '');
            if (!url || seen.has(url)) return false;
            seen.add(url);
            return true;
          }).map(item => ({ ...item, source: 'SoundCloud (respaldo)', _soundCloudFallbackTried: true }));
          if (alternatives.length) {
            queue.unshift(...alternatives);
            console.warn(`YouTube falló; se probarán ${alternatives.length} alternativas de SoundCloud para: ${query}`);
          } else {
            console.warn(`SoundCloud no devolvió alternativas para: ${query}`);
          }
        }).catch(e => console.warn(`No se encontró respaldo en SoundCloud: ${e.message}`)).finally(() => {
          processing = false;
          if (!currentTrack && queue.length) setImmediate(startNext);
        });
      }
      // FFmpeg recibe entrada inválida únicamente porque yt-dlp no entregó audio.
      try { ff.stdin.end(); } catch {}
      if (ff.exitCode === null && !ff.killed) ff.kill('SIGTERM');
    }
  });
  ff.on('error', e => console.error('FFmpeg stream error:',e.message));
  ff.on('close', code => { if (code !== 0 && !didCleanup) console.error('FFmpeg terminó:',ffErr.trim().slice(-400)); });
  activeAudioProcesses = { yt, ff, cleanup };
  return { stream: ff.stdout, type: StreamType.OggOpus, cleanup };
}
function stopAudioProcesses() {
  const p=activeAudioProcesses; activeAudioProcesses=null;
  if(p?.cleanup) p.cleanup();
}

<<<<<<< HEAD
async function startNext() {
  if (processing || !queue.length) {
    if (!queue.length && !processing && player.state.status === AudioPlayerStatus.Idle) currentTrack = null;
    return;
  }
  processing = true;
  const track = queue.shift();
  currentTrack = track;
=======
client.once('clientReady', async () => {
  console.log(`[Discord] Conectado como ${client.user.tag}`);
>>>>>>> 1baab75febe6410a312505620d726ee122916102
  try {
    const stream = createYtDlpAudio(track);
    const resource = createAudioResource(stream.stream, {
      inputType: StreamType.OggOpus,
      metadata: track,
      inlineVolume: true
    });
    resource.volume?.setVolume(volumeLevel);
    player.play(resource);
    lastError = null;
    console.log(`Preparando reproducción: ${track.title} [${track.source || 'audio'}]`);
  } catch (e) {
    stopAudioProcesses();
    lastError = `No se pudo reproducir “${track.title}”: ${e.message}`;
    console.error(lastError);
    currentTrack = null;
    processing = false;
    setTimeout(() => startNext().catch(err => {
      lastError = err?.message || 'Error al continuar la cola.';
      console.error(lastError);
    }), 2500);
    return;
  }
  processing = false;
}

function addTracks(tracks) {
  if (!tracks.length) throw new Error('No hay canciones válidas para añadir.');
  const accepted = tracks.slice(0, Math.max(0, MAX_QUEUE - queue.length));
  if (!accepted.length) throw new Error(`La cola alcanzó su límite de ${MAX_QUEUE} canciones.`);
  queue.push(...accepted);
  if (!currentTrack && player.state.status === AudioPlayerStatus.Idle && !processing) setImmediate(startNext);
  return { added: accepted.length, first: publicTrack(accepted[0]), snapshot: snapshot() };
}
player.on(AudioPlayerStatus.Idle, () => {
  stopAudioProcesses();
  const finished = currentTrack;
  if (finished) {
    history.unshift(finished);
    if (history.length > 20) history.length = 20;
    if (repeatMode === 'track' && !skipRequested) queue.unshift(finished);
    else if (repeatMode === 'queue' && !skipRequested) queue.push(finished);
  }
  skipRequested = false;
  currentTrack = null;
  if (!processing && queue.length) setImmediate(startNext);
  else if (!processing && autoplayEnabled && finished) {
    const query = String(finished.title || '').replace(/\s*[—-]\s*(YouTube|SoundCloud).*$/i, '').trim();
    if (query) setTimeout(async () => {
      if (!autoplayEnabled || currentTrack || queue.length) return;
      try { const found = await searchTracks(query); if (found.length) addTracks([found[0]]); }
      catch (e) { lastError = `Autoplay: ${e.message}`; console.warn(lastError); }
    }, 1200);
  }
});
player.on('error', e => {
  stopAudioProcesses();
  lastError = `Error de audio: ${e.message}`; console.error(lastError); currentTrack = null;
  if (!processing && queue.length) setImmediate(startNext);
});

const commands = [
  { name: 'entrar', description: 'Conecta el bot al canal de voz donde estás' },
  { name: 'salir', description: 'Desconecta el bot del canal de voz' },
  { name: 'estado', description: 'Muestra el estado del bot' },
  { name: 'play', description: 'Busca o reproduce audio con YouTube/SoundCloud', options: [{ name: 'consulta', description: 'Canción o enlace de YouTube, SoundCloud o Spotify', type: 3, required: true }] },
  { name: 'diagnostico', description: 'Comprueba bot, voz y motor de audio' },
  { name: 'pausa', description: 'Pausa la música' }, { name: 'reanudar', description: 'Reanuda la música' },
  { name: 'saltar', description: 'Salta la canción actual' }, { name: 'cola', description: 'Muestra la cola de canciones' },
  { name: 'parar', description: 'Detiene la música y limpia la cola' },
  { name: 'aleatorio', description: 'Mezcla las canciones en cola' },
  { name: 'repetir', description: 'Cambia el modo de repetición', options: [{ name: 'modo', description: 'Qué repetir', type: 3, required: true, choices: [{name:'Desactivado',value:'off'},{name:'Canción actual',value:'track'},{name:'Toda la cola',value:'queue'}] }] },
  { name: 'volumen', description: 'Ajusta el volumen del bot (0 a 100)', options: [{ name: 'nivel', description: 'Porcentaje de volumen', type: 4, required: true, min_value: 0, max_value: 100 }] },
  { name: 'quitar', description: 'Quita una canción de la cola', options: [{ name: 'posicion', description: 'Número de la canción en la cola', type: 4, required: true, min_value: 1, max_value: 200 }] },
  { name: 'limpiar', description: 'Vacía la cola sin detener la canción actual' },
  { name: 'autoplay', description: 'Activa o desactiva la reproducción automática', options: [{ name: 'activo', description: 'Activar autoplay', type: 5, required: true }] }
];
async function registerCommands() { const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN); await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands }); console.log('Comandos slash registrados.'); }

app.get('/', (_req,res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/styles.css', (_req,res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.get('/app.js', (_req,res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/health', (_req,res) => res.status(200).json({ status: 'ok' }));
app.get('/api/status', requireApi, (_req,res) => { const c = getConnection(); res.json({ online: client.isReady(), bot: client.user ? { id: client.user.id, username: client.user.username } : null, voice: c ? c.state.status : 'disconnected', playing: Boolean(currentTrack), paused: player.state.status === AudioPlayerStatus.Paused, lastError }); });
app.get('/api/music/queue', requireApi, (_req,res) => res.json(snapshot()));
app.post('/api/music/shuffle', requireApi, (_req,res) => { for (let i=queue.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [queue[i],queue[j]]=[queue[j],queue[i]]; } res.json({ok:true,...snapshot()}); });
app.post('/api/music/repeat', requireApi, (req,res) => { const mode=String(req.body?.mode||'off'); if(!['off','track','queue'].includes(mode)) return res.status(400).json({error:'Modo inválido. Usa off, track o queue.'}); repeatMode=mode; res.json({ok:true,repeatMode}); });
app.post('/api/music/volume', requireApi, (req,res) => { const n=Number(req.body?.volume); if(!Number.isFinite(n)||n<0||n>100) return res.status(400).json({error:'El volumen debe estar entre 0 y 100.'}); volumeLevel=n/100; const resource=player.state.resource; if(resource?.volume) resource.volume.setVolume(volumeLevel); res.json({ok:true,volume:n}); });
app.post('/api/music/autoplay', requireApi, (req,res) => { if(typeof req.body?.enabled!=='boolean') return res.status(400).json({error:'enabled debe ser true o false.'}); autoplayEnabled=req.body.enabled; res.json({ok:true,autoplayEnabled}); });
app.post('/api/music/queue/shuffle', requireApi, (_req,res) => { for(let i=queue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[queue[i],queue[j]]=[queue[j],queue[i]];} res.json({ok:true,...snapshot()}); });
app.delete('/api/music/queue/:index', requireApi, (req,res) => { const index=Number(req.params.index); if(!Number.isInteger(index)||index<0||index>=queue.length) return res.status(404).json({error:'No existe esa posición en la cola.'}); const [removed]=queue.splice(index,1); res.json({ok:true,removed:publicTrack(removed),...snapshot()}); });
app.post('/api/music/queue/clear', requireApi, (_req,res) => { const removed=queue.length; queue=[]; res.json({ok:true,removed,...snapshot()}); });
app.post('/api/music/queue/move', requireApi, (req,res) => { const from=Number(req.body?.from), to=Number(req.body?.to); if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=queue.length||to>=queue.length) return res.status(400).json({error:'Posición de cola inválida.'}); const [track]=queue.splice(from,1); queue.splice(to,0,track); res.json({ok:true,...snapshot()}); });
app.get('/api/music/search', requireApi, async (req,res) => { try { const q=String(req.query.q||''); const tracks=await searchTracks(q); const isPlaylist=/spotify\.com\/(playlist|album)\//i.test(q)||/youtube\.com\/playlist|[?&]list=/i.test(q); res.json({playlist:isPlaylist,results:tracks.slice(0,isPlaylist?100:10).map((t,i)=>({...publicTrack(t),id:String(i)}))}); } catch(e) { res.status(422).json({error:e.message||'Falló la búsqueda.'}); } });
app.post('/api/music/play', requireApi, async (req,res) => {
  try {
    if (!client.isReady()) return res.status(503).json({ error: 'El bot todavía está iniciando. Espera unos segundos.' });
    const guild = await client.guilds.fetch(GUILD_ID);
    let conn = getConnection();
    if (!conn) { const id = req.body?.channelId; if (!id) return res.status(409).json({ error: 'El bot no está en voz. Usa /entrar en Discord primero.' }); await connectToVoice(await guild.channels.fetch(String(id)), guild); }
    else conn.subscribe(player);
    let tracks;
    if (Array.isArray(req.body?.tracks)) tracks = req.body.tracks.filter(t => t && /^https?:\/\//i.test(String(t.url||''))).slice(0,100);
    else if (req.body?.track?.url) tracks = [req.body.track];
    else tracks = await searchTracks(req.body?.query);
    const result = addTracks(tracks);
    res.json({ ok: true, ...result });
  } catch(e) { lastError = e.message; res.status(422).json({ error: e.message || 'No se pudo añadir la canción.' }); }
});
app.post('/api/music/pause', requireApi, (_req,res) => { const ok = player.pause(); res.status(ok ? 200 : 409).json(ok ? { ok:true, paused:true } : { error:'No hay música reproduciéndose.' }); });
app.post('/api/music/resume', requireApi, (_req,res) => { const ok = player.unpause(); res.status(ok ? 200 : 409).json(ok ? { ok:true, paused:false } : { error:'No hay música pausada.' }); });
app.post('/api/music/skip', requireApi, (_req,res) => { if (!currentTrack) return res.status(409).json({ error:'No hay canción actual.' }); skipRequested=true; player.stop(true); res.json({ ok:true, skipped:true }); });
app.post('/api/music/stop', requireApi, (_req,res) => { queue=[]; currentTrack=null; processing=false; skipRequested=true; stopAudioProcesses(); player.stop(true); res.json({ ok:true, stopped:true }); });

client.once('clientReady', () => {
  console.log(`Bot iniciado como ${client.user.tag}`);
  const { command, prefix } = ytDlpCommand();
  runYtDlp(['--version'], 15000)
    .then(version => console.log(`Motor yt-dlp activo: ${version} · ejecutable: ${command}${prefix.length ? ` ${prefix.join(' ')}` : ''}`))
    .catch(err => { lastError = `No se pudo comprobar yt-dlp: ${err.message}`; console.error(lastError); });
});
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
    if (i.commandName === 'diagnostico') {
      let engine = 'yt-dlp no disponible';
      try { const version = await runYtDlp(['--version'], 20000); const { command, prefix } = ytDlpCommand(); engine = `yt-dlp ${version} · ${prefix.length ? `${command} ${prefix.join(' ')}` : command}`; }
      catch (e) { const { command, prefix } = ytDlpCommand(); engine = `ERROR: ${e.message} · ejecutable: ${command}${prefix.length ? ` ${prefix.join(' ')}` : ''}`; }
      const ffmpeg = FFMPEG_PATH && fs.existsSync(FFMPEG_PATH) ? 'disponible' : 'NO disponible';
      const c = getConnection();
      return i.editReply(`🧪 **Diagnóstico bot-dc.v10**\n• Bot: ${client.isReady()?'Online':'Offline'}\n• Motor: ${engine}\n• Clientes YouTube: predeterminados de yt-dlp\n• FFmpeg: ${ffmpeg}\n• Voz: ${c?c.state.status:'Desconectado'}\n• Reproducción: ${currentTrack?currentTrack.title:'ninguna'}\n• Último error: ${lastError||'ninguno'}`);
    }
    if (i.commandName === 'play') {
      const member=await guild.members.fetch(i.user.id);
      if (!getConnection()) { if(!member.voice.channel) return i.editReply('Entra a un canal de voz y vuelve a usar /play.'); await connectToVoice(member.voice.channel,guild); }
      const q=i.options.getString('consulta',true);
      const tracks=await searchTracks(q);
      if (/^https?:\/\//i.test(q) || tracks.length===1) { addTracks(tracks); return i.editReply(`✅ Añadí **${tracks[0].title}** a la cola.`); }
      // Discord permite como máximo 25 opciones en un menú desplegable.
      const menuTracks = tracks.slice(0, 25);
      if (!menuTracks.length) return i.editReply({ content:'No encontré canciones reproducibles. Prueba otro nombre.', components:[] });
      const menu = new StringSelectMenuBuilder().setCustomId(`x23pick:${i.id}`).setPlaceholder('Elige la canción que querías').addOptions(menuTracks.map((t,n)=>({ label:String(t.title || 'Canción').slice(0,100), description:`${t.duration || 'Duración desconocida'} · ${t.source || 'Audio'}`.slice(0,100), value:String(n) })));
      const row=new ActionRowBuilder().addComponents(menu);
      const msg=await i.editReply({ content:`🔎 **Encontré ${menuTracks.length} canciones. Elige una para reproducir:**`, components:[row] });
      pendingSearches.set(i.id, menuTracks);
      const collector=msg.createMessageComponentCollector({ time:60000, max:1, filter: ci=>ci.customId===`x23pick:${i.id}` && ci.user.id===OWNER_ID });
      collector.on('end', collected=>{ pendingSearches.delete(i.id); if(!collected.size) i.editReply({content:'⌛ La búsqueda caducó. Usa /play para buscar otra vez.',components:[]}).catch(()=>{}); });
      return;
    }
    if (i.commandName === 'pausa') return i.editReply(player.pause()?'⏸️ Música pausada.':'No hay música reproduciéndose.');
    if (i.commandName === 'reanudar') return i.editReply(player.unpause()?'▶️ Música reanudada.':'No hay música pausada.');
    if (i.commandName === 'saltar') { if(!currentTrack) return i.editReply('No hay canción actual.'); skipRequested=true; player.stop(true); return i.editReply('⏭️ Canción saltada.'); }
    if (i.commandName === 'cola') { const items=queue.slice(0,10).map((t,n)=>`${n+1}. ${t.title}`).join('\n'); return i.editReply({content:`**Ahora:** ${currentTrack?currentTrack.title:'Nada'}\n${items?`**Siguiente:**\n${items}`:'La cola está vacía.'}`}); }
    if (i.commandName === 'parar') { queue=[];currentTrack=null;processing=false;skipRequested=true;stopAudioProcesses();player.stop(true);return i.editReply('⏹️ Música detenida y cola vaciada.'); }
    if (i.commandName === 'aleatorio') { if(queue.length<2) return i.editReply('Añade al menos dos canciones para mezclar la cola.'); for(let n=queue.length-1;n>0;n--){const j=Math.floor(Math.random()*(n+1));[queue[n],queue[j]]=[queue[j],queue[n]];} return i.editReply(`🔀 Cola mezclada (${queue.length} canciones).`); }
    if (i.commandName === 'repetir') { repeatMode=i.options.getString('modo',true); return i.editReply(`🔁 Repetición: **${({off:'desactivada',track:'canción actual',queue:'toda la cola'})[repeatMode]}**.`); }
    if (i.commandName === 'volumen') { volumeLevel=i.options.getInteger('nivel',true)/100; const resource=player.state.resource; if(resource?.volume) resource.volume.setVolume(volumeLevel); return i.editReply(`🔊 Volumen ajustado al **${Math.round(volumeLevel*100)}%**.`); }
    if (i.commandName === 'quitar') { const pos=i.options.getInteger('posicion',true)-1; if(pos<0||pos>=queue.length) return i.editReply('No existe una canción en esa posición. Usa /cola para ver los números.'); const [removed]=queue.splice(pos,1); return i.editReply(`🗑️ Quité **${removed.title}** de la cola.`); }
    if (i.commandName === 'limpiar') { const removed=queue.length; queue=[]; return i.editReply(`🧹 Cola vaciada. Se quitaron ${removed} canciones; la actual sigue sonando.`); }
    if (i.commandName === 'autoplay') { autoplayEnabled=i.options.getBoolean('activo',true); return i.editReply(`♾️ Autoplay ${autoplayEnabled?'activado':'desactivado'}.`); }
  } catch(e) { console.error('Comando falló:',e); lastError=e.message; const message=`❌ ${e.message || 'Ocurrió un error. Revisa los logs de Render.'}`; if(i.deferred||i.replied) await i.editReply({content:message,components:[]}).catch(()=>{}); else await i.reply({content:message,ephemeral:true}).catch(()=>{}); }
});
const server=app.listen(process.env.PORT||10000,'0.0.0.0',()=>console.log('API escuchando.'));
async function start(){ await registerCommands(); await client.login(DISCORD_TOKEN); }
start().catch(e=>{ console.error('No se pudo iniciar:',e); process.exit(1); });
process.on('unhandledRejection', reason => {
  const message = reason instanceof Error ? reason.message : String(reason);
  lastError = `Error asíncrono no controlado: ${message}`;
  // Do not dump full objects: some libraries may include temporary connection data.
  console.error('[Unhandled rejection]', message);
});
process.on('SIGTERM',()=>{stopAudioProcesses();const c=getConnection();if(c)c.destroy();client.destroy();server.close(()=>process.exit(0));});
