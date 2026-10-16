// Keep expensive work bounded, including requests Heroku's router abandons.
function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function requestProtection({
  maxConcurrent = positiveInteger(process.env.MAX_CONCURRENT_REQUESTS, 16),
  timeoutMs = 20000,
} = {}) {
  let active = 0;
  return (req, res, next) => {
    // Earlier middleware (notably static-file lookup) can finish after the
    // connection has already closed. Its close event will not fire again.
    if (req.aborted || res.destroyed || res.writableEnded) return;
    if (active >= maxConcurrent) {
      res.set('Retry-After', '5');
      return res.status(503).send('The site is busy. Please try again shortly.');
    }
    active++;
    const controller = new AbortController();
    req.upstreamSignal = controller.signal;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      active--;
      res.removeListener('finish', release);
      res.removeListener('close', release);
      if (req.removeListener) req.removeListener('aborted', release);
      controller.abort();
    };
    const timer = setTimeout(() => {
      // Free the slot even if the socket closed without an observed event,
      // or a partially written response can no longer receive a 504.
      try {
        if (!res.destroyed && !res.writableEnded) {
          if (res.headersSent) res.destroy();
          else res.status(504).send('The request took too long. Please try again.');
        }
      } finally {
        release();
      }
    }, timeoutMs);
    timer.unref();
    res.once('finish', release);
    res.once('close', release);
    if (req.once) req.once('aborted', release);
    next();
  };
}

async function apiJSON(url, signal, timeoutMs = 10000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  }
  const timer = setTimeout(abort, timeoutMs);
  timer.unref();
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      if (response.body) await response.body.cancel();
      throw Object.assign(new Error('The museum data service is unavailable.'), { status: 502 });
    }
    // Keep the timeout active while downloading and parsing the response too.
    const data = await response.json();
    controller.signal.throwIfAborted();
    return data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error('The museum data request took too long.'), { status: 504 });
    }
    if (error.status) throw error;
    // Never expose upstream URLs, which contain the API key.
    throw Object.assign(new Error('The museum data service is unavailable.'), { status: 502 });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}

module.exports = { requestProtection, apiJSON };
