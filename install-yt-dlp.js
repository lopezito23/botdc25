const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const binDir = path.join(__dirname, 'bin');
const binary = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const python = process.env.PYTHON || 'python3';

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Demasiadas redirecciones al descargar yt-dlp.'));
    const request = https.get(url, { headers: { 'User-Agent': 'X23-Music-Bot' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1));
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

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
}

(async () => {
  fs.mkdirSync(binDir, { recursive: true });
  try {
    console.log('Descargando yt-dlp nightly...');
    await download('https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp', binary);
    if (process.platform !== 'win32') fs.chmodSync(binary, 0o755);
    const check = run(binary, ['--version']);
    if (check.status !== 0) throw new Error((check.stderr || check.error?.message || 'No se pudo ejecutar el binario').trim());
    console.log(`yt-dlp nightly instalado como binario: ${(check.stdout || '').trim()}`);
    process.exit(0);
  } catch (err) {
    console.warn('No se pudo instalar el binario de yt-dlp:', err.message);
    try { if (fs.existsSync(binary)) fs.unlinkSync(binary); } catch {}
  }

  // Instala con el MISMO intérprete que usa index.js en runtime.
  console.log(`Instalando yt-dlp con Python: ${python}`);
  let pip = run(python, ['-m', 'pip', 'install', '--upgrade', '--pre', 'yt-dlp[default]']);
  if (pip.stdout) process.stdout.write(pip.stdout);
  if (pip.stderr) process.stderr.write(pip.stderr);

  if (pip.status !== 0) {
    console.warn('pip falló; intentando instalar pip en el mismo entorno...');
    const ensure = run(python, ['-m', 'ensurepip', '--upgrade']);
    if (ensure.stdout) process.stdout.write(ensure.stdout);
    if (ensure.stderr) process.stderr.write(ensure.stderr);
    pip = run(python, ['-m', 'pip', 'install', '--upgrade', '--pre', 'yt-dlp[default]']);
    if (pip.stdout) process.stdout.write(pip.stdout);
    if (pip.stderr) process.stderr.write(pip.stderr);
  }

  const check = run(python, ['-m', 'yt_dlp', '--version']);
  if (check.status !== 0) {
    console.error('ERROR: yt-dlp no quedó instalado en el Python usado por la aplicación.');
    console.error((check.stderr || check.error?.message || 'No se pudo verificar yt-dlp').trim());
    process.exit(1);
  }
  console.log(`yt-dlp instalado mediante Python (${python}): ${(check.stdout || '').trim()}`);
})().catch(err => {
  console.error('Fallo inesperado instalando yt-dlp:', err.message);
  process.exit(1);
});
