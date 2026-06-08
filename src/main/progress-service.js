export function createProgressReporter(onProgress) {
  const startedAt = Date.now();
  let currentStage = null;
  let stageStartedAt = startedAt;

  return ({ stage, current = 0, total = 0, estimateRemaining = false }) => {
    const now = Date.now();
    if (stage !== currentStage) {
      currentStage = stage;
      stageStartedAt = now;
    }

    const elapsedMs = now - startedAt;
    const stageElapsedMs = now - stageStartedAt;
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const remainingMs =
      estimateRemaining && current > 0 && total > current
        ? Math.max(0, Math.round((stageElapsedMs / current) * (total - current)))
        : null;

    onProgress?.({
      stage,
      current,
      total,
      percent,
      startedAt,
      elapsedMs,
      remainingMs
    });
  };
}
