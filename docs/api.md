# API reference

## Entry points

| Import             | Exports                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `xgamepad`         | Core types/classes, `createGamepadManager`, `createSDLBackend`                                               |
| `xgamepad/browser` | Core types/classes, browser-default `createGamepadManager`, `createBrowserBackend`, `standardGamepadMapping` |
| `xgamepad/hid`     | `createHIDBackend`, `decodePlayStationReport`, `playStationProfiles`                                         |

The root export has a browser condition for compatible bundlers. Use the explicit browser entry
point when code must have no native dependency path. All modules use ESM. Native modules load
dynamically at backend startup; importing xgamepad does not enumerate or open devices. The published
file set includes TypeScript declarations; no transpilation is required.

## `createGamepadManager(options?)`

Returns a `GamepadManager`. Node.js defaults to a fresh SDL backend; the browser entry point
defaults to a fresh browser backend. `new GamepadManager(options)` is also exported and requires an
explicit backend.

| Option            | Default                    | Meaning                                        |
| ----------------- | -------------------------- | ---------------------------------------------- |
| `backend`         | Environment default        | Object implementing the backend contract       |
| `deadzone`        | `0.12`                     | Radial stick deadzone; finite, `0 <= d < 1`    |
| `buttonThreshold` | `0.5`                      | Fallback press threshold; finite, `0 <= t < 1` |
| `epsilon`         | `0.001`                    | Analog change threshold; finite, `0 <= e <= 1` |
| `now`             | `performance.now() / 1000` | Clock returning monotonic seconds              |

An explicitly supplied button `pressed` flag takes precedence over `buttonThreshold`. This preserves
physical digital switches on PS3 pressure buttons and browser-provided press semantics. Fallback
values are pressed when `value > buttonThreshold`, not at equality.

`epsilon` applies to changes relative to each control's last reported change. Small movements
therefore accumulate until they exceed the threshold. Boolean press/touch transitions always count
as changes. Normalized snapshots continue to update even when no `change` event is emitted.

## Lifecycle and lookup

### `await manager.start()`

Enumerates controllers and starts input processing. Resolves to the manager. Connected devices can
emit `connect` and initial `state` events before this promise resolves: subscribe before starting.
Concurrent lifecycle requests are serialized in call order. Calling `start` on a running manager
does nothing.

A startup failure attempts backend cleanup, disconnects any partially opened controllers, resets the
manager to `stopped`, and rejects. If startup and cleanup both fail, the rejection is an
`AggregateError` preserving both causes.

An individual device that cannot open emits `error` without preventing other devices from opening.
An unsupported/unmapped device does not get a controller object. No connected devices is a
successful empty start.

### `await manager.stop()`

Stops acquisition, closes owned resources, invalidates all controller objects, and emits
`disconnect` events followed by `stop`. Repeated calls do nothing once stopped. Callback traffic
from an earlier lifecycle generation is ignored. Managers can start again with new controller
objects. Native cleanup errors reject the promise; controller state is still invalidated.

`await manager[Symbol.asyncDispose]()` is equivalent to `stop`. TypeScript users of this method need
`ESNext.Disposable` in their configured libraries.

### Properties

| Member                  | Meaning                                                 |
| ----------------------- | ------------------------------------------------------- |
| `manager.status`        | `stopped`, `starting`, `running`, or `stopping`         |
| `manager.controllers`   | Frozen array snapshot of connected `Controller` objects |
| `manager.get(id)`       | Current controller or `undefined`                       |
| `controller.id`         | Backend-scoped device identifier                        |
| `controller.descriptor` | Frozen device metadata and capabilities                 |
| `controller.state`      | Latest frozen state snapshot                            |
| `controller.connected`  | False permanently after this object disconnects         |

IDs are connection identifiers, not persistent hardware serial numbers. `sdl:<instance>`,
`browser:<index>`, and `hid:<path>` can be reused after disconnection. Retained old controller
objects cannot rumble a newly connected device that happens to reuse an ID.

## Device metadata

```js
{
    id: 'sdl:1',
    name: 'Controller',
    family: 'ps5',
    transport: 'sdl',
    vendorId: 1356,
    productId: 3302,
    mapping: null,
    capabilities: {
        rumble: true,
        pressure: false,
        axes: ['leftX', 'leftY', 'rightX', 'rightY'],
        buttons: ['south', 'east'],
    },
}
```

