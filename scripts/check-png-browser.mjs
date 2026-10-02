// Run against a Chromium tab with --remote-debugging-port=9231. No test dependency.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cdp = process.argv[2] ?? "http://127.0.0.1:9231";
const url = process.argv[3] ?? "http://127.0.0.1:4173/";
const pages = await fetch(`${cdp}/json/list`).then((response) => response.json());
const page = pages.find((target) => target.type === "page");
assert(page, "Open a Chromium tab before starting this check.");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let serial = 0;
const requests = new Map();
ws.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  const request = requests.get(message.id);
  if (!request) return;
  requests.delete(message.id);
  clearTimeout(request.timer);
  message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
});
function call(method, params = {}, timeout = 90_000) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(new Error(`Chromium timed out: ${method}`));
    }, timeout);
    requests.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Browser did not become ready: ${expression}`);
}
function pngInfo(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let ppm;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "pHYs") {
      assert.equal(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
      assert.equal(bytes[offset + 16], 1);
      ppm = bytes.readUInt32BE(offset + 8);
    }
    offset += length + 12;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), ppm };
}

try {
  await call("Page.navigate", { url }, 20_000);
  await waitFor("!!document.querySelector('.maplibregl-canvas')");
  await evaluate(`(() => {
    const node = document.querySelector('.map');
    let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber'))];
    while (fiber) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const ref = hook.memoizedState?.current;
        if (ref?.getStyle) window.__checkMap = ref;
        if (ref?.captureSelectedPng) window.__checkHandle = ref;
      }
      fiber = fiber.return;
    }
    return true;
  })()`);
  await waitFor("window.__checkMap?.loaded() && !window.__checkMap.isMoving()");
  await evaluate(`Array.from(document.querySelectorAll('.rail-item')).find(button => button.textContent.trim() === 'Labels').click()`);
  await waitFor("!!document.querySelector('#pin-json')");
  const document = {
    bounds: { west: 16.2, east: 16.43, south: 48, north: 48.45 },
    pins: [{ lat: 48.2082, lon: 16.3738, label: "PNG check" }],
  };
  await evaluate(`(() => {
    const field = document.querySelector('#pin-json');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(JSON.stringify(document))});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => field.closest('form').requestSubmit(), 50);
  })()`);
  await waitFor("document.querySelector('.pin-count')?.textContent.startsWith('1 ') && window.__checkMap.loaded() && !window.__checkMap.isMoving()");
  const camera = () => evaluate("JSON.stringify({ center: __checkMap.getCenter(), zoom: __checkMap.getZoom(), bearing: __checkMap.getBearing(), pitch: __checkMap.getPitch() })");
  const before = await camera();
  const directory = await mkdtemp(join(tmpdir(), "gsmap-png-check-"));
  const bounds = JSON.stringify(document.bounds);
  const one = await evaluate(`__checkHandle.getPngSize(${bounds}, 1)`);
  for (const options of [1, 2, 3, 4, { width: 2400, height: 1600 }, { width: 2480, height: 3508, dpi: 300 }, { width: 3508, height: 4961, dpi: 300 }]) {
    const encoded = await evaluate(`(async () => {
      const blob = await __checkHandle.captureSelectedPng(${bounds}, ${JSON.stringify(options)});
      return await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
      });
    })()`);
    const bytes = Buffer.from(encoded, "base64");
    const actual = pngInfo(bytes);
    const expected = typeof options === "number" ? { width: one.width * options, height: one.height * options } : options;
    assert.equal(actual.width, expected.width);
    assert.equal(actual.height, expected.height);
    if (expected.dpi) assert.equal(actual.ppm, 11811);
    assert.equal(await camera(), before, "PNG export moved the live camera");
    assert.equal(await evaluate("document.querySelectorAll('.maplibregl-map').length"), 1, "Export map leaked");
    await writeFile(join(directory, `${actual.width}x${actual.height}.png`), bytes);
    console.log(`${actual.width} × ${actual.height} px${actual.ppm === 11811 ? ', 300 DPI' : ''}: OK`);
  }
  console.log(`PNG files: ${directory}`);
} finally {
  for (const request of requests.values()) clearTimeout(request.timer);
  ws.close();
}
