import { GamepadError } from '../core/errors.js';

const signedAxis = (value) => (value < 128 ? (value - 128) / 128 : (value - 128) / 127);

export function crc32(bytes, prefix = []) {
    let crc = 0xffffffff;
    for (const part of [prefix, bytes]) {
        for (const byte of part) {
            crc ^= byte;
            for (let bit = 0; bit < 8; ++bit) {
                crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
            }
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function verifyBluetoothCRC(data) {
    const offset = data.byteLength - 4;
    const expected = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
        offset,
        true,
    );
    if (crc32(data.subarray(0, offset), [0xa1]) !== expected) {
        throw new GamepadError(
            'CRC_MISMATCH',
            'PlayStation Bluetooth input checksum does not match.',
        );
    }
}

function axes(data, offset) {
    return {
        leftX: signedAxis(data[offset]),
        leftY: signedAxis(data[offset + 1]),
        rightX: signedAxis(data[offset + 2]),
        rightY: signedAxis(data[offset + 3]),
    };
}

function hat(value) {
    return {
        dpadUp: [0, 1, 7].includes(value),
        dpadRight: [1, 2, 3].includes(value),
        dpadDown: [3, 4, 5].includes(value),
        dpadLeft: [5, 6, 7].includes(value),
    };
}

function modernButtons(a, b, c) {
    return {
        ...hat(a & 0x0f),
        west: !!(a & 0x10),
        south: !!(a & 0x20),
        east: !!(a & 0x40),
        north: !!(a & 0x80),
        leftShoulder: !!(b & 0x01),
        rightShoulder: !!(b & 0x02),
        back: !!(b & 0x10),
        start: !!(b & 0x20),
        leftStick: !!(b & 0x40),
        rightStick: !!(b & 0x80),
        home: !!(c & 0x01),
        touchpad: !!(c & 0x02),
    };
}

function decodePS3(data) {
    if (data[0] !== 0x01) {
        return null;
    }
    if (![49, 64].includes(data.length)) {
        throw new GamepadError(
            'INVALID_REPORT',
            'PS3 input must contain 49 or 64 bytes, including report ID.',
        );
    }
    if (data[1] === 0xff) {
        return null;
    }
    const buttons = {
        back: !!(data[2] & 0x01),
        leftStick: !!(data[2] & 0x02),
        rightStick: !!(data[2] & 0x04),
        start: !!(data[2] & 0x08),
        home: !!(data[4] & 0x01),
    };
    const pressures = [
        ['dpadUp', 14, 2, 0x10],
        ['dpadRight', 15, 2, 0x20],
        ['dpadDown', 16, 2, 0x40],
        ['dpadLeft', 17, 2, 0x80],
        ['leftTrigger', 18, 3, 0x01],
        ['rightTrigger', 19, 3, 0x02],
        ['leftShoulder', 20, 3, 0x04],
        ['rightShoulder', 21, 3, 0x08],
        ['north', 22, 3, 0x10],
        ['east', 23, 3, 0x20],
        ['south', 24, 3, 0x40],
        ['west', 25, 3, 0x80],
    ];
    for (const [name, offset, byte, mask] of pressures) {
        buttons[name] = { value: data[offset] / 255, pressed: !!(data[byte] & mask) };
    }
    return { axes: axes(data, 6), buttons };
}

/** Pure decoder: includes report ID, rejects malformed recognized report types. */
export function decodePlayStationReport(family, data) {
    if (!(data instanceof Uint8Array) || data.length === 0) {
        throw new GamepadError(
            'INVALID_REPORT',
            'Input must be a nonempty Uint8Array with a report ID.',
        );
    }
    if (family === 'ps3') {
        return decodePS3(data);
    }
    if (family !== 'ps4' && family !== 'ps5') {
        throw new GamepadError('UNSUPPORTED', `No PlayStation decoder for ${family}.`);
    }
    const bluetoothId = family === 'ps4' ? 0x11 : 0x31;
    if (data[0] !== 0x01 && data[0] !== bluetoothId) {
        return null;
    }

    let offset = 1;
    let simple = false;
    if (data[0] === bluetoothId) {
        if (data.length !== 78) {
            throw new GamepadError('INVALID_REPORT', 'Bluetooth input must contain 78 bytes.');
        }
        verifyBluetoothCRC(data);
        offset = family === 'ps4' ? 3 : 2;
    } else {
        simple = data.length === 10 || (family === 'ps5' && data.length === 78);
        if (!simple && data.length !== 64) {
            throw new GamepadError(
                'INVALID_REPORT',
                'USB input must contain 64 bytes; simple Bluetooth input must contain 10 bytes.',
            );
        }
    }
    const modern = family === 'ps5' && !simple;
    const buttonOffset = offset + (modern ? 7 : 4);
    const triggerOffset = offset + (modern ? 4 : 7);
    const a = data[buttonOffset];
    const b = data[buttonOffset + 1];
    const c = data[buttonOffset + 2];
    const buttons = modernButtons(a, b, c);
    buttons.leftTrigger = { value: data[triggerOffset] / 255, pressed: !!(b & 0x04) };
    buttons.rightTrigger = { value: data[triggerOffset + 1] / 255, pressed: !!(b & 0x08) };
    if (modern) {
        buttons.mute = !!(c & 0x04);
    }
    return { axes: axes(data, offset), buttons };
}
