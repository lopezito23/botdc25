# bot-dc.v10 — bot de música con Lavalink

Esta versión deja de extraer audio directamente con `yt-dlp` desde el proceso de Discord. Usa **Lavalink v4 + el plugin actualizado de YouTube**, con SoundCloud como fuente alternativa. Es una arquitectura más apropiada para un bot de música, pero ningún proveedor puede prometer reproducción sin errores al 100%: YouTube puede bloquear fuentes, y algunas pistas no están disponibles.

## Importante: son DOS servicios

El ZIP contiene:
- `index.js` y `package.json`: el bot de Discord (Node.js).
- `lavalink-server/`: el motor de audio (Java/Docker).

No basta con desplegar solo el bot. Los dos servicios deben estar funcionando y el bot necesita conectarse al motor.

## 1) Desplegar el motor Lavalink en Render

1. Sube el contenido de este ZIP a la raíz del repositorio de GitHub que usarás.
2. En Render, crea un **New → Web Service** usando ese repositorio.
3. En la configuración del servicio Lavalink, selecciona **Docker** y establece **Dockerfile Path** en `./lavalink-server/Dockerfile`.
4. Añade la variable de entorno `LAVALINK_PASSWORD` con una contraseña larga y única. Guárdala; la necesitarás en el servicio del bot.
5. Despliega y espera a que los logs indiquen que Lavalink inició correctamente y descargó el plugin de YouTube.
6. Copia el host público de este servicio, por ejemplo `mi-lavalink.onrender.com`, **sin** `https://` y sin ruta.

Si Render no detecta el puerto, configura el puerto HTTP interno del servicio como el valor de `PORT` que Render asigna (normalmente `10000`). El archivo `application.yml` usa `${PORT:2333}`.

## 2) Desplegar el bot de Discord

Puedes crear un segundo servicio de Render con el mismo repositorio y el entorno **Node**:
- **Build Command:** `npm install`
- **Start Command:** `npm start`

Si Render permite configurar Root Directory, déjalo vacío si `package.json` está en la raíz del repositorio.

Añade estas variables en el servicio del bot:

| Variable | Valor |
|---|---|
| `DISCORD_TOKEN` | Token privado de tu bot de Discord |
| `CLIENT_ID` | ID de aplicación del bot |
| `GUILD_ID` | ID del servidor donde registrar comandos |
| `LAVALINK_HOST` | Host público del servicio Lavalink, sin `https://` |
| `LAVALINK_PASSWORD` | La misma contraseña configurada en el servicio Lavalink |
| `LAVALINK_PORT` | `443` |
| `LAVALINK_SECURE` | `true` |

No necesitas `DATABASE_URL`, PostgreSQL, Spotify API key, SoundCloud API key ni `WEB_API_TOKEN` para esta versión de solo música.

## Comandos de música

- `/play cancion`: busca y reproduce una canción o un enlace.
- `/skip`: salta la canción actual.
- `/pause` y `/resume`: pausa y reanuda.
- `/stop`: detiene y limpia la cola.
- `/queue`: muestra la cola.
- `/nowplaying`: muestra la canción actual.
- `/volume nivel`: volumen del 1 al 100.
- `/leave`: desconecta el bot.

## Permisos de Discord

Invita el bot con los scopes `bot` y `applications.commands`. Dale permiso para ver canales, enviar mensajes, insertar enlaces, conectarse y hablar en el canal de voz.

## Diagnóstico

- El bot ofrece `https://TU-SERVICIO-BOT.onrender.com/health` con estado del bot y conexión a Lavalink.
- En los logs del bot busca `[Lavalink] Conectado al nodo render-lavalink`.
- Si no conecta, revisa primero que `LAVALINK_HOST`, `LAVALINK_PASSWORD`, `LAVALINK_PORT=443` y `LAVALINK_SECURE=true` coincidan.
- Si Lavalink arranca pero el plugin de YouTube falla, revisa sus logs: el plugin se descarga en el primer inicio.

## Nota honesta

La arquitectura elimina la dependencia directa de `yt-dlp` + FFmpeg del proceso Node del bot y usa un plugin de YouTube con múltiples clientes internos. No puede garantizar que cualquier vídeo esté disponible en cualquier momento. Respeta las condiciones de los servicios de origen y usa enlaces públicos reproducibles.
