import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIB = 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const MINIMUM_SAMPLES = 12;
const MINIMUM_DURATION_MS = 15 * 60 * 1000;
const MAXIMUM_STABLE_WINDOW_MS = 6 * HOUR_MS;
const CHART_JS_URL =
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js";

const GPU_METRICS = [
  "gpuBindGroups",
  "gpuTextureBindGroups",
  "gpuManagedTextures",
  "gpuManagedBuffers",
  "gpuBindGroupCacheResets",
];
const WEBGL_RESOURCE_TYPES = [
  "Buffers",
  "Textures",
  "Framebuffers",
  "Renderbuffers",
  "Programs",
  "Shaders",
  "VertexArrays",
];
const WEBGL_RESOURCE_METRICS = WEBGL_RESOURCE_TYPES.flatMap((type) =>
  ["Created", "Deleted", "Live", "Peak"].map(
    (measure) => `webgl${type}${measure}`,
  ),
);
const WEBGL_LIVE_METRICS = WEBGL_RESOURCE_TYPES.map(
  (type) => `webgl${type}Live`,
);
const WEBGL_BYTE_METRICS = [
  "webglBufferBytesLive",
  "webglBufferBytesPeak",
];
const VIDEO_METRICS = [
  "activeNativeVideos",
  "nativeVideoFrameBufferAllocations",
  "nativeVideoFrameBufferReuses",
  "nativeVideoRecycledFrameBuffers",
];
const SHUTDOWN_METRICS = [
  "nativeVideoActiveDecoderWorkers",
  "nativeVideoPendingDecoderShutdowns",
  "nativeVideoCompletedDecoderShutdowns",
  "nativeVideoMaxDecoderShutdownMs",
];

const ANSI = {
  cyan: "\u001B[36m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
  reset: "\u001B[0m",
};

export async function resolveMemoryInfoInput(
  requestedPath,
  logsDirectory = resolve("logs"),
) {
  if (requestedPath) return resolve(requestedPath);

  const defaultPath = resolve(logsDirectory, "memoryInfo.log");
  const entries = await readdir(logsDirectory, { withFileTypes: true }).catch(
    () => [],
  );
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name === "memoryInfo.log" ||
            /^memoryInfo-.+\.log$/iu.test(entry.name)),
      )
      .map(async (entry) => {
        const path = resolve(logsDirectory, entry.name);
        return { path, modified: (await stat(path)).mtimeMs };
      }),
  );
  candidates.sort((left, right) => right.modified - left.modified);
  return candidates[0]?.path ?? defaultPath;
}

