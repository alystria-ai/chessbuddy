import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(root, '..', 'docs', 'convai_web-sdk_documentation.md');

const PAGES = [
  ['Web SDK Overview', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk.md'],
  ['ConvaiClient Core API', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/convaiclient-core-api.md'],
  ['Events & Message Handling', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/events-and-message-handling.md'],
  ['Real-time Lipsync', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/real-time-lipsync.md'],
  ['Building a Custom UI', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/building-a-custom-ui-typescript.md'],
  ['Best Practices & Type Definitions', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/best-practices-and-type-definitions.md'],
  ['Mappings Reference', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/mappings-reference.md'],
  ['Actions', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/actions.md'],
  ['Emotions', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/emotions.md'],
  ['Dynamic Context', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/dynamic-context.md'],
  ['Long Term Memory', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/long-term-memory.md'],
  ['Auth Tokens', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/auth-tokens.md'],
  ['WebSocket Transport', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/websocket-transport-layer.md'],
  ['Event Reference', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/event-reference.md'],
  ['GLB/FBX Animations', 'https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/glb-fbx-animations-for-convai.md'],
];

const CLASSIC_CHESS_HEADER = `# Convai Web SDK — implementation reference

> **SDK version in this repo:** \`@convai/web-sdk@1.6.0-beta.1\`
>
> **Classic Chess integration:** wired through \`src/convaiManager.ts\` (per-coach connection pool, dynamic context, vision, lipsync). See also [technical-blog.md](technical-blog.md) and the README **Portrait & Lipsync** section.

## Classic Chess integration summary

### Connection pool (\`convaiManager.ts\`)

- One \`ConvaiClient\` per coach persona; only the active coach stays connected.
- Connect config enables **Vision Dynamic Context**, lipsync (ARKit), and emotions.
- \`AudioRenderer\` attaches bot audio to the LiveKit room.

\`\`\`typescript
const client = new ConvaiClient({
  apiKey,
  characterId,
  endUserId,
  enableVideo: true,
  enableLipsync: true,
  enableEmotion: true,
  blendshapeConfig: { format: 'arkit' },
  visionInputConfig: {
    enabled: true,
    sampleIntervalSecs: 1,
    bufferFrames: 5,
    replacePreviousVisionContext: true,
  },
  respondModes: { vision: 'silent' },
  keepInContext: true,
});
\`\`\`

### Text dynamic context (\`chessAi.ts\` → \`pushDynamicContext\`)

- **Static policy** — coaching instructions seeded once via \`seedStaticCoachPolicy\` (\`run_llm: 'false'\`).
- **Per-turn board state** — \`buildDynamicCoachInfo()\` formats FEN, move history, tactics, Stockfish plan.
- Sent with \`client.updateContext({ text, mode: 'replace', run_llm })\` where \`run_llm\` is \`'auto'\` (coach decides), \`'true'\` (forced speech), or \`'false'\` (silent refresh).
- Before each text push, \`refreshBoardVision()\` redraws the offscreen chess canvas.

### Vision Dynamic Context (\`boardVision.ts\`)

- Offscreen canvas renders the board from FEN or DOM snapshot.
- Published via \`client.videoControls.publishCanvas(canvas, { source: 'canvas', name: 'chess-board', fps: 1 })\`.
- Vision frames flow silently (\`respondModes.vision: 'silent'\`) alongside text context.
- **Dashboard:** enable vision on each Convai character.

### Lipsync (\`ReallusionCharacter.tsx\`)

- Time-based playback: \`blendshapeQueue.getFrameAtTime(elapsedSeconds)\` synced via \`speakingChange\`.
- ARKit → CC4 morph mapping with mouth-only vs non-mouth attenuation (0.6 for non-mouth).
- Reference implementation cloned to \`misc/convai-lipsync-reference/\` from Convai neurosync example.

### Mobile portrait rendering

- \`isMobilePortrait()\` enables material downgrade (Physical → Standard), zero env-map on skin, and skips HDR \`Environment\` on coarse-pointer devices (fixes black-face GLES issues on some phones).

### Required dashboard settings

| Setting | Purpose |
|---------|---------|
| Vision enabled on character | Chess board canvas context |
| LTM enabled + \`endUserId\` | Signed-in memory (Google auth flow) |
| Guest clone IDs (\`VITE_CONVAI_GUEST_CHARACTER_*\`) | Anonymous play without LTM writes |

---

## Official Convai Web SDK documentation

The sections below are synced from [docs.convai.com](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk). Source URLs are listed per section.

`;

async function fetchPage(url) {
  const res = await fetch(url, { headers: { Accept: 'text/markdown' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

const sections = [];
for (const [title, url] of PAGES) {
  try {
    const body = await fetchPage(url);
    sections.push(`\n---\n\n## ${title}\n\n> Source: ${url.replace('.md', '')}\n\n${body.trim()}\n`);
    console.log('OK', title);
  } catch (err) {
    sections.push(`\n---\n\n## ${title}\n\n> Source: ${url}\n\n_Fetch failed: ${err.message}_\n`);
    console.warn('FAIL', title, err.message);
  }
}

const output = CLASSIC_CHESS_HEADER + sections.join('');
fs.writeFileSync(outFile, output, 'utf8');
console.log('Wrote', outFile, `(${output.length} chars)`);
