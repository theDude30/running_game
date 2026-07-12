/**
 * Audio sources: each yields a decoded AudioBuffer; everything downstream
 * (analysis, playback, sync) is source-agnostic.
 */

let ctx: AudioContext | null = null;

/** Lazily created after a user gesture (browser autoplay policy). */
export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export async function decodeArrayBuffer(data: ArrayBuffer): Promise<AudioBuffer> {
  return getAudioContext().decodeAudioData(data);
}

/**
 * Dev-only YouTube extraction via the local yt-dlp server
 * (server/audio-server.mjs, proxied under /api). Never ships in store builds.
 */
export async function fetchYouTubeAudio(
  url: string,
  onStatus?: (msg: string) => void,
): Promise<ArrayBuffer> {
  onStatus?.('Downloading audio…');
  const res = await fetch(`/api/audio?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Audio server error (${res.status}). Is "npm run dev:audio" running?`);
  }
  return res.arrayBuffer();
}

export function loadLocalFile(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}