/** Detects a late RSS plateau from comparable post-scene baseline samples. */
export function analyzeRssTrend(rows) {
  const samples = rows
    .filter((row) => row.reason === "scene-exit:after")
    .map((row) => ({
      timestampMs: getTimestampMs(row),
      rssMiB: toMiB(row.memory?.rss),
      scene: sceneName(row),
    }))
    .filter(
      (sample) =>
        Number.isFinite(sample.timestampMs) && Number.isFinite(sample.rssMiB),
    )
    .sort((left, right) => left.timestampMs - right.timestampMs);

  if (samples.length < MINIMUM_SAMPLES) {
    return insufficientTrend(samples, "fewer than 12 scene-exit baselines");
  }

  const durationMs = samples.at(-1).timestampMs - samples[0].timestampMs;
  if (durationMs < MINIMUM_DURATION_MS) {
    return insufficientTrend(samples, "less than 15 minutes of baselines");
  }

  const buckets = createRssBuckets(samples);
  if (buckets.length < 3) {
    return insufficientTrend(samples, "fewer than three complete time windows");
  }

  const requiredWindowMs = Math.min(
    MAXIMUM_STABLE_WINDOW_MS,
    Math.max(MINIMUM_DURATION_MS, durationMs * 0.25),
  );
  let plateauMetrics;
  for (let index = 0; index < buckets.length; index++) {
    const candidate = buckets.slice(index);
    if (windowDuration(candidate) < requiredWindowMs) continue;
    const metrics = trendMetrics(candidate);
    if (isStable(metrics)) {
      plateauMetrics = metrics;
      break;
    }
  }

  const latestBuckets = trailingBuckets(buckets, requiredWindowMs);
  const metrics = plateauMetrics ?? trendMetrics(latestBuckets);
  let status;
  if (plateauMetrics) {
    status = "PLATEAU";
  } else if (
    Math.abs(metrics.slopeMiBPerHour) <= metrics.stableSlopeLimit &&
    metrics.bandWidthMiB > metrics.stableBandLimit
  ) {
    status = "UNSTABLE";
  } else if (metrics.slopeMiBPerHour < -metrics.stableSlopeLimit) {
    status = "DECLINING";
  } else if (metrics.slopeMiBPerHour <= metrics.slowGrowthLimit) {
    status = "SLOW GROWTH";
  } else {
    status = "GROWING";
  }

  const analysisStartMs = metrics.points[0].timestampMs;
  return {
    status,
    sampleCount: samples.length,
    durationMs,
    requiredWindowMs,
    analysisStartMs,
    settledAtMs: plateauMetrics ? analysisStartMs : undefined,
    centerMiB: metrics.centerMiB,
    p10MiB: metrics.p10MiB,
    p90MiB: metrics.p90MiB,
    slopeMiBPerHour: metrics.slopeMiBPerHour,
    stableSlopeLimit: metrics.stableSlopeLimit,
    stableBandLimit: metrics.stableBandLimit,
    buckets,
    samples,
    reason: undefined,
  };
}

export function analyzeRows(rows, options = {}) {
  if (rows.length === 0) {
    return {
      count: 0,
      lines: ["No valid memoryinfo entries."],
      trend: insufficientTrend([], "no valid entries"),
    };
  }

  const analysis = collectAnalysis(rows);
  return {
    count: rows.length,
    lines: renderTerminalAnalysis(analysis, options.color === true),
    trend: analysis.trend,
  };
}

