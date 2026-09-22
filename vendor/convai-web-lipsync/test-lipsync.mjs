import assert from "node:assert/strict";
import fs from "node:fs";
import { ConvaiMhaLipsync } from "./convai-mha-lipsync.js";

const setup = JSON.parse(fs.readFileSync(new URL("./Lipsynic-setup.json", import.meta.url)));
const order = JSON.parse(fs.readFileSync(new URL("./metahuman-order-251.json", import.meta.url)));
const unityMap = JSON.parse(fs.readFileSync(new URL("./unity-metahuman-map-4.4.1.json", import.meta.url)));
assert.equal(order.channels.length, 251);
assert.equal(new Set(order.channels).size, 251);
assert.equal(unityMap.mappings.length, 251);

const dictionary = Object.fromEntries(order.channels.map((name, index) => [name, index]));
const mesh = { morphTargetDictionary: dictionary, morphTargetInfluences: new Array(251).fill(0), frustumCulled: true };
const scene = { traverse(callback) { callback(mesh); } };
const lipsync = new ConvaiMhaLipsync({ scene, channelOrder: order.channels, setup, unityMap });
assert.equal(lipsync.diagnostics.coverage, 1);
assert.equal(mesh.frustumCulled, false);

const jaw = order.channels.indexOf("CTRL_expressions_jawOpen");
const frame = new Array(251).fill(0);
frame[jaw] = 1;
lipsync.setTargetFrame(frame);
for (let index = 0; index < 60; index += 1) {
  lipsync.beginFrame();
  lipsync.update(1 / 60, true);
  assert.ok(mesh.morphTargetInfluences[jaw] <= 0.35, "jaw clamp must hold during fade and smoothing");
}
const settled = mesh.morphTargetInfluences[jaw];
lipsync.beginFrame();
lipsync.update(1 / 60, true);
assert.ok(Math.abs(mesh.morphTargetInfluences[jaw] - settled) < 1e-5, "add mode must not accumulate after settling");
lipsync.reset();
assert.equal(mesh.morphTargetInfluences[jaw], 0);
console.log("Convai Web LipSync Kit: all tests passed.");
