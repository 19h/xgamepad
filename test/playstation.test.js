import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePlayStationReport, playStationProfiles } from '../src/hid.js';
import { crc32 } from '../src/hid/playstation.js';

function report(family, transport = 'usb') {
    const bluetooth = transport === 'bluetooth';
    const simple = transport === 'simple';
    const data = new Uint8Array(family === 'ps3' ? 49 : simple ? 10 : bluetooth ? 78 : 64);
    const offset = family === 'ps3' ? 6 : bluetooth ? (family === 'ps4' ? 3 : 2) : 1;
    data[0] = bluetooth ? (family === 'ps4' ? 0x11 : 0x31) : 1;
    data.fill(128, offset, offset + 4);
    if (family !== 'ps3') {
        data[offset + (family === 'ps5' && !simple ? 7 : 4)] = 8;
    }
    return {
        data,
        offset,
        seal() {
            if (bluetooth) {
                new DataView(data.buffer).setUint32(
                    data.length - 4,
                    crc32(data.subarray(0, -4), [0xa1]),
                    true,
                );
            }
            return data;
        },
    };
}

test('CRC-32/ISO-HDLC implementation matches the standard check vector', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

for (const family of ['ps3', 'ps4', 'ps5']) {
    for (const transport of family === 'ps3' ? ['usb'] : ['usb', 'bluetooth', 'simple']) {
        test(`${family} ${transport}: neutral sticks, directions, trigger and face controls`, () => {
            const f = report(family, transport);
            let result = decodePlayStationReport(family, f.seal());
            assert.deepEqual(result.axes, { leftX: 0, leftY: 0, rightX: 0, rightY: 0 });
            assert.equal(Number(result.buttons.south.value ?? result.buttons.south), 0);
            f.data[f.offset] = 0;
            f.data[f.offset + 1] = 255;
            if (family === 'ps3') {
                f.data[2] = 0x10;
                f.data[3] = 0x41;
                f.data[18] = 128;
                f.data[24] = 64;
            } else {
                const modern = family === 'ps5' && transport !== 'simple';
                const b = f.offset + (modern ? 7 : 4);
                f.data[b] = 0x21;
                f.data[b + 1] = 0x04;
                f.data[f.offset + (modern ? 4 : 7)] = 128;
            }
            result = decodePlayStationReport(family, f.seal());
            assert.equal(result.axes.leftX, -1);
            assert.equal(result.axes.leftY, 1);
            assert.equal(result.buttons.south.pressed ?? result.buttons.south, true);
            assert.equal(result.buttons.leftTrigger.value, 128 / 255);
            assert.equal(result.buttons.dpadUp.pressed ?? result.buttons.dpadUp, true);
        });
    }
}

test('PS3 preserves every pressure channel and corresponding digital flag', () => {
    const f = report('ps3');
    f.data[2] = 0xf0;
    f.data[3] = 0xff;
    const names = [
        'dpadUp',
        'dpadRight',
        'dpadDown',
        'dpadLeft',
        'leftTrigger',
        'rightTrigger',
        'leftShoulder',
        'rightShoulder',
        'north',
        'east',
        'south',
        'west',
    ];
    names.forEach((name, index) => {
        f.data[14 + index] = index + 1;
    });
    const decoded = decodePlayStationReport('ps3', f.data);
    names.forEach((name, index) => {
        assert.equal(decoded.buttons[name].value, (index + 1) / 255);
        assert.equal(decoded.buttons[name].pressed, true);
    });
});

for (const family of ['ps4', 'ps5']) {
    test(`${family}: all 8 hat positions and invalid hats`, () => {
        const expected = [
            'U',
            'UR',
            'R',
            'DR',
            'D',
            'DL',
            'L',
            'UL',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
        ];
        for (let h = 0; h < 16; ++h) {
            const f = report(family);
            f.data[f.offset + (family === 'ps5' ? 7 : 4)] = h;
            const { buttons } = decodePlayStationReport(family, f.data);
            assert.equal(buttons.dpadUp, expected[h].includes('U'));
            assert.equal(buttons.dpadRight, expected[h].includes('R'));
            assert.equal(buttons.dpadDown, expected[h].includes('D'));
            assert.equal(buttons.dpadLeft, expected[h].includes('L'));
        }
    });

    test(`${family}: Bluetooth corruption is rejected, including typed-array slices`, () => {
        const f = report(family, 'bluetooth');
        const valid = f.seal();
        const buffer = new Uint8Array(100);
        buffer.set(valid, 7);
        assert.ok(decodePlayStationReport(family, buffer.subarray(7, 85)));
        buffer[20] ^= 1;
        assert.throws(() => decodePlayStationReport(family, buffer.subarray(7, 85)), {
            code: 'CRC_MISMATCH',
        });
    });

    test(`${family}: every truncated full report is rejected`, () => {
        const f = report(family);
        for (let length = 1; length < 64; ++length) {
            if (length === 10) {
                continue;
            }
            assert.throws(() => decodePlayStationReport(family, f.data.subarray(0, length)), {
                code: 'INVALID_REPORT',
            });
        }
    });
}

test('DualSense mute and touchpad clicks use their actual bit positions', () => {
    const f = report('ps5');
    f.data[10] = 0x07;
    const { buttons } = decodePlayStationReport('ps5', f.data);
    assert.equal(buttons.home, true);
    assert.equal(buttons.touchpad, true);
    assert.equal(buttons.mute, true);
});

test('unknown report types are ignored, malformed inputs and unknown families fail', () => {
    assert.equal(decodePlayStationReport('ps3', Uint8Array.of(0x02)), null);
    assert.equal(decodePlayStationReport('ps5', Uint8Array.of(0x02)), null);
    assert.throws(() => decodePlayStationReport('ps3', Uint8Array.of(1)), {
        code: 'INVALID_REPORT',
    });
    assert.throws(() => decodePlayStationReport('ps4', new Uint8Array()), {
        code: 'INVALID_REPORT',
    });
    assert.throws(() => decodePlayStationReport('ps5', [1, 2]), { code: 'INVALID_REPORT' });
    assert.throws(() => decodePlayStationReport('ps2', Uint8Array.of(1)), { code: 'UNSUPPORTED' });
    const f = report('ps3');
    f.data[1] = 0xff;
    assert.equal(decodePlayStationReport('ps3', f.data), null);
});

test('HID profiles match Sony gamepads and reject unrelated interfaces or vendors', () => {
    const ps5 = playStationProfiles.find((profile) => profile.id === 'ps5');
    assert.ok(ps5.match({ vendorId: 0x054c, productId: 0x0ce6, usagePage: 1, usage: 5 }));
    assert.ok(!ps5.match({ vendorId: 0x054c, productId: 0x0ce6, usagePage: 1, usage: 6 }));
    assert.ok(!ps5.match({ vendorId: 0x054c, productId: 0x0ce6, usagePage: 12, usage: 1 }));
    assert.ok(!ps5.match({ vendorId: 0x045e, productId: 0x0ce6 }));
});
