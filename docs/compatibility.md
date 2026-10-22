# Controller and platform compatibility

## What support means

The software implements the paths below. Successful input still requires the OS to enumerate the
device, an applicable driver/mapping, and permission to open it. Physical compatibility across all
listed models and firmware revisions has not been measured in this workspace. The exact evidence is
in [validation](validation.md); upstream references are in [references](references.md).

| Family                      | Default Node.js path   | Alternative                          | Boundary                                                        |
| --------------------------- | ---------------------- | ------------------------------------ | --------------------------------------------------------------- |
| PS2 / DualShock 2           | SDL-mapped USB adapter | Custom HID profile or browser mapper | Original console connector is not a USB HID interface           |
| PS3 / Sixaxis / DualShock 3 | SDL controller driver  | Direct Sony report decoder           | Activation, pairing, clones, and Windows driver mode can differ |
| PS4 / DualShock 4           | SDL controller driver  | Direct USB/Bluetooth decoder         | Core controls; raw full Bluetooth packets require valid CRC     |
| PS5 / DualSense / Edge      | SDL controller driver  | Direct USB/Bluetooth decoder         | Core buttons and sticks; advanced output is outside the API     |
| Xbox 360                    | SDL platform driver    | Browser standard mapping             | Receiver/USB transport must be exposed by OS/SDL                |
| Xbox One / Series           | SDL platform driver    | Browser standard mapping             | USB, Bluetooth, and wireless receiver support varies by host    |
| Other controllers           | SDL controller mapping | Explicit HID/browser mapping         | Family remains `generic` if identity is unknown                 |

The direct HID backend does not treat Microsoft's vendor-specific USB protocols as generic HID
reports. The default SDL backend supplies the Xbox transport integration. Original Xbox controllers
and arbitrary third-party clones do not have a specific compatibility claim here.

## Native operating systems

`@kmamal/sdl` supplies the platform bridge. Its install script obtains its native binary/SDL
runtime; see the pinned upstream documentation. This project uses the SDL2 binding series `0.11.x`,
not the incompatible SDL3 development API.

| Host    | Primary path                        | Deployment boundary                                     |
| ------- | ----------------------------------- | ------------------------------------------------------- |
| Windows | SDL platform controller APIs/HID    | Device driver, bitness, native binary availability      |
| macOS   | SDL platform APIs/HID               | OS controller exposure and HID access                   |
| Linux   | SDL platform APIs/input devices/HID | Device access permissions, input driver, native runtime |

No platform driver, Bluetooth pairing service, kernel module, udev rule, or system setting is
installed by xgamepad. An empty controller list does not prove the controller is unsupported: it can
indicate a missing mapping, inaccessible device, or unavailable driver.

## Native axis calibration

The pinned node-sdl implementation normalizes joystick axes relative to their initial position. Its
controller conversion can consequently report resting triggers at a nonzero value. xgamepad samples
both initial trigger values and maps each from `[rest, 1]` to `[0, 1]`.

This establishes a concrete acquisition assumption: sticks are centered and triggers are released
while a controller opens. Holding a control during initialization can bias the origin. Release
controls and reconnect/restart to resample. A trigger initialized at exactly `1` rejects that device
with a calibration error rather than dividing by zero.

For an independently characterized device, supply the binding-domain offsets:

```js
import { createGamepadManager, createSDLBackend } from 'xgamepad';

const pads = createGamepadManager({
    backend: createSDLBackend({
        triggerRest(device) {
            // Example for a measured binding that already rests at zero.
            // Replace with measurements for this device/driver combination.
            console.log(device.guid);
            return { left: 0, right: 0 };
        },
    }),
});
```

This callback corrects trigger offsets only. It does not undo arbitrary analog stick calibration
inside SDL's JavaScript binding. The direct Sony HID backend uses explicit byte-domain normalization
and has no initial-position calibration.

## PS2 USB adapters

PS2 adapter protocols vary. Some adapters report as PS3-compatible devices; others expose generic
joysticks, different button orders, or multiple ports. Analog/digital mode can change the available
axes. Pressure values survive only if the adapter's own protocol exposes them.

