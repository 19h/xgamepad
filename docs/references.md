# Primary references

The implementation uses protocol facts and public API behavior from the sources below. It does not
copy driver implementation code into this project. Stable version links distinguish the implemented
layout from later upstream changes.

| Source                                                                                                                        | Used for                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [node-sdl v0.11.13 API](https://github.com/kmamal/node-sdl/blob/v0.11.13/README.md)                                           | SDL controller discovery, event shapes, normalized axes, rumble, mappings       |
| [node-sdl controller conversion](https://github.com/kmamal/node-sdl/blob/v0.11.13/src/native/controller.cpp)                  | Controller axis conversion through joystick mapping                             |
| [node-sdl joystick conversion](https://github.com/kmamal/node-sdl/blob/v0.11.13/src/native/joystick.cpp)                      | Initial-position normalization and trigger calibration boundary                 |
| [node-hid v3.4.0](https://github.com/node-hid/node-hid/tree/d3660efb37c15f20e2f50e38f4304592d27d985f)                         | Asynchronous enumeration/open/read/close and enumeration costs                  |
| [Linux v6.12 hid-playstation.c](https://github.com/torvalds/linux/blob/v6.12/drivers/hid/hid-playstation.c)                   | DualShock 4 / DualSense report structures, offsets, report IDs, CRC seed        |
| [Linux v6.12 hid-sony.c](https://github.com/torvalds/linux/blob/v6.12/drivers/hid/hid-sony.c)                                 | Sixaxis/DualShock 3 operational-mode and driver boundaries                      |
| [SDL release-2.30.11 PS3 driver](https://github.com/libsdl-org/SDL/blob/release-2.30.11/src/joystick/hidapi/SDL_hidapi_ps3.c) | Standard Sony PS3 buttons, stick and pressure offsets, invalid reports          |
| [SDL release-2.30.11 PS5 driver](https://github.com/libsdl-org/SDL/blob/release-2.30.11/src/joystick/hidapi/SDL_hidapi_ps5.c) | Simple versus full DualSense packet layouts, including 78-byte simple packets   |
| [W3C Gamepad Working Draft, 10 July 2025](https://www.w3.org/TR/2025/WD-gamepad-20250710/)                                    | Browser standard mapping, button/axis domains, permissions and haptic interface |
| [SDL2 mapping format](https://wiki.libsdl.org/SDL2/SDL_GameControllerAddMapping)                                              | Adapter GUID and axis/button/hat mapping syntax                                 |

The W3C document is a Working Draft, not a claim of identical implementation in every browser.
Vendor IDs, product IDs, and reported names identify candidate layouts; they do not establish
physical authenticity or exhaustive firmware coverage. Hardware tests remain distinct from
source-backed protocol parsing.

The source project is [PS3.js](https://github.com/KenanSulayman/PS3.js), authored by Kenan Sulayman.
Its controller-reading purpose informed the rewrite; its global variables, polling examples, and
legacy dependencies were replaced.
