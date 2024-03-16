class Waiter {
  timer?: number = undefined;

  constructor(public resolve: () => void) {
    this.resolve = resolve;
  }

  do() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.resolve();
  }
}

/** A subject that can be awaited on. */
export class Subject {
  private readonly waiters: Waiter[] = [];

  async wait(timeout?: number): Promise<void> {
    const self = this;
    const promise = new Promise<void>((resolve: () => void) => {
      const waiter = new Waiter(resolve);
      if (timeout) {
        waiter.timer = setTimeout(resolve, timeout);
      }
      self.waiters.push(waiter);
    });

    return promise;
  }

  notifyAll() {
    for (const waiter of this.waiters) {
      waiter.do();
    }
  }

  notify() {
    const waiter = this.waiters.pop();
    if (waiter) {
      waiter.do();
    }
  }
}
