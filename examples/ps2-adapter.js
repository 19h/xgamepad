import { readFile } from 'node:fs/promises';
import { createGamepadManager, createSDLBackend } from 'xgamepad';

// Pass a file containing the SDL mappings captured for your actual adapter.
const filename = process.argv[2];
if (!filename) {
    throw new Error('Usage: node examples/ps2-adapter.js mappings.txt');
}
const mappings = (await readFile(filename, 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

const pads = createGamepadManager({
    backend: createSDLBackend({ mappings }),
});
pads.on('error', ({ error }) => console.error(error));
pads.on('change', ({ controller, state }) => console.log(controller.id, state));
await pads.start();
process.once('SIGINT', () => {
    void pads.stop().catch(console.error);
});
