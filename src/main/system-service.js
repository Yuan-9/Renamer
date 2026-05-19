import os from "node:os";

export function getCpuCount() {
  return Math.max(1, os.cpus()?.length ?? 1);
}

export function getDefaultMetadataConcurrency(cpuCount = getCpuCount()) {
  return Math.max(1, cpuCount - 1);
}

export function getSystemInfo() {
  const cpuCount = getCpuCount();
  return {
    cpuCount,
    defaultMetadataConcurrency: getDefaultMetadataConcurrency(cpuCount)
  };
}
