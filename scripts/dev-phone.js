const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const children = [];
const repoRoot = path.resolve(__dirname, "..");
const mobileRoot = path.join(repoRoot, "apps", "mobile");
const apiRoot = path.join(repoRoot, "apps", "api");
const useTunnel = process.argv.includes("--tunnel");
const clearMetroCache = process.argv.includes("--clear");
const useDevelopmentClient = process.argv.includes("--dev-client");
const useConfiguredDatabase =
  Boolean(process.env.DATABASE_URL)
  || process.env.DEV_PHONE_USE_POSTGRES === "1"
  || process.env.USE_POSTGRES === "1";
const hostMode = useTunnel ? "tunnel" : "lan";
const lanHost = process.env.EXPO_DEV_SERVER_HOST || getLanHost();
const apiPort = process.env.API_PORT || "8000";
const metroPort = process.env.METRO_PORT || "8081";
const phoneDatabasePath = path.join(apiRoot, ".local", "living-nutrition-dev.sqlite");
const phoneDatabaseUrl = `sqlite+pysqlite:///${phoneDatabasePath.replaceAll("\\", "/")}`;
const localApiHealthUrl = `http://127.0.0.1:${apiPort}/api/v1/health`;
const localMetroStatusUrl = `http://127.0.0.1:${metroPort}/status`;
const localIosBundleUrl =
  `http://127.0.0.1:${metroPort}/node_modules/expo-router/entry.bundle?` +
  new URLSearchParams({
    platform: "ios",
    dev: "true",
    hot: "false",
    lazy: "true",
    "transform.engine": "hermes",
    "transform.bytecode": "1",
    "transform.routerRoot": "app",
    unstable_transformProfile: "hermes-stable",
  }).toString();
const childEnv = {
  ...process.env,
  AUTO_MIGRATE_ON_STARTUP: process.env.AUTO_MIGRATE_ON_STARTUP || "true",
  EXPO_NO_TELEMETRY: process.env.EXPO_NO_TELEMETRY || "1",
};

if (!useConfiguredDatabase) {
  childEnv.DATABASE_URL = phoneDatabaseUrl;
}

if (lanHost) {
  childEnv.REACT_NATIVE_PACKAGER_HOSTNAME = lanHost;
  childEnv.EXPO_PUBLIC_API_BASE_URL =
    process.env.EXPO_PUBLIC_API_BASE_URL || `http://${lanHost}:${apiPort}/api/v1`;
}

console.log("\nLiving Nutrition phone dev server");
console.log(`Metro host mode: ${hostMode}`);
console.log(`Mobile client: ${useDevelopmentClient ? "development build" : "Expo Go"}`);
console.log(`Metro cache: ${clearMetroCache ? "clear before start" : "preserve for faster phone loads"}`);
console.log(
  `API database: ${useConfiguredDatabase ? "configured DATABASE_URL/Postgres" : "local SQLite phone preview"}`
);
if (lanHost && !useTunnel) {
  console.log(`Forced LAN host: ${lanHost}`);
  console.log(`Phone bundle test: http://${lanHost}:${metroPort}/status`);
  console.log(`Phone API test:    http://${lanHost}:${apiPort}/api/v1/health`);
}
console.log("");

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    cwd: options.cwd || repoRoot,
    env: {
      ...childEnv,
      ...(options.env || {}),
    },
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (signal) {
      return;
    }

    if (code && code !== 0) {
      console.error(`\n${name} exited with code ${code}.`);
      stopAll();
      process.exit(code);
    }
  });
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});

main().catch((error) => {
  console.error(error.message || error);
  stopAll();
  process.exit(1);
});

