# X23 Music v6.5 — Bot avanzado, API y dashboard

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
- Controles avanzados en Discord y dashboard: repetición desactivada/canción/cola, aleatorio, volumen de 0–100%, autoplay y limpieza de cola.
- Administrar la cola desde la web: quitar pistas, moverlas arriba/abajo, mezclar y consultar historial reciente. Límite de 200 pistas en cola para evitar sobrecargas.
- Nuevos comandos: `/aleatorio`, `/repetir`, `/volumen`, `/quitar`, `/limpiar` y `/autoplay`. Solo el propietario configurado en `OWNER_ID` puede ejecutar los comandos de control.
- `/play consulta` en Discord muestra hasta cinco sugerencias para búsquedas por nombre; selecciona una para añadirla a la cola.
- Spotify: importa canciones, álbumes y playlists públicas; convierte cada canción en una coincidencia reproducible de YouTube. Las playlists se procesan hasta 50 canciones por búsqueda para reducir el riesgo de límites de solicitudes.
- En la web, busca por nombre, elige una sugerencia y añádela.
- API: `GET /api/music/search?q=...`, `POST /api/music/play`, pausa, reanudar, saltar, detener y cola.
- Tiempo límite en búsquedas y preparación del audio; errores visibles en vez de dejar la interfaz cargando sin fin. Si la preparación del audio de YouTube falla, inicializa el client_id de SoundCloud y luego intenta buscar y reproducir una coincidencia allí. Registro de estados de conexión de voz para diagnosticar fallos de handshake.

## Diagnóstico de conexión de voz
Los logs de Render muestran `[Voice State]` y `[Voice Debug]`. Si la conexión nunca llega a `ready`, el problema ocurre antes de reproducir audio: revisa permisos, el estado de voz de Discord y la secuencia de logs. Actualizar dependencias y mostrar un error claro no puede garantizar que Discord o el proveedor de hosting completen cada conexión.

## Limitaciones honestas
No existe una forma de garantizar que un bot de música “nunca falle”. YouTube puede cambiar su extracción, Render gratis puede suspender/reiniciar, y Discord puede desconectar la voz. Este código añade límites de tiempo, mensajes de error, inicialización automática del client_id de SoundCloud y un intento alternativo cuando falla la preparación de audio de YouTube y avance a la siguiente pista si ambas fuentes fallan. Requiere pruebas reales tras desplegar; SoundCloud también puede no tener la canción o limitar solicitudes. Spotify se usa para leer metadatos; el audio se busca en YouTube. No se reproduce audio directamente desde Spotify. La integración requiere credenciales de Spotify Developer y las playlists deben ser accesibles públicamente.

## Seguridad
No subas secretos a GitHub. Si el token del bot se expuso, restablécelo en Discord Developer Portal. El `WEB_API_TOKEN` solo debe configurarse en Render y escribirse manualmente en el dashboard.


### SoundCloud en Render (opcional)

La versión 6.3 y posteriores intentan resolver automáticamente el `client_id` de SoundCloud. Si la resolución automática falla, puedes añadir `SOUNDCLOUD_CLIENT_ID` en Render → Environment con un client ID válido de tu propia aplicación de SoundCloud. No pongas ese valor en el dashboard público ni en `app.js`.


### v6.5
- Añade repetición por canción o cola, mezcla, volumen, autoplay y límites de cola.
- Añade controles web para eliminar/reordenar pistas, vaciar o mezclar la cola y ver el historial reciente.
- Registra los mismos controles como comandos slash en Discord.

### v6.4
- Rechaza resultados de audio incompletos antes de que rompan la cola.
- Si una pista de SoundCloud devuelve 404 o falla al abrir el flujo, prueba otras coincidencias en lugar de detenerse en la primera.
- Reintenta buscar por el título limpio y muestra un error más útil si ninguna coincidencia puede transmitirse.
