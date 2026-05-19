import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  FolderOpen,
  ListRestart,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  XCircle
} from "lucide-react";
import { DEFAULT_SETTINGS, STATUS_LABELS } from "../shared/constants.js";
import { validateTemplate } from "../shared/naming.js";
import { renamerApi } from "./api/renamer-api.js";

const initialProgress = { stage: "idle", current: 0, total: 0, percent: 0, remainingMs: null, elapsedMs: 0, startedAt: null };
const initialSystemInfo = { cpuCount: 1, defaultMetadataConcurrency: 1 };
const scanningStages = new Set(["collecting-files", "reading-metadata", "building-preview"]);

function unwrap(response) {
  if (!response?.ok) {
    throw new Error(response?.error?.message ?? "操作失败。");
  }
  return response.data;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function stageLabel(stage) {
  return {
    idle: "空闲",
    "collecting-files": "收集文件",
    "reading-metadata": "读取元数据",
    "building-preview": "生成预览",
    renaming: "执行重命名",
    undoing: "撤销",
    completed: "完成"
  }[stage] ?? stage;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return "计算中";
  if (ms < 1000) return "少于 1 秒";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  if (minutes < 60) return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${restMinutes} 分钟`;
}

function progressCountText(progress) {
  if (!progress.total) {
    return progress.stage === "collecting-files" ? "统计中" : "0/0";
  }
  return `${progress.current}/${progress.total}`;
}

function remainingText(progress) {
  if (progress.stage === "idle") return "预计剩余：-";
  if (progress.stage === "collecting-files") return "预计剩余：计算中";
  if (progress.stage === "building-preview") return "预计剩余：即将完成";
  if (progress.stage === "completed") return "已完成";
  return `预计剩余：${formatDuration(progress.remainingMs)}`;
}

function clampConcurrency(value, systemInfo) {
  if (value === null || value === undefined || value === "") return systemInfo.defaultMetadataConcurrency;
  const parsed = Number(value);
  const fallback = systemInfo.defaultMetadataConcurrency;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(systemInfo.cpuCount, Math.max(1, Math.trunc(parsed)));
}

function statusText(status) {
  return STATUS_LABELS[status] ?? status;
}

function App() {
  const [inputDirectory, setInputDirectory] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [progress, setProgress] = useState(initialProgress);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [systemInfo, setSystemInfo] = useState(initialSystemInfo);
  const [settingsReady, setSettingsReady] = useState(false);
  const [hasExportableLog, setHasExportableLog] = useState(false);

  const templateValidation = useMemo(() => validateTemplate(settings.template), [settings.template]);
  const visibleItems = useMemo(() => {
    if (statusFilter === "all") return items;
    return items.filter((item) => item.status === statusFilter);
  }, [items, statusFilter]);
  const summary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      },
      { total: 0, ready: 0, warning: 0, conflict: 0, error: 0, skipped: 0, renamed: 0 }
    );
  }, [items]);
  const progressPercent =
    typeof progress.percent === "number" ? progress.percent : progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  const isScanning = busy && scanningStages.has(progress.stage);
  const effectiveSettings = useMemo(
    () => ({
      ...settings,
      metadataConcurrency: clampConcurrency(settings.metadataConcurrency, systemInfo)
    }),
    [settings, systemInfo]
  );

  useEffect(() => {
    Promise.all([renamerApi.loadSettings(), renamerApi.getSystemInfo()])
      .then(([settingsResponse, systemResponse]) => {
        const loadedSettings = unwrap(settingsResponse);
        const loadedSystemInfo = unwrap(systemResponse);
        setSystemInfo(loadedSystemInfo);
        setSettings({
          ...loadedSettings,
          metadataConcurrency: clampConcurrency(loadedSettings.metadataConcurrency, loadedSystemInfo)
        });
        setSettingsReady(true);
      })
      .catch((error) => setMessage(error.message));
    return renamerApi.onTaskProgress((payload) => setProgress({ ...initialProgress, ...payload }));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!settingsReady) return;
      renamerApi.saveSettings(effectiveSettings).catch(() => {});
      if (items.length > 0) {
        renamerApi
          .buildPreview({ items, settings: effectiveSettings })
          .then((response) => {
            const data = unwrap(response);
            setItems(data.items);
            if (!data.templateError) setMessage("");
          })
          .catch((error) => setMessage(error.message));
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [effectiveSettings, settingsReady]);

  async function runScan(directory = inputDirectory) {
    if (!directory) return;
    setBusy(true);
    setItems([]);
    setProgress({ ...initialProgress, stage: "collecting-files" });
    setMessage("");
    setLastResult(null);
    try {
      const data = unwrap(await renamerApi.scanDirectory({ directory, settings: effectiveSettings }));
      setItems(data.items);
      setMessage(`扫描完成：${data.summary.total} 个文件。`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseInputDirectory() {
    try {
      const data = unwrap(await renamerApi.selectInputDirectory());
      if (!data.canceled && data.path) {
        setInputDirectory(data.path);
        await runScan(data.path);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function chooseOutputDirectory() {
    try {
      const data = unwrap(await renamerApi.selectOutputDirectory());
      if (!data.canceled && data.path) {
        setSettings((current) => ({ ...current, outputDirectory: data.path }));
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function executeRename() {
    const readyCount = items.filter((item) => item.status === "ready").length;
    if (readyCount === 0) return;
    if (!window.confirm(`确认重命名 ${readyCount} 个文件？`)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = unwrap(await renamerApi.executeRename({ items, settings: effectiveSettings }));
      setLastResult(result.summary);
      setHasExportableLog(Boolean(result.logPath));
      setMessage(`执行完成：成功 ${result.summary.success}，失败 ${result.summary.failed}，跳过 ${result.summary.skipped}。`);
      setItems((current) =>
        current.map((item) => {
          const entry = result.entries.find((row) => row.id === item.id);
          if (!entry) return item;
          if (entry.status === "success") return { ...item, status: "renamed", message: "已完成。" };
          if (entry.status === "skipped") return { ...item, status: "skipped", message: "已跳过。" };
          return { ...item, status: "error", message: entry.error?.message ?? "执行失败。" };
        })
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function undoLastRun() {
    setBusy(true);
    try {
      const result = unwrap(await renamerApi.undoLastRun());
      setLastResult(result.summary);
      if (result.logPath) setHasExportableLog(true);
      setMessage(result.message ?? `撤销完成：成功 ${result.summary.success}，失败 ${result.summary.failed}。`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportLog() {
    try {
      const result = unwrap(await renamerApi.exportLog());
      setMessage(result.exported ? `日志已导出：${result.path}` : result.message ?? "已取消导出。");
    } catch (error) {
      setMessage(error.message);
    }
  }

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateMetadataConcurrency(value) {
    setSettings((current) => ({
      ...current,
      metadataConcurrency: clampConcurrency(value, systemInfo)
    }));
  }

  function onDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file?.path) {
      setInputDirectory(file.path);
      runScan(file.path);
    }
  }

  return (
    <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div>
          <h1>Renamer</h1>
          <p>照片视频批量重命名工具</p>
        </div>
        <div className="toolbar">
          <button type="button" onClick={chooseInputDirectory} title="选择文件夹">
            <FolderOpen size={17} />
            选择
          </button>
          <button type="button" onClick={() => runScan()} disabled={!inputDirectory || busy} title="重新扫描">
            <RefreshCw size={17} />
            扫描
          </button>
          <button type="button" onClick={() => setItems([])} disabled={busy || items.length === 0} title="清空列表">
            <Trash2 size={17} />
            清空
          </button>
          <button type="button" onClick={undoLastRun} disabled={busy} title="撤销上一次">
            <RotateCcw size={17} />
            撤销
          </button>
          <button type="button" onClick={exportLog} disabled={busy || !hasExportableLog} title="导出日志">
            <Save size={17} />
            日志
          </button>
        </div>
      </header>

      <main>
        <section className="settings-panel">
          <label className="field wide">
            <span>输入文件夹</span>
            <input value={inputDirectory} onChange={(event) => setInputDirectory(event.target.value)} placeholder="选择或拖入文件夹" />
          </label>
          <label className="field template-field">
            <span className="field-label-with-help">
              命名模板
              <span className="template-help" tabIndex="0" aria-label="模板使用说明">
                <CircleAlert size={14} />
                <span className="template-help-popover" role="tooltip">
                  可用变量：{"{yyyy}"}、{"{MM}"}、{"{dd}"}、{"{MMdd}"}、{"{HH}"}、{"{mm}"}、{"{ss}"}、{"{HHmmss}"}、{"{SSS}"}、{"{original}"}、{"{index}"}。
                  {"{index}"} 和 {"{index:}"} 默认两位，{"{index:4}"} 表示四位序号，{"{index:000}"} 表示三位序号。扩展名会自动追加。
                </span>
              </span>
            </span>
            <input value={settings.template} onChange={(event) => updateSetting("template", event.target.value)} />
          </label>
          <label className="field">
            <span>扩展名</span>
            <select value={settings.extensionCase} onChange={(event) => updateSetting("extensionCase", event.target.value)}>
              <option value="preserve">保持原样</option>
              <option value="lower">统一小写</option>
              <option value="upper">统一大写</option>
            </select>
          </label>
          <label className="field">
            <span>媒体类型</span>
            <select value={settings.mediaFilter} onChange={(event) => updateSetting("mediaFilter", event.target.value)}>
              <option value="all">照片和视频</option>
              <option value="photo">仅照片</option>
              <option value="video">仅视频</option>
            </select>
          </label>
          <label className="check-field">
            <input type="checkbox" checked={settings.recursive} onChange={(event) => updateSetting("recursive", event.target.checked)} />
            递归子文件夹
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={settings.useModifiedTimeFallback}
              onChange={(event) => updateSetting("useModifiedTimeFallback", event.target.checked)}
            />
            允许修改时间兜底
          </label>
          <label className="field concurrency-field">
            <span className="field-label-with-help">
              并发数
              <span className="template-help" tabIndex="0" aria-label="并发数说明">
                <CircleAlert size={14} />
                <span className="template-help-popover concurrency-help-popover" role="tooltip">
                  控制同时读取元数据的文件数量。可输入 1 到 {systemInfo.cpuCount}，默认值为 {systemInfo.defaultMetadataConcurrency}。
                  数值越高扫描越快，但可能让磁盘或电脑更忙。
                </span>
              </span>
            </span>
            <input
              type="number"
              min="1"
              max={systemInfo.cpuCount}
              value={effectiveSettings.metadataConcurrency}
              onChange={(event) => updateMetadataConcurrency(event.target.value)}
            />
          </label>
          {!templateValidation.ok && <div className="validation">{templateValidation.message}</div>}
        </section>

        <section className="mode-panel">
          <div className="segmented">
            <button
              type="button"
              className={settings.renameMode === "in-place" ? "active" : ""}
              onClick={() => updateSetting("renameMode", "in-place")}
            >
              原地重命名
            </button>
            <button
              type="button"
              className={settings.renameMode === "move-to-directory" ? "active" : ""}
              onClick={() => updateSetting("renameMode", "move-to-directory")}
            >
              移动到指定目录
            </button>
          </div>
          {settings.renameMode === "move-to-directory" && (
            <label className="field output-field">
              <span>输出目录</span>
              <input value={settings.outputDirectory ?? ""} onChange={(event) => updateSetting("outputDirectory", event.target.value)} />
              <button type="button" onClick={chooseOutputDirectory} title="选择输出目录">
                <FolderOpen size={16} />
              </button>
            </label>
          )}
          <div className="mode-actions">
            {busy ? (
              <button type="button" onClick={() => renamerApi.cancelCurrentTask()} title="取消当前任务">
                <ListRestart size={17} />
                取消
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={executeRename}
                disabled={!templateValidation.ok || settings.renameMode === "move-to-directory" && !settings.outputDirectory || summary.ready === 0}
                title="执行重命名"
              >
                <Play size={17} />
                执行重命名
              </button>
            )}
          </div>
        </section>

        <section className="list-header">
          <div className="stats">
            <strong>{summary.total}</strong> 个文件
            <span>可重命名 {summary.ready}</span>
            <span>跳过 {summary.skipped}</span>
            <span>错误 {summary.error}</span>
          </div>
          <div className="filters">
            {["all", "ready", "skipped", "error", "renamed"].map((status) => (
              <button key={status} type="button" className={statusFilter === status ? "active" : ""} onClick={() => setStatusFilter(status)}>
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </section>

        <section className={`table-wrap ${isScanning ? "table-wrap-scanning" : ""}`}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>原文件名</th>
                <th>新文件名</th>
                <th>类型</th>
                <th>拍摄时间</th>
                <th>时间来源</th>
                <th>状态</th>
                <th>提示</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 ? (
                <tr>
                  <td colSpan="8" className="empty">
                    选择文件夹后开始扫描
                  </td>
                </tr>
              ) : (
                visibleItems.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td className="filename" title={item.originalPath}>
                      {item.originalName}
                    </td>
                    <td className="filename" title={item.proposedPath ?? ""}>
                      {item.proposedName ?? "-"}
                    </td>
                    <td>{item.mediaType === "photo" ? "照片" : item.mediaType === "video" ? "视频" : "未知"}</td>
                    <td>{formatDate(item.effectiveCapturedAt ?? item.capturedAt)}</td>
                    <td>{item.timeSource ?? "-"}</td>
                    <td>
                      <span className={`status status-${item.status}`}>
                        {item.status === "ready" || item.status === "renamed" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                        {statusText(item.status)}
                      </span>
                    </td>
                    <td className="message">{item.message || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {isScanning && (
            <div className="scan-overlay" aria-live="polite">
              <div className="scan-card">
                <div className="scan-pulse" />
                <span className="scan-kicker">{stageLabel(progress.stage)}</span>
                <strong>{progressPercent}%</strong>
                <div className="scan-meter" aria-hidden="true">
                  <div style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="scan-details">
                  <span>
                    <b>{progressCountText(progress)}</b>
                    已读取
                  </span>
                  <span>
                    <b>{remainingText(progress).replace("预计剩余：", "")}</b>
                    预计剩余
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="bottombar">
        <div className="footer-message">{message}</div>
      </footer>
      {lastResult && (
        <div className="result-toast">
          成功 {lastResult.success}，失败 {lastResult.failed}，跳过 {lastResult.skipped}
        </div>
      )}
    </div>
  );
}

export default App;
