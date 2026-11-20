#!/usr/bin/env node
// AllUnits MCP server — Model Context Protocol over stdio.
//
// No dependencies, no network: every conversion is computed locally from the
// same factors the public site uses, so it works offline and cannot be rate
// limited. The paid HTTP API exists for bulk work and hard SLAs; this server
// is the free entry point that gets agents and developers to it.
//
// Run:            npx allunits-mcp           (after publishing)
// Local test:     node server.mjs            (speaks JSON-RPC on stdin)
// Register in an MCP client:
//   { "mcpServers": { "allunits": { "command": "node", "args": ["/abs/path/server.mjs"] } } }

import { PAIRS, META } from "./factors.js";
import { createInterface } from "node:readline";

const SERVER = { name: "allunits", version: "1.0.0" };
const KNOWN_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const LATEST_PROTOCOL = "2025-06-18";

// ---------------------------------------------------------------- conversion core

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");

const ALIAS = new Map();
for (const p of PAIRS) {
  ALIAS.set(norm(p.from), norm(p.from));
  ALIAS.set(norm(p.to), norm(p.to));
  for (const side of [p.from, p.to]) {
    const name = norm(side === p.from ? p.from_name : p.to_name);
    if (!name) continue;
    ALIAS.set(name, norm(side));
    if (name.endsWith("s")) ALIAS.set(name.slice(0, -1), norm(side));
    else ALIAS.set(`${name}s`, norm(side));
  }
}
const canon = (u) => ALIAS.get(norm(u)) || norm(u);

const BY_KEY = new Map();
for (const p of PAIRS) {
  BY_KEY.set(`${norm(p.from)}>${norm(p.to)}`, { pair: p, reverse: false });
  const rk = `${norm(p.to)}>${norm(p.from)}`;
  if (!BY_KEY.has(rk)) BY_KEY.set(rk, { pair: p, reverse: true });
}

function convert(from, to, value, decimalsOverride) {
  if (!Number.isFinite(value)) throw new Error("value must be a finite number");
  const hit = BY_KEY.get(`${canon(from)}>${canon(to)}`);
  if (!hit) {
    const src = canon(from);
    const options = PAIRS.filter((p) => norm(p.from) === src || norm(p.to) === src).map((p) => p.slug);
    throw new Error(
      `No conversion from "${from}" to "${to}".` + (options.length ? ` Known pairs from ${from}: ${options.join(", ")}.` : "")
    );
  }
  const { pair, reverse } = hit;
  const decimals = Number.isInteger(decimalsOverride) && decimalsOverride >= 0 && decimalsOverride <= 12
    ? decimalsOverride
    : pair.decimals;
  const raw = reverse ? (value - pair.offset) / pair.factor : value * pair.factor + pair.offset;
  const f = Math.pow(10, decimals);
  const rounded = Math.round((raw + Number.EPSILON) * f) / f;
  return {
    input: { value, from },
    output: { value: Object.is(rounded, -0) ? 0 : rounded, unit: to },
    pair: pair.slug,
    factor: pair.factor,
    offset: pair.offset,
    decimals,
    unrounded: raw,
    definition_page: pair.page,
    attribution: META.attribution,
    license: `${META.license} — commercial use without attribution is available at ${META.site}/api/`,
  };
}

// ---------------------------------------------------------------- tools

const TOOLS = [
  {
    name: "convert_unit",
    description:
      "Convert a value between units of length, mass, temperature, pressure, data size, volume, speed, time or area. " +
      "Accepts symbols or full names (km, kilometers, lb, pounds, °F, fahrenheit). Returns the rounded result, the exact factor " +
      "and the page that documents the definition. Local computation, no API key needed.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source unit, e.g. km, lb, °F, MB, cup" },
        to: { type: "string", description: "Target unit, e.g. mi, kg, °C, GB, mL" },
        value: { type: "number", description: "Numeric value to convert" },
        decimals: { type: "integer", minimum: 0, maximum: 12, description: "Optional rounding override" },
      },
      required: ["from", "to", "value"],
    },
  },
  {
    name: "list_units",
    description: "List the 30 supported conversion pairs, optionally filtered to one category.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["length", "weight", "temperature", "pressure", "data", "volume", "speed", "time", "area"],
          description: "Optional category filter",
        },
      },
    },
  },
  {
    name: "get_factor",
    description: "Return the exact stored factor, offset and display precision for a pair, without converting a value.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
    },
  },
];

function runTool(name, args) {
  const a = args || {};
  if (name === "convert_unit") {
    if (a.from == null || a.to == null || a.value == null) throw new Error("from, to and value are required");
    const value = typeof a.value === "number" ? a.value : Number(a.value);
    return convert(a.from, a.to, value, a.decimals);
  }
  if (name === "list_units") {
    const rows = (a.category ? PAIRS.filter((p) => p.category === a.category) : PAIRS).map((p) => ({
      slug: p.slug,
      category: p.category,
      from: p.from,
      to: p.to,
      from_name: p.from_name,
      to_name: p.to_name,
      decimals: p.decimals,
      page: p.page,
    }));
    return { count: rows.length, pairs: rows };
  }
  if (name === "get_factor") {
    const hit = BY_KEY.get(`${canon(a.from)}>${canon(a.to)}`);
    if (!hit) throw new Error(`Unknown pair ${a.from} -> ${a.to}`);
    const p = hit.pair;
    return {
      pair: p.slug,
      direction_used: hit.reverse ? `${p.to} → ${p.from}` : `${p.from} → ${p.to}`,
      factor: p.factor,
      offset: p.offset,
      decimals: p.decimals,
      formula: p.formula,
      note: "result = value * factor + offset. The reverse direction is (result - offset) / factor.",
      definition_page: p.page,
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

// ---------------------------------------------------------------- JSON-RPC plumbing

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize": {
      const asked = params && params.protocolVersion;
      const protocolVersion = KNOWN_PROTOCOLS.has(asked) ? asked : LATEST_PROTOCOL;
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          "Unit conversion for 30 pairs, computed locally with the same factors as allunits.org. " +
          "For bulk conversions (100+ values per request) use the HTTP API documented at " +
          META.site + "/api/.",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notifications never get a response
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      try {
        const out = runTool(name, args);
        return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: false });
      } catch (err) {
        return reply(id, {
          content: [{ type: "text", text: String(err && err.message ? err.message : err) }],
          isError: true,
        });
      }
    }
    case "resources/list":
      return isNotification ? undefined : reply(id, { resources: [] });
    case "prompts/list":
      return isNotification ? undefined : reply(id, { prompts: [] });
    default:
      if (isNotification) return;
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

function start() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return replyError(null, -32700, "Parse error");
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const m of batch) {
      try {
        handle(m);
      } catch (err) {
        if (m && m.id !== undefined && m.id !== null) replyError(m.id, -32603, String(err && err.message ? err.message : err));
      }
    }
  });
  rl.on("close", () => process.exit(0));
}

start();
