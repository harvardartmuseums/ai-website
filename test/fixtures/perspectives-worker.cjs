const { parentPort, threadId } = require('node:worker_threads');

parentPort.on('message', ({ id, records, object }) => {
  const action = records[0];
  if (action === 'crash') throw new Error('Test worker crash');
  if (action === 'exit') process.exit(0);
  if (action === 'busy') {
    const state = new Int32Array(object.state);
    Atomics.store(state, 0, 1);
    while (Atomics.load(state, 1) === 0) { /* deliberately block this worker */ }
  }
  parentPort.postMessage(action === 'fail' ? { id, failed: true } : { id, result: { action, threadId } });
});
