// Drives server.mjs over stdio exactly as an MCP client would.
// Run: node test.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const waiting = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  const p = new Promise((resolve) => waiting.set(id, resolve));
  child.stdin.write(JSON.stringify(msg) + "\n");
  return p;
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1.0.0" },
});
assert.equal(init.result.protocolVersion, "2025-06-18");
assert.equal(init.result.serverInfo.name, "allunits");
console.log("initialize ok:", init.result.serverInfo);

notify("notifications/initialized");

const tools = await rpc("tools/list", {});
assert.equal(tools.result.tools.length, 3);
console.log("tools:", tools.result.tools.map((t) => t.name).join(", "));

const conv = await rpc("tools/call", { name: "convert_unit", arguments: { from: "km", to: "mi", value: 42.195 } });
const convOut = JSON.parse(conv.result.content[0].text);
assert.equal(convOut.output.value, 26.218757);
assert.equal(convOut.pair, "km-to-miles");
console.log("marathon:", convOut.output.value, convOut.output.unit);

const temp = await rpc("tools/call", { name: "convert_unit", arguments: { from: "°F", to: "°C", value: 451 } });
assert.equal(JSON.parse(temp.result.content[0].text).output.value, 232.7778);
console.log("451F:", JSON.parse(temp.result.content[0].text).output.value, "C");

const bad = await rpc("tools/call", { name: "convert_unit", arguments: { from: "km", to: "parsec", value: 1 } });
assert.equal(bad.result.isError, true);
assert.match(bad.result.content[0].text, /Known pairs from km/);
console.log("error path ok");

const listed = await rpc("tools/call", { name: "list_units", arguments: { category: "pressure" } });
assert.equal(JSON.parse(listed.result.content[0].text).count, 4);
console.log("list_units ok (pressure = 4)");

const factor = await rpc("tools/call", { name: "get_factor", arguments: { from: "bar", to: "psi" } });
assert.equal(JSON.parse(factor.result.content[0].text).factor, 14.503773773);
console.log("get_factor ok");

const unknown = await rpc("does/not/exist", {});
assert.equal(unknown.error.code, -32601);

child.stdin.end();
console.log("\nALL MCP CHECKS PASSED");
