function getApi() {
  if (!window.renamer) {
    throw new Error("Renamer IPC API is not available. Please run inside Electron.");
  }
  return window.renamer;
}

export const renamerApi = {
  selectInputDirectory: () => getApi().selectInputDirectory(),
  selectOutputDirectory: () => getApi().selectOutputDirectory(),
  scanDirectory: (payload) => getApi().scanDirectory(payload),
  buildPreview: (payload) => getApi().buildPreview(payload),
  executeRename: (payload) => getApi().executeRename(payload),
  cancelCurrentTask: () => getApi().cancelCurrentTask(),
  exportLog: () => getApi().exportLog(),
  undoLastRun: () => getApi().undoLastRun(),
  loadSettings: () => getApi().loadSettings(),
  saveSettings: (settings) => getApi().saveSettings(settings),
  onTaskProgress: (callback) => getApi().onTaskProgress(callback)
};
