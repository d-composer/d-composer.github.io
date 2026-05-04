const CLASS_COLORS = {
  kick: "#7b61ff",
  snare: "#6b9d3f",
  rim: "#e39d38",
  clap: "#e39d38",
  hat: "#ea4aa6",
  "hat closed": "#ea4aa6",
  "hat open": "#d53792",
  "hat pedal": "#f18bc5",
  tom: "#628ad8",
  "tom low": "#5275ba",
  "tom mid": "#628ad8",
  "tom high": "#86a6e5",
  cymbal: "#35a39a",
  crash: "#35a39a",
  ride: "#4e9fc8",
  splash: "#7bc7cf",
  tambourine: "#cc7e5d",
  cowbell: "#aa6b4f",
  shaker: "#94ae61",
  perc: "#7a8a63",
  other: "#9aa1aa",
};

const FULL_ROWS = [
  { note: 71, label: "other" },
  { note: 70, label: "shaker" },
  { note: 67, label: "perc" },
  { note: 56, label: "cowbell" },
  { note: 54, label: "tambourine" },
  { note: 51, label: "ride" },
  { note: 50, label: "tom high" },
  { note: 49, label: "crash" },
  { note: 47, label: "tom mid" },
  { note: 46, label: "hat open" },
  { note: 43, label: "tom low" },
  { note: 42, label: "hat closed" },
  { note: 39, label: "clap" },
  { note: 38, label: "snare" },
  { note: 37, label: "rim" },
  { note: 36, label: "kick" },
];

const DATASET_LABELS = {
  mdb_drums: "MDB-Drums",
  e_gmd: "E-GMD",
  musdb: "MusDB",
  fsl10k: "Freesound Loops",
  apple_loops: "Apple Loops",
  synthetic: "Synthetic",
  codec: "One-shots",
};

