/** Small synchronous emitter with explicit, removable subscriptions. */
export class EventHub {
    #listeners = new Map();

    on(type, listener, { signal } = {}) {
        if (typeof type !== 'string' || typeof listener !== 'function') {
            throw new TypeError('An event name and listener function are required.');
        }
        if (signal?.aborted) {
            return () => {};
        }
        let listeners = this.#listeners.get(type);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(type, listeners);
        }
        const subscription = { listener };
        const off = () => {
            listeners.delete(subscription);
            if (listeners.size === 0) {
                this.#listeners.delete(type);
            }
            signal?.removeEventListener('abort', off);
        };
        listeners.add(subscription);
        signal?.addEventListener('abort', off, { once: true });
        return off;
    }

    once(type, listener, options) {
        if (typeof listener !== 'function') {
            throw new TypeError('A listener function is required.');
        }
        const off = this.on(
            type,
            (event) => {
                off();
                listener(event);
            },
            options,
        );
        return off;
    }

    emit(type, event) {
        const failures = [];
        for (const { listener } of [...(this.#listeners.get(type) ?? [])]) {
            try {
                listener(event);
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length) {
            throw failures.length === 1
                ? failures[0]
                : new AggregateError(failures, `Listeners for ${type} failed.`);
        }
    }
}
