import { GamepadError } from '../core/errors.js';
import { identifyFamily } from '../core/identity.js';
import { AXES, BUTTONS } from '../core/state.js';

/** Decode only the W3C standard layout. Unmapped devices require an explicit mapper. */
export function standardGamepadMapping(gamepad) {
    return {
        axes: Object.fromEntries(
            AXES.slice(0, gamepad.axes.length).map((name, index) => [name, gamepad.axes[index]]),
        ),
        buttons: Object.fromEntries(
            BUTTONS.slice(0, Math.min(17, gamepad.buttons.length)).map((name, index) => {
                const button = gamepad.buttons[index];
                return [
                    name,
                    button
                        ? { value: button.value, pressed: button.pressed, touched: button.touched }
                        : 0,
                ];
            }),
        ),
    };
}

export function createBrowserBackend({
    navigator: navigatorObject = globalThis.navigator,
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    mapGamepad,
    mapDevice,
} = {}) {
    let sink;
    let frame;
    const known = new Map();
    const rejected = new Set();
    let accessDenied = false;

    function poll() {
        if (!sink) {
            return;
        }
        let devices;
        try {
            devices = navigatorObject.getGamepads();
            accessDenied = false;
        } catch (cause) {
            if (!accessDenied) {
                accessDenied = true;
                sink.error(
                    new GamepadError('ACCESS_DENIED', 'The browser denied Gamepad API access.', {
                        cause,
                    }),
                );
            }
            frame = requestFrame(poll);
            return;
        }
        const seen = new Set();
        for (const gamepad of devices) {
            if (!gamepad?.connected) {
                continue;
            }
            const id = `browser:${gamepad.index}`;
            seen.add(id);
            if (known.get(id)?.name !== undefined && known.get(id).name !== gamepad.id) {
                known.delete(id);
                sink.disconnect(id);
            }
            let sample;
            try {
                sample = mapGamepad?.(gamepad);
                if (sample == null && gamepad.mapping === 'standard') {
                    sample = standardGamepadMapping(gamepad);
                }
                if (sample == null) {
                    if (!rejected.has(id)) {
                        rejected.add(id);
                        sink.error(
                            new GamepadError(
                                'UNMAPPED_DEVICE',
                                `Provide mapGamepad for ${gamepad.id}.`,
                            ),
                            id,
                        );
                    }
                    continue;
                }
            } catch (cause) {
                sink.error(
                    new GamepadError('INVALID_SAMPLE', `Mapping failed for ${gamepad.id}.`, {
                        cause,
                    }),
                    id,
                );
                continue;
            }
            rejected.delete(id);
            if (!known.has(id)) {
                const actuator = gamepad.vibrationActuator;
                const descriptor = {
                    id,
                    name: gamepad.id,
                    family: identifyFamily({ name: gamepad.id }),
                    transport: 'browser',
                    mapping: gamepad.mapping,
                    capabilities: {
                        rumble:
                            typeof actuator?.playEffect === 'function' &&
                            (actuator.type === 'dual-rumble' ||
                                actuator.effects?.includes('dual-rumble')),
                        axes: Object.keys(sample.axes ?? {}),
                        buttons: Object.keys(sample.buttons ?? {}),
                    },
                    ...mapDevice?.(gamepad),
                };
                descriptor.id = id;
                known.set(id, { name: gamepad.id, index: gamepad.index });
                sink.connect(descriptor);
            }
            sink.update(id, sample);
        }
        for (const id of known.keys()) {
            if (!seen.has(id)) {
                known.delete(id);
                sink.disconnect(id);
            }
        }
        for (const id of rejected) {
            if (!seen.has(id)) {
                rejected.delete(id);
            }
        }
        if (sink) {
            frame = requestFrame(poll);
        }
    }

    return {
        async start(target) {
            if (sink) {
                throw new GamepadError('ALREADY_STARTED', 'Browser backend is already in use.');
            }
            if (
                typeof navigatorObject?.getGamepads !== 'function' ||
                typeof requestFrame !== 'function' ||
                typeof cancelFrame !== 'function'
            ) {
                throw new GamepadError(
                    'BACKEND_UNAVAILABLE',
                    'Gamepad API and animation-frame scheduling are required.',
                );
            }
            sink = target;
            accessDenied = false;
            poll();
        },
        async stop() {
            if (!sink) {
                return;
            }
            const target = sink;
            const active = [...known.values()];
            sink = undefined;
            if (frame !== undefined) {
                cancelFrame(frame);
                frame = undefined;
            }
            for (const id of known.keys()) {
                target.disconnect(id);
            }
            known.clear();
            rejected.clear();
            const results = await Promise.allSettled(
                active.map(async (entry) => {
                    if (!entry.rumbling) {
                        return;
                    }
                    const gamepad = navigatorObject.getGamepads()[entry.index];
                    if (gamepad?.connected && gamepad.id === entry.name) {
                        await gamepad.vibrationActuator?.reset?.();
                    }
                }),
            );
            const errors = results
                .filter((result) => result.status === 'rejected')
                .map((result) => result.reason);
            if (errors.length) {
                throw new AggregateError(errors, 'Browser output cleanup failed.');
            }
        },
        async rumble(id, { low, high, duration }) {
            const entry = known.get(id);
            const gamepad = entry && navigatorObject.getGamepads()[entry.index];
            if (!gamepad?.connected || gamepad.id !== entry.name) {
                throw new GamepadError('DISCONNECTED', `Controller ${id} is disconnected.`);
            }
            entry.rumbling = true;
            const result = await gamepad.vibrationActuator.playEffect('dual-rumble', {
                startDelay: 0,
                duration: duration * 1000,
                strongMagnitude: low,
                weakMagnitude: high,
            });
            if (result !== 'complete' && result !== 'preempted') {
                throw new GamepadError('OUTPUT_FAILED', `Rumble returned ${String(result)}.`);
            }
        },
    };
}
