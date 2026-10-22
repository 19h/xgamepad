import { EventHub } from './events.js';
import { GamepadError, requireNumber } from './errors.js';
import { changesBetween, createDescriptor, normalizeState } from './state.js';

const clock = () => performance.now() / 1000;
const constructionKey = Symbol('Controller');
const controllerData = new WeakMap();

function dispatch(controller, manager, type, event) {
    const failures = [];
    for (const emitter of [controller, manager]) {
        try {
            emitter.emit(type, event);
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length) {
        throw failures.length === 1
            ? failures[0]
            : new AggregateError(failures, `Dispatch of ${type} failed.`);
    }
}

export class Controller extends EventHub {
    #manager;
    #descriptor;

    constructor(key, manager, descriptor, state) {
        super();
        if (key !== constructionKey) {
            throw new TypeError('Controllers are created by GamepadManager.');
        }
        this.#manager = manager;
        this.#descriptor = descriptor;
        controllerData.set(this, { state, baseline: state, connected: true });
    }

    get id() {
        return this.#descriptor.id;
    }
    get descriptor() {
        return this.#descriptor;
    }
    get state() {
        return controllerData.get(this).state;
    }
    get connected() {
        return controllerData.get(this).connected;
    }

    rumble(options) {
        return this.#manager.rumble(this.id, options, this);
    }
}

export class GamepadManager extends EventHub {
    #backend;
    #options;
    #clock;
    #controllers = new Map();
    #status = 'stopped';
    #queue = Promise.resolve();
    #generation = 0;

    constructor({
        backend,
        deadzone = 0.12,
        buttonThreshold = 0.5,
        epsilon = 0.001,
        now = clock,
    } = {}) {
        super();
        if (typeof backend?.start !== 'function' || typeof backend?.stop !== 'function') {
            throw new TypeError('A backend with start(sink) and stop() is required.');
        }
        if (typeof now !== 'function') {
            throw new TypeError('now must be a function returning monotonic seconds.');
        }
        requireNumber(deadzone, 'deadzone', 0, 1, true);
        requireNumber(buttonThreshold, 'buttonThreshold', 0, 1, true);
        requireNumber(epsilon, 'epsilon', 0, 1);
        this.#backend = backend;
        this.#options = { deadzone, buttonThreshold, epsilon };
        this.#clock = now;
    }

    get status() {
        return this.#status;
    }
    get controllers() {
        return Object.freeze([...this.#controllers.values()]);
    }
    get(id) {
        return this.#controllers.get(id);
    }

    #enqueue(operation) {
        const pending = this.#queue.then(operation);
        this.#queue = pending.catch(() => {});
        return pending;
    }

    start() {
        return this.#enqueue(async () => {
            if (this.#status === 'running') {
                return this;
            }
            this.#status = 'starting';
            const generation = ++this.#generation;
            const active = () => generation === this.#generation;
            const sink = Object.freeze({
                connect: (device) => active() && this.#connect(device),
                update: (id, sample) => active() && this.#update(id, sample),
                disconnect: (id) => active() && this.#disconnect(id),
                error: (error, id) => active() && this.emit('error', Object.freeze({ error, id })),
            });
            try {
                await this.#backend.start(sink);
                this.#status = 'running';
            } catch (error) {
                const failures = [error];
                ++this.#generation;
                try {
                    await this.#backend.stop();
                } catch (cleanupError) {
                    failures.push(cleanupError);
                }
                failures.push(...this.#finishStop());
                throw failures.length === 1
                    ? error
                    : new AggregateError(failures, 'Backend startup and cleanup failed.');
            }
            return this;
        });
    }

    stop() {
        return this.#enqueue(async () => {
            if (this.#status === 'stopped') {
                return;
            }
            this.#status = 'stopping';
            ++this.#generation;
            const failures = [];
            try {
                await this.#backend.stop();
            } catch (error) {
                failures.push(error);
            }
            failures.push(...this.#finishStop());
            if (failures.length) {
                throw failures.length === 1
                    ? failures[0]
                    : new AggregateError(failures, 'Backend cleanup failed.');
            }
        });
    }

    async [Symbol.asyncDispose]() {
        await this.stop();
    }

    #finishStop() {
        this.#status = 'stopped';
        const failures = [];
        for (const id of this.#controllers.keys()) {
            try {
                this.#disconnect(id);
            } catch (error) {
                failures.push(error);
            }
        }
        try {
            this.emit('stop', Object.freeze({}));
        } catch (error) {
            failures.push(error);
        }
        return failures;
    }

    #connect(input) {
        const descriptor = createDescriptor(input);
        if (this.#controllers.has(descriptor.id)) {
            return;
        }
        const state = normalizeState({}, this.#options, 0, this.#clock());
        const controller = new Controller(constructionKey, this, descriptor, state);
        this.#controllers.set(controller.id, controller);
        this.emit('connect', Object.freeze({ controller }));
    }

    #disconnect(id) {
        const controller = this.#controllers.get(id);
        if (!controller) {
            return;
        }
        this.#controllers.delete(id);
        controllerData.get(controller).connected = false;
        const event = Object.freeze({ controller, state: controller.state });
        dispatch(controller, this, 'disconnect', event);
    }

    #update(id, sample) {
        const controller = this.#controllers.get(id);
        if (!controller) {
            return;
        }
        const previous = controller.state;
        const state = normalizeState(sample, this.#options, previous.sequence + 1, this.#clock());
        const data = controllerData.get(controller);
        const changed = changesBetween(data.baseline, state, this.#options.epsilon);
        data.state = state;
        data.baseline = {
            axes: { ...data.baseline.axes },
            buttons: { ...data.baseline.buttons },
        };
        for (const name of changed.axes) {
            data.baseline.axes[name] = state.axes[name];
        }
        for (const name of changed.buttons) {
            data.baseline.buttons[name] = state.buttons[name];
        }
        const base = { controller, state, previous };
        const emit = (type, detail = {}) => {
            const event = Object.freeze({ ...base, ...detail });
            dispatch(controller, this, type, event);
        };
        emit('state');
        for (const button of changed.buttons) {
            const value = state.buttons[button];
            if (value.pressed !== previous.buttons[button].pressed) {
                emit(value.pressed ? 'buttondown' : 'buttonup', { button, value });
            }
            emit('button', { button, value });
        }
        for (const axis of changed.axes) {
            emit('axis', { axis, value: state.axes[axis] });
        }
        if (changed.axes.length || changed.buttons.length) {
            emit('change', {
                axes: Object.freeze(changed.axes),
                buttons: Object.freeze(changed.buttons),
            });
        }
    }

    async rumble(id, { low = 1, high = 1, duration = 0.2 } = {}, expectedController) {
        const controller = this.#controllers.get(id);
        if (!controller || (expectedController && controller !== expectedController)) {
            throw new GamepadError('DISCONNECTED', `Controller ${id} is disconnected.`);
        }
        requireNumber(low, 'low', 0, 1);
        requireNumber(high, 'high', 0, 1);
        requireNumber(duration, 'duration', 0, 60);
        if (
            !controller.descriptor.capabilities.rumble ||
            typeof this.#backend.rumble !== 'function'
        ) {
            throw new GamepadError(
                'UNSUPPORTED',
                'This controller/backend does not expose rumble.',
            );
        }
        await this.#backend.rumble(id, { low, high, duration });
    }

    /** Bounded event stream. Slow consumers lose oldest events; no unbounded queue. */
    events(type = 'change', { signal, capacity = 64 } = {}) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) {
            throw new RangeError('capacity must be a positive safe integer.');
        }
        const queue = [];
        let pending;
        let closed = signal?.aborted === true || this.#status === 'stopped';
        let dropped = 0;
        const off = this.on(type, (value) => {
            if (pending) {
                const resolve = pending;
                pending = undefined;
                resolve({ value, done: false });
            } else {
                if (queue.length === capacity) {
                    queue.shift();
                    ++dropped;
                }
                queue.push(value);
            }
        });
        const finish = () => {
            closed = true;
            queue.length = 0;
            off();
            offStop();
            signal?.removeEventListener('abort', finish);
            pending?.({ value: undefined, done: true });
            pending = undefined;
        };
        const offStop = this.on('stop', finish);
        signal?.addEventListener('abort', finish, { once: true });
        if (closed) {
            finish();
        }
        return {
            get dropped() {
                return dropped;
            },
            [Symbol.asyncIterator]() {
                return this;
            },
            next() {
                if (queue.length) {
                    return Promise.resolve({ value: queue.shift(), done: false });
                }
                if (closed) {
                    return Promise.resolve({ value: undefined, done: true });
                }
                if (pending) {
                    return Promise.reject(new Error('Only one next() may be pending.'));
                }
                return new Promise((resolve) => {
                    pending = resolve;
                });
            },
            return() {
                finish();
                return Promise.resolve({ value: undefined, done: true });
            },
        };
    }
}