export function createHtmlReport(rows, inputPath) {
  const analysis = collectAnalysis(rows);
  const reportPayload = createHtmlPayload(rows, analysis);
  const reportJson = serializeForInlineScript(reportPayload);
  const statusClass = analysis.trend.status.toLowerCase().replaceAll(" ", "-");
  const warningRows = analysis.warnings.length
    ? analysis.warnings.map((warning) => [warning])
    : [["No ordering or lifecycle warnings."]];
  const resourceChart = Object.keys(reportPayload.resources).length
    ? '<div class="chart"><canvas id="resource-chart"></canvas></div>'
    : '<div class="empty-state">No native or GPU counter data is available in this log.</div>';
  const webGlBufferChart = reportPayload.webglBufferBytes.length
    ? '<div class="chart"><canvas id="webgl-buffer-chart"></canvas></div>'
    : `<div class="empty-state">${analysis.first.runtime?.backend === "webgpu" ? "Not applicable for WebGPU: this log has no WebGL buffer storage counters." : "No WebGL buffer storage counters are available in this log."}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pixi Native memory report - ${escapeHtml(basename(inputPath))}</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1220; --panel:#111c30; --line:#263650; --text:#e6edf7; --muted:#91a3bc; --cyan:#39c6e8; --green:#50d890; --yellow:#f4c95d; --red:#ff6b75; }
    * { box-sizing:border-box; } body { margin:0; background:linear-gradient(145deg,#08101d,#111b2d); color:var(--text); font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
    main { width:min(1500px,96vw); margin:0 auto; padding:28px 0 56px; } h1 { margin:0 0 4px; font-size:28px; } h2 { margin:0 0 14px; color:var(--cyan); font-size:18px; } .subtitle { color:var(--muted); overflow-wrap:anywhere; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin:22px 0; } .card,.panel { background:rgba(17,28,48,.94); border:1px solid var(--line); border-radius:12px; box-shadow:0 12px 35px #0005; }
    .card { padding:16px; } .card span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; } .card strong { display:block; margin-top:5px; font-size:22px; }
    .plateau { color:var(--green); } .slow-growth,.insufficient-data,.unstable { color:var(--yellow); } .growing { color:var(--red); } .declining { color:var(--cyan); }
    .panel { margin-top:14px; padding:18px; overflow:hidden; } .chart { height:390px; position:relative; } .chart canvas { max-height:390px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(440px,1fr)); gap:14px; } table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; } th,td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:right; white-space:nowrap; } th { color:var(--cyan); } th:first-child,td:first-child { text-align:left; } tr:last-child td { border-bottom:0; }
    #chart-warning { display:none; background:#4b3512; color:#ffe4a3; border:1px solid #8a6221; border-radius:8px; padding:12px; margin:16px 0; } html[data-charts="failed"] #chart-warning { display:block; } .warning { color:var(--yellow); white-space:normal; text-align:left; } .empty-state { min-height:120px; display:grid; place-items:center; color:var(--muted); text-align:center; padding:24px; border:1px dashed var(--line); border-radius:8px; }
    @media (max-width:650px) { .grid { grid-template-columns:1fr; } .panel { overflow-x:auto; } main { width:94vw; } }
    @media print { body { background:#fff; color:#111; } .card,.panel { background:#fff; box-shadow:none; break-inside:avoid; } }
  </style>
</head>
<body>
<main>
  <h1>Pixi Native memory report</h1>
  <div class="subtitle">${escapeHtml(resolve(inputPath))}</div>
  <div id="chart-warning">Charts require an internet connection to load Chart.js. The analysis and tables below remain available.</div>
  <section class="cards">
    <div class="card"><span>RSS status</span><strong class="${statusClass}">${escapeHtml(analysis.trend.status)}</strong></div>
    <div class="card"><span>Late center</span><strong>${formatMaybeMiB(analysis.trend.centerMiB)}</strong></div>
    <div class="card"><span>Late trend</span><strong>${formatRate(analysis.trend.slopeMiBPerHour)}</strong></div>
    <div class="card"><span>Duration</span><strong>${formatDuration(analysis.durationMs)}</strong></div>
    <div class="card"><span>Entries</span><strong>${analysis.rows.length.toLocaleString("en-US")}</strong></div>
  </section>
  <section class="panel"><h2>Run</h2>${htmlTable(["Field", "Value"], analysis.runRows)}</section>
  <section class="panel"><h2>Memory summary</h2>${htmlTable(["Metric", "Start", "End", "Delta", "Min", "Max"], analysis.memoryRows)}</section>
  <section class="panel"><h2>RSS plateau analysis</h2>${htmlTable(["Measure", "Value"], trendRows(analysis.trend))}</section>
  <section class="panel"><h2>RSS over time</h2><div class="chart"><canvas id="rss-chart"></canvas></div></section>
  <section class="panel"><h2>JavaScript memory</h2><div class="chart"><canvas id="js-chart"></canvas></div></section>
  <div class="grid">
    <section class="panel"><h2>Late RSS by scene</h2><div class="chart"><canvas id="scene-chart"></canvas></div></section>
    <section class="panel"><h2>Native and GPU counters</h2>${resourceChart}</section>
  </div>
  <section class="panel"><h2>Live WebGL buffer storage</h2>${webGlBufferChart}</section>
  <section class="panel"><h2>Scene baselines</h2>${htmlTable(["Scene", "Samples", "First", "Late median", "Delta", "Late P10-P90"], analysis.sceneRows)}</section>
  <section class="panel"><h2>Resource summary</h2>${htmlTable(["Category", "Metric", "Start", "End", "Max"], analysis.resourceRows)}</section>
  <section class="panel"><h2>Warnings</h2>${htmlTable(["Result"], warningRows, "warning")}</section>
</main>
<script src="${CHART_JS_URL}" onerror="document.documentElement.dataset.charts='failed'"></script>
<script>
const report = ${reportJson};
if (!window.Chart) {
  document.documentElement.dataset.charts = "failed";
} else {
  const colors = ["#39c6e8","#50d890","#f4c95d","#ff6b75","#a98bff","#ff9f55","#70a7ff","#d56ee8"];
  const chartOptions = (yTitle="MiB") => ({
    responsive:true, maintainAspectRatio:false, animation:false, parsing:false, normalized:true,
    interaction:{ mode:"nearest", axis:"x", intersect:false },
    plugins:{ decimation:{ enabled:true, algorithm:"min-max", threshold:1200 }, legend:{ labels:{ color:"#cbd8e8" } } },
    scales:{ x:{ type:"linear", title:{ display:true, text:"Hours from start", color:"#91a3bc" }, ticks:{ color:"#91a3bc" }, grid:{ color:"#263650" } }, y:{ title:{ display:true, text:yTitle, color:"#91a3bc" }, ticks:{ color:"#91a3bc" }, grid:{ color:"#263650" } } }
  });
  const line = (label, data, color, extra={}) => ({ label, data, borderColor:color, backgroundColor:color, borderWidth:1.5, pointRadius:0, ...extra });
  const rssSets = [line("RSS", report.memory.rss, "#91a3bc"), line("5-minute median", report.trend.buckets, "#39c6e8", {borderWidth:2.5})];
  for (const guide of report.trend.guides) rssSets.push(line(guide.label, guide.data, guide.color, {borderDash:guide.dash, borderWidth:2}));
  new Chart(document.getElementById("rss-chart"), { type:"line", data:{ datasets:rssSets }, options:chartOptions() });
  new Chart(document.getElementById("js-chart"), { type:"line", data:{ datasets:[line("Heap used",report.memory.heap,"#50d890"),line("External",report.memory.external,"#f4c95d"),line("ArrayBuffers",report.memory.arrayBuffers,"#a98bff")] }, options:chartOptions() });
  new Chart(document.getElementById("scene-chart"), { type:"bar", data:{ labels:report.scenes.map(x=>x.name), datasets:[{label:"Late median RSS",data:report.scenes.map(x=>x.median),backgroundColor:"#39c6e8"}] }, options:{responsive:true,maintainAspectRatio:false,animation:false,scales:{x:{ticks:{color:"#91a3bc"},grid:{display:false}},y:{title:{display:true,text:"MiB",color:"#91a3bc"},ticks:{color:"#91a3bc"},grid:{color:"#263650"}}},plugins:{legend:{labels:{color:"#cbd8e8"}}}} });
  const resourceSets = Object.entries(report.resources).map(([name,data],index)=>line(name,data,colors[index%colors.length]));
  const resourceCanvas = document.getElementById("resource-chart");
  if (resourceCanvas && resourceSets.length) new Chart(resourceCanvas, { type:"line", data:{datasets:resourceSets}, options:chartOptions("Count") });
  const webGlBufferCanvas = document.getElementById("webgl-buffer-chart");
  if (webGlBufferCanvas && report.webglBufferBytes.length) new Chart(webGlBufferCanvas, { type:"line", data:{datasets:[line("Live WebGL buffer storage",report.webglBufferBytes,"#ff9f55")]}, options:chartOptions() });
}
</script>
</body>
</html>`;
}

