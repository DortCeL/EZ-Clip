# Ez-clip roadmap

## Phase 1 — lossless cut & join
- **Epic 1 — Foundation:** Electron + electron-vite + React + TypeScript + Tailwind, bundled ffmpeg/ffprobe, `media://` protocol with Range support, typed preload API, JSON settings.
- **Epic 2 — Import & source player:** drag-drop / dialog import, ffprobe metadata, keyframe indexing, media bin, keyboard-driven source player, I/O marks snapped to keyframes.
- **Epic 3 — Timeline:** segment model, add whole clip, split, delete, drag-to-reorder, sequence playback across sources.
- **Epic 4 — Lossless export & settings:** stream-copy cut + concat, compatibility check, progress, date/time naming, output folder settings, reveal in Explorer.

## Phase 2 and later
- **Epic 5 — Compressed export:** NVENC presets (H.264 / HEVC / AV1 where supported), target-size mode, output size estimate, 3-second quality preview at the playhead with A/B comparison.
- **Epic 6 — Light editing:** fades, speed changes, per-track audio mute/volume (re-encode only affected segments).
- **Epic 7 — Speed & polish:** smart cut (re-encode only the GOP around cuts), hardware encoder detection, audio-spike "kill finder", NSIS installer.