The example is a schema illustration, not a captured device. `family` is `ps2`, `ps3`, `ps4`, `ps5`,
`xbox`, or `generic`. Identification uses known Sony VID/PIDs, SDL types, and reported names. It
does not authenticate hardware. Unknown adapters remain `generic` unless explicitly described.

`transport` identifies the acquisition backend (`sdl`, `browser`, or `hid`), not the physical link.
These APIs do not consistently expose USB versus Bluetooth. `vendorId`, `productId`, and `mapping`
are `null` when unavailable. `pressure` means analog face/directional/shoulder channels beyond
ordinary triggers.

## Snapshots and controls

`State` contains `sequence`, `timestamp`, `axes`, and `buttons`. Sequence starts at zero for the
synthetic neutral state and advances for each accepted sample. `timestamp` is acquisition time in
monotonic seconds, not device time, UTC, or time since the physical switch closed. Host scheduling
can delay acquisition.

All snapshots and their nested objects are frozen. Keeping an old snapshot is safe; subsequent
samples allocate new state. Every sample is complete: missing controls become neutral. A backend
sending partial deltas must merge them before calling `sink.update`.

| Axes              | Range     | Direction                     |
| ----------------- | --------- | ----------------------------- |
| `leftX`, `rightX` | `[-1, 1]` | Negative left, positive right |
| `leftY`, `rightY` | `[-1, 1]` | Negative up, positive down    |