For an SDL-supported adapter, plug it in, select analog mode where applicable, and run
`node bin/xgamepad.js list`. If it has no mapping, inspect joystick metadata using the upstream SDL
API:

```js
import sdl from '@kmamal/sdl';

console.log(sdl.joystick.devices);
```

SDL mapping records contain a GUID, name, and physical bindings. Example syntax:

```text
<device-guid>,<adapter-name>,a:b2,b:b1,x:b3,y:b0,back:b8,start:b9,leftshoulder:b4,rightshoulder:b5,lefttrigger:b6,righttrigger:b7,leftstick:b10,rightstick:b11,leftx:a0,lefty:a1,rightx:a3,righty:a4,dpup:h0.1,dpright:h0.2,dpdown:h0.4,dpleft:h0.8,
```

The placeholders and index assignments are illustrative, not a universal PS2 mapping. Identify each
button, axis, and hat on the actual adapter. In SDL notation `bN` is a button, `aN` an axis, and
`hN.mask` a hat. Axis polarity and half-axis syntax are defined by SDL. Feed measured records to
`mappings` or run:

```sh
node examples/ps2-adapter.js /path/to/measured-mappings.txt
```

For known adapters, metadata can label the physical controller:

```js
const backend = createSDLBackend({
    mappings,
    mapDevice(device) {
        if (device.guid === measuredAdapterGuid) {
            return { family: 'ps2', name: 'DualShock 2 via measured adapter' };
        }
        return {};
    },
});
```

`mappings` and `measuredAdapterGuid` are application-supplied values. A generic adapter's name does
not establish that a PS2 controller is physically attached.

## Browser exposure

The browser backend polls `navigator.getGamepads()` with `requestAnimationFrame`. Use a context
where the browser permits that API. A focused page and controller interaction may be required before
the device appears. Embedded pages may need an applicable Permissions Policy. Animation-frame
suspension in background tabs can suspend state updates.

Only `mapping === 'standard'` receives an automatic mapping. Browser extra buttons are not assigned
speculative meanings. Nonstandard adapters require an explicit `mapGamepad`, for example after
measuring the adapter's button order:

```js
import { createGamepadManager, createBrowserBackend } from 'xgamepad/browser';

const pads = createGamepadManager({
    backend: createBrowserBackend({
        mapGamepad(gamepad) {
            if (gamepad.id !== measuredAdapterId) {
                return null;
            }
            return {
                axes: { leftX: gamepad.axes[0], leftY: gamepad.axes[1] },
                buttons: { south: gamepad.buttons[2].value },
            };
        },
    }),
});
```

Here `measuredAdapterId` and the indices belong to the application. Returning null falls back to
standard mapping when available, otherwise emits `UNMAPPED_DEVICE` once per observed attachment.
Pure polling cannot distinguish a disconnect/reconnect that occurs entirely between samples with
identical ID and index.

## Troubleshooting

| Observation                        | Discriminating check                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `BACKEND_UNAVAILABLE`              | Install the named optional dependency; inspect its native install log                           |
| Empty SDL list                     | Compare `sdl.joystick.devices` with `sdl.controller.devices`; unmatched joysticks need mappings |
| `OPEN_FAILED`                      | Inspect `error.cause`; check device access and competing exclusive owners                       |
| Resting triggers appear pressed    | Check initialization posture and measured `triggerRest`                                         |
| Wrong PS2 buttons                  | Verify adapter port, analog mode, GUID and every mapping index                                  |
| HID opens but never produces input | Check activation/driver mode and report access; see HID documentation                           |
| Xbox missing from HID              | Use SDL; the direct backend has no built-in Xbox profile                                        |
| Browser finds nothing              | Check focus, user interaction, permissions and OS exposure                                      |
| Motion absent                      | IMU and touch coordinates are not exposed by this API                                           |
| Stream misses transitions          | Inspect `stream.dropped`; use synchronous listeners for complete observed edges                 |

Two managers/backends opening one physical controller can produce duplicate events and competing
rumble. A single manager with multiple application subscriptions shares one acquisition lifecycle.