function collectAnalysis(rows) {
  const first = rows[0];
  const last = rows.at(-1);
  const startMs = getTimestampMs(first);
  const endMs = getTimestampMs(last);
  const trend = analyzeRssTrend(rows);
  const memoryDefinitions = [
    ["RSS", "rss"],
    ["Heap used", "heapUsed"],
    ["External", "external"],
    ["ArrayBuffers", "arrayBuffers"],
  ];
  const memoryRows = memoryDefinitions.map(([label, name]) => {
    const values = rows.map((row) => row.memory?.[name]).filter(Number.isFinite);
    const firstValue = first.memory?.[name] ?? 0;
    const lastValue = last.memory?.[name] ?? 0;
    return [label, formatBytes(firstValue), formatBytes(lastValue), formatSigned(lastValue - firstValue), formatBytes(values.length ? Math.min(...values) : 0), formatBytes(values.length ? Math.max(...values) : 0)];
  });

  const runtimes = countValues(rows.flatMap((row) => row.runtime ? [`${row.runtime.backend ?? "unknown"}/${row.runtime.target ?? "unknown"}`] : []));
  const scenes = countValues(rows.map(sceneName));
  const runRows = [
    ["Entries", String(rows.length)],
    ["Range", `${first.timestamp ?? "unknown"} -> ${last.timestamp ?? "unknown"}`],
    ["Duration", formatDuration(endMs - startMs)],
    ["Runtime", formatCounts(runtimes) || "unknown"],
    ["Scenes", formatCounts(scenes)],
  ];
  const resourceRows = [
    ...resourceSummaryRows(rows, "GPU", GPU_METRICS),
    ...resourceSummaryRows(rows, "WebGL", WEBGL_RESOURCE_METRICS),
    ...resourceSummaryRows(rows, "WebGL memory", WEBGL_BYTE_METRICS, formatBytes),
    ...resourceSummaryRows(rows, "Video", VIDEO_METRICS),
    ...resourceSummaryRows(rows, "Shutdown", SHUTDOWN_METRICS),
  ];
  const warnings = collectWarnings(rows);
  const sceneStats = createSceneStats(trend);
  const sceneRows = sceneStats.map((scene) => [
    scene.name,
    String(scene.samples),
    formatMaybeMiB(scene.firstMiB),
    formatMaybeMiB(scene.lateMedianMiB),
    formatSignedMiB(scene.deltaMiB),
    `${formatMaybeMiB(scene.p10MiB)} - ${formatMaybeMiB(scene.p90MiB)}`,
  ]);
  return { rows, first, last, startMs, durationMs: endMs - startMs, trend, runRows, memoryRows, resourceRows, sceneStats, sceneRows, warnings };
}

