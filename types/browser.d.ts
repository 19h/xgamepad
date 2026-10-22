export * from './core.js';
import type { Backend, DeviceInput, GamepadManager, ManagerOptions, Sample } from './core.js';

export interface BrowserBackendOptions {
    navigator?: Pick<Navigator, 'getGamepads'>;
    requestFrame?: (callback: FrameRequestCallback) => number;
    cancelFrame?: (handle: number) => void;
    mapGamepad?: (gamepad: Gamepad) => Sample | null | undefined;
    mapDevice?: (gamepad: Gamepad) => Partial<Omit<DeviceInput, 'id'>>;
}

export function standardGamepadMapping(gamepad: Gamepad): Sample;
export function createBrowserBackend(options?: BrowserBackendOptions): Backend;
export function createGamepadManager(options?: ManagerOptions): GamepadManager;
