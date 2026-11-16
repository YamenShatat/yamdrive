// The one thing the yamDRIVE page gets from the program: the PC's RAM and disk (Settings > Device).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yamDesktop', { device: () => ipcRenderer.invoke('device') });
