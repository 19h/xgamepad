import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDeadzone, createGamepadManager, GamepadError } from '../src/index.js';

function fixture(options = {}) {
    let sink;
    let starts = 0;
    let stops = 0;
    const rumbles = [];
    const backend = {
        start(target) {
            sink = target;
            ++starts;
        },
        stop() {
            ++stops;
        },
        rumble(id, effect) {
            rumbles.push({ id, effect });
        },
    };
    const pads = createGamepadManager({ backend, deadzone: 0, now: () => 123.5, ...options });
    return {
        pads,
        backend,
        rumbles,
        get sink() {
            return sink;
        },
        get starts() {
            return starts;
        },
        get stops() {
            return stops;
        },
    };
}

test('import and construction do not open devices', () => {
    const f = fixture();
    assert.equal(f.starts, 0);
    assert.equal(f.pads.status, 'stopped');
    assert.deepEqual(f.pads.controllers, []);
});

test('start/stop serialize, are idempotent, and restart cleanly', async () => {
    const f = fixture();
    await Promise.all([f.pads.start(), f.pads.start()]);
    assert.equal(f.starts, 1);
    f.sink.connect({ id: 'a' });
    const old = f.pads.get('a');
    const staleSink = f.sink;
    await Promise.all([f.pads.stop(), f.pads.stop()]);
    assert.equal(f.stops, 1);
    assert.equal(old.connected, false);
    assert.equal(f.pads.get('a'), undefined);
    await f.pads.start();
    staleSink.connect({ id: 'stale' });
    assert.equal(f.pads.get('stale'), undefined);
    await f.pads.stop();
});

test('a failing start rolls back devices and allows retry', async () => {
    let fail = true;
    const f = fixture();
    f.backend.start = (sink) => {
        sink.connect({ id: 'a' });
        if (fail) {
            throw new Error('open failed');
        }
    };
    await assert.rejects(f.pads.start(), /open failed/);
    assert.equal(f.pads.status, 'stopped');
    assert.equal(f.pads.controllers.length, 0);
    assert.equal(f.stops, 1);
    fail = false;
    await f.pads.start();
    assert.equal(f.pads.controllers.length, 1);
    await f.pads.stop();
});

test('startup and rollback failures preserve both causes', async () => {
    const f = fixture();
    f.backend.start = () => {
        throw new Error('start');
    };
    f.backend.stop = () => {
        throw new Error('stop');
    };
    await assert.rejects(
        f.pads.start(),
        (error) => error instanceof AggregateError && error.errors.length === 2,
    );
    assert.equal(f.pads.status, 'stopped');
});

test('stop failure still disconnects controllers', async () => {
    const f = fixture();
    await f.pads.start();
    f.sink.connect({ id: 'a' });
    f.backend.stop = () => {
        throw new Error('close');
    };
    await assert.rejects(f.pads.stop(), /close/);
    assert.equal(f.pads.controllers.length, 0);
    assert.equal(f.pads.status, 'stopped');
});

test('snapshots are immutable, normalized, complete, and timestamped in seconds', async () => {
    const f = fixture();
    await f.pads.start();
    f.sink.connect({ id: 'a', capabilities: { buttons: ['south'] } });
    const controller = f.pads.get('a');
    const before = controller.state;
    const input = { axes: { leftX: 2 }, buttons: { south: 2, leftTrigger: 0.4 } };
    f.sink.update('a', input);
    input.buttons.south = 0;
    assert.equal(controller.state.timestamp, 123.5);
    assert.equal(controller.state.sequence, 1);
    assert.equal(controller.state.axes.leftX, 1);
    assert.equal(controller.state.buttons.south.value, 1);
    assert.equal(controller.state.buttons.leftTrigger.pressed, false);
    assert.equal(before.buttons.south.value, 0);
    assert.throws(() => {
        controller.state.axes.leftX = 0;
    }, TypeError);
    assert.throws(() => controller.descriptor.capabilities.buttons.push('east'), TypeError);
    await f.pads.stop();
});

