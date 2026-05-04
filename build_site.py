#!/usr/bin/env python3
import csv
import json
import os
import random
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict
from typing import Iterable
from typing import List
from typing import Optional
from typing import Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf
import torch
from audiotools import AudioSignal
from audiotools.metrics.spectral import MultiScaleSTFTLoss


ROOT = Path(__file__).resolve().parent
PROJECT_DIR = ROOT.parent.parent
sys.path.insert(0, str(PROJECT_DIR))
from unsoup.dsp import resample
from unsoup.constants import COARSE_MIDI_NOTE_TO_COARSE_LABEL

EVAL_INPUTS = PROJECT_DIR / "resources" / "eval_inputs_full"
UNSOUP_ROOT = PROJECT_DIR / "resources" / "unsoup_eval_full"
CODEC_ROOT = PROJECT_DIR / "resources" / "codec_reconstruction_logic_oneshots"

D_COMPOSER_TRANSCRIPT_METHOD = "final_normm16_p095_fullamp_ae5"
D_COMPOSER_AUDIO_METHOD = "final_normm16_p095_fullamp_ae5_alloneshots"
IDM_METHOD = "idm_v2"
DOSE_METHOD = "dose"

D_COMPOSER_TRANSCRIPT_ROOT = UNSOUP_ROOT / D_COMPOSER_TRANSCRIPT_METHOD
D_COMPOSER_AUDIO_ROOT = UNSOUP_ROOT / D_COMPOSER_AUDIO_METHOD
IDM_ROOT = UNSOUP_ROOT / IDM_METHOD
DOSE_ROOT = UNSOUP_ROOT / DOSE_METHOD

ROUNDTRIP_DATASETS = ["mdb_drums", "e_gmd", "musdb", "fsl10k", "synthetic"]
TARGET_CLASSES = ["kick", "snare", "tom", "hat", "cymbal"]
MPLCONFIGDIR = str(ROOT / ".mplconfig")
TARGET_DB = -16.0
WINDOW_LENGTHS = [2048, 1024, 512, 256, 128, 64]
EXCLUDED_DECOMPOSITION_IDS = {
    "musdb": {"00433"},
}

IDM_9CLASS_MAP = {
    "KD": (36, "kick", "kick"),
    "SD": (38, "snare", "snare"),
    "HH_CHH": (42, "hat", "hat closed"),
    "HH_OHH": (46, "hat", "hat open"),
    "TT_HFT": (50, "tom", "tom high"),
    "TT_HMT": (47, "tom", "tom mid"),
    "TT_LMT": (43, "tom", "tom low"),
    "CY_CR": (49, "cymbal", "crash"),
    "CY_RD": (51, "cymbal", "ride"),
}

IDM_5CLASS_MAP = {
    "kick": (36, "kick", "kick"),
    "snare": (38, "snare", "snare"),
    "hihat": (42, "hat", "hat closed"),
    "tom": (47, "tom", "tom mid"),
    "cymbal": (49, "cymbal", "crash"),
}

REP_NOTES = {
    "kick": 36,
    "snare": 38,
    "rim": 37,
    "clap": 39,
    "hat": 42,
    "hat closed": 42,
    "hat pedal": 44,
    "hat open": 46,
    "hat_closed": 42,
    "hat_pedal": 44,
    "hat_open": 46,
    "tom": 47,
    "tom low": 43,
    "tom mid": 47,
    "tom high": 50,
    "tom_low": 43,
    "tom_mid": 47,
    "tom_high": 50,
    "cymbal": 49,
    "crash": 49,
    "ride": 51,
    "splash": 55,
    "tambourine": 54,
    "cowbell": 56,
    "shaker": 70,
    "perc": 67,
    "other": 75,
}

IDM_ONE_SHOT_DIRS = {
    "kick": ["kd"],
    "snare": ["sd"],
    "hat closed": ["hh_chh"],
    "hat open": ["hh_ohh"],
    "tom high": ["tt_hft"],
    "tom mid": ["tt_hmt"],
    "tom low": ["tt_lmt"],
    "crash": ["cy_cr"],
    "ride": ["cy_rd"],
}

