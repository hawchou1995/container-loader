'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clAPI', {
  readJson: (name) => ipcRenderer.invoke('data:readJson', name),
  writeJson: (name, obj) => ipcRenderer.invoke('data:writeJson', name, obj),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  writeFile: (file, content) => ipcRenderer.invoke('fs:write', file, content),
  writeFileBuf: (file, b64) => ipcRenderer.invoke('fs:writeBuf', file, b64),
  readFileAny: (file) => ipcRenderer.invoke('fs:readAny', file),
  exportExcel: (payload) => ipcRenderer.invoke('export:excel', payload),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  dataDir: () => ipcRenderer.invoke('paths:data'),
  userData: () => ipcRenderer.invoke('paths:userData'),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
});
