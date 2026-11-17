import { ListeningSession, parseLrc } from './listening.js';
import { VirtualList } from './virtual-list.js';
import { playlistRows,orderedPlaylistRows } from './playlist-order.js';
import {createSongDetail} from './song-detail.js';
import {showPanel,hidePanel,transitionPage} from './transitions.js';
const $ = selector => document.querySelector(selector);
const api = (name, ...args) => window.crescent.call(name, ...args);
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = seconds => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2,'0')}`;
const cover = (url, cls = '') => `<div class="cover ${cls}">${url ? `<img src="${escape(url)}&size=96" loading="lazy" decoding="async" draggable="false" alt="歌曲封面">` : '♫'}</div>`;
let state, view = 'library', filtered = [], queue = [], queueIndex = -1, current = null, listening = null, mode = 'list', lyricText = '', lyricLines = [], drawer = '', timer = null, stopAfterSong = false, toastTimeout, modalSubmit, loadingTrack = 0;
const audio = $('#audio');
const heroMarkup = $('#hero-art').innerHTML;
function toast(message, duration = 4500) { clearTimeout(toastTimeout); $('#toast').textContent = message; $('#toast').classList.remove('hidden'); toastTimeout = setTimeout(() => $('#toast').classList.add('hidden'), duration); }
function report(error) { console.error(error); toast(error.message, 8000); }
window.addEventListener('unhandledrejection', event => { event.preventDefault(); report(event.reason); });
let tracksById = new Map(), playlistsById = new Map(), membershipsByPlaylist = new Map();
const orderedViews = new Map();
const playlistItems = new Map();
const playlistSorts = new Map();
let collectionRevision=0;
const markupCache = new Map();
const collator = new Intl.Collator('zh-CN');
function setMarkup(selector, markup) {
  if (markupCache.get(selector) === markup) return;
  $(selector).innerHTML = markup;
  markupCache.set(selector, markup);
}
async function refresh() {
  state = await api('snapshot');
  tracksById = new Map(state.tracks.map(t => { t.searchText = `${t.title} ${t.artist} ${t.album}`.toLocaleLowerCase(); return [t.id,t]; }));
  indexCollections();
  orderedViews.clear();
  render();
}
function indexCollections() {
  playlistItems.clear();collectionRevision++;
  playlistsById = new Map(state.playlists.map(p => [p.id,p]));
  membershipsByPlaylist = new Map(state.playlists.map(p => [p.id,[]]));
  for (const m of state.memberships) membershipsByPlaylist.get(m.playlist).push(m.track);
}
async function refreshCollections() {
  Object.assign(state,await api('collections'));
  indexCollections();orderedViews.clear();render();
}
async function favorite(id) {
  track(id).favorite=await api('favorite',id);
  orderedViews.clear();render();
}
async function recordPlay(id) {
  const update=await api('played',id);
  Object.assign(track(id),update.stats);state.daily=update.daily;
  orderedViews.clear();render();
}
const track = id => tracksById.get(id);
const playlist = () => playlistsById.get(view);
const songDetail=createSongDetail({getTrack:track,getLyrics:id=>api('lyrics',id),getOffset:id=>state.settings[`offset:${id}`]||0,
  onOpen:()=>{if(drawer){drawer='';hidePanel($('#drawer'),'drawer');}},
  onPlay:async id=>{if(current?.id===id)await toggle();else await play(id,filtered.filter(t=>!t.missing).map(t=>t.id));},
  onSeek:async(id,position)=>{if(current?.id!==id)await play(id,filtered.filter(t=>!t.missing).map(t=>t.id));audio.currentTime=Math.max(0,position);},
  onFavorite:favorite,onImport:async id=>{const text=await api('lyrics-import',id);if(text!==null&&current?.id===id)setLyrics(text);return text;},onSearch:id=>findLyrics(id),onError:report});
function playlistCover(p) { return p.cover || track(membershipsByPlaylist.get(p.id)[0])?.cover; }
function songRow(t,i) {
  if(t.externalOnly)return `<div class="track-row pending-track" data-order-key="${escape(t.orderKey)}" draggable="true" data-external-song="${escape(t.songId)}"><span class="track-index">${String(i+1).padStart(2,'0')}</span><div class="track-name">${cover(null)}<div class="track-info"><strong class="track-title">${escape(t.title)}<span class="format">待导入</span></strong><small>${escape(t.artist)}</small></div></div><span class="track-album">${escape(t.album)}</span><span class="track-plays">待匹配音频</span><span class="track-duration">${time(t.duration)}</span><span></span></div>`;
  return `<div class="track-row ${current?.id === t.id ? 'current' : ''} ${t.missing ? 'missing' : ''} ${t.id===selectedTrackId?'selected':''}" data-track="${t.id}" ${t.orderKey ? `data-order-key="${escape(t.orderKey)}"` : ''} draggable="true"><span class="track-index">${current?.id === t.id ? '♫' : String(i+1).padStart(2,'0')}</span><div class="track-name" data-action="play">${cover(t.cover)}<div class="track-info"><strong class="track-title">${escape(t.title)}<span class="format">${escape(t.format)}</span></strong><small>${escape(t.artist)}${t.missing ? ' · 文件已失效' : ''}</small></div></div><span class="track-album" title="${escape(t.album)}">${escape(t.album)}</span><span class="track-plays">${view === 'week' ? t.weekPlays : t.plays} 次</span><span class="track-duration">${time(t.duration)}</span><div class="row-actions"><button data-action="like" class="${t.favorite ? 'liked' : ''}" title="喜欢">${t.favorite ? '♥' : '♡'}</button><button data-action="more" title="更多操作">···</button></div></div>`;
}
const songList=new VirtualList($('#track-list'),songRow);
let queueList = null;
function render() {
  $('#library-count').textContent = state.tracks.length;
  setMarkup('#playlist-nav', state.playlists.map(p => `<button data-view="${p.id}">${playlistCover(p) ? `<img class="playlist-thumb" src="${escape(playlistCover(p))}&size=96" loading="lazy" decoding="async" alt="">` : '<i>▤</i>'}${escape(p.name)}</button>`).join(''));
  const total = state.tracks.reduce((n,t) => n + t.plays,0), week = state.tracks.reduce((n,t) => n + t.weekPlays,0);
  setMarkup('#overview', [['音乐库',state.tracks.length,'首','♫'],['喜欢的音乐',state.tracks.filter(t=>t.favorite).length,'首','♡'],['近七天播放',week,'次','↗'],['累计播放',total,'次','◷']].map(([label,n,unit,icon])=>`<div class="metric"><span class="metric-label">${label}</span><span class="metric-icon">${icon}</span><b>${n}<small>${unit}</small></b></div>`).join(''));
  renderPage();
  renderPlayback();
}
function renderPage() {
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const titles = {"library":["我的音乐库","","全部歌曲","我的音乐库"],"favorites":["我喜欢的音乐","","我喜欢的音乐","我喜欢的音乐"],"recent":["最近播放","","最近播放","最近播放"],"week":["本周常听","","本周常听","本周常听"],"unplayed":["还没听过","","还没听过","还没听过"],"rediscover":["久违的旋律","","久违的旋律","久违的旋律"],"stats":["听歌统计","","听歌统计","听歌统计"]};
  const p = playlist(); const title = p ? [p.name,'','歌单歌曲',p.name] : titles[view];
  $('#page-title').textContent = title[0]; $('#page-description').textContent = title[1]; $('#list-title').textContent = title[2]; $('#breadcrumb').textContent = title[3];
  $('#playlist-edit').classList.toggle('hidden', !p);
  $('#sort-source').hidden=!p;
  if(p)$('#sort').value=playlistSorts.get(p.id)||'source';else if($('#sort').value==='source')$('#sort').value='added';
  const art = p && playlistCover(p);
  setMarkup('#hero-art', art ? `<img class="hero-custom-cover" src="${escape(art)}" decoding="async" alt="歌单封面">` : heroMarkup);
  $('#stats-panel').classList.toggle('hidden', view !== 'stats');
  if (view === 'stats') renderStats();
  renderTable();
  if(p?.externalId&&!playlistItems.has(p.id))loadPlaylistItems(p.id);
}
async function loadPlaylistItems(id) {
  const revision=collectionRevision;
  const entries=await api('playlist-entries',id);
  if(revision!==collectionRevision)return;
  playlistItems.set(id,entries);orderedViews.clear();
  if(view===id)renderTable();
}
function importedPlaylistRows(p) {
  return orderedPlaylistRows(playlistRows(p.id,membershipsByPlaylist.get(p.id),playlistItems.get(p.id)||[],track),state.playlistOrders[p.id]||[]);
}
function renderTable() {
  const p = playlist();
  const sort = p ? $('#sort').value : view === 'week' ? 'weekPlays' : view === 'stats' ? 'plays' : view === 'recent' ? 'recent' : $('#sort').value;
  const key = `${view}:${sort}`;
  let rows = orderedViews.get(key);
  if (!rows) {
    rows = p?importedPlaylistRows(p):[...state.tracks];
    if (view === 'favorites') rows = rows.filter(t => t.favorite);
    if (view === 'week') rows = rows.filter(t => t.weekPlays > 0);
    if (view === 'unplayed') rows = rows.filter(t => t.plays === 0);
    if (view === 'rediscover') rows = rows.filter(t => t.lastPlayed > 0 && t.lastPlayed < Date.now()-30*86400000);
    if (view === 'recent') rows = rows.filter(t => state.settings[`recent:${t.id}`]);
    if(sort!=='source')rows.sort((a,b) => sort === 'title' ? collator.compare(a.title,b.title) : sort === 'recent' ? state.settings[`recent:${b.id}`]-state.settings[`recent:${a.id}`] : b[sort]-a[sort]);
    orderedViews.set(key,rows);
  }
  const query = $('#search').value.trim().toLocaleLowerCase();
  filtered = query ? rows.filter(t => t.searchText.includes(query)) : rows;
  $('#list-count').textContent = p?.externalId?`${filtered.filter(t=>!t.missing).length} 首本地可播放 / ${p.cachedCount} 条缓存记录`:`${filtered.length} 首音乐`;
  $('#empty').classList.toggle('hidden', filtered.length > 0);
  if (state.tracks.length) { $('#empty h3').textContent = '这里还很安静'; $('#empty p').textContent = '可以换个搜索词，或添加喜欢的歌曲。'; }
  songList.setItems(filtered);
}
function renderPlayback() {
  songList.draw();
  renderPlayer();
  if (drawer === 'queue') renderQueue();
}
function renderStats() {
  const days = Array.from({length:8},(_,i)=>{ const d = new Date(); d.setDate(d.getDate()-7+i); const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; return {label:`${d.getMonth()+1}/${d.getDate()}`,value:state.daily.find(x=>x.day===key)?.count || 0}; });
  const max = Math.max(1,...days.map(d=>d.value));
  $('#stats-panel').innerHTML = `<h3 class="stats-heading">近七天 · 每日播放次数</h3><p class="hint">最近 168 小时，按自然日汇总；首尾日期包含部分时段。</p><div class="chart">${days.map(d=>`<div class="chart-day"><span class="chart-value">${d.value}</span><div class="chart-bar"></div><span>${d.label}</span></div>`).join('')}</div>`;
  document.querySelectorAll('.chart-bar').forEach((bar,i)=>{bar.style.height=`${Math.max(3,days[i].value/max*80)}px`;});
}
function renderPlayer() {
  syncFloatingLyrics();
  songDetail.update(current?.id||null,audio.paused,audio.currentTime);
  if (!current) {
    setMarkup('#player-cover','♫');$('#player-title').textContent='准备好，听一首喜欢的歌';$('#player-artist').textContent='你的私人音乐空间';$('#player-like').textContent='♡';$('#player-like').classList.remove('liked');$('#queue-count').textContent=queue.length;
    syncTaskbar();return;
  }
  const t = track(current.id); if (t) current = t;
  setMarkup('#player-cover', current.cover ? `<img src="${escape(current.cover)}&size=96" decoding="async" alt="封面">` : '♫');
  $('#player-title').textContent = current.title; $('#player-artist').textContent = current.artist;
  $('#player-like').textContent = current.favorite ? '♥' : '♡'; $('#player-like').classList.toggle('liked',!!current.favorite);
  $('#queue-count').textContent = queue.length;
  syncTaskbar();
}
let taskbarSignature='';
function syncTaskbar() {
  const update={id:current?.id||null,playing:!audio.paused,hasQueue:queue.length>0};
  const signature=JSON.stringify([update,current?.favorite,current?.cover,state.tracks.length]);
  if(signature===taskbarSignature)return;
  taskbarSignature=signature;
  api('taskbar-update',update).catch(report);
}
let lastSavedQueue=null;
async function savePlayback() {
  const signature=queue.join(',');
  const values={playback:{id:current?.id || null,position:audio.currentTime,volume:audio.volume,mode}};
  if(signature!==lastSavedQueue)values.queue=queue;
  await api('settings',values);
  lastSavedQueue=signature;
}
async function markRecent(id) {
  await api('recent',id);
  state.settings[`recent:${id}`]=Date.now();
  orderedViews.clear();if(view==='recent')renderTable();
}
async function play(id, newQueue, restorePosition = 0, autoplay = true) {
  const t = track(id); if (!t) return; if (t.missing) throw new Error('音频文件已失效，请检查文件位置并重新扫描');
  const token = ++loadingTrack;
  const followDetail=songDetail.id===current?.id;
  audio.pause(); current = t;
  if(followDetail)songDetail.open(id).catch(report);
  if (newQueue) queue = [...newQueue]; queueIndex = queue.indexOf(id);
  listening = new ListeningSession(t.duration); lyricText = ''; lyricLines = [];
  audio.src = `crescent://audio/${id}`;
  audio.currentTime = restorePosition;
  renderPlayback();
  if (autoplay) { await audio.play(); await markRecent(id); }
  const text = await api('lyrics',id);
  if (token !== loadingTrack) return;
  setLyrics(text);
  await savePlayback();
}
async function toggle() { if (!current) { if(queue.length)await play(queue[0]);else {const available=filtered.filter(t=>!t.missing);if(available.length)await play(available[0].id,available.map(t=>t.id));} return; } if (audio.paused) { await audio.play(); await markRecent(current.id); } else audio.pause(); }
async function next(direction = 1, automatic = false) {
  if (!queue.length) return;
  if (automatic && mode === 'one') return play(current.id);
  if (mode === 'shuffle' && queue.length > 1) { const choices = queue.filter(id=>id!==current?.id); return play(choices[Math.floor(Math.random()*choices.length)]); }
  return play(queue[(queueIndex + direction + queue.length) % queue.length]);
}
function changeView(id) { clearTimeout(detailClickTimer);if(view===id)return;view=id;window.scrollTo(0,0);renderPage();transitionPage(document.querySelector('main')); }
function showModal(title, body, onSubmit, submitLabel = '保存') {
  $('#modal-title').textContent = title; $('#modal-body').innerHTML = body; $('#modal-submit').textContent = submitLabel; $('#modal-submit').classList.toggle('hidden', !onSubmit); $('#modal-cancel').textContent = onSubmit ? '取消' : '关闭'; modalSubmit = onSubmit; $('#modal').showModal();
}
$('#modal-form').addEventListener('submit',async e=>{e.preventDefault(); if (!modalSubmit) return; const button = $('#modal-submit'); button.disabled = true; try { await modalSubmit(new FormData(e.target)); $('#modal').close(); } catch (error) { report(error); } finally {button.disabled=false;} });
$('#modal-close').onclick = $('#modal-cancel').onclick = () => $('#modal').close();
function createPlaylist() { showModal('创建歌单','<label class="field">歌单名称<input name="name" placeholder="给喜欢的音乐取个名字" required maxlength="80" autofocus></label>',async data=>{await api('playlist-create',data.get('name')); await refreshCollections(); toast('歌单已创建');}); }
async function importMusic(kind) {
  document.querySelectorAll('[data-import]').forEach(button=>button.disabled=true);
  try {
    const result = await api('import',kind); if (!result) return;
    await refresh(); toast(`扫描完成：${result.processed} 首歌曲${result.errors.length ? `\n${result.errors.length} 个文件读取失败：\n${result.errors.slice(0,4).map(x=>`${x.file}: ${x.message}`).join('\n')}` : ''}`,result.errors.length ? 10000 : 4500);
  } finally { document.querySelectorAll('[data-import]').forEach(button=>button.disabled=false);$('#import-files').textContent='＋ 导入音乐'; }
}
let detailClickTimer;
let selectedTrackId=null;
document.addEventListener('click',async e=>{
  clearTimeout(detailClickTimer);
  try {
    const nav = e.target.closest('[data-view]'); if (nav) changeView(nav.dataset.view);
    const row = e.target.closest('[data-track]'), action = e.target.closest('[data-action]')?.dataset.action;
    if (row && action) {
      const id = row.dataset.track;
      if (action === 'like') { await favorite(id); }
      if (action === 'more') trackMenu(id);
    }
    if(row?.classList.contains('track-row')&&!e.target.closest('button')){
      selectedTrackId=row.dataset.track;
      document.querySelectorAll('#track-list [data-track]').forEach(item=>item.classList.toggle('selected',item.dataset.track===selectedTrackId));
      clearTimeout(detailClickTimer);const id=row.dataset.track;
      if(e.target.closest('.track-name .cover, .track-title'))detailClickTimer=setTimeout(()=>songDetail.open(id).catch(report),280);
    }
  } catch (error) { report(error); }
});
$('#track-list').addEventListener('dblclick',event=>{
  const row=event.target.closest('[data-track]');if(!row||event.target.closest('button'))return;
  clearTimeout(detailClickTimer);play(row.dataset.track,filtered.filter(t=>!t.missing).map(t=>t.id)).catch(report);
});
$('#player-cover').onclick=$('#player-title').onclick=()=>{if(current)songDetail.open(current.id).catch(report);};
function trackMenu(id) {
  const t = track(id);
  showModal(t.title,`<div class="drawer-tools"><button type="button" class="secondary" id="add-next">下一首播放</button><button type="button" class="secondary" id="reveal-file">打开所在文件夹</button>${playlist() ? '<button type="button" class="secondary" id="remove-track">从此歌单移除</button>' : ''}</div><label class="field">加入歌单<select name="playlist" ${state.playlists.length ? '' : 'disabled'}>${state.playlists.map(p=>`<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></label>${state.playlists.length ? '' : '<p class="hint">在左侧「我的歌单」旁点击 ＋ 创建歌单。</p>'}`, state.playlists.length ? async data=>{await api('playlist-add',data.get('playlist'),id);await refreshCollections();toast('已加入歌单');} : null, '加入歌单');
  $('#add-next').onclick = ()=>{ if(id===current?.id)return toast('这首歌正在播放');const existing = queue.indexOf(id); if (existing >= 0) queue.splice(existing,1); queueIndex = queue.indexOf(current?.id); queue.splice(Math.max(0,queueIndex+1),0,id); $('#modal').close(); renderPlayer(); if(drawer==='queue')renderQueue();savePlayback(); toast('已加入下一首'); };
  $('#reveal-file').onclick = ()=>api('reveal',id);
  if ($('#remove-track')) $('#remove-track').onclick = async ()=>{await api('playlist-remove',view,id);$('#modal').close();await refreshCollections();};
}
$('#new-playlist').onclick = createPlaylist;
const trackDragType='application/x-crescent-track';
let draggedTrack=null;
let draggedOrder=null,dragScrollFrame=0,dragPointerY=0;
function stopDragScroll(){cancelAnimationFrame(dragScrollFrame);dragScrollFrame=0;}
function dragScroll(){
  if(!draggedOrder)return;
  const bottom=window.innerHeight-102;
  if(dragPointerY>bottom-55)window.scrollBy(0,Math.min(18,(dragPointerY-bottom+55)/3));
  else if(dragPointerY<100)window.scrollBy(0,-Math.min(18,(100-dragPointerY)/3));
  dragScrollFrame=requestAnimationFrame(dragScroll);
}
const clearOrderTargets=()=>document.querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
const clearDropTargets=()=>document.querySelectorAll('.playlist-drop-target').forEach(el=>el.classList.remove('playlist-drop-target'));
$('#track-list').addEventListener('dragstart',event=>{
  clearTimeout(detailClickTimer);
  const row=event.target.closest('.track-row');
  if(!row)return;
  draggedTrack=row.dataset.track||null;
  if(playlist()&&row.dataset.orderKey){
    if(playlist().externalId&&!playlistItems.has(view)){event.preventDefault();return;}
    draggedOrder={playlist:view,key:row.dataset.orderKey};
    event.dataTransfer.setData('application/x-crescent-order',draggedOrder.key);
  }
  if(draggedTrack)event.dataTransfer.setData(trackDragType,draggedTrack);
  event.dataTransfer.setData('text/plain',row.querySelector('strong').textContent);
  event.dataTransfer.effectAllowed='copyMove';
  dragPointerY=event.clientY;if(draggedOrder)dragScroll();
  row.classList.add('track-dragging');
});
document.addEventListener('dragend',()=>{
  draggedTrack=null;draggedOrder=null;stopDragScroll();clearDropTargets();clearOrderTargets();
  document.querySelectorAll('.track-dragging').forEach(el=>el.classList.remove('track-dragging'));
  songList.draw();
});
document.addEventListener('dragover',event=>{dragPointerY=event.clientY;});
$('#track-list').addEventListener('dragover',event=>{
  const target=event.target.closest('[data-order-key]');
  if(!draggedOrder||draggedOrder.playlist!==view||!target)return;
  event.preventDefault();event.dataTransfer.dropEffect='move';clearOrderTargets();
  if(target.dataset.orderKey!==draggedOrder.key)target.classList.add(event.clientY<target.getBoundingClientRect().top+target.offsetHeight/2?'drop-before':'drop-after');
});
$('#track-list').addEventListener('dragleave',event=>{if(!$('#track-list').contains(event.relatedTarget))clearOrderTargets();});
$('#track-list').addEventListener('drop',async event=>{
  const target=event.target.closest('[data-order-key]');
  if(!draggedOrder||draggedOrder.playlist!==view||!target)return;
  event.preventDefault();stopDragScroll();clearOrderTargets();
  const {playlist:id,key}=draggedOrder;draggedOrder=null;
  if(target.dataset.orderKey===key)return;
  const keys=importedPlaylistRows(playlist()).map(row=>row.orderKey);
  keys.splice(keys.indexOf(key),1);
  const index=keys.indexOf(target.dataset.orderKey)+(event.clientY>=target.getBoundingClientRect().top+target.offsetHeight/2?1:0);
  keys.splice(index,0,key);
  try{
    await api('playlist-reorder',id,keys);state.playlistOrders[id]=keys;orderedViews.clear();playlistSorts.set(id,'source');
    if(view===id){$('#sort').value='source';renderTable();}
    toast('歌单顺序已保存');
  }catch(error){report(error);}
});
$('#playlist-nav').addEventListener('dragover',event=>{
  const target=event.target.closest('button[data-view]');
  if(!target||!event.dataTransfer.types.includes(trackDragType))return;
  event.preventDefault();event.dataTransfer.dropEffect='copy';
  clearDropTargets();target.classList.add('playlist-drop-target');
});
$('#playlist-nav').addEventListener('dragleave',event=>{
  const target=event.target.closest('button[data-view]');
  if(target&&!target.contains(event.relatedTarget))target.classList.remove('playlist-drop-target');
});
$('#playlist-nav').addEventListener('drop',async event=>{
  const target=event.target.closest('button[data-view]');
  if(!target||!event.dataTransfer.types.includes(trackDragType))return;
  event.preventDefault();clearDropTargets();
  const id=event.dataTransfer.getData(trackDragType);
  const name=playlistsById.get(target.dataset.view).name;
  try{await api('playlist-add',target.dataset.view,id);await refreshCollections();toast(`已加入「${name}」`);}
  catch(error){report(error);}
});
$('#playlist-edit').onclick = ()=>{
  const p = playlist();
  showModal('编辑歌单',`<label class="field">名称<input name="name" value="${escape(p.name)}" required maxlength="80"></label><div class="drawer-tools"><button type="button" class="secondary" id="cover-change">选择封面</button><button type="button" class="secondary" id="delete-playlist">删除歌单</button></div>`,async data=>{await api('playlist-rename',p.id,data.get('name'));await refreshCollections();});
  $('#cover-change').onclick = async ()=>{await api('playlist-cover',p.id);await refreshCollections();toast('封面已更新');};
  $('#delete-playlist').onclick = ()=>{showModal('删除歌单',`<p class="hint">删除「${escape(p.name)}」后，歌曲仍保留在音乐库。</p>`,async()=>{await api('playlist-delete',p.id);view='library';await refreshCollections();},'确认删除');};
};
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-import]');
  if(!button)return;
  if($('#modal').open)$('#modal').close();
  importMusic(button.dataset.import).catch(report);
});
$('#rescan').onclick = async ()=>{const result=await api('rescan');await refresh();toast(`重新扫描完成：${result.processed} 首，${result.errors.length} 个文件失败`);};
$('#play-all').onclick = ()=>{const ids=filtered.filter(t=>!t.missing).map(t=>t.id);if(ids.length)play(ids[0],ids);else toast('先导入一些音乐吧');};
$('#shuffle-all').onclick = ()=>{ const ids = filtered.filter(t=>!t.missing).map(t=>t.id); if(!ids.length)return toast('先导入一些音乐吧'); mode='shuffle';updateMode();play(ids[Math.floor(Math.random()*ids.length)],ids); };
$('#search').oninput=()=>{window.scrollTo(0,0);renderTable();};
$('#sort').onchange=()=>{if(playlist())playlistSorts.set(view,$('#sort').value);window.scrollTo(0,0);renderTable();};
$('#toggle').onclick = toggle; $('#next').onclick = ()=>next(); $('#previous').onclick = ()=>{if(audio.currentTime>3){audio.currentTime=0;}else next(-1);};
$('#player-like').onclick = async()=>{if(current){await favorite(current.id);}};
function updateMode() { $('#mode').textContent = {list:'↻',one:'↺¹',shuffle:'⤨'}[mode]; $('#mode').title = {list:'列表循环',one:'单曲循环',shuffle:'随机播放'}[mode]; }
$('#mode').onclick = ()=>{mode={list:'one',one:'shuffle',shuffle:'list'}[mode];updateMode();toast($('#mode').title);savePlayback();};
$('#volume').oninput = ()=>{audio.volume=Number($('#volume').value);}; $('#volume').onchange = savePlayback;
$('#seek').oninput = ()=>{if(Number.isFinite(audio.duration)) audio.currentTime=Number($('#seek').value);};
audio.addEventListener('seeking',()=>listening?.resetAnchor());
audio.addEventListener('loadedmetadata',()=>{if(listening&&Number.isFinite(audio.duration))listening.duration=audio.duration;});
function sampleListening(playing) {
  if(listening?.update(audio.currentTime,performance.now(),playing)) {
    const id=current.id;
    recordPlay(id);
  }
}
audio.addEventListener('playing',()=>sampleListening(true));
audio.addEventListener('pause',()=>{sampleListening(!audio.seeking&&audio.readyState>=2);listening?.resetAnchor();$('#toggle').textContent='▶';syncTaskbar();syncFloatingLyrics();songDetail.update(current?.id,audio.paused,audio.currentTime);if(current)savePlayback();});
audio.addEventListener('play',()=>{$('#toggle').textContent='Ⅱ';syncTaskbar();syncFloatingLyrics();songDetail.update(current?.id,audio.paused,audio.currentTime);});
audio.addEventListener('error',()=>{toast('音频播放失败：请检查文件是否存在，或此编码是否受支持。',8000);});
let lastSave=0;
audio.addEventListener('timeupdate',async()=>{
  const duration=Number.isFinite(audio.duration)?audio.duration:0;
  $('#elapsed').textContent=time(audio.currentTime);$('#duration').textContent=time(duration);$('#seek').max=duration||100;$('#seek').value=audio.currentTime;
  sampleListening((!audio.paused||audio.ended)&&!audio.seeking&&audio.readyState>=2);
  songDetail.update(current?.id,audio.paused,audio.currentTime);
  syncFloatingLyrics();
  if(current&&performance.now()-lastSave>10000){lastSave=performance.now();await savePlayback();}
});
audio.addEventListener('ended',async()=>{
  if(listening?.finish()){await recordPlay(current.id);}
  if(stopAfterSong){stopAfterSong=false;toast('已在歌曲结束后停止');return;}
  await next(1,true);
});
function openDrawer(kind,title) { drawer=kind;showPanel($('#drawer'),'drawer');$('#drawer-title').textContent=title; }
$('#drawer-close').onclick=()=>{drawer='';hidePanel($('#drawer'),'drawer');};
$('#queue-open').onclick=()=>{openDrawer('queue',`播放队列 · ${queue.length}`);renderQueue();};
function renderQueue(){
  $('#drawer-title').textContent=`播放队列 · ${queue.length}`;
  if (!queueList) {
    $('#drawer-content').innerHTML='<div id="queue-list"></div><p id="queue-empty" class="hint">播放歌曲后，这里会显示播放队列。</p>';
    queueList=new VirtualList($('#queue-list'),(t,i)=>`<div class="queue-row ${t.id===current?.id?'current':''}">${cover(t.cover)}<button class="track-info" data-queue-play="${t.id}"><strong>${escape(t.title)}</strong><small>${escape(t.artist)}</small></button><button data-queue-up="${i}" title="向前移动">↑</button><button data-queue-remove="${i}" title="移除">×</button></div>`,$('#drawer'));
  }
  $('#queue-empty').classList.toggle('hidden',queue.length>0);
  queueList.setItems(queue.map(track));
}
$('#drawer-content').addEventListener('click', async event=>{
  const playButton=event.target.closest('[data-queue-play]');
  if(playButton){await play(playButton.dataset.queuePlay);return;}
  const up=event.target.closest('[data-queue-up]');
  const remove=event.target.closest('[data-queue-remove]');
  if(!up&&!remove)return;
  const index=Number(up?up.dataset.queueUp:remove.dataset.queueRemove);
  if(up&&index>0)[queue[index-1],queue[index]]=[queue[index],queue[index-1]];
  if(remove){if(queue[index]===current?.id)return toast('当前播放的歌曲保留在队列中');queue.splice(index,1);}
  queueIndex=queue.indexOf(current?.id);renderQueue();renderPlayer();await savePlayback();
});
function setLyrics(text){lyricText=text;lyricLines=parseLrc(text);if(current)songDetail.lyricsChanged(current.id,text);syncFloatingLyrics();}
let floatingLyricsEnabled=false,floatingLyricsSignature='';
function setFloatingLyricsState(enabled){floatingLyricsEnabled=enabled;floatingLyricsSignature='';$('#lyrics-open').classList.toggle('liked',enabled);$('#lyrics-open').setAttribute('aria-pressed',String(enabled));syncFloatingLyrics();}
function syncFloatingLyrics(){
  if(!floatingLyricsEnabled)return;
  const position=audio.currentTime-(current?state.settings[`offset:${current.id}`]||0:0);
  let index=-1;for(let i=0;i<lyricLines.length&&lyricLines[i].time<=position;i++)index=i;
  const data={title:current?`${current.title} - ${current.artist}`:'尚未播放',playing:!audio.paused,
    line:current?(lyricLines.length?(index>=0?lyricLines[index].text:current.title):(lyricText.trim().split('\n')[0]||'暂无歌词')):'选择一首歌曲',
    next:lyricLines[index+1]?.text||''};
  const signature=JSON.stringify(data);if(signature===floatingLyricsSignature)return;floatingLyricsSignature=signature;
  api('floating-lyrics-update',data).catch(report);
}
$('#lyrics-open').onclick=async()=>{try{setFloatingLyricsState(await api('floating-lyrics-toggle'));}catch(error){report(error);}};
window.crescent.on('floating-lyrics-state',setFloatingLyricsState);
function findLyrics(id=current.id){
  const selected=track(id);
  showModal('匹配网易云歌词',`<p class="hint">按歌名、歌手搜索，核对专辑与时长后选择版本。也可以直接输入网易云歌曲链接或 ID。</p><label class="field">歌曲 / 链接 / ID<input id="lyric-query" value="${escape(selected.title+' '+(selected.artist==='未知歌手'?'':selected.artist))}"></label><button type="button" id="search-lyrics" class="primary">搜索歌词</button><div id="lyric-results"></div>`,null);
  $('#search-lyrics').onclick=async()=>{
    const button=$('#search-lyrics');button.disabled=true;$('#lyric-results').textContent='正在请求网易云…';
    try{
      const query=$('#lyric-query').value.trim();const songId=query.match(/(?:id=|song\/)(\d+)/)?.[1]||(/^\d+$/.test(query)?query:null);
      if(songId){const text=await api('lyrics-download',id,songId);if(current?.id===id)setLyrics(text);else songDetail.lyricsChanged(id,text);$('#modal').close();return;}
      const results=await api('lyrics-search',query);
      $('#lyric-results').innerHTML=results.length?results.map(r=>`<button type="button" class="search-result" data-song="${r.id}"><strong>${escape(r.title)} · ${time(r.duration)}</strong><small>${escape(r.artist)} / ${escape(r.album)}</small></button>`).join(''):'<p class="hint">暂时没有匹配结果，可修改搜索词或导入本地歌词。</p>';
      $('#lyric-results').querySelectorAll('[data-song]').forEach(b=>b.onclick=async()=>{try{const text=await api('lyrics-download',id,b.dataset.song);if(current?.id===id)setLyrics(text);else songDetail.lyricsChanged(id,text);$('#modal').close();toast('歌词已保存到本地');}catch(error){report(error);}});
    }catch(error){$('#lyric-results').textContent='请求失败，可稍后重试或导入本地 LRC。';report(error);}finally{button.disabled=false;}
  };
}
async function previewNetease(chooseFile) {
  try {
    const preview=await api('netease-preview',chooseFile);if(!preview)return;
    const ambiguous=preview.songs.filter(s=>s.candidates.length>1);
    showModal('迁移网易云播放记录',`<p class="hint">来源：${escape(preview.source)}<br>本机保留 ${preview.totalRecords} 条记录，其中超过 60 秒 ${preview.eligibleRecords} 条。自动匹配 ${preview.matchedSongs} 首歌曲、${preview.matchedEvents} 次播放。记录日期会保留。</p><p class="hint">这些是本机历史，覆盖范围取决于网易云缓存。迁移前自动备份，重复操作自动去重。</p>${ambiguous.map(s=>`<label class="field">${escape(s.title)} · ${escape(s.artist)}<select name="${s.id}"><option value="">暂不迁移此歌曲</option>${s.candidates.map(t=>`<option value="${t.id}">${escape(t.title)} · ${escape(t.format)} · ${time(t.duration)}</option>`).join('')}</select></label>`).join('')}<p class="hint">${preview.songs.filter(s=>!s.candidates.length).length} 首暂未匹配到本地音乐，详细信息将保存在迁移报告中。</p>`,async data=>{
      const choices=Object.fromEntries([...data].filter(([,value])=>value));
      const result=await api('netease-apply',preview.token,choices);
      await refresh();toast(`新增 ${result.added} 次播放，跳过 ${result.duplicates} 条重复记录。\n${result.unmatchedSongs.length} 首待匹配。报告：${result.report}`,12000);
    },'迁移匹配的记录');
  }catch(error){report(error);}
}
$('#timer').onclick=()=>{
  showModal('定时停止',`<label class="field">停止时间<select name="minutes"><option value="15">15 分钟后</option><option value="30">30 分钟后</option><option value="60">60 分钟后</option><option value="song">播完当前歌曲</option><option value="off">关闭定时</option></select></label><p class="hint">到时会暂停播放，并保留当前进度。</p>`,async data=>{clearTimeout(timer);stopAfterSong=false;const m=data.get('minutes');if(m==='song')stopAfterSong=true;else if(m!=='off')timer=setTimeout(()=>{audio.pause();toast('定时时间已到，已暂停播放');},Number(m)*60000);toast(m==='off'?'定时已关闭':m==='song'?'播完当前歌曲后停止':`${m} 分钟后停止播放`);},'确定');
};
$('#settings-open').onclick=()=>{
  showModal('设置与数据',`<div class="setting-row"><h2>音乐文件夹</h2><p>${escape(state.musicFolder)}</p><p>导入时复制音频到此文件夹，重复导入复用已有副本。播放器读取这里的音乐。</p><button type="button" id="library-open" class="secondary">打开音乐文件夹</button><button type="button" id="setting-import-files" data-import="files" class="secondary">选择音乐文件</button><button type="button" id="setting-import" data-import="folder" class="secondary">导入文件夹</button></div><div class="setting-row"><h2>网易云自创歌单</h2><p>从本地数据库同步自己创建的普通歌单，保留歌曲顺序；未匹配音频显示为待导入。默认喜欢、自动年度歌单及收藏歌单维持原状。</p><button type="button" id="netease-playlists-sync" class="secondary">同步自创歌单</button></div><div class="setting-row"><h2>网易云听歌记录</h2><p>读取本机网易云数据库，按超过 60 秒的播放记录迁移；保留日期，重复迁移自动去重。先预览匹配结果。</p><button type="button" id="netease-import" class="secondary">读取并预览</button><button type="button" id="netease-select" class="secondary">选择数据库</button></div><div class="setting-row"><h2>数据备份</h2><p>资料库：${escape(state.dataFolder)}</p><p>备份歌单、收藏、封面、歌词和播放记录。音频副本保存在上方音乐文件夹；数据库备份包含歌曲路径。备份音乐时请同时复制该文件夹。</p><button type="button" id="backup" class="secondary">导出备份</button><button type="button" id="restore" class="secondary">恢复备份</button></div><div class="setting-row"><h2>快捷键</h2><p>空格：播放 / 暂停 · Ctrl K：搜索<br>全局 Ctrl Alt 空格：播放 / 暂停<br>全局 Ctrl Alt ← / →：切歌 · 支持键盘媒体键</p></div><p class="hint">播放计数：实际播放超过 60 秒计一次，每轮最多一次。时长 ≤ 60 秒的歌曲，听满 90% 且播放结束计一次。近七天为滚动 168 小时。</p>`,null);
  $('#netease-playlists-sync').onclick=async()=>{const button=$('#netease-playlists-sync');button.disabled=true;try{const result=await api('netease-playlists');await refreshCollections();toast(`已同步 ${result.playlists.length} 个自创歌单。报告：${result.report}`,10000);}finally{button.disabled=false;}};
  $('#netease-import').onclick=()=>previewNetease(false);
  $('#netease-select').onclick=()=>previewNetease(true);
  $('#library-open').onclick=async()=>{const error=await api('library-open');if(error)throw new Error(error);};
  $('#backup').onclick=async()=>{if(await api('backup'))toast('备份已导出');};
  $('#restore').onclick=async()=>{audio.pause();if(await api('restore')){listening=null;audio.removeAttribute('src');current=null;queue=[];queueIndex=-1;lastSavedQueue='restored';setLyrics('');$('#modal').close();view='library';await refresh();toast('备份已恢复，重新播放即可');}};
};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector("#modal").open&&songDetail.id){songDetail.close();return;}if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus();return;}if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||$('#modal').open)return;if(e.code==='Space'){e.preventDefault();toggle();}});
$('#window-minimize').onclick=()=>api('window-minimize');
$('#window-maximize').onclick=()=>api('window-maximize');
$('#window-close').onclick=async()=>{audio.pause();await savePlayback();await api('window-close');};
window.crescent.on('window-state',maximized=>{const button=$('#window-maximize');button.title=maximized?'还原窗口':'最大化';button.setAttribute('aria-label',button.title);button.innerHTML=maximized?'<svg viewBox="0 0 16 16"><path d="M5.5 5.5v-2h7v7h-2"/><rect x="3.5" y="5.5" width="7" height="7"/></svg>':'<svg viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9"/></svg>';});
window.crescent.on('library-updated',()=>refresh());
window.crescent.on('taskbar-error',message=>report(new Error(message)));
window.crescent.on('transport',action=>{if(action==='toggle')toggle();if(action==='next')next();if(action==='previous')next(-1);if(action==='favorite'&&current)favorite(current.id);});
window.crescent.on('scan-progress',p=>{$('#import-files').textContent=p.done?'＋ 导入音乐':`已处理 ${p.processed} 首…`;});
await refresh();
window.addEventListener('resize',syncTaskbar);
const playback=state.settings.playback;
if(playback){audio.volume=playback.volume;$('#volume').value=audio.volume;mode=playback.mode;updateMode();queue=(state.settings.queue ?? playback.queue ?? []).filter(id=>track(id));lastSavedQueue=state.settings.queue?queue.join(','):null;if(track(playback.id)&&!track(playback.id).missing)await play(playback.id,queue,playback.position,false);}
else audio.volume=.7;
