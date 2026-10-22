#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createGamepadManager } from '../src/index.js';
import { createHIDBackend } from '../src/hid.js';

const usage = `Usage: xgamepad [list|watch] [--backend sdl|hid] [--json]

list   List mapped controllers, then exit (default).
watch  Stream connections, input changes, and disconnections.

--backend hid uses direct Sony HID input and scans every 2 seconds.
--json emits newline-delimited JSON for scripts.`;

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            backend: { type: 'string', default: 'sdl' },
            json: { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    if (values.help) {
        console.log(usage);
        return;
    }
    const command = positionals[0] ?? 'list';
    if (
        positionals.length > 1 ||
        !['list', 'watch'].includes(command) ||
        !['sdl', 'hid'].includes(values.backend)
    ) {
        throw new Error(usage);
    }
    const pads = createGamepadManager({
        ...(values.backend === 'hid'
            ? { backend: createHIDBackend({ pollInterval: command === 'watch' ? 2 : 0 }) }
            : {}),
    });
    const write = (type, value) => {
        if (values.json) {
            console.log(JSON.stringify({ type, ...value }));
        } else {
            console.log(type, value);
        }
    };
    pads.on('error', ({ error, id }) => {
        write('error', { id, code: error.code, message: error.message });
        process.exitCode = 1;
    });
    if (command === 'watch') {
        pads.on('connect', ({ controller }) => write('connect', controller.descriptor));
        pads.on('disconnect', ({ controller }) => write('disconnect', { id: controller.id }));
        pads.on('change', ({ controller, state }) => write('change', { id: controller.id, state }));
    }
    let stopping = false;
    const shutdown = async () => {
        if (stopping) {
            return;
        }
        stopping = true;
        await pads.stop();
    };
    const onSignal = () => {
        void shutdown().catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
        await pads.start();
        if (command === 'list') {
            for (const controller of pads.controllers) {
                write('controller', controller.descriptor);
            }
            if (!values.json && pads.controllers.length === 0) {
                console.log('No mapped controllers found.');
            }
            await shutdown();
        }
    } catch (error) {
        await shutdown();
        throw error;
    } finally {
        if (stopping) {
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
        }
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
