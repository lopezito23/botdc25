# X23 Music — Bot + Web API + página web

Este paquete contiene:
- `bot/`: bot de Discord con comandos slash y API protegida.
- `web/`: página web estática para controlar reproducción, cola, pausa, reanudar, saltar y detener.

## Limitaciones importantes
- La reproducción está implementada para búsquedas y enlaces de YouTube usando `play-dl`. Los extractores de terceros pueden dejar de funcionar cuando las plataformas cambian sus sistemas o condiciones.
- Las playlists de YouTube compatibles se añaden a la cola.
- Spotify no reproduce su audio directamente en este bot. Para usar Spotify habría que integrar su API oficial para leer metadatos, y luego resolver las canciones mediante una fuente de reproducción autorizada; esta versión no importa playlists de Spotify.
- El token de la API se introduce manualmente en la página y no se guarda en el código de la web. No lo pongas en `app.js`, GitHub Pages ni en un repositorio público.
- Un servicio gratuito puede suspenderse o reiniciarse; UptimeRobot no garantiza voz 24/7.

## 1. Desplegar el bot en Render
1. Sube el contenido de la carpeta `bot/` a un repositorio privado o público de GitHub (no subas `.env`).
2. En Render, crea `New +` → `Web Service` y conecta ese repositorio.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Runtime: Node.
6. En Environment Variables, agrega:
   - `DISCORD_TOKEN`: token del bot de Discord
   - `CLIENT_ID`: ID de aplicación
   - `GUILD_ID`: ID del servidor de Discord
   - `OWNER_ID`: tu ID de usuario
   - `WEB_API_TOKEN`: un secreto largo y aleatorio que inventes
   - `PORT`: normalmente Render lo asigna; puedes omitirlo
7. En Discord Developer Portal, habilita el bot e invita al servidor con permisos de usar comandos y conectarse/hablar en voz.

## 2. Probar la API
Abre `https://TU-SERVICIO.onrender.com/health`. Debe responder `{"status":"ok"}`.
Los endpoints de control requieren `Authorization: Bearer TU_WEB_API_TOKEN`:
- `GET /api/status`
- `GET /api/music/queue`
- `POST /api/music/play` con JSON `{ "query": "nombre o enlace de YouTube" }`
- `POST /api/music/pause`
- `POST /api/music/resume`
- `POST /api/music/skip`
- `POST /api/music/stop`

Antes de mandar `/api/music/play`, el bot debe estar en un canal de voz. Usa `/entrar` desde Discord o `/play` para conectarlo automáticamente si ya estás en un canal de voz.

## 3. Publicar la página web
1. Sube los archivos de `web/` (`index.html`, `styles.css`, `app.js`) a otro repositorio de GitHub.
2. En GitHub, entra a Settings → Pages → Deploy from a branch → selecciona `main` y `/root` (o la carpeta donde pusiste los archivos).
3. Abre la URL de GitHub Pages.
4. En la web, introduce la URL pública de Render y el mismo `WEB_API_TOKEN`.
5. Pulsa “Conectar API”.

## 4. UptimeRobot
Crea un monitor HTTP(s) para `https://TU-SERVICIO.onrender.com/health`. Esto puede reducir suspensiones por inactividad, pero no evita todos los reinicios ni garantiza conexión de voz permanente.

## Seguridad
No compartas `DISCORD_TOKEN` ni `WEB_API_TOKEN`. Si un token se filtra, cámbialo inmediatamente.
