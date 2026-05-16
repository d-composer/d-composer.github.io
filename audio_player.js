(function () {
  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const total = Math.floor(sec);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function playSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="8,6 19,12 8,18"></polygon>
      </svg>`;
  }

  function pauseSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="6" width="4" height="12"></rect>
        <rect x="13" y="6" width="4" height="12"></rect>
      </svg>`;
  }

  function downloadSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v10"></path>
        <path d="M8.5 10.5L12 14l3.5-3.5"></path>
        <path d="M6 18h12"></path>
      </svg>`;
  }

  function createNativeAudioPlayer({ src, className = "" } = {}) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = src || "";
    if (className) audio.className = className;
    return audio;
  }

  function createAudioPlayer({ src, compact = false, className = "" } = {}) {
    if (!src) return createNativeAudioPlayer({ src, className });

    const root = document.createElement("div");
    root.className = `audio-player${compact ? " audio-player-compact" : ""}${className ? ` ${className}` : ""}`;

    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = src;
    audio.className = "audio-player-element";

    const button = document.createElement("button");
    button.className = "audio-player-btn";
    button.type = "button";
    button.setAttribute("aria-label", "Play or pause audio");

    const time = document.createElement("div");
    time.className = "audio-player-time";
    time.textContent = "0:00 / 0:00";

    const progressWrap = document.createElement("div");
    progressWrap.className = "audio-player-progress-wrap";
    const progressBase = document.createElement("div");
    progressBase.className = "audio-player-progress-base";
    const progressPlayed = document.createElement("div");
    progressPlayed.className = "audio-player-progress-played";
    const progressThumb = document.createElement("div");
    progressThumb.className = "audio-player-progress-thumb";
    progressWrap.appendChild(progressBase);
    progressWrap.appendChild(progressPlayed);
    progressWrap.appendChild(progressThumb);

    const download = document.createElement("a");
    download.className = "audio-player-download";
    download.href = src;
    download.download = "";
    download.setAttribute("aria-label", "Download audio");
    download.innerHTML = downloadSvg();

    let isSeeking = false;
    let isDragging = false;
    let showThumbPersist = false;
    let raf = null;

    function setThumbClasses() {
      root.classList.toggle("is-dragging", isDragging);
      root.classList.toggle("is-persist-handle", showThumbPersist);
    }

    function syncButton() {
      button.innerHTML = audio.paused ? playSvg() : pauseSvg();
    }

    function setProgressVisual(pct) {
      const clamped = Math.max(0, Math.min(1, pct || 0));
      progressWrap.style.setProperty("--progress-pct", `${clamped * 100}%`);
    }

    function syncRange() {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const current = Math.min(audio.currentTime || 0, duration || 0);
      const pct = duration > 0 ? current / duration : 0;
      if (!isSeeking) setProgressVisual(pct);
      time.textContent = `${fmtTime(current)} / ${fmtTime(duration)}`;
    }

    function tick() {
      syncRange();
      if (!audio.paused) raf = requestAnimationFrame(tick);
    }

    function startTick() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }

    function stopTick() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    function pctFromEvent(evt) {
      const rect = progressWrap.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
    }

    function seekToPct(pct) {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const clamped = Math.max(0, Math.min(1, pct || 0));
      setProgressVisual(clamped);
      time.textContent = `${fmtTime(duration * clamped)} / ${fmtTime(duration)}`;
      if (duration > 0) audio.currentTime = duration * clamped;
    }

    button.addEventListener("click", () => {
      showThumbPersist = false;
      setThumbClasses();
      if (audio.paused) {
        const play = audio.play();
        if (play && typeof play.catch === "function") play.catch(() => {});
      } else {
        audio.pause();
      }
    });

    progressWrap.addEventListener("mouseenter", () => {
      progressWrap.classList.add("is-hovering");
    });

    progressWrap.addEventListener("mouseleave", () => {
      if (!isDragging) progressWrap.classList.remove("is-hovering");
    });

    progressWrap.addEventListener("pointerdown", (evt) => {
      showThumbPersist = true;
      isSeeking = true;
      isDragging = true;
      setThumbClasses();
      progressWrap.classList.add("is-hovering");
      progressWrap.setPointerCapture(evt.pointerId);
      seekToPct(pctFromEvent(evt));
    });

    progressWrap.addEventListener("pointermove", (evt) => {
      if (!isDragging) return;
      seekToPct(pctFromEvent(evt));
    });

    function endDrag(evt) {
      if (!isDragging) return;
      isDragging = false;
      isSeeking = false;
      setThumbClasses();
      seekToPct(pctFromEvent(evt));
    }

    progressWrap.addEventListener("pointerup", endDrag);
    progressWrap.addEventListener("pointercancel", () => {
      isDragging = false;
      isSeeking = false;
      setThumbClasses();
    });

    audio.addEventListener("loadedmetadata", syncRange);
    audio.addEventListener("durationchange", syncRange);
    audio.addEventListener("timeupdate", syncRange);
    audio.addEventListener("play", () => {
      syncButton();
      startTick();
    });
    audio.addEventListener("pause", () => {
      syncButton();
      stopTick();
    });
    audio.addEventListener("ended", () => {
      stopTick();
      syncButton();
      syncRange();
    });

    root.appendChild(button);
    root.appendChild(time);
    root.appendChild(progressWrap);
    root.appendChild(download);
    root.appendChild(audio);

    syncButton();
    syncRange();

    root.destroy = () => {
      stopTick();
      audio.pause();
      audio.src = "";
      audio.load();
    };

    return root;
  }

  window.AudioPlayer = {
    createAudioPlayer,
    createNativeAudioPlayer,
  };
})();
