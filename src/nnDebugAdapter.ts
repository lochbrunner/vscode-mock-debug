import * as vscode from 'vscode';
import { basename } from 'path-browserify';
import { Handles, StoppedEvent, StackFrame, Source, ErrorDestination } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

export class Message implements DebugProtocol.ProtocolMessage {
  seq: number;
  type: string;

  public constructor(type: string) {
    this.seq = 0;
    this.type = type;
  }
}

export class Response extends Message implements DebugProtocol.Response {
  request_seq: number;
  success: boolean;
  command: string;

  public constructor(request: DebugProtocol.Request, message?: string) {
    super('response');
    this.request_seq = request.seq;
    this.command = request.command;
    if (message) {
      this.success = false;
      (<any>this).message = message;
    } else {
      this.success = true;
    }
  }
}

interface IDisposable {
  dispose(): void;
}

class Disposable0 implements IDisposable {
  dispose(): any {
  }
}

interface Event0<T> {
  (listener: (e: T) => any, thisArg?: any): Disposable0;
}

export interface IRuntimeStackFrame {
  index: number;
  name: string;
  file: string;
  line: number;
  column?: number;
  instruction?: number;
}

export interface IRuntimeStack {
  count: number;
  frames: IRuntimeStackFrame[];
}


class Emitter<T> {

  private _event?: Event0<T>;
  private _listener?: (e: T) => void;
  private _this?: any;

  get event(): Event0<T> {
    if (!this._event) {
      this._event = (listener: (e: T) => any, thisArg?: any) => {

        this._listener = listener;
        console.log(`Setting listener to ${listener}`);
        this._this = thisArg;

        let result: IDisposable;
        result = {
          dispose: () => {
            this._listener = undefined;
            this._this = undefined;
          }
        };
        return result;
      };
    }
    return this._event;
  }

  fire(event: T): void {
    if (this._listener) {
      try {
        this._listener.call(this._this, event);
      } catch (e) {
        console.warn(`Could not fire: ${e}`);
      }
    }
    else {
      console.warn(`No listener to fire to`);
    }
  }

  hasListener(): boolean {
    return !!this._listener;
  }

  dispose() {
    this._listener = undefined;
    this._this = undefined;
  }
}

export class RuntimeVariable {
  private _memory?: Uint8Array;

  public reference?: number;

  public get value() {
    return this._value;
  }

  public set value(value: IRuntimeVariableType) {
    this._value = value;
    this._memory = undefined;
  }

  public get memory() {
    if (this._memory === undefined && typeof this._value === 'string') {
      this._memory = new TextEncoder().encode(this._value);
    }
    return this._memory;
  }

  constructor(public readonly name: string, private _value: IRuntimeVariableType) { }

  public setMemory(data: Uint8Array, offset = 0) {
    const memory = this.memory;
    if (!memory) {
      return;
    }

    memory.set(data, offset);
    this._memory = memory;
    this._value = new TextDecoder().decode(memory);
  }
}


export type IRuntimeVariableType = number | boolean | string | RuntimeVariable[];

const _formatPIIRegexp = /{([^}]+)}/g;

function formatPII(format: string, excludePII: boolean, args?: { [key: string]: string }): string {
  const safeArgs = args || {};
  return format.replace(_formatPIIRegexp, function (match, paramName) {
    if (excludePII && paramName.length > 0 && paramName[0] !== '_') {
      return match;
    }
    return safeArgs[paramName] && safeArgs.hasOwnProperty(paramName) ?
      safeArgs[paramName] :
      match;
  });
}

export class DebugProtocolAdapter implements vscode.DebugAdapter {

  /**
   * An event which fires after the debug adapter has sent a Debug Adapter Protocol message to the editor.
   * Messages can be requests, responses, or events.
   */
  readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage>;

  private _sendMessage = new Emitter<vscode.DebugProtocolMessage>();
  private _pendingRequests = new Map<number, (response: DebugProtocol.Response) => void>();
  private _debuggerLinesStartAt1: boolean;
  private _clientColumnsStartAt1: boolean;
  private _debuggerColumnsStartAt1: boolean;
  private _clientLinesStartAt1: boolean;
  private _addressesInHex = true;
  private _valuesInHex = false;
  private _variableHandles = new Handles<'locals' | 'globals' | RuntimeVariable>();