const DATASET_ORDER = ["musdb", "e_gmd", "mdb_drums", "fsl10k", "synthetic"];
const TARGET_CLASSES = ["kick", "snare", "tom", "hat", "cymbal"];
const DCOMPOSER_LABELS = new Map([
  [71, "other"],
  [70, "shaker"],
  [67, "perc"],
  [56, "cowbell"],
  [54, "tambourine"],
  [49, "cymbal"],
  [43, "tom"],
  [42, "hat"],
  [39, "clap"],
  [38, "snare"],
  [37, "rim"],
  [36, "kick"],
]);
const IDM_LABELS = new Map([
  [51, "ride"],
  [50, "tom high"],
  [49, "crash"],
  [47, "tom mid"],
  [46, "hat open"],
  [43, "tom low"],
  [42, "hat closed"],
  [38, "snare"],
  [36, "kick"],
]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmt(x) {
  return x == null ? "-" : Number(x).toFixed(3);
}

function datasetLabel(dataset) {
  return DATASET_LABELS[dataset] || dataset.replaceAll("_", " ");
}

function rowLabelForLane(role, row) {
  if (role === "dcomposer") return DCOMPOSER_LABELS.get(row.note) || "";
  if (role === "idm") return IDM_LABELS.get(row.note) || "";
  return row.label;
}

function buildPlayPauseButton(audio, opts = {}) {
  const beforePlay = opts.beforePlay || (() => {});
  const btn = el("button", "icon-btn");
  btn.setAttribute("type", "button");
  const playSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="8,6 19,12 8,18"></polygon>
    </svg>`;
  const pauseSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="6" width="4" height="12"></rect>
      <rect x="13" y="6" width="4" height="12"></rect>
    </svg>`;
  function sync() {
    btn.innerHTML = `${audio.paused ? playSvg : pauseSvg}<span>${audio.paused ? "Play" : "Pause"}</span>`;
  }
  audio.preload = "auto";
  btn.addEventListener("click", () => {
    if (audio.paused) {
      beforePlay();
      audio.play();
    } else {
      audio.pause();
    }
  });
  audio.addEventListener("play", sync);
  audio.addEventListener("pause", sync);
  audio.addEventListener("ended", sync);
  sync();
  return btn;
}

function makeAudioLink(path, label = "play") {
  if (!path) return el("span", "audio-link missing", "missing");
  const btn = el("button", "audio-link", label);
  btn.addEventListener("click", () => {
    const audio = new Audio(path);
    audio.play();
  });
  return btn;
}

function groupRows(lanes) {
  const byNote = new Map();
  FULL_ROWS.forEach((row) => byNote.set(row.note, row.label));
  lanes.forEach((lane) => {
    lane.events.forEach((ev) => {
      const key = Number(ev.row_note);
      if (!byNote.has(key)) {
        byNote.set(key, ev.row_label);
      }
    });
  });
  return [...byNote.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([note, label]) => ({ note, label }));
}

function colorForEvent(ev) {
  return CLASS_COLORS[ev.row_label] || CLASS_COLORS[ev.coarse_label] || "#7a7a7a";
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildPianoRoll(lane, allRows) {
  const panel = el("div", "roll-card");
  const head = el("div", "roll-head");
  head.appendChild(el("h4", "", lane.name));
  const audio = new Audio(lane.audio);
  audio.preload = "auto";
  audio.load();
  let desiredTime = 0;
  const controls = el("div", "roll-controls");
  controls.appendChild(el("span", "fine-print", "Click notes to listen to predicted one-shots"));
  controls.appendChild(buildPlayPauseButton(audio, {
    beforePlay: () => {
      if (Math.abs(audio.currentTime - desiredTime) > 0.02) {
        try {
          audio.currentTime = desiredTime;
        } catch (_err) {}
      }
    },
  }));
  head.appendChild(controls);
  panel.appendChild(head);

  const duration = 4.0;
  const rowH = 24;
  const top = 24;
  const left = 112;
  const usableW = 620;
  const width = left + usableW + 20;
  const height = top + rowH * allRows.length + 16;

  const roll = el("div", "piano-roll");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  roll.appendChild(svg);

  allRows.forEach((row, idx) => {
    const y = top + idx * rowH;
    const bg = document.createElementNS(svg.namespaceURI, "rect");
    bg.setAttribute("x", String(left));
    bg.setAttribute("y", String(y));
    bg.setAttribute("width", String(usableW));
    bg.setAttribute("height", String(rowH));
    bg.setAttribute("fill", idx % 2 === 0 ? "#ffffff" : "#f4f5f3");
    bg.style.pointerEvents = "none";
    svg.appendChild(bg);

    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", "14");
    label.setAttribute("y", String(y + 16));
    label.setAttribute("fill", "#394450");
    label.setAttribute("font-size", "12");
    label.setAttribute("font-weight", "700");
    label.setAttribute("font-family", "Arial, Helvetica, sans-serif");
    label.style.pointerEvents = "none";
    label.textContent = rowLabelForLane(lane.role, row);
    svg.appendChild(label);

    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", String(left));
    line.setAttribute("x2", String(left + usableW));
    line.setAttribute("y1", String(y + rowH));
    line.setAttribute("y2", String(y + rowH));
    line.setAttribute("stroke", "rgba(31,41,55,0.10)");
    line.style.pointerEvents = "none";
    svg.appendChild(line);
  });

  for (let i = 0; i <= 8; i++) {
    const x = left + (usableW * i) / 8;
    const tick = document.createElementNS(svg.namespaceURI, "line");
    tick.setAttribute("x1", String(x));
    tick.setAttribute("x2", String(x));
    tick.setAttribute("y1", String(top));
    tick.setAttribute("y2", String(top + rowH * allRows.length));
    tick.setAttribute("stroke", i % 2 === 0 ? "rgba(31,41,55,0.18)" : "rgba(31,41,55,0.08)");
    tick.style.pointerEvents = "none";
    svg.appendChild(tick);
    if (i < 8) {
      const label = document.createElementNS(svg.namespaceURI, "text");
      label.setAttribute("x", String(x + 2));
      label.setAttribute("y", "15");
      label.setAttribute("fill", "#6b7280");
      label.setAttribute("font-size", "12");
      label.setAttribute("font-family", "Arial, Helvetica, sans-serif");
      label.style.pointerEvents = "none";
      label.textContent = `${(i * duration / 8).toFixed(2)}s`;
      svg.appendChild(label);
    }
  }

  const rowIndex = new Map(allRows.map((r, i) => [r.note, i]));
  const scrubber = document.createElementNS(svg.namespaceURI, "rect");
  scrubber.setAttribute("x", String(left));
  scrubber.setAttribute("y", String(top));
  scrubber.setAttribute("width", String(usableW));
  scrubber.setAttribute("height", String(rowH * allRows.length));
  scrubber.setAttribute("fill", "transparent");
  scrubber.style.cursor = "pointer";
  svg.appendChild(scrubber);

  lane.events.forEach((ev) => {
    const idx = rowIndex.get(Number(ev.row_note));
    if (idx == null) return;
    const x = left + (usableW * ev.onset_sec) / duration;
    const y = top + idx * rowH + 2;
    const color = colorForEvent(ev);
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", "12");
    rect.setAttribute("height", "18");
    rect.setAttribute("fill", hexToRgba(color, 0.16));
    rect.setAttribute("stroke", color);
    rect.setAttribute("stroke-width", "2.4");
    rect.style.cursor = ev.audio ? "pointer" : "default";
    rect.addEventListener("mouseenter", () => {
      rect.setAttribute("fill", hexToRgba(color, 0.28));
      rect.setAttribute("stroke-width", "3.4");
    });
    rect.addEventListener("mouseleave", () => {
      rect.setAttribute("fill", hexToRgba(color, 0.16));
      rect.setAttribute("stroke-width", "2.4");
    });
    if (ev.audio) {
      rect.addEventListener("click", (e) => {
        e.stopPropagation();
        rect.setAttribute("fill", hexToRgba(color, 0.38));
        rect.setAttribute("stroke-width", "4.0");
        setTimeout(() => {
          rect.setAttribute("fill", hexToRgba(color, 0.16));
          rect.setAttribute("stroke-width", "2.4");
        }, 300);
        const shot = new Audio(ev.audio);
        shot.play();
      });
    }
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${ev.row_label} @ ${ev.onset_sec.toFixed(2)}s`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });

  const playhead = document.createElementNS(svg.namespaceURI, "line");
  playhead.setAttribute("x1", String(left));
  playhead.setAttribute("x2", String(left));
  playhead.setAttribute("y1", String(top));
  playhead.setAttribute("y2", String(top + rowH * allRows.length));
  playhead.setAttribute("stroke", "#cc5b37");
  playhead.setAttribute("stroke-width", "2");
  playhead.setAttribute("visibility", "hidden");
  playhead.style.pointerEvents = "none";
  svg.appendChild(playhead);

  let raf = null;
  function setPlayhead(frac) {
    const clipped = Math.max(0, Math.min(1, frac));
    const x = left + usableW * clipped;
    playhead.setAttribute("x1", String(x));
    playhead.setAttribute("x2", String(x));
    playhead.setAttribute("visibility", "visible");
  }
  function seekAudio(frac) {
    const clipped = Math.max(0, Math.min(1, frac));
    desiredTime = clipped * duration;
    setPlayhead(clipped);
    try {
      if (audio.readyState >= 1) {
        audio.currentTime = desiredTime;
      }
    } catch (_err) {}
  }
  setPlayhead(0);
  function updatePlayhead() {
    const x = left + (usableW * Math.min(audio.currentTime, duration)) / duration;
    playhead.setAttribute("x1", String(x));
    playhead.setAttribute("x2", String(x));
    if (!audio.paused) raf = requestAnimationFrame(updatePlayhead);
  }
  audio.addEventListener("loadedmetadata", () => {
    try {
      audio.currentTime = desiredTime;
    } catch (_err) {}
  });
  audio.addEventListener("timeupdate", () => {
    desiredTime = Math.min(duration, audio.currentTime);
  });
  audio.addEventListener("play", () => {
    playhead.setAttribute("visibility", "visible");
    if (raf) cancelAnimationFrame(raf);
    updatePlayhead();
  });
  audio.addEventListener("pause", () => {
    if (raf) cancelAnimationFrame(raf);
  });
  audio.addEventListener("ended", () => {
    desiredTime = 0;
    setPlayhead(0);
    playhead.setAttribute("visibility", "hidden");
    if (raf) cancelAnimationFrame(raf);
  });

  scrubber.addEventListener("click", (evt) => {
    const bounds = svg.getBoundingClientRect();
    const xPx = evt.clientX - bounds.left;
    const viewX = (xPx / bounds.width) * width;
    if (viewX < left || viewX > left + usableW) return;
    const frac = (viewX - left) / usableW;
    seekAudio(frac);
  });

  panel.appendChild(roll);
  return panel;
}

function buildDatasetCarousel(dataset, examples, renderer) {
  let idx = 0;
  const card = el("div", "card");
  const head = el("div", "card-header");
  head.appendChild(el("h3", "", `Dataset: ${datasetLabel(dataset)}`));
  head.appendChild(el("div", "pill", `${examples.length} examples`));
  card.appendChild(head);

  const nav = el("div", "carousel-nav");
  const prev = el("button", "carousel-btn", "←");
  const status = el("div", "meta");
  const next = el("button", "carousel-btn", "→");
  nav.appendChild(prev);
  nav.appendChild(status);
  nav.appendChild(next);
  card.appendChild(nav);

  const stage = el("div", "carousel-stage");
  card.appendChild(stage);

  function render() {
    stage.replaceChildren(renderer(examples[idx]));
    status.textContent = `Example ${idx + 1} / ${examples.length} · ${examples[idx].mixture_id}`;
  }
  prev.addEventListener("click", () => {
    idx = (idx - 1 + examples.length) % examples.length;
    render();
  });
  next.addEventListener("click", () => {
    idx = (idx + 1) % examples.length;
    render();
  });
  render();
  return card;
}

function renderDecompositionExample(ex) {
  const wrap = el("div", "stack");
  const inputPanel = el("div", "panel");
  inputPanel.appendChild(el("h4", "", "Input mixture"));
  const inputAudio = document.createElement("audio");
  inputAudio.controls = true;
  inputAudio.src = ex.input_audio;
  inputPanel.appendChild(inputAudio);
  wrap.appendChild(inputPanel);

  const laneWrap = el("div", "roll-grid");
  const rows = groupRows(ex.lanes);
  ex.lanes.forEach((lane) => laneWrap.appendChild(buildPianoRoll(lane, rows)));
  wrap.appendChild(laneWrap);
  return wrap;
}

function renderRoundtripExample(ex) {
  const sub = el("div", "panel");
  const cols = el("div", ex.idm ? "three-col" : "two-col");
  [
    ["Input", ex.input, null],
    ["D-Composer", ex.dcomposer, ex.metrics?.dcomposer_stft_loss],
    ["IDM", ex.idm, ex.metrics?.idm_stft_loss],
  ].forEach(([label, media, loss]) => {
    if (!media) return;
    const pane = el("div", "panel");
    const top = el("div", "roundtrip-pane-head");
    top.appendChild(el("h4", "", label));
    top.appendChild(el("div", "meta", loss != null ? `MSL: ${fmt(loss)}` : " "));
    pane.appendChild(top);
    const img = document.createElement("img");
    img.src = media.image;
    img.alt = `${label} spectrogram`;
    img.className = "spectro";
    pane.appendChild(img);
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = media.audio;
    pane.appendChild(audio);
    cols.appendChild(pane);
  });
  sub.appendChild(cols);
  return sub;
}

function initTabs() {
  const tabs = [...document.querySelectorAll(".task-tab")];
  const panels = [...document.querySelectorAll(".task-panel")];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.panel;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) => p.classList.toggle("active", p.id === target));
    });
  });
}

function buildDecompositionSection(data) {
  const root = document.getElementById("decomposition-grid");
  if (!data.decomposition_examples.length) {
    const card = el("div", "card");
    card.appendChild(el("h3", "", "No decomposition examples available"));
    card.appendChild(
      el(
        "p",
        "meta",
        "Examples are only shown when exact dataset-matched D-Composer and IDM transcripts, round-trip audio, and note-click one-shot assets are all present."
      )
    );
    root.appendChild(card);
    return;
  }
  const grouped = {};
  data.decomposition_examples.forEach((ex) => {
    (grouped[ex.dataset] ||= []).push(ex);
  });
  DATASET_ORDER.forEach((dataset) => {
    const examples = grouped[dataset];
    if (examples && examples.length) {
      root.appendChild(buildDatasetCarousel(dataset, examples, renderDecompositionExample));
    }
  });
}

function buildRoundtripSection(data) {
  const root = document.getElementById("roundtrip-grid");
  const grouped = {};
  data.roundtrip_examples.forEach((ex) => {
    (grouped[ex.dataset] ||= []).push(ex);
  });
  DATASET_ORDER.forEach((dataset) => {
    const examples = grouped[dataset];
    if (examples && examples.length) {
      root.appendChild(buildDatasetCarousel(dataset, examples, renderRoundtripExample));
    }
  });
}

function buildOneshotSection(data) {
  const root = document.getElementById("oneshot-grid");
  const examples = data.decomposition_examples.filter((ex) => ex.dataset === "synthetic");
  if (!examples.length) return;
  root.appendChild(buildDatasetCarousel("synthetic", examples, (ex) => {
    const card = el("div", "stack");
    const inputPanel = el("div", "panel");
    inputPanel.appendChild(el("h4", "", "Input mixture"));
    const mix = document.createElement("audio");
    mix.controls = true;
    mix.src = ex.input_audio;
    inputPanel.appendChild(mix);
    card.appendChild(inputPanel);

    const dcompLane = ex.lanes.find((l) => l.name === "D-Composer");
    const idmLane = ex.lanes.find((l) => l.name === "IDM");
    const dcompPresent = new Set((dcompLane?.events || []).map((ev) => ev.coarse_label).filter((x) => TARGET_CLASSES.includes(x)));
    const idmPresent = new Set((idmLane?.events || []).map((ev) => ev.coarse_label).filter((x) => TARGET_CLASSES.includes(x)));

    const gtClasses = TARGET_CLASSES.filter((cls) => ex.oneshot_representatives[cls]?.gt);
    const grid = el("div", "oneshot-class-grid");
    gtClasses.forEach((cls) => {
      const reps = ex.oneshot_representatives[cls] || {};
      const pane = el("div", "panel");
      pane.appendChild(el("h4", "", cls));
      const rows = el("div", "oneshot-method-list");
      [
        ["GT", reps.gt],
        ["D-Composer", dcompPresent.has(cls) ? reps.dcomposer : null],
        ["IDM", idmPresent.has(cls) ? reps.idm : null],
        ["DOSE", ["kick", "snare", "hat"].includes(cls) ? reps.dose : null],
      ].forEach(([label, path]) => {
        const row = el("div", "oneshot-method-row");
        row.appendChild(el("div", "oneshot-method-name", label));
        const cell = el("div", "oneshot-method-audio");
        if (path && path.audio) {
          if (path.stft_loss != null) {
            cell.appendChild(el("div", "meta", `MSL: ${fmt(path.stft_loss)}`));
          }
          if (path.image) {
            const img = document.createElement("img");
            img.src = path.image;
            img.alt = `${label} ${cls} spectrogram`;
            img.className = "spectro oneshot-spectro";
            cell.appendChild(img);
          }
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.src = path.audio;
          cell.appendChild(audio);
        } else {
          cell.appendChild(el("span", "audio-link missing", "missing"));
        }
        row.appendChild(cell);
        rows.appendChild(row);
      });
      pane.appendChild(rows);
      grid.appendChild(pane);
    });
    card.appendChild(grid);
    return card;
  }));
}

function buildCodecSection(data) {
  const grid = document.getElementById("codec-grid");
  grid.appendChild(buildDatasetCarousel("codec", data.codec_examples, (ex) => {
    const sub = el("div", "panel");
    sub.appendChild(el("h4", "", `Logic Drums one-shot ${ex.sample_id}`));
    const cols = el("div", "codec-grid-compact");
    [
      ["Input", ex.input],
      ["DAC (7.7kbps)", ex.dac],
      ["CoDiCodec (2.38kbps)", ex.codicodec],
      ["MelodyFlow (continuous)", ex.melodyflow],
      ["DOC (0.1kbps)", ex.autoencoder],
    ].forEach(([label, media]) => {
      const pane = el("div", "panel");
      const top = el("div", "roundtrip-pane-head");
      top.appendChild(el("h4", "", label));
      top.appendChild(el("div", "meta", media.stft_loss != null ? `MSL: ${fmt(media.stft_loss)}` : " "));
      pane.appendChild(top);
      const img = document.createElement("img");
      img.src = media.image;
      img.alt = `${label} spectrogram`;
      img.className = "spectro";
      pane.appendChild(img);
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = media.audio;
      pane.appendChild(audio);
      cols.appendChild(pane);
    });
    sub.appendChild(cols);
    return sub;
  }));
}

fetch("assets/data/site_data.json")
  .then((r) => r.json())
  .then((data) => {
    initTabs();
    buildDecompositionSection(data);
    buildRoundtripSection(data);
    buildOneshotSection(data);
    buildCodecSection(data);
  })
  .catch((err) => {
    document.body.appendChild(el("pre", "", `Failed to load site data: ${err}`));
  });
