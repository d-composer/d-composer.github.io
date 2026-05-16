# D-Composer Supplementary Webpage

This directory contains a small static supplementary webpage built from a seeded sample of the local evaluation outputs.

## What it currently includes

- `synthetic` interactive decomposition views:
  - ground-truth piano roll
  - D-Composer piano roll
  - IDM piano roll
  - clickable one-shots
  - moving playhead synced to audio playback
- round-trip examples for:
  - `mdb_drums`
  - `e_gmd`
  - `musdb`
  - `fsl10k`
  - `apple_loops`
  - `synthetic`
- synthetic one-shot extraction comparisons across:
  - D-Composer
  - IDM
  - DOSE
- codec reconstruction examples for:
  - DAC
  - CoDiCodec
  - MelodyFlow
  - DOC / autoencoder

## Note on IDM playback

IDM note clicks in the piano-roll section use one representative class-level one-shot per mixture, because IDM predicts one one-shot per class rather than one event-specific one-shot per onset.

## Files

- `build_site.py`
  - copies a small subset of audio into `assets/`
  - generates spectrogram PNGs
  - writes `assets/data/site_data.json`
- `index.html`
- `styles.css`
- `app.js`

## Rebuild the site

From the repo root:

```bash
python resources/d-composer.github.io/build_site.py
```

## Preview locally

From the repo root:

```bash
cd resources/d-composer.github.io
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Notes

- The site is intentionally small and static so it loads quickly.
- Audio and image assets are copied into this directory so the page can be served independently via GitHub Pages.
