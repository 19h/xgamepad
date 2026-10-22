import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createGamepadManager, createSDLBackend } from '../src/index.js';
import { createBrowserBackend } from '../src/browser.js';
import { createHIDBackend } from '../src/hid.js';

function fakeSDL(type = 'xboxOne') {
    const device = {
        id: 1,
        name: type,
        type,
        vendor: type.startsWith('ps') ? 0x054c : 0x045e,
        product: 1,
    };
    const controller = new EventEmitter();
    const handle = new EventEmitter();
    Object.assign(handle, {
        axes: {
            leftStickX: 0,
            leftStickY: 0,
            rightStickX: 0,
            rightStickY: 0,
            leftTrigger: 0.5,
            rightTrigger: 0.5,
        },
        buttons: { a: false, b: false, x: false, y: false },
        hasRumble: true,
        closed: false,
        effects: [],
        close() {
            this.emit('close');
            this.closed = true;
        },
        rumble(...args) {
            this.effects.push(args);
        },
        stopRumble() {},
    });
    controller.devices = [device];
    controller.openDevice = () => handle;
    controller.addMappings = (mappings) => {
        controller.mappings = mappings;
    };
    return { sdl: { controller }, handle, device, controller };
}

for (const [type, family] of [
    ['ps2', 'ps2'],
    ['ps3', 'ps3'],
    ['ps4', 'ps4'],
    ['ps5', 'ps5'],
    ['xbox360', 'xbox'],
    ['xboxOne', 'xbox'],
]) {
    test(`SDL maps ${type}, initial trigger rest, events, and rumble`, async () => {
        const f = fakeSDL(type);
        const pads = createGamepadManager({
            backend: createSDLBackend({ sdl: f.sdl }),
            deadzone: 0,
        });
        await pads.start();
        const pad = pads.get('sdl:1');
        assert.equal(pad.descriptor.family, family);
        assert.equal(pad.state.buttons.leftTrigger.value, 0);
        f.handle.emit('buttonDown', { button: 'a' });
        assert.equal(pad.state.buttons.south.pressed, true);
        f.handle.emit('buttonUp', { button: 'a' });
        assert.equal(pad.state.buttons.south.pressed, false);
        f.handle.emit('axisMotion', { axis: 'leftTrigger', value: 0.75 });
        assert.equal(pad.state.buttons.leftTrigger.value, 0.5);
        f.handle.emit('axisMotion', { axis: 'leftStickX', value: -1 });
        assert.equal(pad.state.axes.leftX, -1);
        await pad.rumble({ duration: 0.125, low: 0.25, high: 0.75 });
        assert.deepEqual(f.handle.effects, [[0.25, 0.75, 125]]);
        await pads.stop();
        assert.equal(f.handle.closed, true);
        assert.equal(f.controller.listenerCount('deviceAdd'), 0);
        assert.equal(f.handle.listenerCount('axisMotion'), 0);
    });
}

test('SDL hotplug and native close invalidate retained controllers', async () => {
    const f = fakeSDL();
    f.controller.devices = [];
    const pads = createGamepadManager({ backend: createSDLBackend({ sdl: f.sdl }) });
    await pads.start();
    f.controller.emit('deviceAdd', { device: f.device });
    const old = pads.get('sdl:1');
    f.handle.emit('close');
    f.handle.closed = true;
    assert.equal(old.connected, false);
    f.controller.emit('deviceRemove', { device: f.device });
    assert.equal(pads.controllers.length, 0);
    await pads.stop();
});

test('SDL custom mappings, descriptor overrides, and explicit trigger calibration', async () => {
    const f = fakeSDL();
    const backend = createSDLBackend({
        sdl: f.sdl,
        mappings: ['some-guid,Adapter,a:b0,'],
        mapDevice: () => ({ family: 'ps2', name: 'Adapter' }),
        triggerRest: () => ({ left: 0, right: 0 }),
    });
    const pads = createGamepadManager({ backend });
    await pads.start();
    assert.equal(f.controller.mappings.length, 1);
    assert.equal(pads.get('sdl:1').descriptor.family, 'ps2');
    assert.equal(pads.get('sdl:1').state.buttons.leftTrigger.value, 0.5);
    await pads.stop();
});

