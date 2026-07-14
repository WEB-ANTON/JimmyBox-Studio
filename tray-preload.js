const { contextBridge, ipcRenderer } = require('electron');

// The tray popover only gets the APIs it needs for host toggles and language.
contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get')
  },
  tray: {
    listHostProjects: () => ipcRenderer.invoke('tray:listHostProjects'),
    setProjectHost: (domain, enabled) => ipcRenderer.invoke('tray:setProjectHost', domain, enabled),
    openStudio: () => ipcRenderer.invoke('tray:openStudio'),
    hide: () => ipcRenderer.invoke('tray:hide'),
    onShow: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('tray:show', listener);
      return () => ipcRenderer.removeListener('tray:show', listener);
    }
  }
});
