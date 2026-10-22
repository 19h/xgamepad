import { GamepadError } from '../core/errors.js';
import { identifyFamily } from '../core/identity.js';

const BUTTON_MAP = Object.freeze({
    a: 'south',
    b: 'east',
    x: 'west',
    y: 'north',
    leftShoulder: 'leftShoulder',
    rightShoulder: 'rightShoulder',
    back: 'back',
    start: 'start',
    guide: 'home',
    leftStick: 'leftStick',
    rightStick: 'rightStick',
    dpadUp: 'dpadUp',
    dpadDown: 'dpadDown',
    dpadLeft: 'dpadLeft',
    dpadRight: 'dpadRight',
    paddle1: 'paddle1',
    paddle2: 'paddle2',
    paddle3: 'paddle3',
    paddle4: 'paddle4',
});

function trigger(value, rest) {
    return Math.min(1, Math.max(0, (value - rest) / (1 - rest)));
}

/** SDL owns OS-specific discovery, mappings, and controller transports. */
export function createSDLBackend({ sdl: providedSDL, mappings = [], mapDevice, triggerRest } = {}) {
    if (!Array.isArray(mappings) || mappings.some((mapping) => typeof mapping !== 'string')) {
        throw new TypeError('mappings must be an array of SDL mapping strings.');
    }
    const opened = new Map();
    let sdl;
    let sink;
    let onAdd;
    let onRemove;

    function disconnect(id) {
        const entry = opened.get(id);
        if (!entry) {
            return;
        }
        opened.delete(id);
        for (const [event, listener] of entry.listeners) {
            entry.handle.removeListener(event, listener);
        }
        try {
            if (!entry.handle.closed) {
                try {
                    if (entry.rumbling) {
                        entry.handle.stopRumble();
                    }
                } finally {
                    entry.handle.close();
                }
            }
        } finally {
            sink?.disconnect(id);
        }
    }

    function connect(device) {
        const id = `sdl:${device.id}`;
        if (!sink || opened.has(id)) {
            return;
        }
        let handle;
        let entry;
        let descriptor;
        try {
            handle = sdl.controller.openDevice(device);
            const axes = { ...handle.axes };
            const buttons = { ...handle.buttons };
            // node-sdl normalizes relative to the joystick's initial position. Its
            // trigger rest can consequently be nonzero. Explicit calibration wins.
            const rest = triggerRest?.(device) ?? {
                left: axes.leftTrigger ?? 0,
                right: axes.rightTrigger ?? 0,
            };
            for (const value of [rest.left, rest.right]) {
                if (!Number.isFinite(value) || value < -1 || value >= 1) {
                    throw new GamepadError(
                        'CALIBRATION',
                        'Release triggers before opening, or provide triggerRest.',
                    );
                }
            }
            entry = { handle, axes, buttons, rest, listeners: [] };
            const mappingKeys = device.mapping
                ? new Set(
                      device.mapping
                          .split(',')
                          .slice(2)
                          .map((entry) => entry.split(':')[0]),
                  )
                : null;
            const supported = Object.entries(BUTTON_MAP)
                .filter(
                    ([key]) =>
                        Object.hasOwn(buttons, key) &&
                        (!mappingKeys || mappingKeys.has(key.toLowerCase())),
                )
                .map(([, value]) => value);
            for (const name of ['leftTrigger', 'rightTrigger']) {
                if (!mappingKeys || mappingKeys.has(name.toLowerCase())) {
                    supported.push(name);
                }
            }
            descriptor = {
                id,
                name: device.name ?? 'SDL controller',
                family: identifyFamily({
                    name: device.name ?? '',
                    type: device.type ?? '',
                    vendorId: device.vendor,
                    productId: device.product,
                }),
                vendorId: device.vendor,
                productId: device.product,
                transport: 'sdl',
                mapping: device.mapping,
                capabilities: {
                    rumble: handle.hasRumble,
                    buttons: supported,
                    axes: Object.entries({
                        leftx: 'leftX',
                        lefty: 'leftY',
                        rightx: 'rightX',
                        righty: 'rightY',
                    })
                        .filter(([key]) => !mappingKeys || mappingKeys.has(key))
                        .map(([, value]) => value),
                },
                ...mapDevice?.(device),
            };
            descriptor.id = id;
        } catch (cause) {
            if (handle && !handle.closed) {
                handle.close();
            }
            sink.error(
                new GamepadError('OPEN_FAILED', `Cannot open ${device.name ?? id}.`, { cause }),
                id,
            );
            return;
        }

        const publish = () => {
            const { axes, buttons, rest } = entry;
            sink.update(id, {
                axes: {
                    leftX: axes.leftStickX ?? 0,
                    leftY: axes.leftStickY ?? 0,
                    rightX: axes.rightStickX ?? 0,
                    rightY: axes.rightStickY ?? 0,
                },
                buttons: {
                    ...Object.fromEntries(
                        Object.entries(BUTTON_MAP).map(([key, name]) => [
                            name,
                            buttons[key] ?? false,
                        ]),
                    ),
                    leftTrigger: trigger(axes.leftTrigger ?? 0, rest.left),
                    rightTrigger: trigger(axes.rightTrigger ?? 0, rest.right),
                },
            });
        };
        entry.listeners = [
            [
                'axisMotion',
                ({ axis, value }) => {
                    entry.axes[axis] = value;
                    publish();
                },
            ],
            [
                'buttonDown',
                ({ button }) => {
                    entry.buttons[button] = true;
                    publish();
                },
            ],
            [
                'buttonUp',
                ({ button }) => {
                    entry.buttons[button] = false;
                    publish();
                },
            ],
            [
                'remap',
                () => {
                    entry.axes = { ...handle.axes };
                    entry.buttons = { ...handle.buttons };
                    publish();
                },
            ],
            [
                'close',
                () => {
                    opened.delete(id);
                    for (const [event, listener] of entry.listeners) {
                        handle.removeListener(event, listener);
                    }
                    sink?.disconnect(id);
                },
            ],
        ];
        opened.set(id, entry);
        for (const [event, listener] of entry.listeners) {
            handle.on(event, listener);
        }
        sink.connect(descriptor);
        publish();
    }

    return {
        async start(target) {
            if (sink) {
                throw new GamepadError('ALREADY_STARTED', 'SDL backend is already in use.');
            }
            try {
                sdl = providedSDL ?? (await import('@kmamal/sdl')).default;
            } catch (cause) {
                throw new GamepadError(
                    'BACKEND_UNAVAILABLE',
                    'Install @kmamal/sdl to use native controller input.',
                    { cause },
                );
            }
            sink = target;
            if (mappings.length) {
                sdl.controller.addMappings(mappings);
            }
            onAdd = ({ device }) => connect(device);
            onRemove = ({ device }) => disconnect(`sdl:${device.id}`);
            sdl.controller.on('deviceAdd', onAdd);
            sdl.controller.on('deviceRemove', onRemove);
            for (const device of sdl.controller.devices) {
                connect(device);
            }
        },
        async stop() {
            if (!sink) {
                return;
            }
            sdl.controller.removeListener('deviceAdd', onAdd);
            sdl.controller.removeListener('deviceRemove', onRemove);
            try {
                const errors = [];
                for (const id of [...opened.keys()]) {
                    try {
                        disconnect(id);
                    } catch (error) {
                        errors.push(error);
                    }
                }
                if (errors.length) {
                    throw new AggregateError(errors, 'SDL device cleanup failed.');
                }
            } finally {
                sink = undefined;
            }
        },
        async rumble(id, { low, high, duration }) {
            const entry = opened.get(id);
            if (!entry) {
                throw new GamepadError('DISCONNECTED', `Controller ${id} is disconnected.`);
            }
            entry.handle.rumble(low, high, duration * 1000);
            entry.rumbling = true;
        },
    };
}