function renderTerminalAnalysis(analysis, color) {
  const lines = [];
  lines.push(...renderTable("Run", ["Field", "Value"], analysis.runRows, color));
  lines.push("");
  lines.push(...renderTable("Memory", ["Metric", "Start", "End", "Delta", "Min", "Max"], analysis.memoryRows, color));
  lines.push("");
  lines.push(...renderTable("RSS trend", ["Measure", "Value"], trendRows(analysis.trend), color, [statusColor(analysis.trend.status)]));
  if (analysis.sceneRows.length) {
    lines.push("");
    lines.push(...renderTable("Scene baselines", ["Scene", "Samples", "First", "Late median", "Delta", "Late P10-P90"], analysis.sceneRows, color));
  }
  if (analysis.resourceRows.length) {
    lines.push("");
    lines.push(...renderTable("Native and GPU resources", ["Category", "Metric", "Start", "End", "Max"], analysis.resourceRows, color));
  }
  lines.push("");
  if (analysis.warnings.length) {
    lines.push(...renderTable("Warnings", ["Result"], analysis.warnings.map((item) => [item]), color, analysis.warnings.map(() => "yellow")));
  } else {
    lines.push(...renderTable("Checks", ["Result"], [["Ordering: continuous timestamps, sequence, and scene exits."]], color, ["green"]));
  }
  return lines;
}

function trendRows(trend) {
  if (trend.status === "INSUFFICIENT DATA") {
    return [["Status", trend.status], ["Evidence", trend.reason], ["Comparable samples", String(trend.sampleCount)]];
  }
  const rows = [
    ["Status", trend.status],
    ["Comparable samples", String(trend.sampleCount)],
    ["Late window", formatDuration(trend.buckets.at(-1).timestampMs - trend.analysisStartMs)],
    ["Center", formatMaybeMiB(trend.centerMiB)],
    ["P10-P90 band", `${formatMaybeMiB(trend.p10MiB)} - ${formatMaybeMiB(trend.p90MiB)}`],
    ["Trend", formatRate(trend.slopeMiBPerHour)],
  ];
  if (Number.isFinite(trend.settledAtMs)) {
    rows.splice(3, 0, ["Settled at", new Date(trend.settledAtMs).toISOString()]);
  }
  return rows;
}

