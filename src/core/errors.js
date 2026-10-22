/** Machine-readable errors shared by every transport. */
export class GamepadError extends Error {
    constructor(code, message, options) {
        super(message, options);
        this.name = 'GamepadError';
        this.code = code;
    }
}

export function requireNumber(value, name, min, max, exclusiveMax = false) {
    if (!Number.isFinite(value) || value < min || (exclusiveMax ? value >= max : value > max)) {
        const closing = exclusiveMax ? ')' : ']';
        throw new RangeError(`${name} must be a finite number in [${min}, ${max}${closing}.`);
    }
    return value;
}
