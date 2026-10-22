# Migrating from PS3.js

This project is a new API. The original global `hid`/`rdata` design and legacy echtzeit server are
not retained. Applications can keep their own transport or UI while replacing raw-array polling with
normalized input events.

| Previous pattern                          | xgamepad replacement                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `require('../lib/ps3.js')` opens a device | Import a factory, register listeners, `await pads.start()`        |
| Global `rdata`                            | `controller.state` or event `state`                               |
| Implicit first VID/PID match              | Explicit backend and a collection of controllers                  |
| `setInterval` polling globals             | `state`, `change`, `buttondown`, `buttonup`, `axis` subscriptions |
| Raw integer axis bytes                    | Dimensionless signed axes with documented polarity/deadzones      |
| Raw pressure offsets                      | `state.buttons[name].value`                                       |
| Thrown strings on open                    | Promise rejection / `GamepadError` with codes and causes          |
| Implicit process lifetime                 | `await pads.stop()` and removable subscriptions                   |
| Embedded realtime server dependency       | Application-owned networking, if needed                           |

The original examples included motion interpretations that did not establish sensor calibration.
xgamepad does not carry them forward as physical measurements.

## Native input

```js
import { createGamepadManager } from 'xgamepad';

const pads = createGamepadManager();
pads.on('state', ({ controller, state }) => {
    const x = state.axes.leftX;
    const y = state.axes.leftY;
    console.log(controller.id, x, y);
});
pads.on('error', ({ error }) => console.error(error));
await pads.start();
```

For byte-domain PS3 behavior with pressure-sensitive controls, choose the direct HID backend and, if
exact nominal positions are desired, `deadzone: 0`:

```js
import { createGamepadManager } from 'xgamepad';
import { createHIDBackend } from 'xgamepad/hid';

const pads = createGamepadManager({
    backend: createHIDBackend(),
    deadzone: 0,
});

pads.on('state', ({ state }) => {
    console.log(state.buttons.south.value);
});
pads.on('error', ({ error }) => console.error(error));
await pads.start();
```

This decoder uses a unit-circle stick domain even with deadzone zero. Direct HID
initialization/driver requirements are documented in [HID input](hid.md).

## Pixel projection

Signed axes can be projected into an application rectangle without using raw device byte offsets:

```js
const width = 1920;
const height = 1080;
const pixelX = ((state.axes.leftX + 1) / 2) * (width - 1);
const pixelY = ((state.axes.leftY + 1) / 2) * (height - 1);
```

Here width/height are pixels, not SI lengths; the result is a fractional pixel coordinate in
`[0, width - 1]` and `[0, height - 1]`. Round only when the renderer requires integer pixels.
Positive y points down, matching the public axis convention.

## Networking and recording

State snapshots are JSON-compatible. An application can serialize `{ id: controller.id, state }` to
its own transport. The library does not open a network port or retain user recordings. The CLI's
`watch --json` output is newline-delimited JSON with connection/input records.

An asynchronous stream can drop events under backpressure. Lossless recording of all host-observed
reports needs a synchronous `state` subscription and an application-defined buffering/storage
policy. `timestamp` refers to acquisition on one host; cross-host timing requires an explicit clock
synchronization model.
