# X23 Music v6.1 — Bot, API y dashboard

## Archivos
- `index.js`, `package.json`: bot + API para Render.
- `index.html`, `styles.css`, `app.js`: dashboard estático para GitHub Pages.

## Render
Sube todos los archivos del ZIP a la raíz del repositorio `botdc25`, reemplazando los archivos con el mismo nombre. El mismo servicio Render sirve la página en `/` y la API en `/api/...`. En Render usa:
- Build command: `npm install`
- Start command: `npm start`
- Variables: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `OWNER_ID`, `WEB_API_TOKEN`

`GET /health` no necesita token. Las demás rutas API requieren `Authorization: Bearer WEB_API_TOKEN`.

## Configurar Spotify (una sola vez)
1. Entra en https://developer.spotify.com/dashboard y crea una aplicación.
2. Copia el **Client ID** y el **Client Secret**.
3. En Render → tu servicio → **Environment**, agrega `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET`.
4. Guarda los cambios y espera el redeploy. No pongas esas credenciales en el HTML ni en GitHub.
5. En el dashboard, pega un enlace público de una canción, álbum o playlist de Spotify.

El dashboard guarda automáticamente la URL y el `WEB_API_TOKEN` en el almacenamiento local del navegador después de conectar correctamente. La próxima vez intentará reconectarse solo. Usa esto solo en tu propio equipo; borrar los datos del sitio o usar otro navegador elimina ese guardado. El guardado no evita que Render se suspenda ni que la API esté temporalmente fuera de servicio.

## Dashboard
La web está servida por el mismo servicio Render. Abre `https://botdc25.onrender.com/`, deja esa URL en el campo de API y escribe el mismo `WEB_API_TOKEN` configurado en Render. No necesitas un repositorio separado ni GitHub Pages.

## Funciones
- `/play consulta` en Discord muestra hasta cinco sugerencias para búsquedas por nombre; selecciona una para añadirla a la cola.\n- Spotify: importa canciones, álbumes y playlists públicas; convierte cada canción en una coincidencia reproducible de YouTube. Las playlists se procesan hasta 50 canciones por búsqueda para reducir el riesgo de límites de solicitudes.
- En la web, busca por nombre, elige una sugerencia y añádela.
- API: `GET /api/music/search?q=...`, `POST /api/music/play`, pausa, reanudar, saltar, detener y cola.
- Tiempo límite en búsquedas y preparación del audio; errores visibles en vez de dejar la interfaz cargando sin fin. Si la preparación del audio de YouTube falla, intenta buscar y reproducir una coincidencia en SoundCloud. Registro de estados de conexión de voz para diagnosticar fallos de handshake.

## Diagnóstico de conexión de voz
Los logs de Render muestran `[Voice State]` y `[Voice Debug]`. Si la conexión nunca llega a `ready`, el problema ocurre antes de reproducir audio: revisa permisos, el estado de voz de Discord y la secuencia de logs. Actualizar dependencias y mostrar un error claro no puede garantizar que Discord o el proveedor de hosting completen cada conexión.

## Limitaciones honestas
No existe una forma de garantizar que un bot de música “nunca falle”. YouTube puede cambiar su extracción, Render gratis puede suspender/reiniciar, y Discord puede desconectar la voz. Este código añade límites de tiempo, mensajes de error, un intento alternativo de SoundCloud cuando falla la preparación de audio de YouTube y avance a la siguiente pista si ambas fuentes fallan. Requiere pruebas reales tras desplegar; SoundCloud también puede no tener la canción o limitar solicitudes. Spotify se usa para leer metadatos; el audio se busca en YouTube. No se reproduce audio directamente desde Spotify. La integración requiere credenciales de Spotify Developer y las playlists deben ser accesibles públicamente.

## Seguridad
No subas secretos a GitHub. Si el token del bot se expuso, restablécelo en Discord Developer Portal. El `WEB_API_TOKEN` solo debe configurarse en Render y escribirse manualmente en el dashboard.
