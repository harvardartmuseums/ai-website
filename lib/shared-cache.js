// Cache serialized public data so callers cannot mutate another request's copy.
// Coalesce simultaneous misses, cancelling shared work only after everyone leaves.
const { busyError, positiveInteger } = require('./request-protection');
function cacheTTLms(hours = process.env.CACHE_TTL_HOURS) {
  const milliseconds = Number(hours) * 60 * 60 * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds : 12 * 60 * 60 * 1000;
}

function sharedCache({ ttlMs = cacheTTLms(), maxBytes = 16 * 1024 * 1024, maxEntries = 100,
  maxWaiters = positiveInteger(process.env.MAX_CACHE_WAITERS, 128), now = Date.now } = {}) {
  const entries = new Map();
  const pending = new Map();
  let totalBytes = 0;
  let waiters = 0;
  const remove = key => {
    const entry = entries.get(key);
    if (entry) totalBytes -= entry.bytes;
    entries.delete(key);
  };
  return function load(key, loader, signal) {
    if (signal && signal.aborted) return Promise.reject(signal.reason);
    const cached = entries.get(key);
    if (cached && cached.expires > now()) {
      entries.delete(key);
      entries.set(key, cached);
      return Promise.resolve(JSON.parse(cached.json));
    }
    remove(key);
    // Bound connections waiting for data, while allowing completed cache hits.
    if (waiters >= maxWaiters) return Promise.reject(busyError());
    let work = pending.get(key);
    if (!work) {
      work = { controller: new AbortController(), users: 0 };
      pending.set(key, work);
      work.promise = Promise.resolve().then(() => {
        work.controller.signal.throwIfAborted();
        return loader(work.controller.signal);
      }).then(value => {
        work.controller.signal.throwIfAborted();
        const json = JSON.stringify(value);
        const bytes = Buffer.byteLength(json);
        if (bytes <= maxBytes) {
          for (const [oldKey, entry] of entries) {
            if (entry.expires <= now()) remove(oldKey);
          }
          while (entries.size >= maxEntries || totalBytes + bytes > maxBytes) {
            remove(entries.keys().next().value);
          }
          entries.set(key, { json, bytes, expires: now() + ttlMs });
          totalBytes += bytes;
        }
        return json;
      }).finally(() => {
        if (pending.get(key) === work) pending.delete(key);
      });
    }
    work.users++;
    waiters++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, json) => {
        if (finished) return;
        finished = true;
        if (signal) signal.removeEventListener('abort', abort);
        work.users--;
        waiters--;
        if (!work.users) {
          work.controller.abort();
          if (pending.get(key) === work) pending.delete(key);
        }
        if (error) reject(error);
        else {
          try { resolve(JSON.parse(json)); } catch (error) { reject(error); }
        }
      };
      const abort = () => finish(signal.reason || new Error('Request cancelled.'));
      if (signal) signal.addEventListener('abort', abort, { once: true });
      work.promise.then(json => finish(null, json), error => finish(error));
    });
  };
}

module.exports = { sharedCache, cacheTTLms };
