import { BUTTONS } from '../core/state.js';
import { decodePlayStationReport } from './playstation.js';

const products = { ps3: [0x0268], ps4: [0x05c4, 0x09cc, 0x0ba0], ps5: [0x0ce6, 0x0df2] };

export const playStationProfiles = Object.freeze(
    Object.entries(products).map(([family, ids]) =>
        Object.freeze({
            id: family,
            match: (device) =>
                device.vendorId === 0x054c &&
                ids.includes(device.productId) &&
                (device.usagePage == null || device.usagePage === 0 || device.usagePage === 1) &&
                (device.usage == null || device.usage === 0 || [4, 5].includes(device.usage)),
            decode: (data) => decodePlayStationReport(family, data),
            describe: () => ({
                family,
                capabilities: {
                    pressure: family === 'ps3',
                    rumble: false,
                    buttons: BUTTONS.slice(0, family === 'ps5' ? 19 : family === 'ps4' ? 18 : 17),
                },
            }),
        }),
    ),
);
