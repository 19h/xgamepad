import { GamepadError, requireNumber } from '../core/errors.js';
import { playStationProfiles } from '../hid/profiles.js';

/** Direct HID input with explicit custom profiles and serialized discovery. */
export function createHIDBackend({
    hid: providedHID,
    profiles = [],
    pollInterval = 0,
    nonExclusive = true,
    initialize,
} = {}) {
    requireNumber(pollInterval, 'pollInterval', 0, 3600);
    if (pollInterval > 0 && pollInterval < 0.25) {
        throw new RangeError('HID discovery interval must be at least 0.25 seconds.');
    }
    for (const profile of profiles) {
        if (typeof profile.match !== 'function' || typeof profile.decode !== 'function') {
            throw new TypeError('Each HID profile requires match() and decode().');
        }
    }
    const allProfiles = [...profiles, ...playStationProfiles];
    const opened = new Map();
    let hid;
    let sink;
    let timer;
    let scanning;

    async function close(id) {
        const entry = opened.get(id);
        if (!entry) {
            return;
        }
        opened.delete(id);
        entry.handle.removeListener('data', entry.onData);
        // Keep the error listener until close completes: node-hid is an EventEmitter.
        try {
            await entry.handle.close();
        } finally {
            entry.handle.removeListener('error', entry.onError);
            sink?.disconnect(id);
        }
    }

    async function scan() {
        const target = sink;
        if (!target) {
            return;
        }
        const devices = await hid.devicesAsync();
        if (target !== sink) {
            return;
        }
        const seen = new Set(devices.map((device) => `hid:${device.path}`));
        for (const id of opened.keys()) {
            if (!seen.has(id)) {
                await close(id);
            }
        }
        for (const device of devices) {
            if (!device.path || target !== sink) {
                continue;
            }
            const id = `hid:${device.path}`;
            if (opened.has(id)) {
                continue;
            }
            const profile = allProfiles.find((candidate) => candidate.match(device));
            if (!profile) {
                continue;
            }
            let handle;
            let descriptor;
            try {
                handle = await hid.HIDAsync.open(device.path, { nonExclusive });
                // Prevent unhandled native errors during asynchronous initialization.
                handle.on('error', openingError);
                await initialize?.(handle, device);
                descriptor = {
                    name: device.product ?? profile.id ?? 'HID controller',
                    vendorId: device.vendorId,
                    productId: device.productId,
                    transport: 'hid',
                    mapping: profile.id ?? 'custom',
                    ...profile.describe?.(device),
                    id,
                };
            } catch (cause) {
                if (handle) {
                    try {
                        await handle.close();
                    } finally {
                        handle.removeListener('error', openingError);
                    }
                }
                target.error(
                    new GamepadError('OPEN_FAILED', `Cannot open HID device ${id}.`, { cause }),
                    id,
                );
                continue;
            }
            if (target !== sink) {
                await handle.close();
                continue;
            }
            const onData = (data) => {
                let sample;
                try {
                    sample = profile.decode(data, device);
                } catch (error) {
                    target.error(error, id);
                    return;
                }
                if (sample != null) {
                    target.update(id, sample);
                }
            };
            const onError = (cause) => {
                void close(id).catch((error) => target.error(error, id));
                target.error(
                    new GamepadError('READ_FAILED', `HID read failed for ${id}.`, { cause }),
                    id,
                );
            };
            opened.set(id, { handle, onData, onError });
            handle.removeListener('error', openingError);
            handle.on('error', onError);
            target.connect(descriptor);
            handle.on('data', onData);

            function openingError(cause) {
                target.error(
                    new GamepadError('READ_FAILED', `HID error while opening ${id}.`, { cause }),
                    id,
                );
            }
        }
    }

    function refresh() {
        if (scanning) {
            return scanning;
        }
        const result = scan();
        scanning = result;
        const finish = () => {
            scanning = undefined;
        };
        result.then(finish, finish);
        return result;
    }

    return {
        refresh,
        async start(target) {
            if (sink) {
                throw new GamepadError('ALREADY_STARTED', 'HID backend is already in use.');
            }
            try {
                hid = providedHID ?? (await import('node-hid')).default;
            } catch (cause) {
                throw new GamepadError(
                    'BACKEND_UNAVAILABLE',
                    'Install node-hid to use direct HID input.',
                    { cause },
                );
            }
            sink = target;
            await refresh();
            if (pollInterval) {
                timer = setInterval(() => {
                    void refresh().catch((error) => sink?.error(error));
                }, pollInterval * 1000);
            }
        },
        async stop() {
            clearInterval(timer);
            sink = undefined;
            await scanning?.catch(() => {});
            const results = await Promise.allSettled([...opened.keys()].map(close));
            const errors = results
                .filter((result) => result.status === 'rejected')
                .map((result) => result.reason);
            if (errors.length) {
                throw new AggregateError(errors, 'HID device cleanup failed.');
            }
        },
    };
}