Radial deadzone processing limits each stick to the unit circle. A raw diagonal `(1, 1)` becomes
approximately `(0.707107, 0.707107)` even with deadzone zero. See
[the equations](architecture.md#normalization) if square-domain input is needed elsewhere in your
application.

| Button names                                  | Physical controls                                            |
| --------------------------------------------- | ------------------------------------------------------------ |
| `south`, `east`, `west`, `north`              | Face buttons in those positions                              |
| `leftShoulder`, `rightShoulder`               | L1/R1 or LB/RB                                               |
| `leftTrigger`, `rightTrigger`                 | L2/R2 or LT/RT, including analog value                       |
| `back`, `start`                               | Select/Share/Create/View and Start/Options/Menu              |
| `leftStick`, `rightStick`                     | Stick clicks                                                 |
| `dpadUp`, `dpadDown`, `dpadLeft`, `dpadRight` | Directional pad                                              |
| `home`                                        | PS/Guide                                                     |
| `touchpad`, `mute`                            | Optional PlayStation clicks                                  |
| `share`                                       | Separate share control where an explicit mapping exposes one |
| `paddle1` through `paddle4`                   | Optional paddles where the backend exposes them              |

All names are exported as frozen `BUTTONS`; `AXES` contains the four stick names. Every button is
`{ value, pressed, touched }`. `value` is dimensionless in `[0, 1]`. When touch information is
absent, `touched` mirrors `pressed`. This does not imply capacitive hardware. Backend capability
arrays distinguish unavailable controls from neutral available controls. The browser standard mapper
exposes only the first 17 standard buttons; extra controls need `mapGamepad`.

Finite out-of-range input is clamped. Nonfinite values reject the sample with `INVALID_SAMPLE`
before state is committed. Custom backends must handle invalid input or route failures to
`sink.error`.

## Subscriptions and events

`manager.on(name, listener, { signal }?)` and `controller.on(...)` return an unsubscribe function.
`once` removes the subscription before invoking it. Aborting a signal removes associated listeners.
An already aborted signal adds no subscription. Listener callbacks run synchronously in registration
order; their exceptions propagate after the other listeners for that event have run. A listener
failure interrupts later event types for that sample, but does not prevent shutdown from cleaning up
other controllers. Async listeners are not awaited: handle their rejections inside the listener. No
listener is required for `error`; it does not have Node's special unhandled-error throwing behavior.

| Event                    | Available on | Payload beyond `controller`                                   |
| ------------------------ | ------------ | ------------------------------------------------------------- |
| `connect`                | Manager      | None                                                          |
| `state`                  | Both         | `state`, `previous`                                           |
| `buttondown`, `buttonup` | Both         | `state`, `previous`, `button`, `value`                        |
| `button`                 | Both         | `state`, `previous`, `button`, `value`                        |
| `axis`                   | Both         | `state`, `previous`, `axis`, numeric `value`                  |
| `change`                 | Both         | `state`, `previous`, changed `axes` and `buttons` name arrays |
| `disconnect`             | Both         | Last `state`                                                  |
| `error`                  | Manager      | `error`, optional `id`; no controller required                |
| `stop`                   | Manager      | Empty object                                                  |

For a sample, state is committed first, then events follow this order:

```text
state
  -> buttondown/buttonup and button (each changed button in BUTTONS order)
  -> axis (each changed axis in AXES order)
  -> change (if anything changed)
```

For each event, the controller's listeners run before the manager's listeners. `previous` is the
immediately previous snapshot, even when the epsilon baseline comes from an older change. Disconnect
does not synthesize button releases; applications maintaining independent held-button state can
clear it on `disconnect`.

### `manager.events(type = 'change', options?)`

Returns an async iterator with `dropped`. Options are `signal` and `capacity` (positive safe
integer, default 64). It subscribes immediately. Create it after `start`, or while startup is
already in progress. A stream created while stopped is immediately closed. Stop, abort, iterator
`return`, or a `for await` break removes its subscriptions. Only one `next()` can be pending.

At capacity, a new event replaces the oldest queued event and increments `dropped`. Streams are
bounded live feeds, not lossless recordings. Their default policy favors fresh input; consumers
needing every edge use synchronous subscriptions. Stop/abort discards pending queued events.

## Rumble

`await controller.rumble({ low = 1, high = 1, duration = 0.2 } = {})` or
`await manager.rumble(id, options)` requests dual-motor output. `low` and `high` are dimensionless
magnitudes in `[0, 1]`; `duration` is seconds in `[0, 60]`. `{ low: 0, high: 0 }` requests no motor
force. The output request is not an assertion of measured force. SDL resolves when the request has
been sent; browser effects resolve according to the browser's completion/preemption semantics.

Input-only HID rejects rumble. Adaptive trigger resistance, HD haptic audio, lightbar control,
sensor calibration, and microphone control are not implemented.

## Backend factories

### `createSDLBackend(options?)`

- `mappings`: array of SDL2 mapping strings, registered before enumeration.
- `mapDevice(device)`: metadata/capability overrides, excluding the managed ID.
- `triggerRest(device)`: explicit `{ left, right }` rest offsets in the binding's axis domain.
  Defaults to initial observed values. Each must be finite in `[-1, 1)`.
- `sdl`: injected SDL-shaped object for tests; omitted in applications.

SDL mappings are global to the loaded SDL module. Each backend owns its opened handles and
subscriptions; it does not shut down SDL used by another application component. Creating separate
managers for the same devices can deliver duplicate input and competing output.

### `createBrowserBackend(options?)`

- `mapGamepad(gamepad)`: returns a complete `Sample`, or null/undefined to try the built-in standard
  mapper. Required for nonstandard layouts.
- `mapDevice(gamepad)`: metadata/capability overrides.
- `navigator`, `requestFrame`, `cancelFrame`: dependency injection for tests or embedding. Defaults
  to browser globals.

The backend copies fresh state each animation frame. It does not retain browser Gamepad objects
between frames. Background-tab scheduling is browser-controlled. `standardGamepadMapping(gamepad)`
is also exported as a pure converter.

### `createHIDBackend(options?)`

See [HID documentation](hid.md) for all options, `refresh`, profiles, report sizes, and the
distinction between input parsing and device activation.

## Error codes

| Code                  | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `BACKEND_UNAVAILABLE` | Required module or browser API unavailable                              |
| `ALREADY_STARTED`     | One backend instance attached to more than one lifecycle                |
| `OPEN_FAILED`         | Device could not open or initialize; inspect `cause`                    |
| `READ_FAILED`         | HID input failed; affected device is disconnected                       |
| `ACCESS_DENIED`       | Browser refused access                                                  |
| `UNMAPPED_DEVICE`     | Browser layout lacks an explicit/standard mapping                       |
| `INVALID_DEVICE`      | Invalid custom device descriptor                                        |
| `INVALID_SAMPLE`      | Invalid normalized sample or mapper failure                             |
| `INVALID_REPORT`      | Malformed recognized HID report                                         |
| `CRC_MISMATCH`        | Corrupted full Bluetooth input report                                   |
| `CALIBRATION`         | SDL trigger rest cannot be normalized; usually wrapped by `OPEN_FAILED` |
| `UNSUPPORTED`         | Feature/family unsupported by selected backend                          |
| `DISCONNECTED`        | Output target no longer connected                                       |
| `OUTPUT_FAILED`       | Browser returned an unknown output completion result                    |

Argument range failures use `RangeError`; wrong argument types use `TypeError`. Dependency and OS
errors may appear as original causes/rejections. Do not match human-readable messages as a stable
protocol. `GamepadError` extends `Error` and preserves standard `cause` when supplied.
