export * from './core.js';
import type { Backend, DeviceInput, GamepadManager, ManagerOptions } from './core.js';

export interface SDLDevice {
    id: number;
    name: string | null;
    type: string | null;
    vendor: number | null;
    product: number | null;
    guid: string | null;
    mapping: string | null;
    path: string | null;
}
export interface SDLBackendOptions {
    /** Optional dependency injection, primarily for tests. */
    sdl?: unknown;
    mappings?: string[];
    mapDevice?: (device: SDLDevice) => Partial<Omit<DeviceInput, 'id'>>;
    triggerRest?: (device: SDLDevice) => { left: number; right: number };
}

export function createSDLBackend(options?: SDLBackendOptions): Backend;
export function createGamepadManager(options?: ManagerOptions): GamepadManager;
