import { DebugProtocol } from '@vscode/debugprotocol';
import { DebugProtocolAdapter, RuntimeVariable } from './nnDebugAdapter';

interface Assignment {
  linenumber: number;
  filename: string;
}

interface IRuntimeStackFrame {
  index: number;
  name: string;
  file: string;
  line: number;
  column?: number;
  instruction?: number;
}

interface IRuntimeStack {
  count: number;
  frames: IRuntimeStackFrame[];
}

export class NnMockDebugSession extends DebugProtocolAdapter {

  private assignments: Assignment[];
  private caret: number;

  constructor() {
    super();
    const filename = '/home/matthias/workspace/github/lochbrunner/vscode-mock-debug/sampleWorkspace/readme.md';
    this.assignments = [
      { linenumber: 1, filename },
      { linenumber: 2, filename },
      { linenumber: 3, filename },
      { linenumber: 4, filename },
      { linenumber: 5, filename },
      { linenumber: 6, filename },
      { linenumber: 7, filename },
      { linenumber: 8, filename },
      { linenumber: 9, filename },
    ];
    this.caret = 0;
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments, request?: DebugProtocol.Request): void {
    // console.info('launchRequest triggered');
    // await this._configurationDone.wait(1000);
    // TODO: Wait for the configuration to be done
    await this._configurationDone.wait(1000);
    this.sendResponse(response);
    setTimeout(() => {
      this.stopOn('entry');
    }, 1000);
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments, request?: DebugProtocol.Request): void {
    console.info('nextRequest');
    this.caret = (this.caret + 1) % this.assignments.length;
    this.stopOn('step');
    this.sendResponse(response);
  }

  protected stack(startFrame: number, endFrame: number): IRuntimeStack {
    return { count: 0, frames: [] };
  }

  protected getLocalVariables(): RuntimeVariable[] {
    return [new RuntimeVariable('local_1', 1), new RuntimeVariable('local_2', 2)];
  }

  protected getGlobalVariables(): RuntimeVariable[] {
    return [];
  }

  public getLocalVariable(name: string): RuntimeVariable | undefined {
    console.info(`getLocalVariable ${name}`);
    // return this.variables.get(name);
    if (name === 'local_1') {
      return new RuntimeVariable('local_1', 1);
    } else if (name === 'local_2') {
      return new RuntimeVariable('local_2', 2);
    }
  }

  // private sendEvent(event: string, ...args: any[]): void {
  //   setImmediate(() => { this.emit(event, ...args); });
  // }
}