test('SDL open errors are reported and handles are cleaned up', async () => {
    const f = fakeSDL();
    const backend = createSDLBackend({ sdl: f.sdl, triggerRest: () => ({ left: 1, right: 0 }) });
    const pads = createGamepadManager({ backend });
    const errors = [];
    pads.on('error', ({ error }) => errors.push(error));
    await pads.start();
    assert.equal(errors[0].code, 'OPEN_FAILED');
    assert.equal(errors[0].cause.code, 'CALIBRATION');
    assert.equal(f.handle.closed, true);
    await pads.stop();
});

function browserFixture(options = {}) {
    let devices = [];
    let frame;
    let cancelCount = 0;
    const backend = createBrowserBackend({
        navigator: { getGamepads: () => devices },
        requestFrame(callback) {
            frame = callback;
            return 42;
        },
        cancelFrame() {
            ++cancelCount;
            frame = undefined;
        },
        ...options,
    });
    const pads = createGamepadManager({ backend, deadzone: 0 });
    return {
        pads,
        set devices(value) {
            devices = value;
        },
        tick() {
            const next = frame;
            frame = undefined;
            next?.();
        },
        get cancelCount() {
            return cancelCount;
        },
    };
}

function browserPad(index = 0, overrides = {}) {
    return {
        id: 'Xbox Wireless Controller',
        index,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false, touched: false })),
        ...overrides,
    };
}

test('browser scans sparse arrays, normalizes buttons, and disconnects missing devices', async () => {
    const f = browserFixture();
    const pad = browserPad(2);
    f.devices = [null, null, pad];
    await f.pads.start();
    assert.equal(f.pads.get('browser:2').descriptor.family, 'xbox');
    pad.buttons[0] = { value: 0.75, pressed: true, touched: true };
    f.tick();
    assert.equal(f.pads.get('browser:2').state.buttons.south.value, 0.75);
    f.devices = [];
    f.tick();
    assert.equal(f.pads.controllers.length, 0);
    await f.pads.stop();
    assert.equal(f.cancelCount, 1);
});

test('browser rejects unmapped devices once per attachment and supports explicit adapters', async () => {
    const f = browserFixture();
    f.devices = [browserPad(0, { mapping: '' })];
    let errors = 0;
    f.pads.on('error', ({ error }) => {
        assert.equal(error.code, 'UNMAPPED_DEVICE');
        ++errors;
    });
    await f.pads.start();
    f.tick();
    assert.equal(errors, 1);
    assert.equal(f.pads.controllers.length, 0);
    await f.pads.stop();
    const custom = browserFixture({
        mapGamepad: () => ({ buttons: { south: true } }),
        mapDevice: () => ({ family: 'ps2' }),
    });
    custom.devices = [browserPad(0, { mapping: '' })];
    await custom.pads.start();
    assert.equal(custom.pads.get('browser:0').descriptor.family, 'ps2');
    assert.equal(custom.pads.get('browser:0').state.buttons.south.pressed, true);
    await custom.pads.stop();
});

test('browser handles index reuse and current actuator identity', async () => {
    const f = browserFixture();
    const calls = [];
    f.devices = [
        browserPad(0, {
            vibrationActuator: {
                type: 'dual-rumble',
                playEffect: async (...args) => {
                    calls.push(args);
                    return 'complete';
                },
            },
        }),
    ];
    await f.pads.start();
    const old = f.pads.get('browser:0');
    await old.rumble({ duration: 0.2, low: 0.4, high: 0.1 });
    assert.equal(calls[0][1].duration, 200);
    f.devices = [browserPad(0, { id: 'DualSense Wireless Controller' })];
    f.tick();
    assert.equal(old.connected, false);
    assert.equal(f.pads.get('browser:0').descriptor.family, 'ps5');
    await f.pads.stop();
});