function createRssBuckets(samples) {
  const origin = samples[0].timestampMs;
  const grouped = new Map();
  for (const sample of samples) {
    const index = Math.floor((sample.timestampMs - origin) / BUCKET_MS);
    const bucket = grouped.get(index) ?? [];
    bucket.push(sample);
    grouped.set(index, bucket);
  }
  return [...grouped.entries()].flatMap(([index, bucket]) => bucket.length < 3 ? [] : [{
    timestampMs: origin + index * BUCKET_MS + BUCKET_MS / 2,
    rssMiB: percentile(bucket.map((sample) => sample.rssMiB), 0.5),
    count: bucket.length,
  }]);
}

function trendMetrics(points) {
  const values = points.map((point) => point.rssMiB);
  const centerMiB = percentile(values, 0.5);
  const p10MiB = percentile(values, 0.1);
  const p90MiB = percentile(values, 0.9);
  return {
    points,
    centerMiB,
    p10MiB,
    p90MiB,
    bandWidthMiB: p90MiB - p10MiB,
    slopeMiBPerHour: linearSlope(points),
    stableSlopeLimit: Math.max(0.5, centerMiB * 0.001),
    slowGrowthLimit: Math.max(3, centerMiB * 0.005),
    stableBandLimit: Math.max(5, centerMiB * 0.01),
  };
}

function isStable(metrics) {
  return Math.abs(metrics.slopeMiBPerHour) <= metrics.stableSlopeLimit && metrics.bandWidthMiB <= metrics.stableBandLimit;
}

function trailingBuckets(buckets, durationMs) {
  const lastTimestamp = buckets.at(-1).timestampMs;
  const start = buckets.findIndex((bucket) => lastTimestamp - bucket.timestampMs <= durationMs);
  return buckets.slice(Math.max(0, start));
}

function windowDuration(points) {
  return points.length > 1 ? points.at(-1).timestampMs - points[0].timestampMs : 0;
}

function linearSlope(points) {
  if (points.length < 2) return 0;
  const origin = points[0].timestampMs;
  const xs = points.map((point) => (point.timestampMs - origin) / HOUR_MS);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = points.reduce((sum, point) => sum + point.rssMiB, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < points.length; index++) {
    const deltaX = xs[index] - meanX;
    numerator += deltaX * (points[index].rssMiB - meanY);
    denominator += deltaX * deltaX;
  }
  return denominator ? numerator / denominator : 0;
}

function insufficientTrend(samples, reason) {
  return {
    status: "INSUFFICIENT DATA",
    sampleCount: samples.length,
    durationMs: samples.length > 1 ? samples.at(-1).timestampMs - samples[0].timestampMs : 0,
    buckets: [],
    samples,
    reason,
  };
}

function createSceneStats(trend) {
  if (!trend.samples.length) return [];
  const lateStart = trend.analysisStartMs ?? trend.samples[0].timestampMs;
  const grouped = new Map();
  for (const sample of trend.samples) {
    const values = grouped.get(sample.scene) ?? [];
    values.push(sample);
    grouped.set(sample.scene, values);
  }
  return [...grouped.entries()].map(([name, samples]) => {
    const lateValues = samples.filter((sample) => sample.timestampMs >= lateStart).map((sample) => sample.rssMiB);
    const comparable = lateValues.length ? lateValues : samples.map((sample) => sample.rssMiB);
    const lateMedianMiB = percentile(comparable, 0.5);
    return { name, samples: samples.length, firstMiB: samples[0].rssMiB, lateMedianMiB, deltaMiB: lateMedianMiB - samples[0].rssMiB, p10MiB: percentile(comparable, 0.1), p90MiB: percentile(comparable, 0.9) };
  });
}

