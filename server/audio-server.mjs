/**
 * Dev-only audio extraction server: GET /api/audio?url=<youtube url>
 * streams the audio track of a YouTube video using the locally installed
 * yt-dlp. Results are cached on disk keyed by video URL hash.
 *
 * This is a prototyping tool (see README §2) — it is never bundled with or
 * deployed alongside the game.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5181;
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
mkdirSync(CACHE_DIR, { recursive: true });

const MIME = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

function isYouTubeUrl(raw) {
  try {
    const u = new URL(raw);
    return ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(
      u.hostname,
    );
  } catch {
    return false;
  }
}

function findCached(key) {
  return readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith(key + '.'))
    .map((f) => path.join(CACHE_DIR, f))[0];
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(body);
}

function streamFile(res, file) {
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (u.pathname === '/api/health') {
    const check = spawn('yt-dlp', ['--version']);
    check.on('error', () => send(res, 500, 'yt-dlp not installed'));
    check.on('exit', (code) =>
      code === 0 ? send(res, 200, 'ok') : send(res, 500, 'yt-dlp not working'),
    );
    return;
  }

  if (u.pathname !== '/api/audio') return send(res, 404, 'not found');

  const videoUrl = u.searchParams.get('url') ?? '';
  if (!isYouTubeUrl(videoUrl)) return send(res, 400, 'not a YouTube URL');

  const key = createHash('sha1').update(videoUrl).digest('hex').slice(0, 16);
  const cached = findCached(key);
  if (cached) return streamFile(res, cached);

  const outTemplate = path.join(CACHE_DIR, `${key}.%(ext)s`);
  const dl = spawn('yt-dlp', [
    '-f',
    'bestaudio[ext=m4a]/bestaudio',
    '--no-playlist',
    '--max-filesize',
    '60M',
    '-o',
    outTemplate,
    videoUrl,
  ]);

  let stderr = '';
  dl.stderr.on('data', (d) => (stderr += d));
  dl.on('error', () => send(res, 500, 'yt-dlp not installed — brew install yt-dlp'));
  dl.on('exit', (code) => {
    if (code !== 0) return send(res, 500, `yt-dlp failed: ${stderr.slice(-400)}`);
    const file = findCached(key);
    if (!file) return send(res, 500, 'download finished but file not found');
    streamFile(res, file);
  });
});

server.listen(PORT, () => {
  console.log(`[audio-server] listening on http://localhost:${PORT}`);
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
});
