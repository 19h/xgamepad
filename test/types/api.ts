import { createGamepadManager, createSDLBackend, type Backend, type Sample } from 'xgamepad';
import { createBrowserBackend } from 'xgamepad/browser';
import { createHIDBackend, decodePlayStationReport, type HIDProfile } from 'xgamepad/hid';

const backend: Backend = {
    start(sink) {
        sink.connect({ id: 'example', capabilities: { rumble: true } });
        sink.update('example', { axes: { leftX: 1 }, buttons: { south: true } });
    },
    stop() {},
};
const pads = createGamepadManager({ backend });
pads.on('buttondown', ({ button, state, controller }) => {
    console.log(button, state.buttons.south.pressed);
    void controller.rumble({ duration: 0.1 });
});
const off = pads.once('error', ({ error }) => console.error(error));
off();
for await (const event of pads.events('axis')) {
    console.log(event.axis, event.value);
    break;
}
const profile: HIDProfile = {
    id: 'adapter',
    match: (device) => device.vendorId === 0x1234,
    decode: (data) => ({ buttons: { south: data[0] === 1 } }),
    describe: () => ({ family: 'ps2' }),
};
createHIDBackend({
    profiles: [profile],
    initialize: async (handle) => {
        await handle.getFeatureReport(0xf2, 17);
    },
});
createSDLBackend({ triggerRest: () => ({ left: 0, right: 0 }) });
createBrowserBackend({ mapGamepad: () => ({ axes: { leftX: 0 } }) });
decodePlayStationReport('ps5', new Uint8Array(64));

// @ts-expect-error unknown event names are rejected
pads.on('banana', () => {});
// @ts-expect-error snapshots are readonly
pads.controllers[0].state.axes.leftX = 1;
const invalid: Sample = {
    // @ts-expect-error unknown buttons are rejected
    buttons: { banana: true },
};
void invalid;
