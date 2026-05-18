const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("renamer", {
  selectInputDirectory: () => invoke("dialog:select-input-directory"),
  selectOutputDirectory: () => invoke("dialog:select-output-directory"),
  scanDirectory: (payload) => invoke("scan:start", payload),
  buildPreview: (payload) => invoke("preview:build", payload),
  executeRename: (payload) => invoke("rename:execute", payload),
  cancelCurrentTask: () => invoke("task:cancel"),
  exportLog: () => invoke("log:export"),
  undoLastRun: () => invoke("rename:undo-last"),
  loadSettings: () => invoke("settings:load"),
  saveSettings: (settings) => invoke("settings:save", settings),
  onTaskProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("task:progress", listener);
    return () => ipcRenderer.removeListener("task:progress", listener);
  }
});
