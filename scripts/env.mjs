#!/usr/bin/env node
// Local env helpers, driven by the Makefile. No dependencies.
//   node scripts/env.mjs check            required vars present and well formed
//   node scripts/env.mjs intra            42 app credentials get a token
//   node scripts/env.mjs key-list         saved API key profiles
//   node scripts/env.mjs key-save <name>  save current FT_CLIENT_* as a profile
//   node scripts/env.mjs key-use <name>   switch FT_CLIENT_* to a profile
//   node scripts/env.mjs secret-check     a new secret (stdin) works with FT_CLIENT_ID
//   node scripts/env.mjs secret-set       write a new secret (stdin) into the env file
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const ENV_FILE = process.env.ENV_FILE || ".env.local";
const KEYS_DIR = ".keys";
const KEY_VARS = ["FT_CLIENT_ID", "FT_CLIENT_SECRET"];

const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`  \x1b[31m✗\x1b[0m ${msg}`);
  process.exitCode = 1;
};

const readEnv = (file) => (existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {});

/** File values, overridden by the real environment (so CI can skip the file). */
function loadEnv() {
  const env = { ...readEnv(ENV_FILE) };
  for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
  return env;
}

function check() {
  console.log(existsSync(ENV_FILE) ? `Checking ${ENV_FILE}` : `No ${ENV_FILE}, checking the process environment`);
  const env = loadEnv();

  if (/^u-s4t2ud-[0-9a-f]{64}$/.test(env.FT_CLIENT_ID ?? "")) ok("FT_CLIENT_ID");
  else if (env.FT_CLIENT_ID) warn("FT_CLIENT_ID is set but does not look like u-s4t2ud-<64 hex>");
  else fail("FT_CLIENT_ID is missing");

  if (/^s-s4t2ud-[0-9a-f]{64}$/.test(env.FT_CLIENT_SECRET ?? "")) ok("FT_CLIENT_SECRET");
  else if (env.FT_CLIENT_SECRET) warn("FT_CLIENT_SECRET is set but does not look like s-s4t2ud-<64 hex>");
  else fail("FT_CLIENT_SECRET is missing");

  const secret = env.SESSION_SECRET ?? "";
  if (secret.length < 32) fail("SESSION_SECRET must be at least 32 characters (openssl rand -base64 48)");
  else if (secret.startsWith("change-me")) fail("SESSION_SECRET is still the example value");
  else ok("SESSION_SECRET");

  if (!env.APP_URL) warn("APP_URL is empty, the request origin will be used");
  else if (!/^https?:\/\/[^/]+$/.test(env.APP_URL)) fail("APP_URL must be an origin like https://example.com, no trailing slash");
  else ok(`APP_URL (redirect URI: ${env.APP_URL}/api/auth/callback)`);

  const redisUrl = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (redisUrl && redisToken) ok("Upstash Redis");
  else if (redisUrl || redisToken) fail("Upstash Redis needs both the REST URL and the REST token");
  else warn("No Upstash Redis, view counts stay in memory");
}

async function intra() {
  const env = loadEnv();
  if (!env.FT_CLIENT_ID || !env.FT_CLIENT_SECRET) return fail("FT_CLIENT_ID and FT_CLIENT_SECRET are required");

  const res = await fetch("https://api.intra.42.fr/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "42shops-make" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.FT_CLIENT_ID,
      client_secret: env.FT_CLIENT_SECRET,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return fail(`42 rejected the credentials (${res.status}): ${body.error_description ?? body.error ?? "no details"}`);
  ok(`Token issued for ${env.FT_CLIENT_ID.slice(0, 16)}…`);

  // 42 rotates app secrets; the token response says when this one expires.
  const valid = body.secret_valid_until;
  if (valid) {
    const days = Math.floor((valid * 1000 - Date.now()) / 86_400_000);
    (days < 14 ? warn : ok)(`Secret valid until ${new Date(valid * 1000).toISOString().slice(0, 10)} (${days} days)`);
  }
}

const profile = (name) => {
  if (!/^[\w.-]+$/.test(name ?? "")) {
    console.error("Usage: make key-use NAME=<profile>  (letters, digits, . _ -)");
    process.exit(2);
  }
  return join(KEYS_DIR, `${name}.env`);
};

function keyList() {
  const current = readEnv(ENV_FILE);
  const files = existsSync(KEYS_DIR) ? readdirSync(KEYS_DIR).filter((f) => f.endsWith(".env")) : [];
  if (!files.length) return console.log("No saved keys. Save the current one with: make key-save NAME=<profile>");
  for (const f of files) {
    const saved = readEnv(join(KEYS_DIR, f));
    const active = KEY_VARS.every((k) => saved[k] === current[k]);
    console.log(`${active ? "*" : " "} ${f.slice(0, -4)}`);
  }
}

function keySave(name) {
  const file = profile(name);
  const env = readEnv(ENV_FILE);
  if (!env.FT_CLIENT_ID || !env.FT_CLIENT_SECRET) return fail(`No FT_CLIENT_ID / FT_CLIENT_SECRET in ${ENV_FILE}`);
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, KEY_VARS.map((k) => `${k}=${env[k]}\n`).join(""), { mode: 0o600 });
  ok(`Saved ${file}`);
}

/** Replace (or append) KEY=value lines in the env file, keeping everything else. */
function setVars(vars) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  writeFileSync(ENV_FILE, text);
}

function keyUse(name) {
  const file = profile(name);
  if (!existsSync(file)) return fail(`No profile ${file}. See: make key-list`);
  const keys = readEnv(file);
  for (const k of KEY_VARS) if (!keys[k]) return fail(`${file} has no ${k}`);
  setVars(Object.fromEntries(KEY_VARS.map((k) => [k, keys[k]])));
  ok(`${ENV_FILE} now uses the "${name}" key. Restart the dev server to pick it up.`);
}

/** The new secret, piped on stdin so it never shows up in shell history or `ps`. */
async function readSecret() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const secret = input.trim();
  if (!/^s-s4t2ud-[0-9a-f]{64}$/.test(secret)) {
    fail("That doesn't look like a 42 secret (s-s4t2ud-<64 hex>)");
    process.exit(1);
  }
  return secret;
}

async function secretCheck() {
  process.env.FT_CLIENT_SECRET = await readSecret();
  await intra();
}

async function secretSet() {
  setVars({ FT_CLIENT_SECRET: await readSecret() });
  ok(`Saved the new FT_CLIENT_SECRET in ${ENV_FILE}`);
}

const [cmd, arg] = process.argv.slice(2);
const commands = {
  check,
  intra,
  "key-list": keyList,
  "key-save": keySave,
  "key-use": keyUse,
  "secret-check": secretCheck,
  "secret-set": secretSet,
};
if (!commands[cmd]) {
  console.error(`Unknown command "${cmd ?? ""}". One of: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
await commands[cmd](arg);
