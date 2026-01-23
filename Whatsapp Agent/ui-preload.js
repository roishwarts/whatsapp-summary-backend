const { contextBridge, ipcRenderer } = require('electron');

// Secure IPC Bridge Setup for the UI Window
contextBridge.exposeInMainWorld('uiApi', {
    receiveCommand: (channel, listener) => {
        const safeListener = (event, ...args) => listener(...args);
        ipcRenderer.on(channel, safeListener);
    },
    sendData: (channel, data) => {
        ipcRenderer.send(channel, data);
    }
});