#!/usr/bin/env python3
"""
Train the on-device cognitive-state classifier and export to ONNX.

Architecture
------------
Inputs (19-dim, float32):
    [ 0]  overallDb
    [ 1- 7]  bandEnergies (7 bands, 0–1)
    [ 8]  spectralCentroid (Hz, normalised by 20kHz)
    [ 9]  spectralRolloff   (Hz, normalised by 20kHz)
    [10]  zeroCrossingRate  (0–1)
    [11]  dominantFrequency (Hz, normalised by 20kHz)
    [12]  soundClassTop1OneHot (length 7) — collapsed by argmax-as-int below
                                            (we encode ordinal id /6 here)

    Behavioural (Agent B) — zeros if window.__residueBehavior is undefined:
    [13] typingSpeed (WPM / 100)
    [14] errorRate   (0–1)
    [15] focusSwitchRate / 30
    [16] mouseJitter / 50
    [17] scrollVelocity / 1000
    [18] idleRatio   (0–1)

Outputs (5-dim, float32):
    [0..3] logits over {focused, scattered, anxious, drowsy} — softmax in TS
    [4]    raw match-to-goal score — sigmoid in TS

We synthesise per-class data with class-conditioned Gaussians, train for a few
hundred epochs of cross-entropy + MSE on a held-out validation set, then
export the weights to ONNX with a fixed batch dimension of 1 (the runtime
reshape is cheap).
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "public" / "models" / "state-classifier.onnx"

INPUT_DIM = 19
HIDDEN1 = 32
HIDDEN2 = 16
NUM_CLASSES = 4
OUTPUT_DIM = NUM_CLASSES + 1  # 4 logits + 1 match score

CLASS_NAMES = ["focused", "scattered", "anxious", "drowsy"]


class StateClassifier(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.fc1 = nn.Linear(INPUT_DIM, HIDDEN1)
        self.fc2 = nn.Linear(HIDDEN1, HIDDEN2)
        self.head = nn.Linear(HIDDEN2, OUTPUT_DIM)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = F.relu(self.fc1(x))
        h = F.relu(self.fc2(h))
        return self.head(h)


def synth_dataset(n_per_class: int = 4000, seed: int = 42) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Generate synthetic feature/label/match-score triples.

    Class priors (loose, plausible):
        focused   : moderate dB (45–60), bands biased to mid/upper, low ZCR, fast typing, low errors
        scattered : variable dB, high focusSwitchRate, mid errors
        anxious   : higher dB, high ZCR, high mouseJitter, high errors
        drowsy    : low dB, high low-band energy, low typing speed, high idleRatio
    """
    rng = np.random.default_rng(seed)
    X_chunks, y_chunks, m_chunks = [], [], []

    def sample(mean: np.ndarray, scale: np.ndarray, n: int) -> np.ndarray:
        return rng.normal(loc=mean, scale=scale, size=(n, INPUT_DIM)).astype(np.float32)

    presets = [
        # focused
        dict(
            mean=np.array([
                0.55,  # dB / 100
                0.05, 0.10, 0.10, 0.30, 0.25, 0.10, 0.05,  # bands
                0.20, 0.30, 0.05, 0.10, 0.30,  # centroid, rolloff, zcr, dom, sound-class
                0.55, 0.05, 0.05, 0.05, 0.10, 0.10,  # behavioural
            ]),
            scale=np.full(INPUT_DIM, 0.05),
            match=0.92,
        ),
        # scattered
        dict(
            mean=np.array([
                0.50,
                0.05, 0.10, 0.20, 0.30, 0.15, 0.10, 0.05,
                0.30, 0.45, 0.15, 0.20, 0.40,
                0.30, 0.25, 0.50, 0.30, 0.50, 0.30,
            ]),
            scale=np.full(INPUT_DIM, 0.08),
            match=0.45,
        ),
        # anxious
        dict(
            mean=np.array([
                0.70,
                0.10, 0.15, 0.20, 0.25, 0.20, 0.15, 0.10,
                0.45, 0.55, 0.35, 0.30, 0.50,
                0.40, 0.35, 0.40, 0.55, 0.40, 0.20,
            ]),
            scale=np.full(INPUT_DIM, 0.07),
            match=0.20,
        ),
        # drowsy
        dict(
            mean=np.array([
                0.30,
                0.30, 0.30, 0.10, 0.10, 0.05, 0.05, 0.05,
                0.10, 0.15, 0.02, 0.05, 0.20,
                0.15, 0.05, 0.05, 0.10, 0.10, 0.70,
            ]),
            scale=np.full(INPUT_DIM, 0.06),
            match=0.30,
        ),
    ]

    for cls, p in enumerate(presets):
        x = sample(p["mean"], p["scale"], n_per_class)
        x = np.clip(x, 0.0, 1.0)
        y = np.full(n_per_class, cls, dtype=np.int64)
        m = np.clip(rng.normal(loc=p["match"], scale=0.08, size=(n_per_class,)), 0.0, 1.0).astype(np.float32)
        X_chunks.append(x)
        y_chunks.append(y)
        m_chunks.append(m)

    X = np.concatenate(X_chunks, axis=0)
    y = np.concatenate(y_chunks, axis=0)
    m = np.concatenate(m_chunks, axis=0)
    perm = rng.permutation(len(X))
    return X[perm], y[perm], m[perm]


def main() -> None:
    torch.manual_seed(0)

    X, y, m = synth_dataset()
    n_val = max(1, int(len(X) * 0.1))
    X_tr, X_val = X[:-n_val], X[-n_val:]
    y_tr, y_val = y[:-n_val], y[-n_val:]
    m_tr, m_val = m[:-n_val], m[-n_val:]

    device = torch.device("cpu")
    model = StateClassifier().to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=2e-3)

    train_ds = TensorDataset(torch.from_numpy(X_tr), torch.from_numpy(y_tr), torch.from_numpy(m_tr))
    train_loader = DataLoader(train_ds, batch_size=256, shuffle=True)

    EPOCHS = 30
    for epoch in range(EPOCHS):
        model.train()
        for xb, yb, mb in train_loader:
            xb = xb.to(device)
            yb = yb.to(device)
            mb = mb.to(device)
            out = model(xb)
            logits = out[:, :NUM_CLASSES]
            score = out[:, NUM_CLASSES]
            loss_cls = F.cross_entropy(logits, yb)
            loss_reg = F.mse_loss(score, mb)
            loss = loss_cls + 0.5 * loss_reg
            optimiser.zero_grad()
            loss.backward()
            optimiser.step()

        # quick validation
        model.eval()
        with torch.no_grad():
            out = model(torch.from_numpy(X_val).to(device))
            logits = out[:, :NUM_CLASSES]
            preds = logits.argmax(dim=1).cpu().numpy()
            acc = (preds == y_val).mean()
        if epoch == 0 or (epoch + 1) % 5 == 0 or epoch == EPOCHS - 1:
            print(f"epoch {epoch + 1:02d}/{EPOCHS} val-acc={acc:.3f}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, INPUT_DIM, dtype=torch.float32)
    # Use the legacy TorchScript-based exporter so weights are inlined into the
    # single .onnx file (the new dynamo exporter writes external `.onnx.data`,
    # which ORT-Web can load but adds a second asset for us to ship).
    torch.onnx.export(
        model,
        (dummy,),
        str(OUTPUT_PATH),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    # Clean up any stray external-data file from earlier runs.
    sidecar = OUTPUT_PATH.with_suffix(".onnx.data")
    if sidecar.exists():
        sidecar.unlink()
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
