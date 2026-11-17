import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export async function openStore(file, { readOnly = false } = {}) {
  if (!readOnly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { readOnly });
  try {
  db.exec('PRAGMA foreign_keys=ON');
  if (!readOnly) db.exec(`CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL, duration REAL NOT NULL, format TEXT NOT NULL, cover TEXT, lyrics TEXT, added INTEGER NOT NULL, favorite INTEGER DEFAULT 0, missing INTEGER DEFAULT 0, offset REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, cover TEXT);
    CREATE TABLE IF NOT EXISTS playlist_tracks (playlist TEXT REFERENCES playlists(id) ON DELETE CASCADE, track TEXT REFERENCES tracks(id), position INTEGER, PRIMARY KEY (playlist,track));
    CREATE TABLE IF NOT EXISTS playlist_orders(playlist TEXT PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,items TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS plays (id INTEGER PRIMARY KEY, track TEXT NOT NULL REFERENCES tracks(id), at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS count_snapshots(source_key TEXT PRIMARY KEY,rank INTEGER NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>=0),captured_at INTEGER NOT NULL,reference TEXT NOT NULL,local_title TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS play_baselines(track TEXT PRIMARY KEY REFERENCES tracks(id),total INTEGER NOT NULL CHECK(total>=0),captured_at INTEGER NOT NULL,play_id INTEGER NOT NULL,source_key TEXT NOT NULL REFERENCES count_snapshots(source_key));
    CREATE TABLE IF NOT EXISTS playlist_origins(playlist TEXT PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,external_id TEXT UNIQUE NOT NULL,expected_count INTEGER NOT NULL,cached_count INTEGER NOT NULL,cache_mismatch INTEGER NOT NULL,cached_at INTEGER,cover_url TEXT);
    CREATE TABLE IF NOT EXISTS remote_playlist_items(playlist TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,song_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,duration REAL NOT NULL,known INTEGER NOT NULL,local_track TEXT REFERENCES tracks(id),managed INTEGER NOT NULL,suppressed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(playlist,song_id));
    CREATE INDEX IF NOT EXISTS plays_track_at ON plays(track,at);`);
  if (!readOnly && !db.prepare('PRAGMA table_info(tracks)').all().some(column => column.name === 'content_hash')) {
    db.exec('ALTER TABLE tracks ADD COLUMN content_hash TEXT');
  }
  if (!readOnly) {
    if(!db.prepare('PRAGMA table_info(remote_playlist_items)').all().some(field=>field.name==='suppressed'))db.exec('ALTER TABLE remote_playlist_items ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0');
    if(!db.prepare('PRAGMA table_info(playlists)').all().some(field=>field.name==='sort_order'))db.exec('ALTER TABLE playlists ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    if(!db.prepare('PRAGMA table_info(count_snapshots)').all().some(field=>field.name==='local_artist'))db.exec('ALTER TABLE count_snapshots ADD COLUMN local_artist TEXT');
    for(const [column,type] of [['source',"TEXT NOT NULL DEFAULT 'crescent'"],['source_key','TEXT']]){
      if(!db.prepare('PRAGMA table_info(plays)').all().some(field=>field.name===column))db.exec(`ALTER TABLE plays ADD COLUMN ${column} ${type}`);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS plays_source_key ON plays(source_key) WHERE source_key IS NOT NULL');
    for (const column of ['file_size','mtime_ms']) {
      if (!db.prepare('PRAGMA table_info(tracks)').all().some(field => field.name === column)) db.exec(`ALTER TABLE tracks ADD COLUMN ${column} REAL`);
    }
    for (const table of ['tracks', 'playlists']) {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'cover_version')) db.exec(`ALTER TABLE ${table} ADD COLUMN cover_version INTEGER NOT NULL DEFAULT 0`);
    }
    db.exec('CREATE INDEX IF NOT EXISTS tracks_content_hash ON tracks(content_hash); CREATE INDEX IF NOT EXISTS plays_at ON plays(at)');
  }
  } catch (error) { db.close(); throw error; }
  const statements = new Map();
  const statement = sql => { if (!statements.has(sql)) statements.set(sql,db.prepare(sql)); return statements.get(sql); };
  const all = (sql, params = []) => statement(sql).all(...params);
  const run = (sql, params = []) => statement(sql).run(...params);
  const collections = () => ({
    playlists: all("SELECT p.id,p.name,CASE WHEN p.cover IS NOT NULL THEN 'crescent://cover/playlist/' || p.id || '?v=' || p.cover_version END AS cover,o.external_id AS externalId,o.expected_count AS remoteCount,o.cached_count AS cachedCount,o.cache_mismatch AS cacheMismatch FROM playlists p LEFT JOIN playlist_origins o ON o.playlist=p.id ORDER BY p.sort_order,p.rowid"),
    playlistOrders: Object.fromEntries(all('SELECT * FROM playlist_orders').map(r=>[r.playlist,JSON.parse(r.items)])),
    memberships: all('SELECT * FROM playlist_tracks ORDER BY position')
  });
  const daily = () => all("SELECT strftime('%Y-%m-%d',at/1000,'unixepoch','localtime') AS day, COUNT(*) AS count FROM plays WHERE at>=? GROUP BY day", [Date.now()-7*86400000]);
  const trackStats = id => all(`SELECT COALESCE(b.total,0)+COALESCE(SUM(CASE WHEN p.id IS NULL THEN 0 WHEN b.track IS NULL OR (p.id>b.play_id AND (p.source='crescent' OR p.at>b.captured_at)) THEN 1 ELSE 0 END),0) AS plays,
    COALESCE(SUM(p.at>=?),0) AS weekPlays,COALESCE(MAX(p.at),0) AS lastPlayed
    FROM tracks t LEFT JOIN play_baselines b ON b.track=t.id LEFT JOIN plays p ON p.track=t.id WHERE t.id=?`,[Date.now()-7*86400000,id])[0];
  return { db, file, all, run, collections, daily, trackStats, snapshot() {
    const week = Date.now() - 7 * 86400000;
    return {
      tracks: all(`SELECT t.id,t.path,t.title,t.artist,t.album,t.duration,t.format,t.added,t.favorite,t.missing,t.content_hash,
        CASE WHEN t.cover IS NOT NULL THEN 'crescent://cover/track/' || t.id || '?v=' || t.cover_version END AS cover,
        COALESCE(b.total,0)+COALESCE(p.plays,0) AS plays,COALESCE(p.weekPlays,0) AS weekPlays,COALESCE(p.lastPlayed,0) AS lastPlayed
        FROM tracks t LEFT JOIN play_baselines b ON b.track=t.id
        LEFT JOIN (SELECT p.track,SUM(CASE WHEN b.track IS NULL OR (p.id>b.play_id AND (p.source='crescent' OR p.at>b.captured_at)) THEN 1 ELSE 0 END) AS plays,
          SUM(p.at>=?) AS weekPlays,MAX(p.at) AS lastPlayed FROM plays p LEFT JOIN play_baselines b ON b.track=p.track GROUP BY p.track) p ON p.track=t.id ORDER BY t.added DESC`, [week]),
      ...collections(),
      settings: Object.fromEntries(all('SELECT * FROM settings').map(r => [r.key, JSON.parse(r.value)])),
      daily: daily()
    };
  } };
}
