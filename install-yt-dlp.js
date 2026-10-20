const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
const binDir = path.join(__dirname, 'bin');
const binary = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
(async () => {
  try {
    fs.mkdirSync(binDir, { recursive: true });
    await YTDlpWrap.downloadFromGithub(binary);
    if (process.platform !== 'win32') fs.chmodSync(binary, 0o755);
    console.log('yt-dlp instalado correctamente.');
  } catch (err) {
    console.warn('No se pudo descargar el binario de yt-dlp:', err.message);
    console.warn('Intentando instalar yt-dlp mediante Python/pip...');
    const python = process.env.PYTHON || 'python3';
    const pip = spawnSync(python, ['-m','pip','install','--user','--upgrade','yt-dlp'], { stdio: 'inherit' });
    if (pip.status === 0) console.log('yt-dlp instalado mediante Python.');
    else console.warn('No se pudo instalar yt-dlp mediante Python. Revisa los logs de Render y el comando /diagnostico.');
  }
})();
