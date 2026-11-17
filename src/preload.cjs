const { contextBridge, ipcRenderer } = require('electron');
const channels = ['floating-lyrics-toggle','floating-lyrics-update','taskbar-update','snapshot','playlist-reorder','playlist-entries','netease-playlists','netease-preview','netease-apply','collections','import','rescan','favorite','playlist-create','playlist-rename','playlist-delete','playlist-add','playlist-remove','playlist-cover','played','recent','settings','lyrics','lyrics-search','lyrics-download','lyrics-import','backup','restore','reveal','library-open','window-minimize','window-maximize','window-close'];
contextBridge.exposeInMainWorld('crescent', {
  call: (channel, ...args) => {
    if (!channels.includes(channel)) throw new Error('Unknown command');
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, callback) => {
    if (!['floating-lyrics-state','taskbar-error','scan-progress','transport','window-state','library-updated'].includes(channel)) throw new Error('Unknown event');
    ipcRenderer.on(channel, (_event, value) => callback(value));
  }
});
