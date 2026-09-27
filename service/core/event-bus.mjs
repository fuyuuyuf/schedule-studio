import { EventEmitter } from 'node:events';

export class ApplicationEventBus {
  #emitter = new EventEmitter();

  on(eventName, listener) {
    this.#emitter.on(eventName, listener);
    return () => this.#emitter.off(eventName, listener);
  }

  emit(eventName, payload) {
    this.#emitter.emit(eventName, structuredClone(payload));
  }
}
