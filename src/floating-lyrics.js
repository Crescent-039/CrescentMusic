import {BrowserWindow,screen,ipcMain} from 'electron';
import path from 'node:path';

export function createFloatingLyrics(owner,here){
  let window=null,latest={title:'尚未播放',line:'选择一首歌曲',next:'',playing:false};
  const state=enabled=>owner.webContents.send('floating-lyrics-state',enabled);
  ipcMain.on('floating-lyrics-control',(event,action)=>{
    if(!window||event.sender!==window.webContents)return;
    if(action==='close')window.close();
    else if(['toggle','previous','next'].includes(action))owner.webContents.send('transport',action);
  });
  owner.on('closed',()=>{if(window)window.close();});
  return {toggle(){
    if(window){window.close();return false;}
    const area=screen.getDisplayMatching(owner.getBounds()).workArea,width=Math.min(820,area.width-40);
    window=new BrowserWindow({width,height:146,x:Math.round(area.x+(area.width-width)/2),y:area.y+area.height-190,minWidth:420,minHeight:120,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,show:false,title:'桌面歌词',webPreferences:{preload:path.join(here,'floating-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.setAlwaysOnTop(true,'screen-saver');
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
    window.once('ready-to-show',()=>{window.webContents.send('floating-lyrics-data',latest);window.showInactive();});
    window.on('closed',()=>{window=null;if(!owner.isDestroyed())state(false);});
    window.loadFile(path.join(here,'floating-lyrics.html')).catch(error=>{console.error(error);if(!owner.isDestroyed())owner.webContents.send('taskbar-error',`悬浮歌词加载失败：${error.message}`);});
    state(true);return true;
  },update(data){latest=data;if(window&&!window.webContents.isLoading())window.webContents.send('floating-lyrics-data',latest);}};
}
