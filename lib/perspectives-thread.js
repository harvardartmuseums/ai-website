const { parentPort } = require('node:worker_threads');
const { compute } = require('../public/javascripts/perspectives');

parentPort.on('message', ({ id, records, object, image }) => {
  try {
    parentPort.postMessage({ id, result: compute(records, object, image) });
  } catch {
    parentPort.postMessage({ id, failed: true });
  }
});
