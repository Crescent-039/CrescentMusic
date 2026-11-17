import { app, BrowserWindow, ipcMain, dialog, protocol, globalShortcut, shell, nativeImage } from 'electron';
import { backup } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioResponse } from './audio-response.js';
import { savePlaylistOrder } from './playlist-order.js';
import { createTaskbar } from './taskbar.js';
import {createFloatingLyrics} from './floating-lyrics.js';
import { randomUUID } from 'node:crypto';
import { parseFile, selectCover } from 'music-metadata';
import { openStore } from './store.js';
import { audioHash, copyAudio, isManaged, sidecarLyrics } from './library.js';
import { migrateRelease } from './upgrade.js';
import { readNeteaseDatabase, planNeteaseImport, applyNeteaseImport } from './netease.js';
import { reconcileCountSnapshots } from './count-snapshots.js';
import { readCreatedNeteasePlaylists,importCreatedPlaylists,reconcilePlaylistItems } from './netease-playlists.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const customData = app.commandLine.getSwitchValue('user-data-dir');
if (customData) app.setPath('userData', path.resolve(customData));
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.setAppUserModelId('local.crescent.music');
protocol.registerSchemesAsPrivileged([{ scheme: 'crescent', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win, store, musicFolder, dataFolder, scanning = false;
const extensions = new Set(['.mp3','.flac','.wav','.ogg','.opus','.m4a','.aac','.aiff','.aif','.webm']);
const requireTrack = id => {
  const track = store.all('SELECT id,path,favorite FROM tracks WHERE id=?', [id])[0];
  if (!track) throw new Error('歌曲已从音乐库移除');
  return track;
};
const handle = (name, fn) => ipcMain.handle(name, async (_event, ...args) => {
  const result = await fn(...args);
  return result;
});
async function* walk(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && extensions.has(path.extname(full).toLowerCase())) yield full;
  }
}
async function scan(folders, selectedFiles = null) {
  if (scanning) throw new Error('正在扫描音乐库，请稍候');
  scanning = true;
  let processed = 0; const errors = [];
  let lastProgress = 0;
  const progress = (force = false) => {
    if (force || Date.now()-lastProgress >= 100) { lastProgress=Date.now();win.webContents.send('scan-progress',{processed,errors:errors.length}); }
  };
  try {
    for (const folder of selectedFiles ? ['selection'] : folders) {
      for await (const filename of selectedFiles || walk(folder)) {
        const existing = store.all('SELECT id,file_size,mtime_ms,missing FROM tracks WHERE path=?',[filename])[0];
        if (existing && isManaged(filename,musicFolder)) {
          const stat = await fs.stat(filename);
          if (stat.size===existing.file_size && stat.mtimeMs===existing.mtime_ms) {
            const lyrics = await sidecarLyrics(filename);
            if (lyrics) store.run('UPDATE tracks SET lyrics=? WHERE id=?',[lyrics,existing.id]);
            if (existing.missing) store.run('UPDATE tracks SET missing=0 WHERE id=?',[existing.id]);
            processed++;progress();continue;
          }
        }
        let metadata;
        try {
          metadata = await parseFile(filename);
          if (!metadata.format.codec) throw new Error('无法识别有效的音频编码');
        }
        catch (error) {
          errors.push({file:filename,message:error.message});
          progress();
          continue;
        }
          const hash = await audioHash(filename);
          const old = store.all('SELECT id,path,title,content_hash FROM tracks WHERE path=? OR content_hash=? ORDER BY path=? DESC LIMIT 1', [filename, hash, filename])[0];
          const stem = path.basename(filename,path.extname(filename));
          const id = old ? old.id : isManaged(filename,musicFolder) && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(stem) ? stem : randomUUID();
          const managedPath = await copyAudio(filename, musicFolder, id, hash);
          const { common, format } = metadata;
          const picture = selectCover(common.picture);
          const cover = picture ? `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}` : null;
          let lyrics = null;
          if (common.lyrics?.length) {
            const l = common.lyrics[0];
            lyrics = typeof l === 'string' ? l : l.syncText?.length ? l.syncText.map(x => `[${Math.floor(x.timestamp / 60000)}:${((x.timestamp % 60000) / 1000).toFixed(2)}]${x.text}`).join('\n') : l.text ?? null;
          }
          lyrics = lyrics || await sidecarLyrics(filename);
          const title = common.title || (isManaged(filename,musicFolder) ? old?.title : stem) || stem;
          if (old) store.run('UPDATE tracks SET path=?,content_hash=?,title=?,artist=?,album=?,duration=?,format=?,cover=?,lyrics=COALESCE(?,lyrics),missing=0 WHERE id=?', [managedPath, hash, title, common.artist || '未知歌手', common.album || '未知专辑', format.duration || 0, path.extname(filename).slice(1).toUpperCase(), cover, lyrics, id]);
          else store.run('INSERT INTO tracks (id,path,content_hash,title,artist,album,duration,format,cover,lyrics,added) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, managedPath, hash, title, common.artist || '未知歌手', common.album || '未知专辑', format.duration || 0, path.extname(filename).slice(1).toUpperCase(), cover, lyrics, Date.now()]);
          const stat = await fs.stat(managedPath);
          store.run('UPDATE tracks SET cover_version=?,file_size=?,mtime_ms=? WHERE id=?', [Date.now(),stat.size,stat.mtimeMs,id]);
          processed++;
        progress();
      }
    }
    for (const track of store.all('SELECT id,path FROM tracks')) {
      if (!isManaged(track.path, musicFolder)) { store.run('UPDATE tracks SET missing=1 WHERE id=?', [track.id]); continue; }
      try { await fs.access(track.path); store.run('UPDATE tracks SET missing=0 WHERE id=?', [track.id]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; store.run('UPDATE tracks SET missing=1 WHERE id=?', [track.id]); }
    }
    
    reconcileCountSnapshots(store);
    reconcilePlaylistItems(store);
    progress(true);
    return { processed, errors };
  } finally { scanning = false;win.webContents.send('scan-progress',{processed,errors:errors.length,done:true}); }
}
async function jsonFetch(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`网易云请求失败：HTTP ${response.status}`);
  const data = await response.json();
  if (data.code !== 200) throw new Error(`网易云接口返回：${data.code}`);
  return data;
}

async function migrateLibrary() {
  const errors = [];
  for (const track of store.all('SELECT id,path,content_hash FROM tracks')) {
    if (isManaged(track.path, musicFolder) && track.content_hash) continue;
    let hash, destination, lyrics, stat;
    try {
      hash = track.content_hash || await audioHash(track.path);
      lyrics = store.all('SELECT lyrics FROM tracks WHERE id=?',[track.id])[0].lyrics || await sidecarLyrics(track.path);
      destination = await copyAudio(track.path, musicFolder, track.id, hash);
      stat = await fs.stat(destination);
    } catch (error) {
      store.run('UPDATE tracks SET missing=1 WHERE id=?', [track.id]);
      errors.push({file:track.path,message:error.message});
      continue;
    }
    store.run('UPDATE tracks SET path=?,content_hash=?,lyrics=?,missing=0,file_size=?,mtime_ms=? WHERE id=?', [destination,hash,lyrics,stat.size,stat.mtimeMs,track.id]);
  }
  return errors;
}

async function start() {
const softwareRoot = app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(here, '..');
dataFolder = customData ? app.getPath('userData') : path.join(softwareRoot,'Data');
const build=JSON.parse(await fs.readFile(path.join(here,'..','package.json'),'utf8'));
if (!customData&&build.crescentDataMigration!=='portable-only') await migrateRelease(softwareRoot,softwareRoot,path.join(app.getPath('userData'),'crescent.sqlite'));
store = await openStore(path.join(dataFolder,'crescent.sqlite'));
musicFolder = path.join(customData ? app.getPath('userData') : softwareRoot, 'Music');
await fs.mkdir(musicFolder, { recursive: true });
const migrationErrors = await migrateLibrary();
let taskbar;
handle('taskbar-update',({id,playing,hasQueue})=>{
  if(process.platform!=='win32')return;
  const track=id?store.all('SELECT id,title,artist,favorite,cover_version FROM tracks WHERE id=?',[id])[0]:null;
  const canPlay=!!store.all('SELECT id FROM tracks WHERE missing=0 LIMIT 1').length;
  taskbar.update({track,playing,hasQueue,canPlay});
});
const coverCache = new Map();
let coverBytes = 0;
protocol.handle('crescent', request => {
  const url = new URL(request.url);
  if (url.hostname === 'cover') {
    const [,kind,id] = url.pathname.split('/');
    if (!['track','playlist'].includes(kind) || !id) return new Response('Unknown cover', {status:404});
    const size = Number(url.searchParams.get('size') || 320);
    if (![96,320].includes(size)) return new Response('Invalid thumbnail size', {status:400});
    let bytes = coverCache.get(request.url);
    if (bytes) { coverCache.delete(request.url); coverCache.set(request.url,bytes); }
    else {
      const row = store.all(`SELECT cover FROM ${kind === 'track' ? 'tracks' : 'playlists'} WHERE id=?`,[id])[0];
      if (!row?.cover) return new Response('Cover not found', {status:404});
      const img = nativeImage.createFromDataURL(row.cover);
      if (img.isEmpty()) return new Response('Invalid cover data', {status:422});
      bytes = img.resize({width:size,height:size,quality:'good'}).toPNG();
      coverCache.set(request.url,bytes);
      coverBytes += bytes.length;
      while (coverCache.size > 256 || coverBytes > 16*1024*1024) {
        const oldest = coverCache.keys().next().value;
        coverBytes -= coverCache.get(oldest).length;
        coverCache.delete(oldest);
      }
    }
    return new Response(bytes,{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000, immutable'}});
  }
  if (url.hostname !== 'audio') return new Response('Not found', { status: 404 });
  const track = requireTrack(decodeURIComponent(url.pathname.slice(1)));
  if (!isManaged(track.path, musicFolder)) return new Response('Audio must be imported into the managed library', { status: 403 });
  return audioResponse(track.path,request);
});
handle('snapshot', () => ({ ...store.snapshot(), musicFolder, dataFolder }));
handle('collections', () => store.collections());
handle('playlist-reorder',(id,order)=>savePlaylistOrder(store,id,order));
handle('playlist-entries',id=>store.all('SELECT song_id,position,title,artist,album,duration,known,local_track AS localTrack,suppressed FROM remote_playlist_items WHERE playlist=? ORDER BY position',[id]));
handle('netease-playlists',async()=>{
  if(scanning)throw new Error('请等待音乐扫描完成后同步歌单');
  const source=path.join(app.getPath('appData'),'..','Local','NetEase','CloudMusic','Library','webdb.dat');
  const bundle=readCreatedNeteasePlaylists(source);
  const directory=path.join(dataFolder,'imports');await fs.mkdir(directory,{recursive:true});
  const stamp=Date.now(),backupFile=path.join(directory,`before-playlist-sync-${stamp}.sqlite`);
  await backup(store.db,backupFile);
  const playlists=importCreatedPlaylists(store,bundle);
  const file=path.join(directory,`created-playlists-${stamp}.json`);
  const report={source,backup:backupFile,capturedAt:bundle.capturedAt,playlists};
  await fs.writeFile(file,JSON.stringify(report,null,2));
  return {...report,report:file};
});
let neteasePreview=null;
handle('netease-preview',async chooseFile=>{
  let file=path.join(app.getPath('appData'),'..','Local','NetEase','CloudMusic','Library','webdb.dat');
  if(chooseFile){
    const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'网易云数据库',extensions:['dat','sqlite','db']}]});
    if(result.canceled)return null;
    file=result.filePaths[0];
  }
  const history=readNeteaseDatabase(file);
  const plan=planNeteaseImport(history,store.snapshot().tracks);
  const token=randomUUID();neteasePreview={token,plan};
  return {token,source:file,totalRecords:history.totalRecords,eligibleRecords:history.eligibleRecords,matchedSongs:plan.matchedSongs,matchedEvents:plan.matchedEvents,songs:plan.songs};
});
handle('netease-apply',async(token,choices)=>{
  if(scanning)throw new Error('请等待音乐扫描完成后迁移记录');
  if(!neteasePreview||neteasePreview.token!==token)throw new Error('预览已失效，请重新读取网易云记录');
  const directory=path.join(dataFolder,'imports');await fs.mkdir(directory,{recursive:true});
  const stamp=Date.now();const backupFile=path.join(directory,`before-netease-${stamp}.sqlite`);
  await backup(store.db,backupFile);
  const report=applyNeteaseImport(store,neteasePreview.plan,choices);
  report.backup=backupFile;report.report=path.join(directory,`netease-${stamp}.json`);
  await fs.writeFile(report.report,JSON.stringify(report,null,2));
  neteasePreview=null;return report;
});
handle('import', async kind => {
  const result = await dialog.showOpenDialog(win, { properties: kind === 'folder' ? ['openDirectory','multiSelections'] : ['openFile','multiSelections'], filters: [{ name: '音频文件', extensions: [...extensions].map(x => x.slice(1)) }] });
  if (result.canceled) return null;
  if (kind === 'folder') return scan(result.filePaths);
  return scanSelected(result.filePaths);
});
async function scanSelected(files) {
  return scan([], files);
}
handle('rescan', () => scan([musicFolder]));
handle('library-open', () => shell.openPath(musicFolder));
handle('window-minimize', () => win.minimize());
handle('window-maximize', () => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized(); });
handle('window-close', () => win.close());
handle('favorite', id => { const t = requireTrack(id);const favorite=t.favorite?0:1;store.run('UPDATE tracks SET favorite=? WHERE id=?',[favorite,id]);return favorite; });
handle('playlist-create', name => { if (!name.trim()) throw new Error('请输入歌单名称'); store.run('INSERT INTO playlists (id,name) VALUES (?,?)',[randomUUID(),name.trim()]);  });
handle('playlist-rename', (id,name) => { if (!name.trim()) throw new Error('请输入歌单名称'); store.run('UPDATE playlists SET name=? WHERE id=?',[name.trim(),id]);  });
handle('playlist-delete', id => { store.run('DELETE FROM playlists WHERE id=?',[id]); });
handle('playlist-add', (playlist,track) => { requireTrack(track); if (!store.all('SELECT id FROM playlists WHERE id=?',[playlist]).length) throw new Error('歌单不存在'); store.run('INSERT OR IGNORE INTO playlist_tracks VALUES (?,?,?)',[playlist,track,Date.now()]);  });
handle('playlist-remove', (playlist,track) => { store.run('DELETE FROM playlist_tracks WHERE playlist=? AND track=?',[playlist,track]);store.run('UPDATE remote_playlist_items SET local_track=NULL,managed=0,suppressed=1 WHERE playlist=? AND local_track=?',[playlist,track]); });
handle('playlist-cover', async id => {
  const r = await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'封面图片',extensions:['jpg','jpeg','png','webp']}]});
  if (r.canceled) return;
  const bytes = await fs.readFile(r.filePaths[0]);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('请选择小于 10 MB 的图片');
  const ext = path.extname(r.filePaths[0]).slice(1).replace('jpg','jpeg');
  store.run('UPDATE playlists SET cover=?,cover_version=? WHERE id=?',[`data:image/${ext};base64,${bytes.toString('base64')}`,Date.now(),id]);
});
handle('played', id => { requireTrack(id);store.run('INSERT INTO plays (track,at) VALUES (?,?)',[id,Date.now()]);return {stats:store.trackStats(id),daily:store.daily()}; });
handle('recent', id => { requireTrack(id); store.run('INSERT OR REPLACE INTO settings VALUES (?,?)',[`recent:${id}`,JSON.stringify(Date.now())]);  });
handle('settings', values => { for (const [key,value] of Object.entries(values)) store.run('INSERT OR REPLACE INTO settings VALUES (?,?)',[key,JSON.stringify(value)]);  });
handle('lyrics', async id => {
  const t = requireTrack(id);
  const lyrics = store.all('SELECT lyrics FROM tracks WHERE id=?',[id])[0].lyrics;
  if (lyrics) return lyrics;
  try { return await fs.readFile(t.path.slice(0,-path.extname(t.path).length) + '.lrc','utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
});
handle('lyrics-search', async query => {
  const data = await jsonFetch(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&limit=12`);
  return (data.result?.songs || []).map(s => ({id:s.id,title:s.name,artist:s.artists.map(a=>a.name).join(' / '),album:s.album.name,duration:s.duration/1000}));
});
handle('lyrics-download', async (id, songId) => {
  requireTrack(id);
  if (!/^\d+$/.test(String(songId))) throw new Error('请输入有效的网易云歌曲 ID');
  const data = await jsonFetch(`https://music.163.com/api/song/lyric?id=${songId}&lv=-1&kv=-1&tv=-1`);
  if (!data.lrc?.lyric) throw new Error(data.nolyric ? '这首歌是纯音乐' : '网易云暂时没有这首歌的歌词');
  const text = [data.lrc.lyric,data.tlyric?.lyric].filter(Boolean).join('\n');
  store.run('UPDATE tracks SET lyrics=? WHERE id=?',[text,id]);  return text;
});
handle('lyrics-import', async id => {
  requireTrack(id);
  const r = await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'歌词',extensions:['lrc','txt']}]});
  if (r.canceled) return null;
  const text = await fs.readFile(r.filePaths[0],'utf8'); store.run('UPDATE tracks SET lyrics=? WHERE id=?',[text,id]);  return text;
});
handle('backup', async () => {
  const r = await dialog.showSaveDialog(win,{defaultPath:'Crescent-backup.sqlite',filters:[{name:'Crescent 数据备份',extensions:['sqlite']}]});
  if (r.canceled) return false;
  await backup(store.db, r.filePath); return true;
});
handle('restore', async () => {
  if (scanning) throw new Error('请等待音乐扫描完成后恢复备份');
  const r = await dialog.showOpenDialog(win,{filters:[{name:'Crescent 数据备份',extensions:['sqlite']}],properties:['openFile']});
  if (r.canceled) return false;
  const confirmation = await dialog.showMessageBox(win,{type:'question',buttons:['取消','恢复备份'],defaultId:0,message:'恢复将替换当前歌单、收藏和播放记录。当前数据会自动保留为恢复前备份。'});
  if (confirmation.response !== 1) return false;
  const file = store.file;
  const candidate = await openStore(r.filePaths[0], { readOnly: true });
  try {
    for (const query of ['SELECT id,path,title,artist,album,duration,format,cover,lyrics,added,favorite,missing FROM tracks LIMIT 0','SELECT id,name,cover FROM playlists LIMIT 0','SELECT playlist,track,position FROM playlist_tracks LIMIT 0','SELECT track,at FROM plays LIMIT 0','SELECT key,value FROM settings LIMIT 0']) candidate.all(query);
  } finally { candidate.db.close(); }
  if (path.resolve(r.filePaths[0]).toLowerCase() === path.resolve(file).toLowerCase()) throw new Error('请选择导出的备份文件');
  await backup(store.db,file + '.before-restore');
  store.db.close(); await fs.copyFile(r.filePaths[0], file); store = await openStore(file);
  coverCache.clear();
  coverBytes = 0;
  const errors = await migrateLibrary();
  if (errors.length) throw new Error(`备份已恢复，${errors.length} 首歌曲复制失败：${errors.map(e=>e.message).join('；')}`);
  return true;
});
handle('reveal', id => shell.showItemInFolder(requireTrack(id).path));

