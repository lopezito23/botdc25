# X23 Music v6.6 — motor de audio actualizado

Esta versión cambia el motor principal de extracción a **yt-dlp + FFmpeg**, para dejar de depender del extractor `play-dl` que estaba devolviendo HTTP 429/404. Conserva el dashboard, las rutas de API y los controles existentes.

## Despliegue en Render
1. Descarga este ZIP y reemplaza los archivos del repositorio conectado a Render por los de la carpeta `x23-music-fixed`.
2. En Render → tu Web Service → **Settings**, configura **Build Command** como `npm install` y **Start Command** como `npm start`.
3. Conserva estas variables: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `OWNER_ID`, `WEB_API_TOKEN`. Spotify es opcional: `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET`. `SOUNDCLOUD_CLIENT_ID` ya no es necesario para el motor principal.
4. Haz **Manual Deploy → Clear build cache & deploy** si Render conserva dependencias de una versión anterior.
5. Cuando termine el deploy, usa `/diagnostico` en tu servidor de Discord. Debe mostrar una versión de yt-dlp y `FFmpeg: disponible`.
6. Entra a un canal de voz y prueba `/play consulta: nombre de canción`. También puedes probar un enlace público de YouTube o SoundCloud.

El script `postinstall` intenta descargar el ejecutable de yt-dlp; si falla, intenta instalarlo con Python/pip. Comprueba los logs de build para confirmar que uno de esos métodos terminó correctamente.

## Comandos slash
- `/entrar`, `/salir`, `/estado`, `/diagnostico`
- `/play consulta` — búsqueda o URL de YouTube, SoundCloud o Spotify
- `/pausa`, `/reanudar`, `/saltar`, `/parar`
- `/cola`, `/quitar`, `/limpiar`, `/aleatorio`
- `/repetir modo`, `/volumen nivel`, `/autoplay activo`

## Importante sobre el “100%”
Ningún extractor puede garantizar disponibilidad del 100%: YouTube y SoundCloud pueden limitar solicitudes, bloquear IPs de alojamiento o cambiar sus sistemas. Este ZIP cambia el motor y agrega diagnóstico, pero la confirmación final requiere desplegarlo y escuchar una canción en tu servidor de Discord. Si `/diagnostico` muestra error de yt-dlp, comparte ese resultado y los logs de Render; no cambies el token de Discord por un error de extracción de audio.
