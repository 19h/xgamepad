import { GamepadManager } from './core/manager.js';
import { createSDLBackend } from './backends/sdl.js';

export { GamepadManager, Controller } from './core/manager.js';
export { GamepadError } from './core/errors.js';
export { BUTTONS, AXES, applyDeadzone } from './core/state.js';
export { createSDLBackend } from './backends/sdl.js';

export function createGamepadManager({ backend = createSDLBackend(), ...options } = {}) {
    return new GamepadManager({ ...options, backend });
}
