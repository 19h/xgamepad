# Architecture and numerical model

## Data flow

```text
OS drivers / SDL          Browser Gamepad API          node-hid
       |                          |                        |
   SDL backend              Browser backend           HID profiles
       |                          |                        |
       +--------------------------+------------------------+
                                  |
                     connect / update / disconnect
                                  |
                           GamepadManager
                                  |
                    normalized, immutable snapshots
                                  |
             +--------------------+-------------------+
             |                    |                   |
       synchronous events    current state      bounded iterator
```

One backend instance belongs to one manager lifecycle. Backends identify and decode; the manager
applies shared normalization, owns controller identity, orders events, and validates output. No
ambient singleton, global report buffer, HTTP server, or implicit device open is involved.

## Backend contract

```js
const backend = {
    async start(sink) {
        sink.connect({
            id: 'custom:0',
            name: 'Measured input source',
            family: 'generic',
            capabilities: {
                axes: ['leftX', 'leftY'],
                buttons: ['south'],
                rumble: false,
            },
        });
        sink.update('custom:0', {
            axes: { leftX: 0, leftY: 0 },
            buttons: { south: false },
        });
    },
    async stop() {
        // Remove acquisition callbacks and release owned resources.
    },
};
```

`sink.connect(descriptor)` precedes updates. `sink.update(id, sample)` supplies a complete snapshot
in canonical names and normalized input ranges. `sink.disconnect(id)` removes that connection.
`sink.error(error, id?)` emits a recoverable error. Startup failures reject `start`; shutdown
failures reject `stop`. All sink methods are synchronous. Application callback exceptions also
propagate synchronously.

Manager lifecycle operations run through a promise queue. Each start receives a generation token.
After stop begins, callbacks carrying that token cannot mutate the manager, even if a native
callback was already queued. Device handles belong to the backend; controller snapshots belong to
the manager.

```text
start requested -> starting -> running -> stop requested -> stopping -> stopped
                      |
                      +-> startup failure -> backend cleanup -> stopped
```

Disconnect invalidates the old controller object permanently. A reconnection creates a new object
even when a backend reuses the same string ID. Rumble called through a retained old object verifies
object identity as well as ID.

## Normalization

All controls are dimensionless. Time values use seconds. There are no implicit degrees, sensor
acceleration units, or angular-velocity units in the public API.

For a Sony unsigned 8-bit stick sample `q`:

```text
q in [0, 255], center c = 128

x = (q - c) / 128, if q < c
x = (q - c) / 127, otherwise

q =   0 -> x = -1
q = 128 -> x =  0
q = 255 -> x = +1
```

This fixes the nominal digital center; it does not claim measured center is exactly 128 for every
physical stick. With nearest-integer quantization as an explicit model, quantization error is at
most `0.5 / 127 = 0.00394` on the positive side and `0.5 / 128 = 0.00391` on the negative side.
Physical noise, drift and calibration error are additional and unmeasured.

For unsigned 8-bit pressure `q`, `p = q / 255`. Under the same nearest-integer model the bound is
`0.5 / 255 = 0.00196`. Digital press bits remain independent; low pressure can therefore have
`pressed: true`.

Each stick then uses a radial deadzone with raw vector `(x, y)`, Euclidean length
`r = sqrt(x*x + y*y)`, and deadzone `d`:

```text
r <= d: output = (0, 0)
r >  d: output = (x, y) * (min(r, 1) - d) / ((1 - d) * r)
```

For example, `x = 0.6`, `y = 0`, `d = 0.2` yields `r = 0.6` and
`x_out = (0.6 - 0.2) / (1 - 0.2) = 0.5`. The result is continuous at the deadzone boundary,
direction-preserving outside it, and bounded by the unit circle. A diagonal larger than the unit
circle is saturated radially. The test suite sweeps a grid and verifies boundedness and odd symmetry
within floating-point tolerance.

For SDL trigger value `v` and measured initial offset `r0`, the mapping is
`clamp((v - r0) / (1 - r0), 0, 1)`. The initial posture assumption is detailed in
[compatibility](compatibility.md#native-axis-calibration). Browser values already use their Gamepad
API domains; the shared core checks finiteness and clamps them.

The host timestamp is `performance.now() / 1000`. Conversion from milliseconds to seconds has factor
`10^-3`; it is not a transport-latency estimate. A custom `now` function must maintain a monotonic
clock if consumers depend on that property.

## Change detection and delivery

Every observed sample commits state, including duplicate samples. Each control has a
last-emitted-change baseline. Analog differences exceeding `epsilon` emit changes; smaller steps
accumulate against that baseline. Press and touch transitions are never suppressed by epsilon. A
state event's `previous` field still refers to the immediately previous sample.

Events are synchronous and ordered; the manager does not await application listeners. Native input
reports can arrive faster than application storage or networking. The asynchronous iterator bounds
its queue and drops the oldest event on overflow. Its `dropped` count makes that loss observable. No
unbounded report archive exists inside the library.

The queue uses a JavaScript array: insertion is amortized constant time; removal or overflow
shifting is `O(capacity)`. Choosing a very large capacity increases both retained memory and shift
work. The default is 64 events.

## Computational bounds

Let `D` be enumerated devices, `P` configured HID profiles, `C` canonical controls (28: four axes
and 24 buttons), `L` listeners for an emitted event, and `Q` stream capacity.

| Operation                     | Time                        | Retained space                          |
| ----------------------------- | --------------------------- | --------------------------------------- |
| Normalize and diff one sample | `O(C)`                      | `O(C)` per retained snapshot            |
| Dispatch one event            | `O(L)`                      | `O(L)` temporary listener snapshot      |
| SDL/browser scan              | `O(D)` plus native API cost | `O(D)` device records                   |
| HID profile matching          | `O(D * P)`                  | `O(D)` device records                   |
| HID packet decode / CRC       | `O(n)` for `n` report bytes | `O(C)` decoded sample                   |
| One async stream              | At most `O(Q)` per shift    | `O(Q * C)` for distinct retained states |

Native enumeration cost includes OS work outside these JavaScript bounds. HID polling is opt-in so
callers can avoid repeated USB enumeration. Profile matching is bounded by the configured profile
count; there is no speculative brute-force protocol detection.

## Extension boundaries

SDL maps many devices but does not expose every raw feature through this binding. HID profiles
provide deterministic access to measured reports. Browser mappings operate only on controls the
browser supplies. None of these layers can recover a pressure channel that an adapter or driver
discarded.

Replay, recording, input remapping, and action binding can be implemented as application layers over
immutable states or as custom backends. They do not require changing native transport code. Examples
of scope implications are listed in [validation](validation.md#bounded-scope-observations).
