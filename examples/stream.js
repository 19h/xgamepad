import { createGamepadManager } from 'xgamepad';

const pads = createGamepadManager();
const abort = new AbortController();
pads.on('error', ({ error }) => console.error(error));
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());

try {
    await pads.start();
    for await (const { controller, state } of pads.events('change', { signal: abort.signal })) {
        console.log(JSON.stringify({ id: controller.id, state }));
    }
} finally {
    await pads.stop();
}
