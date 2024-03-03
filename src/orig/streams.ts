export interface EventEmitter {
  addListener(event: string | symbol, listener: (...args: any[]) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string | symbol): this;
  setMaxListeners(n: number): this;
  getMaxListeners(): number;
  listeners(event: string | symbol): Function[];
  rawListeners(event: string | symbol): Function[];
  emit(event: string | symbol, ...args: any[]): boolean;
  listenerCount(event: string | symbol): number;
  // Added in Node 6...
  prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
  eventNames(): Array<string | symbol>;
}

export interface ReadableStream extends EventEmitter {
  readable: boolean;
  read(size?: number): string | Buffer;
  setEncoding(encoding: BufferEncoding): this;
  pause(): this;
  resume(): this;
  isPaused(): boolean;
  pipe<T extends WritableStream>(destination: T, options?: { end?: boolean; }): T;
  unpipe(destination?: WritableStream): this;
  unshift(chunk: string | Uint8Array, encoding?: BufferEncoding): void;
  wrap(oldStream: ReadableStream): this;
  [Symbol.asyncIterator](): AsyncIterableIterator<string | Buffer>;
}

export interface WritableStream extends EventEmitter {
  writable: boolean;
  write(buffer: Uint8Array | string, cb?: (err?: Error | null) => void): boolean;
  write(str: string, encoding?: BufferEncoding, cb?: (err?: Error | null) => void): boolean;
  end(cb?: () => void): void;
  end(data: string | Uint8Array, cb?: () => void): void;
  end(str: string, encoding?: BufferEncoding, cb?: () => void): void;
}