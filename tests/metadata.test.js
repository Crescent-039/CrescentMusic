import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseFile, selectCover } from 'music-metadata';
for (const [file,title] of [['Moonrise.mp3','Moonrise'],['Afterglow.flac','Afterglow']]) {
  test(`extracts title, artist, album, duration and cover from real ${file}`,async()=>{
    const m=await parseFile(fileURLToPath(new URL(`./fixtures/${file}`,import.meta.url)));
    assert.equal(m.common.title,title);assert.equal(m.common.artist,'Crescent Studio');assert.equal(m.common.album,'First Light');
    assert.ok(m.format.duration>=3&&m.format.duration<3.1);
    const art=selectCover(m.common.picture);assert.equal(art.format,'image/png');assert.ok(art.data.length>1000);
  });
}
