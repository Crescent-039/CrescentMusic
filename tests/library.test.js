import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { audioHash, copyAudio, isManaged, sidecarLyrics } from '../src/library.js';

test('managed copy keeps source bytes and survives source deletion; reimport reuses the copy', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'crescent-copy-'));
  try {
    const source = path.join(folder, 'Original.FLAC'), music = path.join(folder, 'Music');
    await fs.writeFile(source, 'audio fixture');
    await fs.writeFile(path.join(folder, 'Original.lrc'), '[00:01]Hello');
    const hash = await audioHash(source);
    const copy = await copyAudio(source, music, 'track-1', hash);
    assert.equal(await audioHash(source), hash);
    assert.equal(await audioHash(copy), hash);
    assert.equal(await sidecarLyrics(source), '[00:01]Hello');
    const before = await fs.stat(copy);
    assert.equal(await copyAudio(source, music, 'track-1', hash), copy);
    assert.equal((await fs.stat(copy)).mtimeMs, before.mtimeMs);
    await fs.unlink(source);
    assert.equal(await fs.readFile(copy, 'utf8'), 'audio fixture');
    assert.equal(isManaged(copy, music), true);
    assert.equal(isManaged(source, music), false);
    assert.equal(isManaged(path.join(folder, 'Music-other', 'x.flac'), music), false);
    assert.equal(await copyAudio(copy, music, 'track-1', hash), copy);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('different song IDs preserve same-named files; a failed copy remains explicit and cleans temporary files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'crescent-copy-'));
  try {
    const music = path.join(folder, 'Music');
    await fs.mkdir(path.join(folder, 'a')); await fs.mkdir(path.join(folder, 'b'));
    const a = path.join(folder, 'a', 'Song.mp3'), b = path.join(folder, 'b', 'Song.mp3');
    await fs.writeFile(a, 'first'); await fs.writeFile(b, 'second');
    const first = await copyAudio(a, music, 'a', await audioHash(a));
    const second = await copyAudio(b, music, 'b', await audioHash(b));
    assert.notEqual(first, second);
    assert.equal(await fs.readFile(first, 'utf8'), 'first');
    assert.equal(await fs.readFile(second, 'utf8'), 'second');
    await assert.rejects(copyAudio(a, music, 'bad', 'wrong hash'), /源文件发生变化/);
    await assert.rejects(copyAudio(a, music, '../escape', await audioHash(a)), /歌曲 ID 无效/);
    assert.deepEqual((await fs.readdir(music)).sort(), ['a.mp3', 'b.mp3']);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
