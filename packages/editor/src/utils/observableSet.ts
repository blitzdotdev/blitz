type SetEvent = "add" | "delete" | "clear";
type Listener<T> = (value?: T) => void;

export class ObservableSet<T> extends Set<T> {
    private listeners: Record<SetEvent, Set<Listener<T>>> = {
        add: new Set(),
        delete: new Set(),
        clear: new Set(),
    };

    on(event: SetEvent, listener: Listener<T>) {
        this.listeners[event].add(listener);
        return () => this.listeners[event].delete(listener); // unsubscribe
    }
    off(event: SetEvent, listener: Listener<T>) {
        this.listeners[event].delete(listener);
    }

    toArray() {
        return Array.from(this);
    }

    private emit(event: SetEvent, value?: T) {
        for (const listener of this.listeners[event]) listener(value);
    }

    override add(value: T) {
        if (!this.has(value)) {
            super.add(value);
            this.emit("add", value);
        }
        return this;
    }

    override delete(value: T) {
        const deleted = super.delete(value);
        if (deleted) this.emit("delete", value);
        return deleted;
    }

    override clear() {
        if (this.size) {
            super.clear();
            this.emit("clear");
        }
    }
}
