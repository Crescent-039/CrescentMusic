import {parseLrc} from './listening.js';
import {showPanel,hidePanel} from './transitions.js';

export function createSongDetail({getTrack,getLyrics,getOffset,onPlay,onSeek,onFavorite,onImport,onSearch,onOpen,onError}) {
  const root=document.querySelector('#song-detail'),$=s=>root.querySelector(s);
  let id=null,request=0,lines=[],active=-1,playbackId=null,paused=true;
  function refresh(){
    if(!id)return;
    const t=getTrack(id);if(!t){close();return;}
    $('#detail-title').textContent=t.title;$('#detail-artist').textContent=t.artist;$('#detail-album').textContent=t.album;
    $('#detail-format').textContent=t.format;
    $('#detail-favorite').textContent=t.favorite?'♥ 已喜欢':'♡ 喜欢';
    for(const image of root.querySelectorAll('.detail-art-image')){
      const url=t.cover?`${t.cover}&size=320`:'';
      if(image.getAttribute('src')!==url){if(url)image.src=url;else image.removeAttribute('src');}
      image.hidden=!url;
    }
    $('.detail-artwork').classList.toggle('has-cover',!!t.cover);
    const playing=id===playbackId&&!paused;
    root.classList.toggle('is-playing',playing);
    $('#detail-play').textContent=playing?'Ⅱ 暂停播放':'▶ 播放这首';
    $('#detail-status').textContent=id===playbackId?(paused?'已暂停':'正在播放'):'歌曲预览';
  }
  function setLyrics(text){
    lines=parseLrc(text);active=-1;const pane=$('#detail-lyrics');pane.replaceChildren();pane.scrollTop=0;
    if(lines.length){for(const [i,line] of lines.entries()){
      const button=document.createElement('button');button.className='detail-line';button.dataset.detailLine=i;button.textContent=line.text||'♪';pane.append(button);
    }}else{const p=document.createElement('p');p.className='detail-plain';p.textContent=text||'这首歌还没有歌词\n可以导入本地 LRC，或匹配网易云歌词。';pane.append(p);}
  }
  async function open(nextId){
    const entering=id===null;id=nextId;const token=++request;if(entering){onOpen();showPanel(root);}document.body.classList.add('detail-open');
    refresh();setLyrics('正在读取歌词…');
    const text=await getLyrics(id);
    if(token===request)setLyrics(text);
  }
  function close(){++request;id=null;hidePanel(root);document.body.classList.remove('detail-open');}
  $('#detail-close').onclick=close;
  $('#detail-play').onclick=()=>onPlay(id).catch(onError);
  $('#detail-favorite').onclick=()=>onFavorite(id).catch(onError);
  $('#detail-import').onclick=async()=>{try{const selected=id,text=await onImport(selected);if(text!==null&&id===selected)setLyrics(text);}catch(error){onError(error);}};
  $('#detail-search').onclick=()=>onSearch(id);
  $('#detail-lyrics').onclick=event=>{const line=event.target.closest('[data-detail-line]');if(line)onSeek(id,lines[Number(line.dataset.detailLine)].time+getOffset(id)).catch(onError);};
  return {open,close,refresh,get id(){return id;},
    update(currentId,isPaused,position){
      playbackId=currentId;paused=isPaused;if(!id)return;refresh();
      if(id!==currentId||!lines.length)return;
      const time=position-getOffset(id);let index=-1;
      for(let i=0;i<lines.length&&lines[i].time<=time;i++)index=i;
      if(index===active)return;
      if(active>=0)$('#detail-lyrics').children[active]?.classList.remove('active');active=index;
      if(index>=0){const line=$('#detail-lyrics').children[index];line.classList.add('active');$('#detail-lyrics').scrollTo({top:line.offsetTop-$('#detail-lyrics').clientHeight*.4,behavior:'smooth'});}
    },
    lyricsChanged(trackId,text){if(id===trackId)setLyrics(text);}
  };
}
