export function createMediaReadinessGate() {
  let ready = false;
  const waiters = new Set();

  return {
    get ready() {
      return ready;
    },

    markReady() {
      if (ready) return;
      ready = true;
      for (const resolve of waiters) resolve(true);
      waiters.clear();
    },

    wait(timeoutMs = 8000) {
      if (ready) return Promise.resolve(true);
      return new Promise((resolve) => {
        let timer = null;
        const finish = (result) => {
          if (timer) clearTimeout(timer);
          waiters.delete(finish);
          resolve(result);
        };
        waiters.add(finish);
        timer = setTimeout(() => finish(false), timeoutMs);
      });
    },
  };
}
