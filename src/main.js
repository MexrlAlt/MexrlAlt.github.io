// ─── Config ──────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS  = 3;
const RETRY_DELAY   = 1500; // ms between attempts

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Script cache — prevents re-declaring `const` globals on retry which causes
// SyntaxError / "already declared" crashes in WebKit.
const _loaded = new Set();

function load_script(src) {
  if (_loaded.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src    = src;
    el.onload  = () => { _loaded.add(src); resolve(); };
    el.onerror = () => reject(new Error(`load_script: failed to fetch ${src}`));
    document.head.appendChild(el);
  });
}

async function load_json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → HTTP ${r.status}`);
  return r.arrayBuffer();
}

// Stage header in the console
function stage(msg) {
  appendLine(`\n> ${msg}`, "console-line-dim");
}

// ─── Single exploit attempt ───────────────────────────────────────────────────
async function run_jb() {
  // ── Load shared base ──────────────────────────────────────────────────────
  stage("Loading base modules...");
  await load_script("src/misc.js");

  version.init();
  appendLine(`  fw ${version}  console PS${version.console}`, "console-line-dim");

  switch (version.console) {
    case 4:
      await load_script("src/ps4/constants.js");
      await load_script("src/ps4/userland.js");
      break;
    case 5:
      throw new Error("PS5 not yet supported");
    default:
      throw new Error(`Unsupported console ${version.console}`);
  }

  // ── Userland arbitrary R/W ────────────────────────────────────────────────
  stage("Establishing userland R/W...");
  let rw;
  if (arw.master === undefined) {
    rw = await init_rw();
  }
  init_arw(rw);
  init_rop();
  init_syscalls();
  appendLine("  userland R/W ready", "console-line-dim");

  // ── Load support modules ──────────────────────────────────────────────────
  await load_script("src/loader.js");
  await load_script("src/workers.js");

  switch (version.console) {
    case 4: await load_script("src/ps4/kernel.js"); break;
  }

  await load_script(`src/${exploitChain}.js`);

  // ── Exploit chain ─────────────────────────────────────────────────────────
  stage(`Running ${exploitChain}...`);

  try {
    if (exploitChain === "lapse") {
      init();
      await setup();
      await double_free_reqs2();
      leak_kaddrs();
      double_free_reqs1();
      make_karw();
      inc_karw_pipe_refcnt();

      stage("Cleanup...");
      remove_pktinfo_from_so(pktopts_twins[0]);
      remove_rthdr_from_so(pktopts_twins[1]);
      remove_rthdr_from_so(rthdr_twins[0]);
    } else {
      init();
      await setup();
      await ucred_triple_free();
      leak_kqueue();
      await make_karw();
      inc_karw_pipe_refcnt();

      stage("Cleanup...");
      for (const t of triplets) remove_rthdr_from_so(t);
      remove_uaf_file();
    }
  } finally {
    // Always run cleanup even if a step throws — avoids leaking kernel memory
    // and leaving half-initialized state that causes a panic on retry.
    cleanup();
  }

  // ── Kernel phase ──────────────────────────────────────────────────────────
  stage("Scanning process list...");
  find_all_proc();

  if (fn.setuid.invoke(0) === -1) {
    // Not yet root — run full jailbreak
    stage("Applying jailbreak...");
    jailbreak();

    stage(`Fetching kernel patches (${constants.KPATCH})...`);
    const kpatch_buf = await load_json(`src/ps4/patches/${constants.KPATCH}`);
    const kpatch_u8  = new Uint8Array(kpatch_buf);
    if (kpatch_u8.length === 0) {
      throw new Error(`${constants.KPATCH} is empty — patch file missing?`);
    }
    appendLine(`  patch size: ${kpatch_u8.length} bytes`, "console-line-dim");
    kernel_patches(kpatch_u8);
  } else {
    stage("Already root — skipping kernel patches");
  }

  // ── Payload ───────────────────────────────────────────────────────────────
  stage("Loading payload...");
  const payload_buf = await load_json("src/payload.bin");
  const payload_u8  = new Uint8Array(payload_buf);
  if (payload_u8.length === 0) {
    throw new Error("payload.bin is empty");
  }
  appendLine(`  payload size: ${payload_u8.length} bytes`, "console-line-dim");
  load_bin(payload_u8);
}

// ─── Entry point (called by script.js button handler) ────────────────────────
async function doJb() {
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      appendLine(`\n> retry ${attempt}/${MAX_ATTEMPTS}`, "console-line-warn");
      setStatus("running", `Retry ${attempt}`);
      await sleep(RETRY_DELAY);
    }

    try {
      await run_jb();

      // ── Success ────────────────────────────────────────────────────────────
      appendLine("\n> jailbreak complete", "console-line-ok");
      window.exploitFinished(true, "jailbreak complete");
      return;

    } catch (e) {
      lastErr = e;

      // Print the error and a few stack frames to the console
      appendLine(`\n> [${attempt}/${MAX_ATTEMPTS}] ${e.message}`, "console-line-err");
      if (e.stack) {
        e.stack.split("\n")
          .slice(1, 5)
          .map(l => l.trim())
          .filter(Boolean)
          .forEach(l => appendLine(`  ${l}`, "console-line-dim"));
      }

      if (attempt < MAX_ATTEMPTS) {
        appendLine(`  retrying in ${RETRY_DELAY / 1000}s...`, "console-line-warn");
      }
    }
  }

  // ── All attempts exhausted ─────────────────────────────────────────────────
  window.exploitFinished(false, lastErr?.message ?? "unknown error");
}
