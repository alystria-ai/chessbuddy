# Demo capture reference

This folder preserves the local recording and editing code used to make the Chessbuddy feature walkthrough. It is a reference pipeline for contributors interested in browser capture, facial replay, dialogue timing, and scene assembly. It is not loaded by the production app.

The reusable parts are `browser-capture.js` (shared browser-clock markers), `capture.mjs` (headless browser and tab-audio recording), `app/src/demoReplay.ts` (local recorded-response adapter), and `edit/assemble-v15.py` (timeline, graphics and audio mix). The source-answer scripts show how a developer can collect a response and all 251 facial channels from their own Convai development account.

Generated coach recordings, conversations, keys, source media, and final exports are not included. The source scripts expect a local `replay-data/` directory and demo-only assets. To run the original workflow, create a separate demo workspace with a local app checkout, add the recording-only `demoReplay.ts` adapter to that checkout, and supply your own recordings. Use `FFMPEG` and `FFPROBE` environment variables if those executables are not on `PATH`.

Do not use the included sample chess questions to claim a response is live. The demo timeline plays recorded Convai speech and corresponding facial frames; it is for controlled feature presentation, not latency measurement.
