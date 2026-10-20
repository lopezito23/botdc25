const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const binDir = path.join(__dirname, 'bin');
const binary = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Demasiadas redirecciones al descargar yt-dlp.'));
    const request = https.get(url, { headers: { 'User-Agent': 'X23-Music-Bot' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        return resolve(download(next, destination, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`GitHub respondió HTTP ${response.statusCode}`));
      }
      const output = fs.createWriteStream(destination);
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(45000, () => request.destroy(new Error('Tiempo agotado descargando yt-dlp.')));
  });
}

(async () => {
  try {
    fs.mkdirSync(binDir, { recursive: true });
    console.log('Descargando yt-dlp nightly para corregir cambios recientes de YouTube...');
    await download('https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp', binary);
    if (process.platform !== 'win32') fs.chmodSync(binary, 0o755);
    const check = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 });
    if (check.status !== 0) throw new Error((check.stderr || check.error?.message || 'No se pudo ejecutar el binario').trim());
    console.log(`yt-dlp nightly instalado: ${(check.stdout || '').trim()}`);
  } catch (err) {
    console.warn('No se pudo instalar el binario nightly:', err.message);
    try { if (fs.existsSync(binary)) fs.unlinkSync(binary); } catch {}
    console.warn('Intentando instalar la versión nightly mediante Python/pip...');
    const python = process.env.PYTHON || 'python3';
    const pip = spawnSync(python, ['-m', 'pip', 'install', '--user', '--upgrade', '--pre', 'yt-dlp[default]'], { stdio: 'inherit' });
    if (pip.status === 0) console.log('yt-dlp nightly instalado mediante Python.');
    else console.warn('No se pudo instalar yt-dlp. Comprueba los logs de Render.');
  }
})();
