import { GamepadError, requireNumber } from './errors.js';

export const BUTTONS = Object.freeze([
    'south',
    'east',
    'west',
    'north',
    'leftShoulder',
    'rightShoulder',
    'leftTrigger',
    'rightTrigger',
    'back',
    'start',
    'leftStick',
    'rightStick',
    'dpadUp',
    'dpadDown',
    'dpadLeft',
    'dpadRight',
    'home',
    'touchpad',
    'mute',
    'share',
    'paddle1',
    'paddle2',
    'paddle3',
    'paddle4',
]);

export const AXES = Object.freeze(['leftX', 'leftY', 'rightX', 'rightY']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finite(value, name) {
    if (!Number.isFinite(value)) {
        throw new GamepadError('INVALID_SAMPLE', `${name} must be finite.`);
    }
    return value;
}

/** Radial deadzone, continuous at the boundary, with a unit-circle output. */
export function applyDeadzone(x, y, deadzone = 0.12) {
    requireNumber(deadzone, 'deadzone', 0, 1, true);
    x = clamp(finite(x, 'x'), -1, 1);
    y = clamp(finite(y, 'y'), -1, 1);
    const length = Math.hypot(x, y);
    if (length <= deadzone) {
        return Object.freeze({ x: 0, y: 0 });
    }
    const scale = (Math.min(length, 1) - deadzone) / ((1 - deadzone) * length);
    return Object.freeze({ x: x * scale, y: y * scale });
}

function normalizeButton(input = 0, threshold) {
    const object = typeof input === 'object' && input !== null;
    const raw = object ? input.value : input;
    const value = clamp(finite(typeof raw === 'boolean' ? Number(raw) : raw, 'button'), 0, 1);
    const pressed =
        object && typeof input.pressed === 'boolean' ? input.pressed : value > threshold;
    const touched = object && typeof input.touched === 'boolean' ? input.touched : pressed;
    return Object.freeze({ value, pressed, touched });
}

export function normalizeState(sample, { deadzone, buttonThreshold }, sequence, timestamp) {
    if (!sample || typeof sample !== 'object') {
        throw new GamepadError('INVALID_SAMPLE', 'A sample object is required.');
    }
    const left = applyDeadzone(sample.axes?.leftX ?? 0, sample.axes?.leftY ?? 0, deadzone);
    const right = applyDeadzone(sample.axes?.rightX ?? 0, sample.axes?.rightY ?? 0, deadzone);
    const axes = Object.freeze({ leftX: left.x, leftY: left.y, rightX: right.x, rightY: right.y });
    const buttons = Object.freeze(
        Object.fromEntries(
            BUTTONS.map((name) => [name, normalizeButton(sample.buttons?.[name], buttonThreshold)]),
        ),
    );
    return Object.freeze({ sequence, timestamp: finite(timestamp, 'timestamp'), axes, buttons });
}

export function changesBetween(previous, current, epsilon) {
    const axes = AXES.filter(
        (name) => Math.abs(current.axes[name] - previous.axes[name]) > epsilon,
    );
    const buttons = BUTTONS.filter((name) => {
        const a = previous.buttons[name];
        const b = current.buttons[name];
        return (
            a.pressed !== b.pressed ||
            a.touched !== b.touched ||
            Math.abs(a.value - b.value) > epsilon
        );
    });
    return { axes, buttons };
}

export function createDescriptor(input) {
    if (!input || typeof input.id !== 'string' || input.id.length === 0) {
        throw new GamepadError('INVALID_DEVICE', 'Device id must be a nonempty string.');
    }
    const capabilities = input.capabilities ?? {};
    return Object.freeze({
        id: input.id,
        name: input.name ?? 'Unknown controller',
        family: input.family ?? 'generic',
        transport: input.transport ?? 'unknown',
        vendorId: input.vendorId ?? null,
        productId: input.productId ?? null,
        mapping: input.mapping ?? null,
        capabilities: Object.freeze({
            rumble: capabilities.rumble === true,
            pressure: capabilities.pressure === true,
            axes: Object.freeze([...(capabilities.axes ?? AXES)]),
            buttons: Object.freeze([...(capabilities.buttons ?? BUTTONS.slice(0, 17))]),
        }),
    });
}
