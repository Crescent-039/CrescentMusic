// Count real playback, excluding pauses, stalls and seek jumps.
export class ListeningSession {
  constructor(duration) {
    this.duration = duration;
    this.seconds = 0;
    this.counted = false;
    this.anchor = null;
  }
  resetAnchor() { this.anchor = null; }
  update(position, now, playing) {
    if (playing && this.anchor) {
      const media = position - this.anchor.position;
      const wall = (now - this.anchor.now) / 1000;
      if (media > 0 && media <= 2 && wall > 0) this.seconds += Math.min(media, wall);
    }
    this.anchor = playing ? { position, now } : null;
    if (!this.counted && this.seconds > 60) {
      this.counted = true;
      return true;
    }
    return false;
  }
  finish() {
    if (!this.counted && this.duration > 0 && this.duration <= 60 && this.seconds >= this.duration * 0.9) {
      this.counted = true;
      return true;
    }
    return false;
  }
}

export function parseLrc(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const tag of tags) lines.push({ time: Number(tag[1]) * 60 + Number(tag[2]), text: content });
  }
  return lines.sort((a, b) => a.time - b.time);
}
