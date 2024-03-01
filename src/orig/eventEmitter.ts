type Listener = (...args: any[]) => void;

interface IEvents {
  [event: string]: Listener[]
}

export class EventEmitter {
  private readonly events: IEvents = {};

  public on(event, listener) {
    if (!(event in this.events)) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return () => this.removeListener(event, listener);
  }
  public removeListener(event, listener) {
    if (!(event in this.events)) {
      return;
    }
    const idx = this.events[event].indexOf(listener);
    if (idx > -1) {
      this.events[event].splice(idx, 1);
    }
    if (this.events[event].length === 0) {
      delete this.events[event];
    }
  }
  public emit(event, ...args) {
    if (!(event in this.events)) {
      return;
    }
    this.events[event].forEach(listener => listener(...args));
  }
};