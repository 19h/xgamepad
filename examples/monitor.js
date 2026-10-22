import { createGamepadManager } from 'xgamepad';

const pads = createGamepadManager();
pads.on('error', ({ error }) => console.error(error));
pads.on('connect', ({ controller }) => console.log('Connected:', controller.descriptor));
pads.on('buttondown', ({ controller, button }) => console.log(controller.id, button));
pads.on('disconnect', ({ controller }) => console.log('Disconnected:', controller.id));
await pads.start();

process.once('SIGINT', () => {
    void pads.stop().catch(console.error);
});
process.once('SIGTERM', () => {
    void pads.stop().catch(console.error);
});