win = new BrowserWindow({ width: 1440, height: 940, minWidth: 1060, minHeight: 720, frame:false, backgroundColor:'#141519', title:'Crescent Music', icon:path.join(here,'assets/taskbar/app.png'), autoHideMenuBar:true, webPreferences:{ preload:path.join(here,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
if(process.platform==='win32')taskbar=createTaskbar(win,path.join(here,'assets/taskbar'),id=>store.all('SELECT cover FROM tracks WHERE id=?',[id])[0].cover);
win.on('page-title-updated',event=>event.preventDefault());
const floatingLyrics=createFloatingLyrics(win,here);
handle('floating-lyrics-toggle',()=>floatingLyrics.toggle());
handle('floating-lyrics-update',data=>floatingLyrics.update(data));
win.on('maximize', () => win.webContents.send('window-state', true));
win.on('unmaximize', () => win.webContents.send('window-state', false));
win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
win.webContents.on('will-navigate', e => e.preventDefault());
await win.loadFile(path.join(here,'index.html'));
if (!store.all('SELECT id FROM tracks LIMIT 1').length && !(await walk(musicFolder).next()).done) {
  await scan([musicFolder]);
  win.webContents.send('library-updated');
}
if (migrationErrors.length) await dialog.showMessageBox(win, { type:'warning', message:`${migrationErrors.length} 首已有歌曲复制失败，请重新导入对应源文件。`, detail:migrationErrors.map(e=>`${e.file}: ${e.message}`).join('\n') });
for (const [key,action] of Object.entries({'MediaPlayPause':'toggle','MediaNextTrack':'next','MediaPreviousTrack':'previous','CommandOrControl+Alt+Space':'toggle','CommandOrControl+Alt+Right':'next','CommandOrControl+Alt+Left':'previous'})) {
  if (!globalShortcut.register(key, () => win.webContents.send('transport',action))) console.warn(`快捷键注册失败：${key}`);
}
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
}
app.whenReady().then(start).catch(error => {
  console.error(error);
  dialog.showErrorBox('Crescent 启动失败', error.stack);
  app.quit();
});
