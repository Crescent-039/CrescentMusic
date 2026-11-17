import path from 'node:path';
import {nativeImage} from 'electron';
import {createTaskbarArtwork} from './taskbar-artwork.js';

export function createTaskbar(win,assets,readCover) {
  const icons=Object.fromEntries(['previous','play','pause','next','favorite','favorited'].map(name=>{
    const icon=nativeImage.createFromPath(path.join(assets,`${name}.png`));
    if(icon.isEmpty())throw new Error(`任务栏图标读取失败：${name}`);
    return [name,icon];
  }));
  const artwork=createTaskbarArtwork(win,error=>{console.error(error);win.webContents.send('taskbar-error',error.message);});
  let lastButtons='',lastArtwork;
  return {update({track,playing,hasQueue,canPlay}){
    const title=track?`${track.title} - ${track.artist} · Crescent Music`:'Crescent Music';
    win.setTitle(title);win.setThumbnailToolTip(title);
    const artworkKey=track?`${track.id}:${track.cover_version}`:'empty';
    if(artworkKey!==lastArtwork){
      const data=track?readCover(track.id):null;
      const image=data?nativeImage.createFromDataURL(data):nativeImage.createFromPath(path.join(assets,'app.png'));
      if(image.isEmpty())throw new Error('当前歌曲封面无法解码');
      artwork.set(image);lastArtwork=artworkKey;
    }
    const signature=JSON.stringify([!!track,playing,hasQueue,canPlay,track?.favorite]);
    if(signature===lastButtons)return;
    const button=(icon,tooltip,action,enabled)=>({icon:icons[icon],tooltip,flags:enabled?[]:['disabled'],click:()=>win.webContents.send('transport',action)});
    const success=win.setThumbarButtons([
      button('previous','上一首','previous',hasQueue),
      button(playing?'pause':'play',playing?'暂停':'播放','toggle',canPlay),
      button('next','下一首','next',hasQueue),
      button(track?.favorite?'favorited':'favorite',track?.favorite?'取消喜欢':'喜欢','favorite',!!track)
    ]);
    if(!success)throw new Error('任务栏播放按钮注册失败');
    lastButtons=signature;
  }};
}
