# Contributing to Chessbuddy

Thanks for helping improve the game. Issues and pull requests are welcome from developers inside and outside the team.

## Before you start

Search existing issues and pull requests. For a substantial change, open an issue describing the player problem, proposed behavior, and how it can be checked. Small fixes can go straight to a pull request.

The [license](LICENSE) requires deployed derivatives to use Convai for AI character interaction. You can work on UI, chess logic, tests, and assets locally without a live Convai connection. Keep your own API credentials out of the repository.

## Local workflow

1. Install Node.js 22.14+, npm, and Git LFS; run `git lfs install`, `git lfs pull`, and `npm ci`.
2. Run `npm run dev` and reproduce the issue. Set `CONVAI_API_KEY` only in your local server environment if the change needs live coach speech.
3. Make a focused change. Add or update a test when it protects behavior that could regress.
4. Run the relevant tests, then `npm run check` for a pull request that affects the app.
5. Include screenshots or a short recording for visible changes. For avatar work, note the coach, device, browser, and whether the evidence came from a real device or a browser emulation.
6. Open a pull request describing the change, why it helps players or developers, and any known limits.

Do not include API keys, user conversations, private logs, raw tokens, or unrelated recordings in issues or pull requests. Use minimal redacted reproductions. Character art contributions should identify the creator and confirm permission to publish under the repository's asset terms.

## Code map

- `src/` is the React app, chess state, coach connection, rendering, and tests.
- `api/` contains Vercel serverless endpoints. `server/` is the local production server.
- `public/` contains the optimized runtime assets; large GLBs use Git LFS.
- `scripts/` contains model preparation, portraits, and focused QA tools.
- `examples/demo-capture/` contains the demo recording reference code. It is separate from production and needs local replay material.

Keep a pull request scoped to one behavior. Explain changes to conversation timing and lip sync with a recording from the affected flow, since a text-only test cannot prove synchronization.