function collectWarnings(rows) {
  const gaps = [];
  const sequenceGaps = [];
  const interruptedSceneExits = [];
  let pendingSceneExit;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.reason === "scene-exit:before") {
      if (pendingSceneExit) interruptedSceneExits.push(pendingSceneExit);
      pendingSceneExit = `${sceneName(row)} at sequence ${row.sequence ?? "?"}`;
    } else if (row.reason === "scene-exit:after") {
      pendingSceneExit = undefined;
    }
    if (index === 0) continue;
    const previous = rows[index - 1];
    const deltaMs = getTimestampMs(row) - getTimestampMs(previous);
    if (deltaMs > 180_000) gaps.push(`${Math.round(deltaMs / 1000)}s before ${row.reason}`);
    if (Number.isFinite(previous.sequence) && Number.isFinite(row.sequence) && row.sequence !== previous.sequence + 1) sequenceGaps.push(`${previous.sequence}->${row.sequence}`);
  }
  if (pendingSceneExit) interruptedSceneExits.push(pendingSceneExit);
  const warnings = [];
  if (gaps.length) warnings.push(`Time gaps: ${gaps.join(", ")}`);
  if (sequenceGaps.length) warnings.push(`Sequence gaps: ${sequenceGaps.join(", ")}`);
  if (interruptedSceneExits.length) warnings.push(`Incomplete scene exits: ${interruptedSceneExits.join(", ")}`);
  const pending = rows.at(-1).extra?.nativeVideoPendingDecoderShutdowns;
  if (Number.isFinite(pending) && pending > 0) warnings.push(`Pending native video shutdowns at final entry: ${pending}`);
  return warnings;
}

function resourceSummaryRows(rows, category, names, format = String) {
  return names.flatMap((name) => {
    const values = rows.map((row) => row.extra?.[name]).filter(Number.isFinite);
    return values.length ? [[category, name, format(values[0]), format(values.at(-1)), format(Math.max(...values))]] : [];
  });
}

function createHtmlPayload(rows, analysis) {
  const memoryPoints = rows.flatMap((row) => {
    const timestampMs = getTimestampMs(row);
    if (!Number.isFinite(timestampMs)) return [];
    return [{ x: (timestampMs - analysis.startMs) / HOUR_MS, rss: toMiB(row.memory?.rss), heap: toMiB(row.memory?.heapUsed), external: toMiB(row.memory?.external), arrayBuffers: toMiB(row.memory?.arrayBuffers) }];
  });
  const pointSeries = (name) => memoryPoints.filter((point) => Number.isFinite(point[name])).map((point) => ({ x: point.x, y: point[name] }));
  const resources = {};
  for (const name of [...GPU_METRICS, ...WEBGL_LIVE_METRICS, ...VIDEO_METRICS, ...SHUTDOWN_METRICS]) {
    const values = rows.flatMap((row) => {
      const value = row.extra?.[name];
      const timestampMs = getTimestampMs(row);
      return Number.isFinite(value) && Number.isFinite(timestampMs) ? [{ x: (timestampMs - analysis.startMs) / HOUR_MS, y: value }] : [];
    });
    if (values.length) resources[name] = values;
  }
  const webglBufferBytes = rows.flatMap((row) => {
    const value = row.extra?.webglBufferBytesLive;
    const timestampMs = getTimestampMs(row);
    return Number.isFinite(value) && Number.isFinite(timestampMs)
      ? [{ x: (timestampMs - analysis.startMs) / HOUR_MS, y: value / MIB }]
      : [];
  });
  const guides = [];
  if (
    Number.isFinite(analysis.trend.analysisStartMs) &&
    Number.isFinite(analysis.trend.centerMiB)
  ) {
    const start = (analysis.trend.analysisStartMs - analysis.startMs) / HOUR_MS;
    const end = analysis.durationMs / HOUR_MS;
    for (const [label, value, color, dash] of [["Late center", analysis.trend.centerMiB, "#50d890", []], ["Late P10", analysis.trend.p10MiB, "#f4c95d", [6, 5]], ["Late P90", analysis.trend.p90MiB, "#f4c95d", [6, 5]]]) {
      guides.push({ label, color, dash, data: [{ x: start, y: value }, { x: end, y: value }] });
    }
  }
  return {
    memory: { rss: pointSeries("rss"), heap: pointSeries("heap"), external: pointSeries("external"), arrayBuffers: pointSeries("arrayBuffers") },
    trend: { buckets: analysis.trend.buckets.map((bucket) => ({ x: (bucket.timestampMs - analysis.startMs) / HOUR_MS, y: bucket.rssMiB })), guides },
    scenes: analysis.sceneStats.map((scene) => ({ name: scene.name, median: scene.lateMedianMiB })),
    resources,
    webglBufferBytes,
  };
}