test('state, edge, button, axis and change events have deterministic order', async () => {
    const f = fixture();
    const order = [];
    await f.pads.start();
    f.sink.connect({ id: 'a' });
    const controller = f.pads.get('a');
    for (const event of ['state', 'buttondown', 'button', 'axis', 'change']) {
        controller.on(event, () => order.push(`controller:${event}`));
        f.pads.on(event, () => order.push(`manager:${event}`));
    }
    f.sink.update('a', { buttons: { south: true }, axes: { leftX: 1 } });
    assert.deepEqual(order, [
        'controller:state',
        'manager:state',
        'controller:buttondown',
        'manager:buttondown',
        'controller:button',
        'manager:button',
        'controller:axis',
        'manager:axis',
        'controller:change',
        'manager:change',
    ]);
    let releases = 0;
    f.pads.on('buttonup', () => ++releases);
    f.sink.update('a', {});
    assert.equal(releases, 1);
    await f.pads.stop();
});

test('duplicate frames produce state events but no false changes or edges', async () => {
    const f = fixture();
    await f.pads.start();
    f.sink.connect({ id: 'a' });
    let states = 0;
    let changes = 0;
    f.pads.on('state', () => ++states);
    f.pads.on('change', () => ++changes);
    f.sink.update('a', {});
    f.sink.update('a', { axes: { leftX: 0.0001 } });
    assert.equal(states, 2);
    assert.equal(changes, 0);
    await f.pads.stop();
});

test('digital pressed state can differ from analog pressure', async () => {
    const f = fixture();
    await f.pads.start();
    f.sink.connect({ id: 'a' });
    f.sink.update('a', { buttons: { south: { value: 0.1, pressed: true, touched: true } } });
    assert.deepEqual(f.pads.get('a').state.buttons.south, {
        value: 0.1,
        pressed: true,
        touched: true,
    });
    await f.pads.stop();
});

test('once, unsubscribe, and AbortSignal dispose listeners', async () => {
    const f = fixture();
    let calls = 0;
    const abort = new AbortController();
    f.pads.on('connect', () => ++calls, { signal: abort.signal });
    f.pads.once('connect', () => ++calls);
    const off = f.pads.on('connect', () => ++calls);
    off();
    await f.pads.start();
    f.sink.connect({ id: 'a' });
    abort.abort();
    f.sink.connect({ id: 'b' });
    assert.equal(calls, 2);
    await f.pads.stop();
});

test('unknown input and duplicate connections do not create phantom devices', async () => {
    const f = fixture();
    await f.pads.start();
    f.sink.update('missing', {});
    f.sink.disconnect('missing');
    f.sink.connect({ id: 'a' });
    f.sink.connect({ id: 'a' });
    assert.equal(f.pads.controllers.length, 1);
    await f.pads.stop();
});

test('rumble validates capability, units, range, and stale controller references', async () => {
    const f = fixture();
    await f.pads.start();
    f.sink.connect({ id: 'a', capabilities: { rumble: true } });
    const old = f.pads.get('a');
    await old.rumble({ duration: 0.25, low: 0.3 });
    assert.deepEqual(f.rumbles, [{ id: 'a', effect: { low: 0.3, high: 1, duration: 0.25 } }]);
    await assert.rejects(old.rumble({ low: NaN }), RangeError);
    f.sink.disconnect('a');
    f.sink.connect({ id: 'a', capabilities: { rumble: true } });
    await assert.rejects(old.rumble(), { code: 'DISCONNECTED' });
    f.sink.connect({ id: 'b' });
    await assert.rejects(f.pads.get('b').rumble(), { code: 'UNSUPPORTED' });
    await f.pads.stop();
});

test('bounded streams drop oldest, expose counts, and close on stop', async () => {
    const f = fixture();
    await f.pads.start();
    const stream = f.pads.events('connect', { capacity: 2 });
    for (const id of ['a', 'b', 'c']) {
        f.sink.connect({ id });
    }
    assert.equal(stream.dropped, 1);
    assert.equal((await stream.next()).value.controller.id, 'b');
    assert.equal((await stream.next()).value.controller.id, 'c');
    const pending = stream.next();
    await assert.rejects(stream.next(), /one next/);
    await f.pads.stop();
    assert.equal((await pending).done, true);
});

test('stream abort and explicit iterator return release pending consumers', async () => {
    const f = fixture();
    await f.pads.start();
    const abort = new AbortController();
    const stream = f.pads.events('change', { signal: abort.signal });
    const pending = stream.next();
    abort.abort();
    assert.equal((await pending).done, true);
    const other = f.pads.events();
    assert.equal((await other.return()).done, true);
    await f.pads.stop();
    assert.equal((await f.pads.events().next()).done, true);
});