test('browser API absence and access denial have actionable errors', async () => {
    const missing = createGamepadManager({ backend: createBrowserBackend({ navigator: {} }) });
    await assert.rejects(missing.start(), { code: 'BACKEND_UNAVAILABLE' });
    const denied = browserFixture({
        navigator: {
            getGamepads() {
                throw new Error('denied');
            },
        },
    });
    const errors = [];
    denied.pads.on('error', ({ error }) => errors.push(error));
    await denied.pads.start();
    assert.equal(errors[0].code, 'ACCESS_DENIED');
    await denied.pads.stop();
});

function hidFixture() {
    let devices = [{ path: '/fake/ps5', vendorId: 0x054c, productId: 0x0ce6 }];
    const handles = [];
    const hid = {
        devicesAsync: async () => devices,
        HIDAsync: {
            open: async () => {
                const handle = new EventEmitter();
                handle.closed = false;
                handle.close = async () => {
                    handle.closed = true;
                };
                handles.push(handle);
                return handle;
            },
        },
    };
    return {
        hid,
        handles,
        set devices(value) {
            devices = value;
        },
    };
}

function neutralPS5() {
    const data = new Uint8Array(64);
    data[0] = 1;
    data.fill(128, 1, 5);
    data[8] = 8;
    return data;
}

test('HID discovery, decoder errors, refresh, and shutdown release handles', async () => {
    const f = hidFixture();
    const backend = createHIDBackend({ hid: f.hid });
    const pads = createGamepadManager({ backend });
    const errors = [];
    pads.on('error', ({ error }) => errors.push(error));
    await pads.start();
    assert.equal(pads.controllers.length, 1);
    f.handles[0].emit('data', Uint8Array.of(1));
    assert.equal(errors[0].code, 'INVALID_REPORT');
    f.handles[0].emit('data', neutralPS5());
    assert.equal(pads.controllers[0].state.sequence, 1);
    await backend.refresh();
    assert.equal(f.handles.length, 1);
    f.devices = [];
    await backend.refresh();
    assert.equal(f.handles[0].closed, true);
    assert.equal(pads.controllers.length, 0);
    await pads.stop();
});

