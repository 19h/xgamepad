# xgamepad

A modern JavaScript controller API for Node.js and browsers. One state model for PlayStation 2,
PlayStation 3, PlayStation 4, PlayStation 5, and Xbox controllers.

Native input uses SDL's controller mappings and platform drivers. Direct Sony HID input is available
for applications that need PS3 pressure values or deterministic report decoding. Browser input uses
the Gamepad API.

## Features

- ES modules, asynchronous lifecycle, private implementation state, and TypeScript declarations. No
  device access at import time.
- Multiple controllers, connection/disconnection events, immutable snapshots, button edges, analog
  values, radial stick deadzones, and change filtering.
- Removable subscriptions, `AbortSignal`, bounded asynchronous event streams, and explicit resource
  cleanup.
- Dual-motor rumble where the selected backend and device expose it.
- Custom SDL mappings, browser mappings, and HID profiles for adapters and unusual controllers.
- Four-space source formatting, ESLint, Prettier, deterministic tests, and documented protocol
  boundaries.

## Controller coverage

| Controller                  | Native SDL backend                                     | Direct HID backend                             | Browser backend                     |
| --------------------------- | ------------------------------------------------------ | ---------------------------------------------- | ----------------------------------- |
| PS2 / DualShock 2           | USB adapter with an SDL mapping                        | Custom adapter profile                         | Standard mapping or explicit mapper |
| PS3 / Sixaxis / DualShock 3 | Through an available SDL/OS driver                     | Sony input reports and pressure channels       | When the browser/OS exposes it      |
| PS4 / DualShock 4           | Through SDL/OS                                         | USB and Bluetooth input reports                | Standard mapping or explicit mapper |
| PS5 / DualSense / Edge      | Through SDL/OS                                         | USB and Bluetooth input reports; core controls | Standard mapping or explicit mapper |
| Xbox 360 / One / Series     | Through SDL/OS, including native controller transports | No built-in Xbox HID profile                   | Standard mapping or explicit mapper |

This is implemented software coverage, not a claim of physical testing on every controller/OS
combination. A PS2 controller needs an adapter; adapters do not share one universal report format.
Xbox transport availability depends on the OS and driver. See [compatibility](docs/compatibility.md)
for exact boundaries and [validation](docs/validation.md) for evidence.

## Install and run

Requires Node.js 22.13 or later for native use.

```sh
cd ~/dev/xgamepad
npm ci
node bin/xgamepad.js list
node bin/xgamepad.js watch
```

To use this local project from another Node.js project:

```sh
npm install /absolute/path/to/xgamepad
```

The project is not assumed to be published to npm. Native dependencies are optional: the JavaScript
core and browser entry point work without them. If a native dependency could not install, install
the needed backend explicitly:

```sh
npm install @kmamal/sdl@~0.11.13
npm install node-hid@^3.4.0
```

## Node.js quick start

```js
import { createGamepadManager } from 'xgamepad';

const pads = createGamepadManager({ deadzone: 0.12 });

pads.on('error', ({ error, id }) => {
    console.error(id, error.code, error.message);
});

pads.on('connect', ({ controller }) => {
    console.log(controller.id, controller.descriptor.family);
});

pads.on('buttondown', ({ controller, button, state }) => {
    if (button === 'south') {
        console.log(controller.id, 'confirm', state.axes.leftX);
    }
});

await pads.start();

// When your application shuts down:
// await pads.stop();
```

Keep native sticks centered and triggers released while connecting. The SDL binding establishes its
axis origin at initialization; xgamepad compensates for the initial trigger offset. See
[calibration](docs/compatibility.md#native-axis-calibration).

## Browser quick start

```js
import { createGamepadManager } from 'xgamepad/browser';

const pads = createGamepadManager();
pads.on('change', ({ controller, state }) => {
    console.log(controller.id, state.axes, state.buttons.south);
});
pads.on('error', ({ error }) => console.error(error));
await pads.start();
```

Serve the included monitor from this directory:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/examples/browser.html`, focus the page, and press a controller button.
The example imports the browser module directly and needs no bundler. Browser permissions,
secure-context rules, user activation, and platform mapping support still apply.

## State and names

Every controller exposes `controller.state`:

```js
{
    sequence: 1,
    timestamp: 12.345, // Monotonic seconds, local to this process/page.
    axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
    buttons: {
        south: { value: 1, pressed: true, touched: true },
        // Every canonical button is present; unavailable controls remain neutral.
    },
}
```

Sticks use `[-1, 1]`; left/up are negative. Buttons and triggers use `[0, 1]`. Names describe
physical positions so application bindings can span controller families:

| Name                            | PlayStation                        | Xbox                  |
| ------------------------------- | ---------------------------------- | --------------------- |
| `south`                         | Cross                              | A                     |
| `east`                          | Circle                             | B                     |
| `west`                          | Square                             | X                     |
| `north`                         | Triangle                           | Y                     |
| `leftShoulder`, `rightShoulder` | L1, R1                             | LB, RB                |
| `leftTrigger`, `rightTrigger`   | L2, R2                             | LT, RT                |
| `back`, `start`                 | Select/Share/Create, Start/Options | Back/View, Start/Menu |
| `home`                          | PS                                 | Guide                 |

Check `controller.descriptor.capabilities` before using optional controls or output. A neutral value
alone does not prove a control exists.

## Rumble and streams

```js
const controller = pads.controllers[0];
if (controller?.descriptor.capabilities.rumble) {
    await controller.rumble({ low: 0.4, high: 0.2, duration: 0.15 });
}
```

Duration is in seconds. Unsupported output rejects with `GamepadError` code `UNSUPPORTED`. The
direct HID backend is input-only.

```js
const abort = new AbortController();
const events = pads.events('change', { signal: abort.signal, capacity: 64 });

try {
    for await (const { controller, state } of events) {
        console.log(controller.id, state);
    }
} finally {
    await pads.stop();
}
```

Call `abort.abort()` to end the stream. Slow consumers drop oldest queued events; `events.dropped`
counts them. Use synchronous subscriptions when every transition must be observed.

## Documentation

- [API reference](docs/api.md): lifecycle, options, every event, state, errors.
- [Compatibility and setup](docs/compatibility.md): operating systems, PS2 adapters, Xbox
  transports, calibration, troubleshooting.
- [HID reports and profiles](docs/hid.md): packet boundaries, pressure, CRC, activation, custom
  adapter implementation.
- [Architecture](docs/architecture.md): backend contract, event flow, numerical conventions,
  complexity, resource ownership.
- [Migration from PS3.js](docs/migration.md): replacing globals and polling.
- [Validation](docs/validation.md): assumptions, evidence, limitations, physical acceptance
  procedure, quality gates.
- [Primary references](docs/references.md): source implementations and standards.

## Development

```sh
npm run check
npm run test:coverage
npm run format
npm pack --dry-run
```

`check` runs linting, formatting verification, declaration compilation, and the hardware-independent
test suite. See [examples](examples/) for native monitoring, asynchronous streams, a browser
monitor, and adapter mappings.

This is a new implementation inspired by
[PS3.js](https://github.com/19h/PS3.js). It does not retain its global
variables or legacy server dependencies. New code is [MIT licensed](LICENSE).