test('invalid options and samples fail explicitly', async () => {
    assert.throws(() => fixture({ deadzone: 1 }), RangeError);
    assert.throws(() => fixture({ buttonThreshold: -1 }), RangeError);
    assert.throws(() => fixture({ epsilon: Infinity }), RangeError);
    assert.throws(() => createGamepadManager({ backend: {} }), TypeError);
    const f = fixture();
    assert.throws(() => f.pads.events('change', { capacity: 0 }), RangeError);
    await f.pads.start();
    assert.throws(() => f.sink.connect({ id: '' }), GamepadError);
    f.sink.connect({ id: 'a' });
    assert.throws(() => f.sink.update('a', { axes: { leftX: NaN } }), { code: 'INVALID_SAMPLE' });
    assert.equal(f.pads.get('a').state.sequence, 0);
    await f.pads.stop();
});

test('radial deadzone preserves direction, reaches endpoints, and is continuous', () => {
    assert.deepEqual(applyDeadzone(0.1, 0.1, 0.2), { x: 0, y: 0 });
    assert.equal(applyDeadzone(1, 0, 0.2).x, 1);
    assert.equal(applyDeadzone(-1, 0, 0.2).x, -1);
    const diagonal = applyDeadzone(1, 1, 0.2);
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-14);
    assert.ok(applyDeadzone(0.200001, 0, 0.2).x < 0.000002);
    assert.throws(() => applyDeadzone(NaN, 0), GamepadError);
});

test('deadzone property sweep stays finite, bounded, symmetric, and radial', () => {
    for (let x = -1; x <= 1; x += 0.05) {
        for (let y = -1; y <= 1; y += 0.05) {
            const a = applyDeadzone(x, y, 0.15);
            const b = applyDeadzone(-x, -y, 0.15);
            assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
            assert.ok(Math.hypot(a.x, a.y) <= 1 + 1e-14);
            assert.ok(Math.abs(a.x + b.x) < 1e-14);
            assert.ok(Math.abs(a.y + b.y) < 1e-14);
        }
    }
});

test('small analog steps accumulate independently against change baselines', async () => {
    const f = fixture({ epsilon: 0.01 });
    await f.pads.start();
    f.sink.connect({ id: 'a' });
    const axes = [];
    f.pads.on('axis', ({ axis }) => axes.push(axis));
    f.sink.update('a', { axes: { leftX: 0.004, rightX: 0.1 } });
    f.sink.update('a', { axes: { leftX: 0.008, rightX: 0.2 } });
    f.sink.update('a', { axes: { leftX: 0.012, rightX: 0.3 } });
    assert.equal(axes.filter((axis) => axis === 'leftX').length, 1);
    assert.equal(axes.filter((axis) => axis === 'rightX').length, 3);
    await f.pads.stop();
});

test('throwing disconnect and stop listeners cannot leave controllers or streams alive', async () => {
    const f = fixture();
    await f.pads.start();
    f.sink.connect({ id: 'a' });
    f.sink.connect({ id: 'b' });
    f.pads.get('a').on('disconnect', () => {
        throw new Error('controller listener');
    });
    const seen = [];
    f.pads.on('disconnect', ({ controller }) => seen.push(controller.id));
    f.pads.on('stop', () => {
        throw new Error('stop listener');
    });
    const stream = f.pads.events();
    const pending = stream.next();
    await assert.rejects(f.pads.stop(), AggregateError);
    assert.deepEqual(seen, ['a', 'b']);
    assert.equal(f.pads.controllers.length, 0);
    assert.equal((await pending).done, true);
});

test('a stream attached during failed startup is closed during rollback', async () => {
    const f = fixture();
    let stream;
    f.backend.start = () => {
        stream = f.pads.events();
        throw new Error('start failed');
    };
    await assert.rejects(f.pads.start(), /start failed/);
    assert.equal((await stream.next()).done, true);
});

test('stop waits for in-flight start, then closes exactly once', async () => {
    const f = fixture();
    let release;
    f.backend.start = () =>
        new Promise((resolve) => {
            release = resolve;
        });
    const start = f.pads.start();
    const stop = f.pads.stop();
    await Promise.resolve();
    assert.equal(f.pads.status, 'starting');
    release();
    await Promise.all([start, stop]);
    assert.equal(f.stops, 1);
    assert.equal(f.pads.status, 'stopped');
});
