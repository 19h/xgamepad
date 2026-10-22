# Direct HID input and report profiles

## Usage

```js
import { createGamepadManager } from 'xgamepad';
import { createHIDBackend } from 'xgamepad/hid';

const backend = createHIDBackend();
const pads = createGamepadManager({ backend });

pads.on('error', ({ error, id }) => console.error(id, error));
pads.on('state', ({ state }) => {
    console.log(state.buttons.south.value);
});
await pads.start();

// Explicitly discover later attachments when periodic scanning is disabled.
await backend.refresh();

// At application shutdown:
await pads.stop();
```

The backend uses the asynchronous node-hid API. Each OS HID path becomes one controller. Built-in
matching checks known Sony VID/PIDs and excludes unrelated HID usages when those fields are
available. Paths are platform-specific and not persistent identifiers. Two nodes for one physical
device can still produce two controllers when the OS exposes equivalent interfaces without
discriminating metadata.

## Options

| Option         | Default        | Meaning                                                |
| -------------- | -------------- | ------------------------------------------------------ |
| `profiles`     | `[]`           | Custom profiles searched before built-in Sony profiles |
| `pollInterval` | `0`            | Discovery interval in seconds; zero disables the timer |
| `nonExclusive` | `true`         | Passed to node-hid; affects macOS device opening       |
| `initialize`   | Absent         | Awaited callback `(handle, device)` after open         |
| `hid`          | Dynamic import | Injected node-hid-shaped module for tests              |

Nonzero discovery intervals must be at least 0.25 s and at most 3600 s. This is enumeration
scheduling, not the input report rate. Reports themselves are event driven. Periodic enumeration can
impose USB/OS cost; the native module documents that behavior. `refresh()` serializes scans and also
retries previously failed opens. A data error closes the affected handle, emits `READ_FAILED`, and
allows a future scan to reopen it.

The backend is input-only. It does not send rumble, LED, adaptive-trigger, audio, or pairing
commands. The explicit initialization hook is the only built-in route for application-supplied
feature operations.

## PS3 activation

Some PS3 stacks require a feature request to enter operational mode; other OS drivers already handle
it. There is no automatic transport guess in xgamepad. For a characterized USB DualShock 3 setup
that needs the request:

```js
const backend = createHIDBackend({
    async initialize(handle, device) {
        if (device.vendorId === 0x054c && device.productId === 0x0268) {
            await handle.getFeatureReport(0xf2, 17);
        }
    },
});
```

This example assumes that the selected Sony path is the USB input interface. Bluetooth activation
and clone-specific sequences differ; this callback is not a universal PS3 pairing solution. Upstream
Linux and SDL source describe the different initialization paths. The default SDL backend handles
its supported activation/transport modes itself.

## Pure decoder

`decodePlayStationReport(family, bytes)` accepts `ps3`, `ps4`, or `ps5` and a nonempty `Uint8Array`
including its report ID. Node `Buffer` is accepted as a `Uint8Array`. It returns a canonical,
unfiltered `Sample`; the manager later applies deadzones, immutable state and event semantics.

Unknown report IDs and PS3 invalid-data packets return `null`. A recognized but malformed report
throws `GamepadError`. Stripping the report ID before calling the decoder changes offsets and is not
supported.

| Family | Report ID | Accepted byte count | Payload start | Interpretation               |
| ------ | --------- | ------------------- | ------------- | ---------------------------- |
| PS3    | `0x01`    | 49 or 64            | Sticks at 6   | Standard Sony input          |
| PS4    | `0x01`    | 64                  | 1             | USB full input               |
| PS4    | `0x01`    | 10                  | 1             | Simple Bluetooth input       |
| PS4    | `0x11`    | 78                  | 3             | Full Bluetooth, CRC required |
| PS5    | `0x01`    | 64                  | 1             | USB full input               |
| PS5    | `0x01`    | 10 or 78            | 1             | Simple Bluetooth input       |
| PS5    | `0x31`    | 78                  | 2             | Full Bluetooth, CRC required |

Simple PS5 reports use the PS4-style ordering for basic controls. The PS5 full report places
triggers before the button bytes. Confusing these variants yields apparently plausible but incorrect
controls, so layouts are selected by family, report ID, and size rather than by length alone.

Full Bluetooth reports carry a little-endian CRC in the final four bytes. Verification uses
reflected CRC-32/ISO-HDLC, polynomial `0xEDB88320`, initial register `0xFFFFFFFF`, final XOR
`0xFFFFFFFF`, and a leading `0xA1` input-report seed before the bytes preceding the checksum.
Corruption rejects the entire sample without changing controller state. This checks transport
integrity; it is not cryptographic authentication.

## PS3 pressure channels

Offsets include the report ID. Digital button bits independently determine `pressed`, while the
following bytes determine `value = byte / 255`:

| Offsets        | Canonical names                               |
| -------------- | --------------------------------------------- |
| 14, 15, 16, 17 | `dpadUp`, `dpadRight`, `dpadDown`, `dpadLeft` |
| 18, 19         | `leftTrigger`, `rightTrigger`                 |
| 20, 21         | `leftShoulder`, `rightShoulder`               |
| 22, 23, 24, 25 | `north`, `east`, `south`, `west`              |

The old PS3.js comments contained inconsistent byte offsets. This rewrite uses the layouts
corroborated by upstream SDL/Linux rather than retaining those comments. Raw IMU bytes are not
exposed as degrees or acceleration: physical units would require calibration and axis conventions
not implemented here.

## Custom profiles, including PS2 adapters

A profile implements `id`, `match(device)`, and `decode(report, device)`. `describe(device)` can
specify family, name, and capabilities. Functions must be synchronous; an ignored report returns
`null`. Matching is first-match-wins, with custom profiles before built-ins.

This deliberately incomplete hardware example defines a hypothetical measured two-byte adapter
protocol. It is executable as a profile, but its identifiers and report layout are not a claim about
an existing adapter:

```js
const measuredProfile = {
    id: 'measured-ps2-adapter',
    match(device) {
        return device.vendorId === measuredVendorId && device.productId === measuredProductId;
    },
    describe() {
        return {
            family: 'ps2',
            capabilities: { axes: [], buttons: ['south'], rumble: false },
        };
    },
    decode(report) {
        if (report[0] !== 1) {
            return null;
        }
        if (report.length !== 2) {
            throw new Error('Invalid measured adapter report length');
        }
        return { buttons: { south: Boolean(report[1] & 1) } };
    },
};

const backend = createHIDBackend({ profiles: [measuredProfile] });
```

`measuredVendorId` and `measuredProductId` are application inputs, not allocated USB IDs supplied by
the library. A production profile defines its exact accepted lengths, IDs, axis ranges, polarity,
pressure semantics and any checksum before returning normalized values. Use a complete snapshot on
every update; the manager does not merge missing controls from older reports.