test('HID read failure disconnects and leaves no listeners after close', async () => {
    const f = hidFixture();
    const pads = createGamepadManager({ backend: createHIDBackend({ hid: f.hid }) });
    const errors = [];
    pads.on('error', ({ error }) => errors.push(error));
    await pads.start();
    f.handles[0].emit('error', new Error('unplug'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(errors[0].code, 'READ_FAILED');
    assert.equal(pads.controllers.length, 0);
    assert.equal(f.handles[0].listenerCount('data'), 0);
    assert.equal(f.handles[0].listenerCount('error'), 0);
    await pads.stop();
});

test('custom HID profiles precede builtins and initialization is awaited', async () => {
    const f = hidFixture();
    let initialized = false;
    const backend = createHIDBackend({
        hid: f.hid,
        profiles: [
            {
                id: 'test',
                match: () => true,
                decode: () => ({ buttons: { south: true } }),
                describe: () => ({ family: 'ps2' }),
            },
        ],
        initialize: async () => {
            initialized = true;
        },
    });
    const pads = createGamepadManager({ backend });
    await pads.start();
    assert.equal(initialized, true);
    assert.equal(pads.controllers[0].descriptor.family, 'ps2');
    f.handles[0].emit('data', new Uint8Array());
    assert.equal(pads.controllers[0].state.buttons.south.pressed, true);
    await pads.stop();
    assert.equal(f.handles[0].closed, true);
});

test('HID initialization failure closes its handle', async () => {
    const f = hidFixture();
    const errors = [];
    const pads = createGamepadManager({
        backend: createHIDBackend({
            hid: f.hid,
            initialize: () => {
                throw new Error('init');
            },
        }),
    });
    pads.on('error', ({ error }) => errors.push(error));
    await pads.start();
    assert.equal(errors[0].code, 'OPEN_FAILED');
    assert.equal(f.handles[0].closed, true);
    await pads.stop();
});

test('HID enumeration failure rejects startup without leaking a running manager', async () => {
    const f = hidFixture();
    f.hid.devicesAsync = async () => {
        throw new Error('enumeration');
    };
    const pads = createGamepadManager({ backend: createHIDBackend({ hid: f.hid }) });
    await assert.rejects(pads.start(), /enumeration/);
    assert.equal(pads.status, 'stopped');
});

test('SDL capability lists respect mappings instead of advertising absent paddles', async () => {
    const f = fakeSDL();
    f.device.mapping = 'guid,Example,a:b0,leftx:a0,lefty:a1,lefttrigger:a2,';
    f.handle.buttons.paddle1 = false;
    const pads = createGamepadManager({ backend: createSDLBackend({ sdl: f.sdl }) });
    await pads.start();
    const capabilities = pads.controllers[0].descriptor.capabilities;
    assert.deepEqual(capabilities.buttons, ['south', 'leftTrigger']);
    assert.deepEqual(capabilities.axes, ['leftX', 'leftY']);
    await pads.stop();
});

test('SDL closes a handle even when stopping its motors fails', async () => {
    const f = fakeSDL();
    const pads = createGamepadManager({ backend: createSDLBackend({ sdl: f.sdl }) });
    await pads.start();
    await pads.controllers[0].rumble();
    f.handle.stopRumble = () => {
        throw new Error('motor stop');
    };
    await assert.rejects(pads.stop(), AggregateError);
    assert.equal(f.handle.closed, true);
    assert.equal(pads.controllers.length, 0);
});

test('browser recovers from transient permission failure without repeated errors', async () => {
    let allowed = false;
    const f = browserFixture({
        navigator: {
            getGamepads() {
                if (!allowed) {
                    throw new Error('denied');
                }
                return [browserPad()];
            },
        },
    });
    let errors = 0;
    f.pads.on('error', () => ++errors);
    await f.pads.start();
    f.tick();
    assert.equal(errors, 1);
    allowed = true;
    f.tick();
    assert.equal(f.pads.controllers.length, 1);
    await f.pads.stop();
});

test('browser stop resets an active effect and short layouts expose only supplied controls', async () => {
    let resets = 0;
    const f = browserFixture();
    f.devices = [
        browserPad(0, {
            axes: [0, 0],
            buttons: [{ value: 0, pressed: false, touched: false }],
            vibrationActuator: {
                type: 'dual-rumble',
                playEffect: async () => 'complete',
                reset: async () => {
                    ++resets;
                },
            },
        }),
    ];
    await f.pads.start();
    assert.deepEqual(f.pads.controllers[0].descriptor.capabilities.axes, ['leftX', 'leftY']);
    assert.deepEqual(f.pads.controllers[0].descriptor.capabilities.buttons, ['south']);
    await f.pads.controllers[0].rumble();
    await f.pads.stop();
    assert.equal(resets, 1);
});

test('HID shutdown reports close failure and still invalidates controllers', async () => {
    const f = hidFixture();
    const pads = createGamepadManager({ backend: createHIDBackend({ hid: f.hid }) });
    await pads.start();
    f.handles[0].close = async () => {
        throw new Error('close failure');
    };
    await assert.rejects(pads.stop(), AggregateError);
    assert.equal(pads.controllers.length, 0);
});

test('overlapping HID refreshes share one scan instead of building an enumeration backlog', async () => {
    const f = hidFixture();
    const backend = createHIDBackend({ hid: f.hid });
    const pads = createGamepadManager({ backend });
    await pads.start();
    let scans = 0;
    let release;
    f.hid.devicesAsync = () => {
        ++scans;
        return new Promise((resolve) => {
            release = resolve;
        });
    };
    const scansPending = Array.from({ length: 100 }, () => backend.refresh());
    assert.equal(scans, 1);
    assert.ok(scansPending.every((promise) => promise === scansPending[0]));
    release([]);
    await Promise.all(scansPending);
    await pads.stop();
});
