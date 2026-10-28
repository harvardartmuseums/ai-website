const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { busyError, positiveInteger } = require('./request-protection');

// One reusable CPU worker per web process. Keep the waiting list within the
// existing job limit; the surrounding runWork call owns deadlines/cancellation.
function createPerspectivesWorker({
  maxPending = positiveInteger(process.env.MAX_CONCURRENT_REQUESTS, 16),
  workerPath = path.join(__dirname, 'perspectives-thread.js'),
} = {}) {
  let worker = null;
  let current = null;
  let stopping = false;
  let closed = false;
  let sequence = 0;
  const queue = [];
  const unavailable = () => Object.assign(new Error('The image analysis is unavailable. Please try again.'), { status: 503, retryAfter: 5 });
  const cancelled = () => Object.assign(new Error('The request took too long.'), { status: 504 });

  function settle(job, error, result) {
    if (job.signal) job.signal.removeEventListener('abort', job.abort);
    if (error) job.reject(error);
    else job.resolve(result);
  }

  function startNext() {
    if (closed || stopping || current || !queue.length) return;
    current = queue.shift();
    try {
      if (!worker) {
        const thread = worker = new Worker(workerPath);
        thread.on('message', message => {
          if (!current || message.id !== current.id || stopping) return;
          const job = current;
          current = null;
          thread.unref();
          settle(job, message.failed ? unavailable() : null, message.result);
          startNext();
        });
        thread.on('error', () => {
          stopping = true;
          if (current) {
            const job = current;
            current = null;
            settle(job, unavailable());
          }
        });
        thread.on('exit', () => {
          worker = null;
          stopping = false;
          if (current) {
            const job = current;
            current = null;
            settle(job, unavailable());
          }
          startNext();
        });
      }
      worker.ref();
      worker.postMessage(current.message);
      current.message = null;
    } catch {
      const job = current;
      current = null;
      if (worker) worker.unref();
      settle(job, unavailable());
      startNext();
    }
  }

  function compute(records, object, image, signal) {
    if (signal && signal.aborted) return Promise.reject(cancelled());
    if (closed) return Promise.reject(unavailable());
    if (queue.length + Number(Boolean(current)) >= maxPending) return Promise.reject(busyError());
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const job = { id, message: { id, records, object, image }, signal, resolve, reject };
      job.abort = () => {
        if (job === current) {
          // A synchronous compute cannot receive cancellation messages. Stop
          // its thread and wait for exit before starting a replacement.
          current = null;
          stopping = true;
          worker.terminate();
        } else {
          queue.splice(queue.indexOf(job), 1);
        }
        settle(job, cancelled());
        startNext();
      };
      if (signal) signal.addEventListener('abort', job.abort, { once: true });
      queue.push(job);
      startNext();
    });
  }

  async function close() {
    closed = true;
    if (current) {
      const job = current;
      current = null;
      settle(job, unavailable());
    }
    for (const job of queue.splice(0)) settle(job, unavailable());
    if (worker) await worker.terminate();
  }

  return { compute, close };
}

module.exports = { ...createPerspectivesWorker(), createPerspectivesWorker };