function renderTable(title, headers, rows, color, rowColors = []) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length)));
  const border = (left, middle, right) => left + widths.map((width) => "─".repeat(width + 2)).join(middle) + right;
  const renderRow = (row) => `│ ${row.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join(" │ ")} │`;
  const lines = [paint(title, "cyan", color), border("┌", "┬", "┐"), paint(renderRow(headers), "cyan", color), border("├", "┼", "┤")];
  for (let index = 0; index < rows.length; index++) lines.push(paint(renderRow(rows[index]), rowColors[index], color));
  lines.push(border("└", "┴", "┘"));
  return lines;
}

function htmlTable(headers, rows, cellClass = "") {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td${cellClass && index === 0 ? ` class="${cellClass}"` : ""}>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function paint(value, colorName, enabled) {
  return enabled && colorName ? `${ANSI[colorName]}${value}${ANSI.reset}` : value;
}

function statusColor(status) {
  if (status === "PLATEAU") return "green";
  if (status === "GROWING") return "red";
  if (status === "DECLINING") return "cyan";
  return "yellow";
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function formatCounts(counts) {
  return [...counts.entries()].map(([name, count]) => `${name}=${count}`).join(", ");
}

function percentile(values, fraction) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function getTimestampMs(row) {
  return Number.isFinite(row.timestampMs) ? row.timestampMs : Date.parse(row.timestamp);
}

function sceneName(row) {
  return row.scene ? `${row.scene.index ?? "?"}:${row.scene.name ?? "unknown"}` : "unknown";
}

function toMiB(value) {
  return Number.isFinite(value) ? value / MIB : undefined;
}

function formatBytes(value = 0) {
  return `${(value / MIB).toFixed(1)} MiB`;
}

function formatSigned(value = 0) {
  return `${value >= 0 ? "+" : ""}${formatBytes(value)}`;
}

function formatMaybeMiB(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} MiB` : "n/a";
}

function formatSignedMiB(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(1)} MiB` : "n/a";
}

function formatRate(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)} MiB/h` : "n/a";
}

function formatDuration(value) {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  const minutes = Math.round(value / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function serializeForInlineScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function parseArguments(arguments_) {
  let inputPath;
  let html = false;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === "--html") {
      html = true;
    } else if (argument === "--path") {
      if (inputPath) throw new Error("The input path may only be specified once.");
      inputPath = arguments_[++index];
      if (!inputPath) throw new Error("Missing value for --path.");
    } else if (argument.startsWith("--path=")) {
      if (inputPath) throw new Error("The input path may only be specified once.");
      inputPath = argument.slice("--path=".length);
      if (!inputPath) throw new Error("Missing value for --path.");
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!inputPath) {
      inputPath = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  return { inputPath, html };
}

function htmlReportPath(inputPath) {
  const extension = extname(inputPath);
  return join(dirname(inputPath), `${basename(inputPath, extension)}.report.html`);
}

function shouldUseColor() {
  return Boolean(process.stdout.isTTY && !("NO_COLOR" in process.env) && process.env.TERM !== "dumb");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const inputPath = await resolveMemoryInfoInput(options.inputPath);
    const content = await readFile(inputPath, "utf8");
    const rows = content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    for (const line of analyzeRows(rows, { color: shouldUseColor() }).lines) console.log(line);
    if (options.html) {
      const outputPath = htmlReportPath(inputPath);
      await writeFile(outputPath, createHtmlReport(rows, inputPath), "utf8");
      console.log(`\nHTML report: ${outputPath}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Usage: pnpm analyze-memory-info [--path <memoryInfo.log>] [--html]");
    process.exitCode = 1;
  }
}
