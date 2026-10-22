import { GamepadManager } from './core/manager.js';
import { createBrowserBackend } from './backends/browser.js';

export { GamepadManager, Controller } from './core/manager.js';
export { GamepadError } from './core/errors.js';
export { BUTTONS, AXES, applyDeadzone } from './core/state.js';
export { createBrowserBackend, standardGamepadMapping } from './backends/browser.js';

export function createGamepadManager({ backend = createBrowserBackend(), ...options } = {}) {
    return new GamepadManager({ ...options, backend });
}
