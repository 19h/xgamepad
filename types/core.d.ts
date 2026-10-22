export type Family = 'ps2' | 'ps3' | 'ps4' | 'ps5' | 'xbox' | 'generic';
export type AxisName = 'leftX' | 'leftY' | 'rightX' | 'rightY';
export type ButtonName =
    | 'south'
    | 'east'
    | 'west'
    | 'north'
    | 'leftShoulder'
    | 'rightShoulder'
    | 'leftTrigger'
    | 'rightTrigger'
    | 'back'
    | 'start'
    | 'leftStick'
    | 'rightStick'
    | 'dpadUp'
    | 'dpadDown'
    | 'dpadLeft'
    | 'dpadRight'
    | 'home'
    | 'touchpad'
    | 'mute'
    | 'share'
    | 'paddle1'
    | 'paddle2'
    | 'paddle3'
    | 'paddle4';

export interface ButtonState {
    readonly value: number;
    readonly pressed: boolean;
    readonly touched: boolean;
}

export interface State {
    readonly sequence: number;
    /** Monotonic seconds, local to this process/page. */
    readonly timestamp: number;
    readonly axes: Readonly<Record<AxisName, number>>;
    readonly buttons: Readonly<Record<ButtonName, ButtonState>>;
}

export interface Capabilities {
    readonly rumble: boolean;
    readonly pressure: boolean;
    readonly axes: readonly AxisName[];
    readonly buttons: readonly ButtonName[];
}

export interface DeviceDescriptor {
    readonly id: string;
    readonly name: string;
    readonly family: Family;
    readonly transport: string;
    readonly vendorId: number | null;
    readonly productId: number | null;
    readonly mapping: string | null;
    readonly capabilities: Capabilities;
}

export type DeviceInput = Pick<DeviceDescriptor, 'id'> &
    Partial<Omit<DeviceDescriptor, 'id' | 'capabilities'>> & {
        capabilities?: Partial<Capabilities>;
    };

export interface Sample {
    axes?: Partial<Record<AxisName, number>>;
    buttons?: Partial<
        Record<
            ButtonName,
            | number
            | boolean
            | {
                  value: number;
                  pressed?: boolean;
                  touched?: boolean;
              }
        >
    >;
}

export interface BackendSink {
    connect(device: DeviceInput): void;
    update(id: string, sample: Sample): void;
    disconnect(id: string): void;
    error(error: Error, id?: string): void;
}

export interface RumbleOptions {
    low?: number;
    high?: number;
    /** Seconds, from 0 through 60. */
    duration?: number;
}

export interface Backend {
    start(sink: BackendSink): void | Promise<void>;
    stop(): void | Promise<void>;
    rumble?(id: string, options: Required<RumbleOptions>): void | Promise<void>;
}

export interface ManagerOptions {
    backend?: Backend;
    deadzone?: number;
    buttonThreshold?: number;
    epsilon?: number;
    now?: () => number;
}

export interface ConnectionEvent {
    readonly controller: Controller;
}
export interface DisconnectEvent extends ConnectionEvent {
    readonly state: State;
}
export interface StateEvent extends DisconnectEvent {
    readonly previous: State;
}
export interface ButtonEvent extends StateEvent {
    readonly button: ButtonName;
    readonly value: ButtonState;
}
export interface AxisEvent extends StateEvent {
    readonly axis: AxisName;
    readonly value: number;
}
export interface ChangeEvent extends StateEvent {
    readonly axes: readonly AxisName[];
    readonly buttons: readonly ButtonName[];
}
export interface ErrorEvent {
    readonly error: Error;
    readonly id?: string;
}
export interface ControllerEvents {
    state: StateEvent;
    change: ChangeEvent;
    button: ButtonEvent;
    buttondown: ButtonEvent;
    buttonup: ButtonEvent;
    axis: AxisEvent;
    disconnect: DisconnectEvent;
}
export interface ManagerEvents extends ControllerEvents {
    connect: ConnectionEvent;
    error: ErrorEvent;
    stop: Readonly<Record<string, never>>;
}
export interface SubscriptionOptions {
    signal?: AbortSignal;
}
export interface StreamOptions extends SubscriptionOptions {
    capacity?: number;
}
export interface EventStream<T> extends AsyncIterableIterator<T> {
    readonly dropped: number;
}

export class Controller {
    private constructor();
    readonly id: string;
    readonly descriptor: DeviceDescriptor;
    readonly state: State;
    readonly connected: boolean;
    on<K extends keyof ControllerEvents>(
        type: K,
        listener: (event: ControllerEvents[K]) => void,
        options?: SubscriptionOptions,
    ): () => void;
    once<K extends keyof ControllerEvents>(
        type: K,
        listener: (event: ControllerEvents[K]) => void,
        options?: SubscriptionOptions,
    ): () => void;
    rumble(options?: RumbleOptions): Promise<void>;
}

export class GamepadManager {
    constructor(options: ManagerOptions & { backend: Backend });
    readonly status: 'stopped' | 'starting' | 'running' | 'stopping';
    readonly controllers: readonly Controller[];
    get(id: string): Controller | undefined;
    start(): Promise<this>;
    stop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    on<K extends keyof ManagerEvents>(
        type: K,
        listener: (event: ManagerEvents[K]) => void,
        options?: SubscriptionOptions,
    ): () => void;
    once<K extends keyof ManagerEvents>(
        type: K,
        listener: (event: ManagerEvents[K]) => void,
        options?: SubscriptionOptions,
    ): () => void;
    rumble(id: string, options?: RumbleOptions): Promise<void>;
    events<K extends keyof ManagerEvents = 'change'>(
        type?: K,
        options?: StreamOptions,
    ): EventStream<ManagerEvents[K]>;
}

export class GamepadError extends Error {
    constructor(code: string, message: string, options?: ErrorOptions);
    readonly code: string;
}
export const AXES: readonly AxisName[];
export const BUTTONS: readonly ButtonName[];
export function applyDeadzone(
    x: number,
    y: number,
    deadzone?: number,
): Readonly<{ x: number; y: number }>;
