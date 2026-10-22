# Validation and assumptions

## Evidence boundary

The implementation includes tests for the common state API, synthetic HID packets, and injected
SDL/browser/HID backends. This proves behavior against those inputs. It does not prove electrical,
radio, firmware, driver, or browser compatibility for an untested physical controller.

During creation, both optional native modules loaded on macOS arm64. The SDL and HID CLI
enumerations completed successfully and found zero matching controllers. No physical button,
pressure, wireless, vibration, latency, or reconnection test was possible with that inventory.
Windows/Linux native operation and interactive browser input were not exercised on this host.

The test suite was also run under the minimum declared Node.js version, 22.13.0. Tests inject
backends and do not require controller hardware or native modules. The CI workflow covers Node.js 22
and 24 on Windows, macOS and Linux for these software checks; a configured workflow is not evidence
of a completed CI run.

## Reproduce the checks

```sh
npm ci
npm run check
npm run test:coverage
npm pack --dry-run
node bin/xgamepad.js list --json
node bin/xgamepad.js list --backend hid --json
```

`check` runs ESLint, formatting verification, TypeScript consumer compilation and the test suite.
Coverage quantifies exercised software lines/branches, not physical compatibility. A fresh install
with `npm ci --omit=optional` can run the same unit checks without downloading native binaries.

Native dependency installation, source tests, packaged import tests, actual hardware, and live
browser tests are separate evidence categories.

## Assumption register

| ID  | Assumption                                                                             | Dependent result                                     | Falsification/stress probe                                                                                        |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A1  | Node.js remains a primary target because the source project is a Node HID wrapper      | Default SDL backend and native CLI                   | Install the packed module in a clean Node project; browser-only consumers use the separate entry point            |
| A2  | SDL/OS exposes the selected controller as a mapped controller                          | Native PS2/PS3/PS4/PS5/Xbox input                    | Compare raw joystick and mapped controller inventories; test each transport and firmware separately               |
| A3  | Native sticks are centered and triggers released at open                               | Initial-origin SDL normalization                     | Hold each control during open, then release; compare against measured trigger offsets or direct Sony HID          |
| A4  | Adapter mappings are measured for the actual device, port and mode                     | Correct PS2 semantics                                | Press one control at a time; repeat for both ports and analog/digital modes; reject mismatched GUIDs              |
| A5  | Built-in Sony HID layouts match original-compatible firmware and include the report ID | Direct report decoding                               | Capture one report per independent control; verify exact length, ID, offsets and CRC; test clones separately      |
| A6  | The browser marks a layout `standard` truthfully, or a supplied mapper is correct      | Browser semantic mapping                             | Compare physical labels against all 17 standard slots and four axes; test malformed and sparse arrays             |
| A7  | The supplied clock is monotonic; controls are dimensionless                            | Timestamp ordering and numerical interpretation      | Inject deterministic and nonfinite clocks; distinguish host arrival time from device scan time                    |
| A8  | Nearest-integer quantization describes the hypothetical prequantized signal            | Numerical error bounds in architecture documentation | Compare calibrated analog measurements against report quantization; physical noise remains an independent unknown |

No assumption converts missing physical evidence into a compatibility result. Hardware-specific
findings remain unknown until measured. Built-in metadata identification is descriptive rather than
an authenticity check.

## Automated acceptance surface

- Lifecycle serialization, repeated start/stop, restart, failed startup rollback, stale callback
  rejection, disconnect, and native cleanup.
- Immutable nested snapshots, normalized endpoints, independent digital pressure flags,
  invalid-value rejection, deterministic event order and edge detection.
- Deadzone boundary continuity, radial saturation, symmetry and bounded outputs.
- Removable/aborted/one-shot listeners; bounded streams, dropped counts, pending consumer release
  and concurrent-next rejection.
- SDL mappings for each requested controller family through an injected SDL implementation,
  trigger-offset correction and output unit conversion.
- Browser sparse inventories, standard mapping, custom mappings, index reuse, absence/denial, and
  rumble semantics through an injected browser environment.
- HID enumeration, custom-profile precedence, initialization, input failure and explicit rescan
  through an injected node-hid implementation.
- Synthetic PS3, PS4 and PS5 packets; supported full/simple transports, pressure offsets, hat
  positions, malformed lengths, sliced byte arrays and Bluetooth CRC corruption. CRC-32 also uses
  the independent standard check vector `123456789 -> 0xCBF43926`.
- Type declarations compiled against positive and intentional negative consumer examples. Native
  dependencies remain absent from browser source imports.

## Physical acceptance procedure

For each controller, record model, VID/PID if available, firmware, host OS, driver, transport,
backend, adapter mode and mapping. Those values define the scope of the result.

1. Enumerate; compare identity and capabilities with actual controls.
2. Keep controls released at open. Verify neutral sticks/triggers and all four axis signs/endpoints.
3. Press each button independently, then simultaneous face/shoulder/directional combinations. Verify
   exactly one press edge and one release edge per action.
4. Sweep triggers slowly. For direct PS3 input, sweep each pressure-sensitive
   face/shoulder/directional button; compare analog values with digital flags.
5. Disconnect while holding a control, reconnect, and verify the previous controller object remains
   invalid. Repeat with multiple physical pads.
6. If rumble is exposed, request a small effect, verify both channels, preempt it, and stop the
   manager during output. Record observed behavior separately from the request's promise result.
7. Repeat for USB and Bluetooth/receiver connections separately. For adapters, repeat for every port
   and mode.
8. For browsers, repeat in foreground/background contexts and after focus/user activation. Verify
   queue loss monitoring under deliberately slow consumption.

These steps describe a reproducible acceptance protocol, not completed physical test results.

## Bounded scope observations

| Impact | Observation                                                             | Consequence/opportunity                                                                           |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| High   | Adapter IDs can identify the bridge rather than the attached controller | Device-specific mapping validation prevents plausible but wrong control meanings                  |
| High   | Arrival timestamps are not hardware timestamps                          | Latency studies require separate device/host clock and transport measurements                     |
| High   | SDL and direct HID can represent the same physical controller           | Running both without application-level identity reconciliation can duplicate input and output     |
| Medium | Bounded event streams intentionally drop under pressure                 | Applications can monitor `dropped` or choose synchronous recording                                |
| Medium | Pure decoders and injectable backends separate hardware from semantics  | Captured reports can become reproducible regression/replay inputs without connected hardware      |
| Medium | Browser mappings and SDL device maps can omit advanced controls         | HID profiles or explicit mappings can expose measured additional inputs without changing the core |
| Low    | State snapshots are JSON-compatible                                     | External logging and visualization need no embedded HTTP server                                   |

Adaptive trigger output, touch coordinates, calibrated IMU data, pairing tools, and raw Xbox USB
protocols are outside this release's bounded feature surface.

## Quality gates

| Gate | Evidence / criterion                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| QG1  | Engineering implementation and factual validation; no normative conclusion needed                                                  |
| QG2  | Assumptions A1-A8 have explicit dependent results and probes                                                                       |
| QG3  | New target directory, modern JS API, requested controller-family paths, four-space source style, README and detailed documentation |
| QG4  | Dimensionless controls, seconds at the public API, explicit millisecond conversions and reproducible normalization equations       |
| QG5  | Lifecycle, stale IDs, malformed reports, backpressure, calibration and transport limits are tested or explicitly bounded           |
| QG6  | Versioned primary references identify native API and packet-layout provenance; synthetic and physical evidence remain separate     |
| QG7  | Additional patterns and opportunities are bounded and impact-labelled above                                                        |