  constructor(obsolete_debuggerLinesAndColumnsStartAt1?: boolean) {
    const linesAndColumnsStartAt1 = typeof obsolete_debuggerLinesAndColumnsStartAt1 === 'boolean' ? obsolete_debuggerLinesAndColumnsStartAt1 : false;
    this.onDidSendMessage = this._sendMessage.event;
    this._clientColumnsStartAt1 = true;
    this._clientLinesStartAt1 = true;
    this._debuggerColumnsStartAt1 = linesAndColumnsStartAt1;
    this._debuggerLinesStartAt1 = linesAndColumnsStartAt1;
  }

  /**
   * Handle a Debug Adapter Protocol message.
   * Messages can be requests, responses, or events.
   * Results or errors are returned via onSendMessage events.
   * @param message A Debug Adapter Protocol message
   */
  handleMessage(msg: DebugProtocol.ProtocolMessage): void {
    if (msg.type === 'request') {
      this.dispatchRequest(<DebugProtocol.Request>msg);
    } else if (msg.type === 'response') {
      const response = <DebugProtocol.Response>msg;
      const clb = this._pendingRequests.get(response.request_seq);
      if (clb) {
        this._pendingRequests.delete(response.request_seq);
        clb(response);
      }
    }

  }

  private _send(typ: 'request' | 'response' | 'event', message: DebugProtocol.ProtocolMessage): void {

    message.type = typ;
    console.info(`Firing ${JSON.stringify(message)}`);
    this._sendMessage.fire(message);
  }

  public sendResponse(response: DebugProtocol.Response): void {
    if (response.seq > 0) {
      console.error(`attempt to send more than one response for command ${response.command}`);
    } else {
      response.type = 'response';
      this._send('response', response);
    }
  }

  protected sendErrorResponse(response: DebugProtocol.Response, codeOrMessage: number | DebugProtocol.Message, format?: string, variables?: any, dest: ErrorDestination = ErrorDestination.User): void {

    let msg: DebugProtocol.Message;
    if (typeof codeOrMessage === 'number') {
      msg = <DebugProtocol.Message>{
        id: <number>codeOrMessage,
        format: format
      };
      if (variables) {
        msg.variables = variables;
      }
      if (dest & ErrorDestination.User) {
        msg.showUser = true;
      }
      if (dest & ErrorDestination.Telemetry) {
        msg.sendTelemetry = true;
      }
    } else {
      msg = codeOrMessage;
    }

    response.success = false;
    response.message = formatPII(msg.format, true, msg.variables);
    if (!response.body) {
      response.body = {};
    }
    response.body.error = msg;

    this.sendResponse(response);
  }

  protected sendEvent(event: DebugProtocol.Event): void {
    setImmediate(() => { this._send('event', event); });
    // this._send('event', event);
  }

  protected stopOn(what: 'entry' | 'step' | 'data breakpoint' | 'breakpoint' | 'exception'): void {
    this.sendEvent(new StoppedEvent(what, 1));
  }

  protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected gotoRequest(response: DebugProtocol.GotoResponse, args: DebugProtocol.GotoArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected terminateThreadsRequest(response: DebugProtocol.TerminateThreadsResponse, args: DebugProtocol.TerminateThreadsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments, request?: DebugProtocol.Request): void {

    const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
    const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
    const endFrame = startFrame + maxLevels;

    const stk = this.stack(startFrame, endFrame);

    response.body = {
      stackFrames: stk.frames.map((f, ix) => {
        const sf: DebugProtocol.StackFrame = new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line));
        if (typeof f.column === 'number') {
          sf.column = this.convertDebuggerColumnToClient(f.column);
        }
        if (typeof f.instruction === 'number') {
          const address = this.formatAddress(f.instruction);
          sf.name = `${f.name} ${address}`;
          sf.instructionPointerReference = address;
        }

        return sf;
      }),
      // 4 options for 'totalFrames':
      //omit totalFrames property: 	// VS Code has to probe/guess. Should result in a max. of two requests
      totalFrames: stk.count			// stk.count is the correct size, should result in a max. of two requests
      //totalFrames: 1000000 			// not the correct size, should result in a max. of two requests
      //totalFrames: endFrame + 20 	// dynamically increases the size with every requested chunk, results in paging
    };
    this.sendResponse(response);
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request): void {
    let vs: RuntimeVariable[] = [];
    const v = this._variableHandles.get(args.variablesReference);
    if (v === 'locals') {
      vs = this.getLocalVariables();
    } else if (v === 'globals') {
      // vs = await this.getGlobalVariables();
      vs = this.getGlobalVariables();
    }
    else if (v && Array.isArray(v.value)) {
      vs = v.value;
    }
    response.body = {
      variables: vs.map(v => this.convertFromRuntime(v))
    };
    this.sendResponse(response);
  }

  protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected setExpressionRequest(response: DebugProtocol.SetExpressionResponse, args: DebugProtocol.SetExpressionArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected stepInTargetsRequest(response: DebugProtocol.StepInTargetsResponse, args: DebugProtocol.StepInTargetsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected loadedSourcesRequest(response: DebugProtocol.LoadedSourcesResponse, args: DebugProtocol.LoadedSourcesArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, args: DebugProtocol.DataBreakpointInfoArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse, args: DebugProtocol.SetDataBreakpointsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected readMemoryRequest(response: DebugProtocol.ReadMemoryResponse, args: DebugProtocol.ReadMemoryArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected writeMemoryRequest(response: DebugProtocol.WriteMemoryResponse, args: DebugProtocol.WriteMemoryArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected disassembleRequest(response: DebugProtocol.DisassembleResponse, args: DebugProtocol.DisassembleArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected setInstructionBreakpointsRequest(response: DebugProtocol.SetInstructionBreakpointsResponse, args: DebugProtocol.SetInstructionBreakpointsArguments, request?: DebugProtocol.Request): void {
    this.sendResponse(response);
  }

  protected stack(startFrame: number, endFrame: number): IRuntimeStack {
    return { count: 0, frames: [] };
  }

  protected getLocalVariables(): RuntimeVariable[] {
    return [];
  }

  protected getGlobalVariables(): RuntimeVariable[] {
    return [];
  }

  public getLocalVariable(name: string): RuntimeVariable | undefined {
    return undefined;
  }


  // public async getGlobalVariables(cancellationToken?: () => boolean): Promise<RuntimeVariable[]> {

  //   let a: RuntimeVariable[] = [];

  //   await timeout(1000);

  //   return a;
  // }

  protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
    if (!response.body) {
      return;
    }
    // This default debug adapter does not support conditional breakpoints.
    response.body.supportsConditionalBreakpoints = false;

    // This default debug adapter does not support hit conditional breakpoints.
    response.body.supportsHitConditionalBreakpoints = false;

    // This default debug adapter does not support function breakpoints.
    response.body.supportsFunctionBreakpoints = false;

    // This default debug adapter implements the 'configurationDone' request.
    response.body.supportsConfigurationDoneRequest = true;

    // This default debug adapter does not support hovers based on the 'evaluate' request.
    response.body.supportsEvaluateForHovers = false;

    // This default debug adapter does not support the 'stepBack' request.
    response.body.supportsStepBack = false;

    // This default debug adapter does not support the 'setVariable' request.
    response.body.supportsSetVariable = false;

    // This default debug adapter does not support the 'restartFrame' request.
    response.body.supportsRestartFrame = false;

    // This default debug adapter does not support the 'stepInTargets' request.
    response.body.supportsStepInTargetsRequest = false;

    // This default debug adapter does not support the 'gotoTargets' request.
    response.body.supportsGotoTargetsRequest = false;

    // This default debug adapter does not support the 'completions' request.
    response.body.supportsCompletionsRequest = false;

    // This default debug adapter does not support the 'restart' request.
    response.body.supportsRestartRequest = false;

    // This default debug adapter does not support the 'exceptionOptions' attribute on the 'setExceptionBreakpoints' request.
    response.body.supportsExceptionOptions = false;

    // This default debug adapter does not support the 'format' attribute on the 'variables', 'evaluate', and 'stackTrace' request.
    response.body.supportsValueFormattingOptions = false;

    // This debug adapter does not support the 'exceptionInfo' request.
    response.body.supportsExceptionInfoRequest = false;

    // This debug adapter does not support the 'TerminateDebuggee' attribute on the 'disconnect' request.
    response.body.supportTerminateDebuggee = false;

    // This debug adapter does not support delayed loading of stack frames.
    response.body.supportsDelayedStackTraceLoading = false;

    // This debug adapter does not support the 'loadedSources' request.
    response.body.supportsLoadedSourcesRequest = false;

    // This debug adapter does not support the 'logMessage' attribute of the SourceBreakpoint.
    response.body.supportsLogPoints = false;

    // This debug adapter does not support the 'terminateThreads' request.
    response.body.supportsTerminateThreadsRequest = false;

    // This debug adapter does not support the 'setExpression' request.
    response.body.supportsSetExpression = false;

    // This debug adapter does not support the 'terminate' request.
    response.body.supportsTerminateRequest = false;

    // This debug adapter does not support data breakpoints.
    response.body.supportsDataBreakpoints = false;

    /** This debug adapter does not support the 'readMemory' request. */
    response.body.supportsReadMemoryRequest = false;

    /** The debug adapter does not support the 'disassemble' request. */
    response.body.supportsDisassembleRequest = false;

    /** The debug adapter does not support the 'cancel' request. */
    response.body.supportsCancelRequest = false;

    /** The debug adapter does not support the 'breakpointLocations' request. */
    response.body.supportsBreakpointLocationsRequest = false;

    /** The debug adapter does not support the 'clipboard' context value in the 'evaluate' request. */
    response.body.supportsClipboardContext = false;

    /** The debug adapter does not support stepping granularities for the stepping requests. */
    response.body.supportsSteppingGranularity = false;

    /** The debug adapter does not support the 'setInstructionBreakpoints' request. */
    response.body.supportsInstructionBreakpoints = false;

    /** The debug adapter does not support 'filterOptions' on the 'setExceptionBreakpoints' request. */
    response.body.supportsExceptionFilterOptions = false;

    this.sendEvent({ "seq": 0, "type": "event", "event": "initialized" });
    this.sendResponse(response);
  }

  private dispatchRequest(request: DebugProtocol.Request): void {
    const response = new Response(request);
    if (request.command === 'initialize') {
      var args = <DebugProtocol.InitializeRequestArguments>request.arguments;

      if (typeof args.linesStartAt1 === 'boolean') {
        this._clientLinesStartAt1 = args.linesStartAt1;
      }
      if (typeof args.columnsStartAt1 === 'boolean') {
        this._clientColumnsStartAt1 = args.columnsStartAt1;
      }

      if (args.pathFormat !== 'path') {
        this.sendErrorResponse(response, 2018, 'debug adapter only supports native paths', null, ErrorDestination.Telemetry);
      } else {
        const initializeResponse = <DebugProtocol.InitializeResponse>response;
        initializeResponse.body = {};
        this.initializeRequest(initializeResponse, args);
      }

    }
    else if (request.command === 'launch') {
      this.launchRequest(<DebugProtocol.LaunchResponse>response, request.arguments, request);

    } else if (request.command === 'attach') {
      this.attachRequest(<DebugProtocol.AttachResponse>response, request.arguments, request);

    } else if (request.command === 'disconnect') {
      this.disconnectRequest(<DebugProtocol.DisconnectResponse>response, request.arguments, request);

    } else if (request.command === 'terminate') {
      this.terminateRequest(<DebugProtocol.TerminateResponse>response, request.arguments, request);

    } else if (request.command === 'restart') {
      this.restartRequest(<DebugProtocol.RestartResponse>response, request.arguments, request);

    } else if (request.command === 'setBreakpoints') {
      this.setBreakPointsRequest(<DebugProtocol.SetBreakpointsResponse>response, request.arguments, request);

    } else if (request.command === 'setFunctionBreakpoints') {
      this.setFunctionBreakPointsRequest(<DebugProtocol.SetFunctionBreakpointsResponse>response, request.arguments, request);

    } else if (request.command === 'setExceptionBreakpoints') {
      this.setExceptionBreakPointsRequest(<DebugProtocol.SetExceptionBreakpointsResponse>response, request.arguments, request);

    } else if (request.command === 'configurationDone') {
      this.configurationDoneRequest(<DebugProtocol.ConfigurationDoneResponse>response, request.arguments, request);

    } else if (request.command === 'continue') {
      this.continueRequest(<DebugProtocol.ContinueResponse>response, request.arguments, request);

    } else if (request.command === 'next') {
      this.nextRequest(<DebugProtocol.NextResponse>response, request.arguments, request);

    } else if (request.command === 'stepIn') {
      this.stepInRequest(<DebugProtocol.StepInResponse>response, request.arguments, request);

    } else if (request.command === 'stepOut') {
      this.stepOutRequest(<DebugProtocol.StepOutResponse>response, request.arguments, request);

    } else if (request.command === 'stepBack') {
      this.stepBackRequest(<DebugProtocol.StepBackResponse>response, request.arguments, request);

    } else if (request.command === 'reverseContinue') {
      this.reverseContinueRequest(<DebugProtocol.ReverseContinueResponse>response, request.arguments, request);

    } else if (request.command === 'restartFrame') {
      this.restartFrameRequest(<DebugProtocol.RestartFrameResponse>response, request.arguments, request);

    } else if (request.command === 'goto') {
      this.gotoRequest(<DebugProtocol.GotoResponse>response, request.arguments, request);

    } else if (request.command === 'pause') {
      this.pauseRequest(<DebugProtocol.PauseResponse>response, request.arguments, request);

    } else if (request.command === 'stackTrace') {
      this.stackTraceRequest(<DebugProtocol.StackTraceResponse>response, request.arguments, request);

    } else if (request.command === 'scopes') {
      this.scopesRequest(<DebugProtocol.ScopesResponse>response, request.arguments, request);

    } else if (request.command === 'variables') {
      this.variablesRequest(<DebugProtocol.VariablesResponse>response, request.arguments, request);

    } else if (request.command === 'setVariable') {
      this.setVariableRequest(<DebugProtocol.SetVariableResponse>response, request.arguments, request);

    } else if (request.command === 'setExpression') {
      this.setExpressionRequest(<DebugProtocol.SetExpressionResponse>response, request.arguments, request);

    } else if (request.command === 'source') {
      this.sourceRequest(<DebugProtocol.SourceResponse>response, request.arguments, request);

    } else if (request.command === 'threads') {
      this.threadsRequest(<DebugProtocol.ThreadsResponse>response, request);

    } else if (request.command === 'terminateThreads') {
      this.terminateThreadsRequest(<DebugProtocol.TerminateThreadsResponse>response, request.arguments, request);

    } else if (request.command === 'evaluate') {
      this.evaluateRequest(<DebugProtocol.EvaluateResponse>response, request.arguments, request);

    } else if (request.command === 'stepInTargets') {
      this.stepInTargetsRequest(<DebugProtocol.StepInTargetsResponse>response, request.arguments, request);

    } else if (request.command === 'gotoTargets') {
      this.gotoTargetsRequest(<DebugProtocol.GotoTargetsResponse>response, request.arguments, request);

    } else if (request.command === 'completions') {
      this.completionsRequest(<DebugProtocol.CompletionsResponse>response, request.arguments, request);

    } else if (request.command === 'exceptionInfo') {
      this.exceptionInfoRequest(<DebugProtocol.ExceptionInfoResponse>response, request.arguments, request);

    } else if (request.command === 'loadedSources') {
      this.loadedSourcesRequest(<DebugProtocol.LoadedSourcesResponse>response, request.arguments, request);

    } else if (request.command === 'dataBreakpointInfo') {
      this.dataBreakpointInfoRequest(<DebugProtocol.DataBreakpointInfoResponse>response, request.arguments, request);

    } else if (request.command === 'setDataBreakpoints') {
      this.setDataBreakpointsRequest(<DebugProtocol.SetDataBreakpointsResponse>response, request.arguments, request);

    } else if (request.command === 'readMemory') {
      this.readMemoryRequest(<DebugProtocol.ReadMemoryResponse>response, request.arguments, request);

    } else if (request.command === 'writeMemory') {
      this.writeMemoryRequest(<DebugProtocol.WriteMemoryResponse>response, request.arguments, request);

    } else if (request.command === 'disassemble') {
      this.disassembleRequest(<DebugProtocol.DisassembleResponse>response, request.arguments, request);

    } else if (request.command === 'cancel') {
      this.cancelRequest(<DebugProtocol.CancelResponse>response, request.arguments, request);

    } else if (request.command === 'breakpointLocations') {
      this.breakpointLocationsRequest(<DebugProtocol.BreakpointLocationsResponse>response, request.arguments, request);

    } else if (request.command === 'setInstructionBreakpoints') {
      this.setInstructionBreakpointsRequest(<DebugProtocol.SetInstructionBreakpointsResponse>response, request.arguments, request);

    } else {
      console.error(`unknown request '${request.command}'`);
    }
  }

  private convertFromRuntime(v: RuntimeVariable): DebugProtocol.Variable {

    let dapVariable: DebugProtocol.Variable = {
      name: v.name,
      value: '???',
      type: typeof v.value,
      variablesReference: 0,
      evaluateName: '$' + v.name
    };

    if (v.name.indexOf('lazy') >= 0) {
      // a "lazy" variable needs an additional click to retrieve its value

      dapVariable.value = 'lazy var';		// placeholder value
      v.reference ??= this._variableHandles.create(new RuntimeVariable('', [new RuntimeVariable('', v.value)]));
      dapVariable.variablesReference = v.reference;
      dapVariable.presentationHint = { lazy: true };
    } else {

      if (Array.isArray(v.value)) {
        dapVariable.value = 'Object';
        v.reference ??= this._variableHandles.create(v);
        dapVariable.variablesReference = v.reference;
      } else {

        switch (typeof v.value) {
          case 'number':
            if (Math.round(v.value) === v.value) {
              dapVariable.value = this.formatNumber(v.value);
              (<any>dapVariable).__vscodeVariableMenuContext = 'simple';	// enable context menu contribution
              dapVariable.type = 'integer';
            } else {
              dapVariable.value = v.value.toString();
              dapVariable.type = 'float';
            }
            break;
          case 'string':
            dapVariable.value = `"${v.value}"`;
            break;
          case 'boolean':
            dapVariable.value = v.value ? 'true' : 'false';
            break;
          default:
            dapVariable.value = typeof v.value;
            break;
        }
      }
    }

    if (v.memory) {
      v.reference ??= this._variableHandles.create(v);
      dapVariable.memoryReference = String(v.reference);
    }

    return dapVariable;
  }

  private convertDebuggerColumnToClient(column: number): number {
    if (this._debuggerColumnsStartAt1) {
      return this._clientColumnsStartAt1 ? column : column - 1;
    }
    return this._clientColumnsStartAt1 ? column + 1 : column;
  }

  private formatAddress(x: number, pad = 8) {
    return 'mem' + (this._addressesInHex ? '0x' + x.toString(16).padStart(8, '0') : x.toString(10));
  }

  private formatNumber(x: number) {
    return this._valuesInHex ? '0x' + x.toString(16) : x.toString(10);
  }

  private createSource(filePath: string): Source {
    return new Source(basename(filePath), filePath, undefined, undefined, 'mock-adapter-data');
  }

  private convertDebuggerLineToClient(line: number): number {
    if (this._debuggerLinesStartAt1) {
      return this._clientLinesStartAt1 ? line : line - 1;
    }
    return this._clientLinesStartAt1 ? line + 1 : line;
  }


  dispose(): any { }
}