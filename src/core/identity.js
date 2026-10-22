export function identifyFamily({ vendorId, productId, name = '', type = '' }) {
    if (vendorId === 0x054c) {
        if (productId === 0x0268) {
            return 'ps3';
        }
        if ([0x05c4, 0x09cc, 0x0ba0].includes(productId)) {
            return 'ps4';
        }
        if ([0x0ce6, 0x0df2].includes(productId)) {
            return 'ps5';
        }
    }
    if (vendorId === 0x045e || /xbox/i.test(`${type} ${name}`)) {
        return 'xbox';
    }
    if (/ps5|dualsense/i.test(`${type} ${name}`)) {
        return 'ps5';
    }
    if (/ps4|dualshock.?4/i.test(`${type} ${name}`)) {
        return 'ps4';
    }
    if (/ps3|playstation.?3|dualshock.?3/i.test(`${type} ${name}`)) {
        return 'ps3';
    }
    if (/ps2|playstation.?2|dualshock.?2/i.test(`${type} ${name}`)) {
        return 'ps2';
    }
    return 'generic';
}
