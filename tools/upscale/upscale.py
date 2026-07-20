#!/usr/bin/env python3
"""サクヤ種目動画のローカル無料アップスケール。
Real-ESRGAN (anime 6B, 4x) を PyTorch+MPS で各フレームに適用し、
目標2倍(1280x1280)へ area 縮小してから H264 で再エンコードする。

使い方:
  python3 upscale.py <input.mp4> <output.mp4> [--scale 2]
"""
import argparse
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np
import torch
from spandrel import ModelLoader

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
# 既定はアニメ動画向けの軽量ネット(SRVGGNetCompact)。6B(RRDB)は高品質だが桁違いに重い。
DEFAULT_MODEL = "realesr-animevideov3.pth"


def pick_device():
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model(device, model_file):
    model = ModelLoader().load_from_file(os.path.join(MODELS_DIR, model_file))
    model.to(device).eval()
    return model


@torch.inference_mode()
def upscale_frame(model, device, bgr):
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    t = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0).to(device)
    out = model(t)  # 4x
    out = out.clamp(0, 1).squeeze(0).permute(1, 2, 0).cpu().numpy()
    out = (out * 255.0 + 0.5).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)


def probe_fps(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=r_frame_rate", "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, check=True).stdout.strip()
    num, den = r.split("/")
    return num + "/" + den  # keep exact rational for ffmpeg


def process_one(model, device, inp, out, scale):
    src = cv2.VideoCapture(inp)
    W = int(src.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(src.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n = int(src.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = probe_fps(inp)
    tw, th = int(round(W * scale)), int(round(H * scale))
    print(f"[{os.path.basename(inp)}] {W}x{H} x{scale} -> {tw}x{th}  ({n} frames, {fps} fps, {device})", flush=True)

    tmp = tempfile.mkdtemp(prefix="upscale_")
    i = 0
    while True:
        ok, bgr = src.read()
        if not ok:
            break
        up = upscale_frame(model, device, bgr)  # 4x
        if (up.shape[1], up.shape[0]) != (tw, th):
            up = cv2.resize(up, (tw, th), interpolation=cv2.INTER_AREA)  # 4x -> target(2x), sharp downscale
        cv2.imwrite(os.path.join(tmp, f"{i:05d}.png"), up)
        i += 1
    src.release()
    print(f"  upscaled {i} frames", flush=True)

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y",
         "-framerate", fps, "-i", os.path.join(tmp, "%05d.png"),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19",
         "-movflags", "+faststart", out],
        check=True)

    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    sz = os.path.getsize(out) / 1024
    print(f"  wrote {out} ({sz:.0f} KB)", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp", help="input .mp4 file OR a directory of .mp4 files")
    ap.add_argument("out", help="output .mp4 file OR output directory (when inp is a dir)")
    ap.add_argument("--scale", type=float, default=2.0, help="final upscale factor vs source")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="model file under models/")
    args = ap.parse_args()

    device = pick_device()
    model = load_model(device, args.model)

    if os.path.isdir(args.inp):
        files = sorted(f for f in os.listdir(args.inp) if f.lower().endswith(".mp4"))
        print(f"batch: {len(files)} videos  ({args.model}, {device})", flush=True)
        for idx, f in enumerate(files, 1):
            print(f"--- {idx}/{len(files)} ---", flush=True)
            process_one(model, device, os.path.join(args.inp, f), os.path.join(args.out, f), args.scale)
    else:
        process_one(model, device, args.inp, args.out, args.scale)


if __name__ == "__main__":
    main()
