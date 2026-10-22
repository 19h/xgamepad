import type { Backend, DeviceInput, Sample } from './core.js';

export interface HIDDevice {
    path?: string;
    vendorId: number;
    productId: number;
    product?: string;
    manufacturer?: string;
    serialNumber?: string;
    usagePage?: number;
    usage?: number;
    interface?: number;
    release?: number;
}

export interface HIDHandle {
    getFeatureReport(id: number, length: number): Promise<Uint8Array>;
    sendFeatureReport(data: number[] | Uint8Array): Promise<number>;
    write(data: number[] | Uint8Array): Promise<number>;
}

export interface HIDProfile {
    readonly id: string;
    match(device: HIDDevice): boolean;
    decode(report: Uint8Array, device: HIDDevice): Sample | null;
    describe?(device: HIDDevice): Partial<Omit<DeviceInput, 'id'>>;
}
export interface HIDBackend extends Backend {
    refresh(): Promise<void>;
}
export interface HIDBackendOptions {
    hid?: unknown;
    profiles?: readonly HIDProfile[];
    /** Seconds; 0 disables periodic enumeration. */
    pollInterval?: number;
    nonExclusive?: boolean;
    initialize?: (handle: HIDHandle, device: HIDDevice) => void | Promise<void>;
}

export function createHIDBackend(options?: HIDBackendOptions): HIDBackend;
export function decodePlayStationReport(
    family: 'ps3' | 'ps4' | 'ps5',
    data: Uint8Array,
): Sample | null;
export const playStationProfiles: readonly HIDProfile[];