IDM_CLASS_BUCKET_DIRS = {
    "kick": ["kd"],
    "snare": ["sd"],
    "hat": ["hh_chh"],
    "tom": ["tt_hmt"],
    "cymbal": ["cy_cr"],
}

_MSL = None


def ensure_clean_dir(path: Path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def copy_audio(src: Path, dst: Path, *, force_mono: bool = False):
    dst.parent.mkdir(parents=True, exist_ok=True)
    audio, sr = sf.read(str(src), always_2d=True, dtype="float32")
    if force_mono:
        audio = audio.mean(axis=1, keepdims=True)
    rms = float(np.sqrt(np.mean(np.square(audio), dtype=np.float64)))
    if rms > 1e-12:
        target_amp = 10.0 ** (TARGET_DB / 20.0)
        audio = audio * (target_amp / rms)
    peak = float(np.max(np.abs(audio)))
    if peak > 1.0:
        audio = audio / peak
    sf.write(str(dst), audio, sr)


def load_json(path: Path) -> Dict:
    with path.open("r") as f:
        return json.load(f)


def load_csv(path: Path) -> List[Dict]:
    with path.open("r", newline="") as f:
        return list(csv.DictReader(f))


def get_msl() -> MultiScaleSTFTLoss:
    global _MSL
    if _MSL is None:
        _MSL = MultiScaleSTFTLoss(window_lengths=WINDOW_LENGTHS, log_weight=0.0).cpu()
    return _MSL


def load_signal(path: Path) -> AudioSignal:
    audio, sr = sf.read(str(path), always_2d=True, dtype="float32")
    return AudioSignal(torch.from_numpy(audio.T).unsqueeze(0), sample_rate=int(sr))


def fit_signal_length(sig: AudioSignal, n_samples: int) -> AudioSignal:
    target = int(n_samples)
    if sig.signal_length > target:
        sig.truncate_samples(target)
    elif sig.signal_length < target:
        sig = sig.zero_pad_to(target)
    return sig


def prepare_metric_signal(sig: AudioSignal, sample_rate: int = 44100) -> AudioSignal:
    out = sig.clone()
    if out.num_channels != 1:
        out = out.to_mono()
    if int(out.sample_rate) != int(sample_rate):
        out = resample(out, int(sample_rate))
    return out


def compute_msl_from_paths(ref_path: Path, pred_path: Path) -> float:
    ref = prepare_metric_signal(load_signal(ref_path))
    pred = prepare_metric_signal(load_signal(pred_path))
    target_len = max(int(ref.signal_length), int(pred.signal_length))
    ref = fit_signal_length(ref, target_len)
    pred = fit_signal_length(pred, target_len)
    with torch.no_grad():
        return float(get_msl()(ref.cpu(), pred.cpu()).detach().item())


def choose_midband_rows(rows: Sequence[Dict], key: str, n: int, seed: int) -> List[Dict]:
    vals = sorted(float(r[key]) for r in rows)
    lo = vals[max(0, int(0.15 * (len(vals) - 1)))]
    hi = vals[min(len(vals) - 1, int(0.85 * (len(vals) - 1)))]
    candidates = [r for r in rows if lo <= float(r[key]) <= hi]
    rng = random.Random(seed)
    if len(candidates) <= n:
        out = list(candidates)
        rng.shuffle(out)
        return out
    return rng.sample(candidates, n)


def load_dataset_manifest_map(dataset: str) -> Dict[str, Dict]:
    manifest_path = EVAL_INPUTS / dataset / "manifest.json"
    if not manifest_path.is_file():
        return {}
    rows = load_json(manifest_path)
    return {Path(row["audio_path"]).stem: row for row in rows}


def choose_dataset_examples(
    rows: Sequence[Dict],
    *,
    dataset: str,
    key: str,
    n: int,
    seed: int,
) -> List[Dict]:
    vals = sorted(float(r[key]) for r in rows)
    lo = vals[max(0, int(0.15 * (len(vals) - 1)))]
    hi = vals[min(len(vals) - 1, int(0.85 * (len(vals) - 1)))]
    excluded = EXCLUDED_DECOMPOSITION_IDS.get(dataset, set())
    candidates = [r for r in rows if lo <= float(r[key]) <= hi and Path(r["mixture_relpath"]).stem not in excluded]
    rng = random.Random(seed)
    rng.shuffle(candidates)

    if dataset != "musdb":
        return candidates[:n]

    manifest_map = load_dataset_manifest_map("musdb")
    chosen = []
    seen_sources = set()
    leftovers = []
    for row in candidates:
        mid = Path(row["mixture_relpath"]).stem
        src = manifest_map.get(mid, {}).get("source_audio_path")
        if src is None:
            leftovers.append(row)
            continue
        if src in seen_sources:
            leftovers.append(row)
            continue
        chosen.append(row)
        seen_sources.add(src)
        if len(chosen) == n:
            return chosen
    for row in leftovers:
        if len(chosen) == n:
            break
        chosen.append(row)
    return chosen[:n]


def read_audio_mono(path: Path) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(str(path), always_2d=True, dtype="float32")
    mono = audio.mean(axis=1)
    return mono, int(sr)


def stft_mag(signal: np.ndarray, n_fft: int = 1024, hop: int = 256) -> np.ndarray:
    if signal.ndim != 1:
        signal = signal.reshape(-1)
    if len(signal) < n_fft:
        signal = np.pad(signal, (0, n_fft - len(signal)))
    window = np.hanning(n_fft).astype(np.float32)
    n_frames = 1 + max(0, (len(signal) - n_fft) // hop)
    if n_frames <= 0:
        n_frames = 1
        signal = np.pad(signal, (0, n_fft - len(signal)))
    frames = []
    for i in range(n_frames):
        start = i * hop
        frame = signal[start : start + n_fft]
        if len(frame) < n_fft:
            frame = np.pad(frame, (0, n_fft - len(frame)))
        frames.append(np.abs(np.fft.rfft(frame * window)))
    return np.log1p(np.stack(frames, axis=1))


def save_spectrogram(src_audio: Path, dst_png: Path):
    x, _sr = read_audio_mono(src_audio)
    spec = stft_mag(x, n_fft=1024, hop=256)
    fig = plt.figure(figsize=(6.2, 1.35), dpi=150)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.imshow(spec, origin="lower", aspect="auto", cmap="magma")
    ax.axis("off")
    dst_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(dst_png, bbox_inches="tight", pad_inches=0)
    plt.close(fig)


def parse_gt_class(path: Path) -> Optional[str]:
    parts = path.stem.split("_")
    if len(parts) < 5:
        return None
    label = parts[1]
    if label in TARGET_CLASSES:
        return label
    if label in {"rim", "clap"}:
        return "snare"
    return None


def parse_dcomposer_class(path: Path) -> Optional[str]:
    stem = path.stem
    if "__coarse" not in stem:
        return None
    tail = stem.split("__coarse", 1)[1]
    parts = tail.split("_", 1)
    if len(parts) != 2:
        return None
    label = parts[1]
    if label == "hihat":
        return "hat"
    return label if label in TARGET_CLASSES else None


def gt_oneshot_map(mixture_id: str) -> Dict[str, List[Path]]:
    root = EVAL_INPUTS / "synthetic" / "oneshot" / mixture_id
    out = defaultdict(list)
    if not root.is_dir():
        return out
    for p in sorted(root.glob("*.wav")):
        cls = parse_gt_class(p)
        if cls is not None:
            out[cls].append(p)
    return out


def dcomposer_pred_oneshot_map(mixture_id: str) -> Dict[str, List[Path]]:
    root = D_COMPOSER_AUDIO_ROOT / "oneshots" / "synthetic" / "audio" / mixture_id
    out = defaultdict(list)
    if not root.is_dir():
        return out
    for p in sorted(root.glob("*.wav")):
        cls = parse_dcomposer_class(p)
        if cls is not None:
            out[cls].append(p)
    return out


def class_bucket_pred_path(method: str, mixture_id: str, cls: str) -> Optional[Path]:
    if method == IDM_METHOD:
        subs = IDM_CLASS_BUCKET_DIRS.get(cls, [])
        for sub in subs:
            p = IDM_ROOT / "oneshot" / "synthetic" / sub / f"{mixture_id}.wav"
            if p.is_file():
                return p
        return None
    lookup = {"hat": "hihat"}
    sub = lookup.get(cls, cls)
    p = DOSE_ROOT / "oneshot" / "synthetic" / sub / f"{mixture_id}.wav"
    return p if p.is_file() else None


def idm_exact_oneshot_path(dataset: str, mixture_id: str, row_label: str) -> Optional[Path]:
    roots = IDM_ONE_SHOT_DIRS.get(row_label, [])
    for sub in roots:
        p = IDM_ROOT / "oneshot" / dataset / sub / f"{mixture_id}.wav"
        if p.is_file():
            return p
    return None


def normalize_events(events: List[Dict], *, coarse_only: bool = False) -> List[Dict]:
    out = []
    for ev in events:
        if coarse_only:
            note = ev.get("coarse_note")
            if note is not None:
                note = int(note)
            coarse_label = COARSE_MIDI_NOTE_TO_COARSE_LABEL.get(note) or ev.get("coarse_label") or ev.get("fine_label") or "event"
            fine_label = coarse_label
        else:
            fine_label = ev.get("fine_label") or ev.get("coarse_label") or "event"
            coarse_label = ev.get("coarse_label") or fine_label
            note = ev.get("fine_note")
            if note is None:
                note = ev.get("coarse_note")
        if note is None:
            note = REP_NOTES.get(fine_label, REP_NOTES.get(coarse_label, 60))
        out.append(
            {
                "event_idx": int(ev["event_idx"]),
                "onset_sec": float(ev["onset_sec"]),
                "coarse_label": coarse_label,
                "fine_label": fine_label,
                "row_label": str(fine_label).replace("_", " "),
                "row_note": int(note),
            }
        )
    out.sort(key=lambda x: (x["onset_sec"], -x["row_note"]))
    return out


def load_idm_transcript(path: Path) -> Dict:
    data = load_json(path)
    events = []
    idx = 0
    if data.get("9class"):
        mapping = IDM_9CLASS_MAP
        bucket = data.get("9class", {})
    else:
        mapping = IDM_5CLASS_MAP
        bucket = data.get("5class", {})
    for key, (note, coarse_label, row_label) in mapping.items():
        for onset in bucket.get(key, []):
            events.append(
                {
                    "event_idx": idx,
                    "onset_sec": float(onset),
                    "coarse_label": coarse_label,
                    "fine_label": row_label,
                    "row_label": row_label,
                    "row_note": note,
                }
            )
            idx += 1
    events.sort(key=lambda x: (x["onset_sec"], -x["row_note"]))
    return {"events": events}


def choose_roundtrip_examples(seed: int = 61, n_per_dataset: int = 6) -> List[Dict]:
    rows = load_csv(D_COMPOSER_TRANSCRIPT_ROOT / "dcomposer_eval_metrics_roundtrip.csv")
    by_dataset = defaultdict(list)
    for row in rows:
        by_dataset[row["dataset"]].append(row)
    examples = []
    for ds in ROUNDTRIP_DATASETS:
        chosen = choose_midband_rows(by_dataset[ds], "stft_loss", n_per_dataset, seed + hash(ds) % 10000)
        for row in chosen:
            examples.append({"dataset": ds, "mixture_id": Path(row["mixture_relpath"]).stem, "row": row})
    return examples


def choose_decomposition_examples(seed: int = 73, n_per_dataset: int = 6) -> List[Dict]:
    rows = load_csv(D_COMPOSER_TRANSCRIPT_ROOT / "dcomposer_eval_metrics_roundtrip.csv")
    by_dataset = defaultdict(list)
    for row in rows:
        by_dataset[row["dataset"]].append(row)
    out = []
    for ds in ROUNDTRIP_DATASETS:
        chosen = choose_dataset_examples(
            by_dataset[ds],
            dataset=ds,
            key="stft_loss",
            n=n_per_dataset,
            seed=seed + hash(ds) % 10000,
        )
        if ds == "musdb" and len(chosen) >= 6:
            chosen.insert(2, chosen.pop(5))
        for row in chosen:
            out.append({"dataset": ds, "mixture_id": Path(row["mixture_relpath"]).stem, "row": row})
    return out


def choose_codec_examples(seed: int = 21, n_examples: int = 10) -> List[str]:
    rows = [r for r in load_csv(CODEC_ROOT / "per_sample_metrics.csv") if r["codec"] == "autoencoder"]
    chosen = choose_midband_rows(rows, "stft_loss", n_examples, seed)
    return [f"{int(r['sample_idx']):05d}" for r in chosen]


def build_roundtrip_assets(site_audio: Path, site_images: Path, examples: List[Dict]) -> List[Dict]:
    out = []
    for ex in examples:
        ds = ex["dataset"]
        mid = ex["mixture_id"]
        inp = EVAL_INPUTS / ds / "audio" / f"{mid}.wav"
        dcmp = D_COMPOSER_AUDIO_ROOT / "roundtrip" / ds / "audio" / f"{mid}.wav"
        idm = IDM_ROOT / "roundtrip" / ds / f"{mid}.wav"
        base_audio = site_audio / "roundtrip" / ds
        base_img = site_images / "roundtrip" / ds
        copied = {}
        for label, src in [("input", inp), ("dcomposer", dcmp)] + ([("idm", idm)] if idm.is_file() else []):
            dst_audio = base_audio / f"{mid}_{label}.wav"
            dst_img = base_img / f"{mid}_{label}.png"
            copy_audio(src, dst_audio)
            save_spectrogram(dst_audio, dst_img)
            copied[label] = {
                "audio": str(dst_audio.relative_to(ROOT)).replace(os.sep, "/"),
                "image": str(dst_img.relative_to(ROOT)).replace(os.sep, "/"),
            }
        metrics = {}
        if "dcomposer" in copied:
            metrics["dcomposer_stft_loss"] = compute_msl_from_paths(
                base_audio / f"{mid}_input.wav",
                base_audio / f"{mid}_dcomposer.wav",
            )
        if "idm" in copied:
            metrics["idm_stft_loss"] = compute_msl_from_paths(
                base_audio / f"{mid}_input.wav",
                base_audio / f"{mid}_idm.wav",
            )
        out.append(
            {
                "dataset": ds,
                "mixture_id": mid,
                "metrics": metrics,
                **copied,
            }
        )
    return out


def build_media_entry(src: Path, audio_dst: Path, image_dst: Path, *, force_mono: bool = False) -> Dict:
    copy_audio(src, audio_dst, force_mono=force_mono)
    save_spectrogram(audio_dst, image_dst)
    return {
        "audio": str(audio_dst.relative_to(ROOT)).replace(os.sep, "/"),
        "image": str(image_dst.relative_to(ROOT)).replace(os.sep, "/"),
    }


def copy_decomposition_oneshots(dataset: str, mixture_id: str, site_audio: Path, site_images: Path) -> Dict:
    if dataset != "synthetic":
        return {}
    gt_map = gt_oneshot_map(mixture_id)
    dcmp_map = dcomposer_pred_oneshot_map(mixture_id)
    rng = random.Random(int(mixture_id))
    reps = {}
    for cls in TARGET_CLASSES:
        entry = {"gt": None, "dcomposer": None, "idm": None, "dose": None}
        gt_audio_path = None
        if cls in gt_map:
            gt_path = rng.choice(gt_map[cls])
            gt_dst = site_audio / "oneshots" / dataset / mixture_id / "gt" / gt_path.name
            gt_img = site_images / "oneshots" / dataset / mixture_id / "gt" / f"{gt_path.stem}.png"
            entry["gt"] = build_media_entry(gt_path, gt_dst, gt_img)
            gt_audio_path = gt_dst
        if cls in dcmp_map and dcmp_map[cls]:
            dcmp_path = rng.choice(dcmp_map[cls])
            dcmp_dst = site_audio / "oneshots" / dataset / mixture_id / "dcomposer" / dcmp_path.name
            dcmp_img = site_images / "oneshots" / dataset / mixture_id / "dcomposer" / f"{dcmp_path.stem}.png"
            entry["dcomposer"] = build_media_entry(dcmp_path, dcmp_dst, dcmp_img)
            if gt_audio_path is not None:
                entry["dcomposer"]["stft_loss"] = compute_msl_from_paths(gt_audio_path, dcmp_dst)
        for method, key in [(IDM_METHOD, "idm"), (DOSE_METHOD, "dose")]:
            pred = class_bucket_pred_path(method, mixture_id, cls)
            if pred is not None:
                dst = site_audio / "oneshots" / dataset / mixture_id / key / f"{cls}.wav"
                img = site_images / "oneshots" / dataset / mixture_id / key / f"{cls}.png"
                entry[key] = build_media_entry(pred, dst, img)
                if gt_audio_path is not None:
                    entry[key]["stft_loss"] = compute_msl_from_paths(gt_audio_path, dst)
        reps[cls] = entry
    return reps


def build_decomposition_assets(site_audio: Path, site_images: Path, examples: List[Dict]) -> List[Dict]:
    out = []
    for ex in examples:
        dataset = ex["dataset"]
        mixture_id = ex["mixture_id"]
        input_src = EVAL_INPUTS / dataset / "audio" / f"{mixture_id}.wav"
        input_dst = site_audio / "decomposition" / f"{dataset}_{mixture_id}_input.wav"
        dcmp_roundtrip = D_COMPOSER_AUDIO_ROOT / "roundtrip" / dataset / "audio" / f"{mixture_id}.wav"
        dcmp_dst = site_audio / "decomposition" / f"{dataset}_{mixture_id}_dcomposer.wav"
        idm_roundtrip = IDM_ROOT / "roundtrip" / dataset / f"{mixture_id}.wav"
        idm_dst = site_audio / "decomposition" / f"{dataset}_{mixture_id}_idm.wav"
        copy_audio(input_src, input_dst)
        copy_audio(dcmp_roundtrip, dcmp_dst)
        if idm_roundtrip.is_file():
            copy_audio(idm_roundtrip, idm_dst)

        def attach_paths(events: List[Dict], role: str) -> List[Dict]:
            enriched = []
            for ev in events:
                item = dict(ev)
                item["audio"] = None
                cls = ev.get("coarse_label")
                if role == "dcomposer":
                    base = D_COMPOSER_AUDIO_ROOT / "oneshots" / dataset / "audio" / mixture_id
                    matches = list(base.glob(f"{int(ev['event_idx']):04d}_*.wav"))
                    if not matches:
                        return []
                    dst = site_audio / "decomposition" / dataset / mixture_id / "dcomposer_events" / matches[0].name
                    copy_audio(matches[0], dst)
                    item["audio"] = str(dst.relative_to(ROOT)).replace(os.sep, "/")
                elif role == "idm":
                    pred = idm_exact_oneshot_path(dataset, mixture_id, ev["row_label"])
                    if pred is None:
                        return []
                    safe_label = ev["row_label"].replace(" ", "_")
                    dst = site_audio / "decomposition" / dataset / mixture_id / "idm_events" / f"{safe_label}.wav"
                    if not dst.exists():
                        copy_audio(pred, dst)
                    item["audio"] = str(dst.relative_to(ROOT)).replace(os.sep, "/")
                enriched.append(item)
            return enriched

        lanes = []
        dcmp_path = D_COMPOSER_TRANSCRIPT_ROOT / "transcripts" / dataset / "audio" / f"{mixture_id}.json"
        idm_pred = IDM_ROOT / "transcription" / dataset / f"{mixture_id}.json"
        if not dcmp_path.is_file() or not idm_pred.is_file() or not idm_roundtrip.is_file():
            continue

        dcmp = load_json(dcmp_path)
        dcmp_events = attach_paths(normalize_events(dcmp.get("events", []), coarse_only=True), "dcomposer")
        if not dcmp_events:
            continue
        lanes.append({"name": "D-Composer", "role": "dcomposer", "audio": str(dcmp_dst.relative_to(ROOT)).replace(os.sep, "/"), "events": dcmp_events})

        idm_events = attach_paths(load_idm_transcript(idm_pred).get("events", []), "idm")
        if not idm_events:
            continue
        lanes.append({"name": "IDM", "role": "idm", "audio": str(idm_dst.relative_to(ROOT)).replace(os.sep, "/"), "events": idm_events})

        reps = copy_decomposition_oneshots(dataset, mixture_id, site_audio, site_images)
        out.append(
            {
                "dataset": dataset,
                "mixture_id": mixture_id,
                "input_audio": str(input_dst.relative_to(ROOT)).replace(os.sep, "/"),
                "present_classes": [cls for cls in TARGET_CLASSES if cls in reps],
                "oneshot_representatives": reps,
                "lanes": lanes,
            }
        )
    return out


def build_codec_assets(site_audio: Path, site_images: Path, sample_ids: List[str]) -> Dict:
    methods = ["input", "dac", "codicodec", "melodyflow", "autoencoder"]
    per_sample = load_csv(CODEC_ROOT / "per_sample_metrics.csv")
    per_sample_dac = load_csv(CODEC_ROOT / "per_sample_metrics_dac.csv")
    metric_map = defaultdict(dict)
    for row in per_sample:
        metric_map[f"{int(row['sample_idx']):05d}"][row["codec"]] = float(row["stft_loss"])
    for row in per_sample_dac:
        metric_map[f"{int(row['sample_idx']):05d}"]["dac"] = float(row["stft_loss"])
    examples = []
    for sid in sample_ids:
        ex = {"sample_id": sid}
        for method in methods:
            if method == "input":
                src = CODEC_ROOT / "inputs" / f"{sid}.wav"
            elif method == "dac":
                src = CODEC_ROOT / "reconstructions" / "dac" / f"{sid}.wav"
            else:
                src = CODEC_ROOT / "reconstructions" / method / f"{sid}.wav"
            dst_audio = site_audio / "codec" / f"{sid}_{method}.wav"
            dst_img = site_images / "codec" / f"{sid}_{method}.png"
            copy_audio(src, dst_audio, force_mono=(method == "dac"))
            save_spectrogram(dst_audio, dst_img)
            ex[method] = {
                "audio": str(dst_audio.relative_to(ROOT)).replace(os.sep, "/"),
                "image": str(dst_img.relative_to(ROOT)).replace(os.sep, "/"),
                "stft_loss": metric_map.get(sid, {}).get(method),
            }
        examples.append(ex)

    codec_summary = load_json(CODEC_ROOT / "summary.json")["summary"]
    dac_summary = load_json(CODEC_ROOT / "summary_dac.json")["summary"]
    summary = {
        "codicodec": codec_summary["codicodec"],
        "melodyflow": codec_summary["melodyflow"],
        "autoencoder": codec_summary["autoencoder"],
        "dac": dac_summary["dac"],
    }
    return {"examples": examples, "summary": summary}


def write_manifest(path: Path, payload: Dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


def main():
    os.environ["MPLCONFIGDIR"] = MPLCONFIGDIR
    assets_dir = ROOT / "assets"
    site_audio = assets_dir / "audio"
    site_images = assets_dir / "images"
    site_data = assets_dir / "data"
    ensure_clean_dir(site_audio)
    ensure_clean_dir(site_images)
    site_data.mkdir(parents=True, exist_ok=True)

    roundtrip_examples = build_roundtrip_assets(site_audio, site_images, choose_roundtrip_examples())
    decomposition_examples = build_decomposition_assets(site_audio, site_images, choose_decomposition_examples())
    codec_payload = build_codec_assets(site_audio, site_images, choose_codec_examples())

    payload = {
        "meta": {
            "title": "D-Composer Supplementary Webpage",
            "note": "Initial supplementary site built from a small sampled subset of synchronized assets.",
            "idm_transcripts_available": True,
            "codec_note": "DAC benchmark artifacts are shown exactly as saved by the upstream benchmark. The current DAC wrapper appears to reconstruct stereo outputs from stereo inputs by processing channels separately through a mono codec.",
        },
        "roundtrip_examples": roundtrip_examples,
        "decomposition_examples": decomposition_examples,
        "codec_examples": codec_payload["examples"],
        "codec_summary": codec_payload["summary"],
    }
    write_manifest(site_data / "site_data.json", payload)
    print(f"Wrote site assets to {ROOT}")


if __name__ == "__main__":
    main()
