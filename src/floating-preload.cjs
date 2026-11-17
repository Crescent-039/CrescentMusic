const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktopLyrics',{
  onData:callback=>ipcRenderer.on('floating-lyrics-data',(_event,data)=>callback(data)),
  control:action=>{if(['close','toggle','previous','next'].includes(action))ipcRenderer.send('floating-lyrics-control',action);}
});
