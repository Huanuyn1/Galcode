"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("galcode", {
  getState: () => ipcRenderer.invoke("galcode:get-state"),
  saveConfig: (config) => ipcRenderer.invoke("galcode:save-config", config),
  run: (task) => ipcRenderer.invoke("galcode:run", task),
  stop: () => ipcRenderer.invoke("galcode:stop"),
  openPath: (targetPath) => ipcRenderer.invoke("galcode:open-path", targetPath),
  onLog: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("galcode:log", handler);
    return () => ipcRenderer.removeListener("galcode:log", handler);
  },
  onTaskDone: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("galcode:task-done", handler);
    return () => ipcRenderer.removeListener("galcode:task-done", handler);
  }
});