async function main() {
  if (await tcpPortIsOpen(Number(metroPort)) && !(await metroIsHealthy())) {
    console.error(
      `Port ${metroPort} is already in use, but ${localMetroStatusUrl} did not respond.`
    );
    console.error("Stop the stale Expo/Metro process with Ctrl+C, then run npm run dev:phone again.");
    process.exit(1);
  }

  if (await apiIsHealthy()) {
    console.log(`Reusing existing API at ${localApiHealthUrl}`);
  } else if (await tcpPortIsOpen(Number(apiPort))) {
    console.error(
      `Port ${apiPort} is already in use, but ${localApiHealthUrl} did not return a healthy API response.`
    );
    console.error("Stop the process using that port, or set API_PORT to another port before running dev:phone.");
    process.exit(1);
  } else {
    if (!useConfiguredDatabase) {
      fs.mkdirSync(path.dirname(phoneDatabasePath), { recursive: true });
    }

    start("api", "npm", ["run", "api"], { cwd: repoRoot });
    await waitForApiHealth();
  }

  // Camera confirmation now creates a durable server job. Keep its bounded
  // worker alongside Metro during phone preview so queued scans are reviewed.
  start("meal-analysis-worker", "npm", ["run", "api:analysis-worker"], { cwd: repoRoot });

  const expoArgs = [
    "expo",
    "start",
    useDevelopmentClient ? "--dev-client" : "--go",
    "--host",
    hostMode,
    "--port",
    metroPort,
  ];

  if (clearMetroCache) {
    expoArgs.push("--clear");
  }

  start("mobile", "npx", expoArgs, {
    cwd: mobileRoot,
  });

  prewarmIosBundle();
}

async function apiIsHealthy() {
  try {
    const response = await fetch(localApiHealthUrl, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) {
      return false;
    }

    const body = await response.json();
    return Boolean(body?.ok && body?.database?.schemaReady);
  } catch {
    return false;
  }
}

async function waitForApiHealth() {
  const attempts = 20;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await apiIsHealthy()) {
      console.log(`API schema is ready at ${localApiHealthUrl}`);
      return;
    }

    await sleep(500);
  }

  throw new Error(
    `The API did not become schema-ready at ${localApiHealthUrl}. ` +
      "Check the API logs above; Expo was not started to avoid a phone-side server error."
  );
}

async function metroIsHealthy() {
  try {
    const response = await fetch(localMetroStatusUrl, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

function tcpPortIsOpen(port) {
  const net = require("node:net");

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(700);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function prewarmIosBundle() {
  try {
    await waitForMetro();
    console.log("\nPrewarming iOS bundle locally. Wait for this before scanning the QR code...");
    const startedAt = Date.now();
    const response = await fetch(localIosBundleUrl, {
      signal: AbortSignal.timeout(180000),
    });

    if (!response.ok) {
      console.warn(`Metro bundle prewarm failed with HTTP ${response.status}. Check the Metro logs above.`);
      return;
    }

    const bytes = await response.arrayBuffer();
    const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
    console.log(`iOS bundle ready: ${Math.round(bytes.byteLength / 1024)} KB in ${seconds}s.`);
    console.log(
      useDevelopmentClient
        ? "Open your installed development build and scan the QR code from its launcher."
        : "Now scan the Expo QR code from Expo Go."
    );
  } catch (error) {
    console.warn("\nMetro bundle prewarm did not finish in time.");
    console.warn(error instanceof Error ? error.message : error);
    console.warn("If Expo Go still times out, run npm run dev:phone:clear once, wait for prewarm, then scan again.");
  }
}

async function waitForMetro() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(localMetroStatusUrl, {
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Metro is still booting.
    }

    await sleep(1000);
  }

  throw new Error(`Metro did not become ready at ${localMetroStatusUrl}.`);
}

function getLanHost() {
  const interfaces = os.networkInterfaces();
  const interfaceNames = Object.keys(interfaces);
  // macOS can expose stale VPN/continuity addresses before the active Wi-Fi adapter.
  // Prefer physical Ethernet/Wi-Fi adapters, then fall back to other non-loopback interfaces.
  const orderedInterfaceNames = [
    ...interfaceNames.filter((name) => /^en\d+$/.test(name)),
    ...interfaceNames.filter((name) => !/^en\d+$/.test(name)),
  ];
  const candidates = [];

  for (const name of orderedInterfaceNames) {
    const addresses = interfaces[name];
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push(address.address);
      }
    }
  }

  return candidates.find((address) => address.startsWith("192.168."))
    || candidates.find((address) => address.startsWith("10."))
    || candidates.find((address) => address.startsWith("172."))
    || candidates[0];
}
