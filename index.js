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

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID, WEB_API_TOKEN, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SOUNDCLOUD_CLIENT_ID } = process.env;
const missing = ['DISCORD_TOKEN','CLIENT_ID','GUILD_ID','OWNER_ID','WEB_API_TOKEN'].filter(k => !process.env[k]);
if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}. Configúralas en Render > Environment.`);

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
const SEARCH_TIMEOUT_MS = 15000;
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

function normalizeVideo(v) {
  if (!v || typeof v !== 'object' || typeof v.url !== 'string' || !v.url) return null;
  return { title: v.title || 'Video de YouTube', url: v.url, duration: v.durationRaw || '—', source: 'YouTube', thumbnail: v.thumbnails?.[0]?.url || null };
}
// SoundCloud must be configured before ANY search or stream call. On Render,
// an explicit SOUNDCLOUD_CLIENT_ID is preferred; otherwise try play-dl's resolver.
let soundCloudClientIdPromise = null;
async function ensureSoundCloudClientId() {
  if (!soundCloudClientIdPromise) {
    soundCloudClientIdPromise = (async () => {
      let clientId = typeof SOUNDCLOUD_CLIENT_ID === 'string' ? SOUNDCLOUD_CLIENT_ID.trim() : '';
      if (!clientId) {
        if (typeof play.getFreeClientID !== 'function') throw new Error('play-dl no ofrece getFreeClientID().');
        clientId = await timeout(play.getFreeClientID(), SEARCH_TIMEOUT_MS, 'SoundCloud tardó demasiado en obtener su client_id.');
      }
      if (typeof clientId !== 'string' || !clientId.trim()) throw new Error('SoundCloud no devolvió un client_id válido.');
      // Re-apply before every use too: some play-dl paths read this shared config lazily.
      if (typeof play.setToken !== 'function') throw new Error('Esta versión de play-dl no permite configurar SoundCloud.');
      play.setToken({ soundcloud: { client_id: clientId.trim() } });
      console.log(`SoundCloud preparado (${SOUNDCLOUD_CLIENT_ID ? 'client_id de Render' : 'client_id automático'}).`);
      return clientId.trim();
    })().catch(error => {
      soundCloudClientIdPromise = null;
      throw new Error(`No se pudo inicializar SoundCloud: ${error?.message || error}`);
    });
  }
  const id = await soundCloudClientIdPromise;
  play.setToken({ soundcloud: { client_id: id } });
  return id;
}
function normalizeSoundCloud(v) {
  if (!v || typeof v !== 'object' || typeof v.url !== 'string' || !/^https?:\/\/(www\.)?soundcloud\.com\//i.test(v.url)) return null;
  const seconds = Number(v.durationInSec);
  return {
    title: v.name || v.title || 'Pista de SoundCloud',
    url: v.url,
    duration: v.durationRaw || (Number.isFinite(seconds) && seconds >= 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '—'),
    source: 'SoundCloud',
    thumbnail: v.thumbnail || v.user?.thumbnail || null
  };
}
async function searchSoundCloud(query, limit = 5) {
  await ensureSoundCloudClientId();
  const results = await timeout(
    play.search(query, { limit, source: { soundcloud: 'tracks' } }),
    SEARCH_TIMEOUT_MS,
    'La búsqueda en SoundCloud tardó demasiado.'
  );
  return (Array.isArray(results) ? results : []).map(normalizeSoundCloud).filter(Boolean);
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
  try { const sc=await searchSoundCloud(q,1); if(sc.length) return {...sc[0],title:displayTitle,source:'Spotify → SoundCloud'}; }
  catch(e) { console.warn(`SoundCloud no pudo resolver “${q}”: ${e.message}`); }
  const found=await timeout(play.search(q,{limit:1,source:{youtube:'video'}}),SEARCH_TIMEOUT_MS,`La búsqueda de “${q}” tardó demasiado.`);
  const v=found.find(x=>x?.url);
  return v?{...normalizeVideo(v),source:'Spotify → YouTube',title:displayTitle}:null;
}
async function searchTracks(query) {
  const q=String(query||'').trim();
  if(!q)throw new Error('Escribe una canción o pega un enlace de YouTube/Spotify.');
  if(q.length>300)throw new Error('La búsqueda es demasiado larga.');
  if(/^https?:\/\//i.test(q)){
    if(/spotify\.com/i.test(q)){
      const imported=await spotifyItems(q), input=imported.tracks.slice(0,imported.playlist?50:1), mapped=[];
      for(const track of input){try{const match=await spotifyToPlayable(track);if(match)mapped.push(match);}catch(e){console.warn(`No se encontró coincidencia para ${spotifyQuery(track)}: ${e.message}`);}}
      if(!mapped.length)throw new Error('Leí Spotify, pero no encontré coincidencias reproducibles.');
      return mapped;
    }
    if(!/(youtube\.com|youtu\.be)/i.test(q))throw new Error('Usa una búsqueda por nombre o un enlace de YouTube/Spotify.');
    if(/youtube\.com\/playlist|[?&]list=/i.test(q)){
      const info=await timeout(play.playlist_info(q,{incomplete:true}),SEARCH_TIMEOUT_MS,'La playlist tardó demasiado en cargar. Prueba de nuevo.');
      const videos=await timeout(info.all_videos(),SEARCH_TIMEOUT_MS,'No pude cargar las canciones de esa playlist.');
      return videos.filter(v=>v?.url).map(normalizeVideo).filter(Boolean).slice(0,100);
    }
    const info=await timeout(play.video_basic_info(q),SEARCH_TIMEOUT_MS,'YouTube tardó demasiado en responder. Inténtalo otra vez.');
    const video = normalizeVideo(info?.video_details);
    if (!video) throw new Error('YouTube no devolvió un enlace de audio válido para esa canción.');
    return [video];
  }
  // Prefer SoundCloud for text searches. This avoids making every request hit
  // YouTube first, which is currently returning HTTP 429 from Render.
  try {
    const soundCloudTracks = await searchSoundCloud(q, 5);
    if (soundCloudTracks.length) return soundCloudTracks;
  } catch (soundCloudError) {
    console.warn(`Falló la búsqueda en SoundCloud (${soundCloudError.message}); probando YouTube.`);
  }
  try {
    const results = await timeout(
      play.search(q, { limit: 5, source: { youtube: 'video' } }),
      SEARCH_TIMEOUT_MS,
      'La búsqueda en YouTube tardó demasiado.'
    );
    const tracks = (Array.isArray(results) ? results : []).map(normalizeVideo).filter(Boolean);
    if (tracks.length) return tracks;
  } catch (youtubeError) {
    console.warn(`También falló la búsqueda en YouTube (${youtubeError.message}).`);
  }
  throw new Error('No pude encontrar la canción en YouTube ni en SoundCloud. Puede ser una limitación temporal; espera unos minutos y prueba otra vez.');
}
async function findSoundCloudFallback(track) {
  const query = String(track?.title || '')
    .replace(/\s*[—-]\s*(YouTube|SoundCloud).*$/i, '')
    .replace(/\s*\((Video Con Letras|Letras\/Lyrics|Lyrics|Official Video)\)/ig, '')
    .trim();
  if (!query) throw new Error('No hay título para buscar una fuente alternativa.');

  await ensureSoundCloudClientId();
  const results = await timeout(
    play.search(query, { limit: 8, source: { soundcloud: 'tracks' } }),
    SEARCH_TIMEOUT_MS,
    'La búsqueda alternativa en SoundCloud tardó demasiado.'
  );
  const candidates = (Array.isArray(results) ? results : [])
    .filter(item => item && typeof item.url === 'string' && /^https?:\/\/(www\.)?soundcloud\.com\//i.test(item.url))
    .slice(0, 8);
  if (!candidates.length) throw new Error('No encontré una pista válida en SoundCloud. Prueba con artista + canción.');

  const failures = [];
  for (const candidate of candidates) {
    try {
      await ensureSoundCloudClientId();
      const stream = await timeout(
        play.stream(candidate.url),
        STREAM_TIMEOUT_MS,
        'SoundCloud tardó demasiado en preparar esta pista.'
      );
      if (!stream || !stream.stream) throw new Error('SoundCloud no devolvió un flujo de audio válido.');
      const seconds = Number(candidate.durationInSec);
      const duration = candidate.durationRaw || (Number.isFinite(seconds) && seconds >= 0
        ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
        : track.duration);
      return {
        stream,
        track: {
          ...track,
          title: candidate.name || candidate.title || track.title,
          url: candidate.url,
          source: 'SoundCloud',
          thumbnail: candidate.thumbnail || candidate.user?.thumbnail || track.thumbnail || null,
          duration: duration || track.duration
        }
      };
    } catch (error) {
      failures.push(`${error?.message || error}`);
      console.warn(`SoundCloud descartó una coincidencia para “${query}”: ${error?.message || error}`);
    }
  }
  throw new Error(`SoundCloud encontró pistas, pero ninguna se pudo transmitir (${failures.slice(0, 2).join('; ')}). Prueba otra búsqueda o inténtalo más tarde.`);
}

async function startNext() {
  if (processing || !queue.length) {
    if (!queue.length && !processing && player.state.status === AudioPlayerStatus.Idle) currentTrack = null;
    return;
  }
  processing = true;
  const track = queue.shift();
  currentTrack = track;
  try {
    let activeTrack = track;
    let stream;
    try {
      if (/soundcloud\.com/i.test(String(track.url || '')) || /soundcloud/i.test(String(track.source || ''))) await ensureSoundCloudClientId();
      stream = await timeout(
        play.stream(track.url),
        STREAM_TIMEOUT_MS,
        'La fuente principal tardó demasiado en preparar el audio.'
      );
    } catch (primaryError) {
      const sourceText = `${String(track.url || '')} ${String(track.source || '')}`;
      const isYoutube = /youtube\.com|youtu\.be|youtube/i.test(sourceText);
      const isSoundCloud = /soundcloud/i.test(sourceText);
      if (!isYoutube && !isSoundCloud) throw primaryError;
      console.warn(`Falló el audio principal para “${track.title}” (${primaryError.message}); buscando otra coincidencia en SoundCloud.`);
      const fallback = await findSoundCloudFallback(track);
      stream = fallback.stream;
      activeTrack = fallback.track;
      currentTrack = activeTrack;
    }
    if (!stream || !stream.stream) throw new Error('La fuente no devolvió un flujo de audio válido.');
    const resource = createAudioResource(stream.stream,{
      inputType: stream.type || StreamType.Arbitrary,
      metadata: activeTrack,
      inlineVolume: true
    });
    resource.volume?.setVolume(volumeLevel);
    player.play(resource);
    lastError = null;
    console.log(`Reproduciendo: ${activeTrack.title} [${activeTrack.source || 'audio'}]`);
  } catch (e) {
    lastError = `No se pudo reproducir “${track.title}”: ${e.message}`;
    console.error(lastError);
    currentTrack = null;
    processing = false;
    // Cool down after provider errors instead of hammering the same upstream service.
    setTimeout(() => {
      startNext().catch(err => {
        lastError = err?.message || 'Error al continuar la cola.';
        console.error(lastError);
      });
    }, 5000);
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
app.post('/api/music/stop', requireApi, (_req,res) => { queue=[]; currentTrack=null; processing=false; skipRequested=true; player.stop(true); res.json({ ok:true, stopped:true }); });

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
      const menu = new StringSelectMenuBuilder().setCustomId(`x23pick:${i.id}`).setPlaceholder('Elige la canción que querías').addOptions(tracks.slice(0,5).map((t,n)=>({ label:t.title.slice(0,100), description:`${t.duration || 'Duración desconocida'} · ${t.source || 'Audio'}`.slice(0,100), value:String(n) })));
      const row=new ActionRowBuilder().addComponents(menu);
      const msg=await i.editReply({ content:'🔎 **Encontré estas canciones. Elige una para reproducir:**', components:[row] });
      pendingSearches.set(i.id, tracks);
      const collector=msg.createMessageComponentCollector({ time:60000, max:1, filter: ci=>ci.customId===`x23pick:${i.id}` && ci.user.id===OWNER_ID });
      collector.on('end', collected=>{ pendingSearches.delete(i.id); if(!collected.size) i.editReply({content:'⌛ La búsqueda caducó. Usa /play para buscar otra vez.',components:[]}).catch(()=>{}); });
      return;
    }
    if (i.commandName === 'pausa') return i.editReply(player.pause()?'⏸️ Música pausada.':'No hay música reproduciéndose.');
    if (i.commandName === 'reanudar') return i.editReply(player.unpause()?'▶️ Música reanudada.':'No hay música pausada.');
    if (i.commandName === 'saltar') { if(!currentTrack) return i.editReply('No hay canción actual.'); skipRequested=true; player.stop(true); return i.editReply('⏭️ Canción saltada.'); }
    if (i.commandName === 'cola') { const items=queue.slice(0,10).map((t,n)=>`${n+1}. ${t.title}`).join('\n'); return i.editReply({content:`**Ahora:** ${currentTrack?currentTrack.title:'Nada'}\n${items?`**Siguiente:**\n${items}`:'La cola está vacía.'}`}); }
    if (i.commandName === 'parar') { queue=[];currentTrack=null;processing=false;skipRequested=true;player.stop(true);return i.editReply('⏹️ Música detenida y cola vaciada.'); }
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
process.on('SIGTERM',()=>{const c=getConnection();if(c)c.destroy();client.destroy();server.close(()=>process.exit(0));});
