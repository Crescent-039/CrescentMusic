import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export async function audioHash(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export function isManaged(filename, folder) {
  const relative = path.relative(folder, filename);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function copyAudio(source, folder, id, hash) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('音乐库歌曲 ID 无效');
  await fs.mkdir(folder, { recursive: true });
  const destination = path.join(folder, id + path.extname(source).toLowerCase());
  if (path.resolve(source) === path.resolve(destination)) return destination;
  try { if (await audioHash(destination) === hash) return destination; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = destination + '.' + randomUUID() + '.importing';
  try {
    await fs.copyFile(source, temporary);
    if (await audioHash(temporary) !== hash) throw new Error('复制期间源文件发生变化，请重新导入');
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return destination;
}

export async function sidecarLyrics(filename) {
  try { return await fs.readFile(filename.slice(0, -path.extname(filename).length) + '.lrc', 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
