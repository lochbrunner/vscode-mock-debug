/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

// import { logger } from '@vscode/debugadapter';
import { EventEmitter } from './orig/eventEmitter';


export interface IRuntimeBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

interface IRuntimeStepInTargets {
	id: number;
	label: string;
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

interface RuntimeDisassembledInstruction {
	address: number;
	instruction: string;
	line?: number;
}

export type IRuntimeVariableType = number | boolean | string | RuntimeVariable[];

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

interface Word {
	name: string;
	line: number;
	index: number;
}

export function timeout(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// interface Variable {
// 	name: string;
// 	type: string;
// }

// interface Frame {
// 	local_variables: Variable[];
// }

interface Assignment {
	linenumber: number;
	filename: string;
	localVariables: RuntimeVariable[];
}

/**
 * A Mock runtime with minimal debugger functionality.
 * MockRuntime is a hypothetical (aka "Mock") "execution engine with debugging support":
 * it takes a Markdown (*.md) file and "executes" it by "running" through the text lines
 * and searching for "command" patterns that trigger some debugger related functionality (e.g. exceptions).
 * When it finds a command it typically emits an event.
 * The runtime can not only run through the whole file but also executes one line at a time
 * and stops on lines for which a breakpoint has been registered. This functionality is the
 * core of the "debugging support".
 * Since the MockRuntime is completely independent from VS Code or the Debug Adapter Protocol,
 * it can be viewed as a simplified representation of a real "execution engine" (e.g. node.js)
 * or debugger (e.g. gdb).
 * When implementing your own debugger extension for VS Code, you probably don't need this
 * class because you can rely on some existing debugger or runtime.
 */
export class MockRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string = '';
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private sourceLines: string[] = [];
	private instructions: Word[] = [];

	// This is the next line that will be 'executed'
	// private _currentLine = 0;
	private get currentLine() {
		return this.assignments[this.caret].linenumber;
	}

	// This is the next instruction that will be 'executed'
	public instruction = 0;

	// maps from sourceFile to array of IRuntimeBreakpoint
	// private breakPoints = new Map<string, IRuntimeBreakpoint[]>();

	// all instruction breakpoint addresses
	private instructionBreakpoints = new Set<number>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private breakpointId = 1;

	private breakAddresses = new Map<string, string>();

	private assignments: Assignment[];
	private caret: number;

	constructor() {
		super();
		const filename = '/home/matthias/workspace/github/lochbrunner/vscode-mock-debug/sampleWorkspace/readme.md';
		this.assignments = [
			{ linenumber: 1, filename, localVariables: [new RuntimeVariable('local_1', 1), new RuntimeVariable('local_2', 2)] },
			{ linenumber: 2, filename, localVariables: [new RuntimeVariable('local_1', 2), new RuntimeVariable('local_4', 4)] },
			{ linenumber: 3, filename, localVariables: [new RuntimeVariable('local_1', 1), new RuntimeVariable('local_4', 2)] },
			{ linenumber: 4, filename, localVariables: [new RuntimeVariable('local_1', 4), new RuntimeVariable('local_2', 2)] },
			{ linenumber: 5, filename, localVariables: [new RuntimeVariable('local_1', 3), new RuntimeVariable('local_2', 2)] },
			{ linenumber: 6, filename, localVariables: [new RuntimeVariable('local_1', 4), new RuntimeVariable('local_2', 2)] },
			{ linenumber: 7, filename, localVariables: [new RuntimeVariable('local_1', 7), new RuntimeVariable('local_2', 2)] },
			{ linenumber: 8, filename, localVariables: [new RuntimeVariable('local_1', 9), new RuntimeVariable('local_2', 2)] },
			{ linenumber: 9, filename, localVariables: [new RuntimeVariable('local_1', 10), new RuntimeVariable('local_2', 2)] },
		];
		this.caret = 0;
	}

	/**
	 * Start executing the given program.
	 */
	public async start(program: string, stopOnEntry: boolean, debug: boolean): Promise<void> {
		console.info(`start ${program} ${stopOnEntry} ${debug}`);

		if (debug) {

			this.caret = 0;
			this.sendEvent('stopOnEntry');
		} else {
			this.continue(false);
		}
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue(reverse: boolean) {
		console.info(`continue ${reverse}`);

		// Do we have breakpoints?
		if (this.breakAddresses) {
			const assignments = reverse ? this.assignments.slice().reverse() : this.assignments;
			for (const assignment of assignments) {
				if (this.breakAddresses.has(assignment.filename) && this.breakAddresses.get(assignment.filename) === assignment.linenumber.toString()) {
					this.caret = this.assignments.indexOf(assignment);
					this.sendEvent('stopOnBreakpoint');
					break;
				}
			}
		}
		else {
			const delta = reverse ? -1 : 1;
			this.caret = (this.caret + delta + this.assignments.length) % this.assignments.length;
			this.sendEvent('stopOnBreakpoint');
		}
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(instruction: boolean, reverse: boolean) {
		console.info(`step ${instruction} ${reverse}`);
		if (!reverse) {
			this.caret = (this.caret + 1) % this.assignments.length;
		} else {
			this.caret = (this.caret - 1 + this.assignments.length) % this.assignments.length;
		}
		this.sendEvent('stopOnStep');
	}

	/**
	 * "Step into" for Mock debug means: go to next character
	 */
	public stepIn(targetId: number | undefined) {
		console.info(`stepIn ${targetId}`);
		this.step(false, false);
	}

	/**
	 * "Step out" for Mock debug means: go to previous character
	 */
	public stepOut() {
		console.info('stepOut');
		this.step(false, false);
	}

	public getStepInTargets(frameId: number): IRuntimeStepInTargets[] {
		console.info(`getStepInTargets ${frameId}`);

		const line = this.getLine();
		const words = this.getWords(this.currentLine, line);

		// return nothing if frameId is out of range
		if (frameId < 0 || frameId >= words.length) {
			return [];
		}

		const { name, index } = words[frameId];

		// make every character of the frame a potential "step in" target
		return name.split('').map((c, ix) => {
			return {
				id: index + ix,
				label: `target: ${c}`
			};
		});
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): IRuntimeStack {
		console.info(`stack ${startFrame} ${endFrame}`);
		const alignment = this.assignments[this.caret];
		return { count: 0, frames: [{ index: 0, name: 'frame_name', file: alignment.filename, line: alignment.linenumber }] };

		return {
			frames: [],
			count: 0
		};
	}

	/*
	 * Determine possible column breakpoint positions for the given line.
	 * Here we return the start location of words with more than 8 characters.
	 */
	public getBreakpoints(path: string, line: number): number[] {
		const breakPoint = this.breakAddresses.get(path);
		if (breakPoint === undefined || line !== parseInt(breakPoint)) {
			console.info(`getBreakpoints ${path} ${line} (empty)`);
			return [];
		}
		else {
			console.info(`getBreakpoints ${path} ${line} (match)`);
			return [0];
		}
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public async setBreakPoint(path: string, line: number): Promise<IRuntimeBreakpoint> {
		console.info(`setBreakPoint ${path} ${line}`);
		this.breakAddresses.set(path, line.toString());
		return { verified: true, line, id: this.breakpointId++ };
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number): IRuntimeBreakpoint | undefined {
		console.info(`clearBreakPoint ${path} ${line}`);
		return undefined;
	}

	public clearBreakpoints(path: string): void {
		this.breakAddresses.clear();
		console.info(`clearBreakpoints ${path}`);
	}

	public setDataBreakpoint(address: string, accessType: 'read' | 'write' | 'readWrite'): boolean {
		console.info(`setDataBreakpoint ${address} ${accessType}`);
		return true;
	}

	public clearAllDataBreakpoints(): void {
		console.info('clearAllDataBreakpoints');
	}

	public setExceptionsFilters(namedException: string | undefined, otherExceptions: boolean): void {
	}

	public setInstructionBreakpoint(address: number): boolean {
		this.instructionBreakpoints.add(address);
		return true;
	}

	public clearInstructionBreakpoints(): void {
		this.instructionBreakpoints.clear();
	}

	public async getGlobalVariables(cancellationToken?: () => boolean): Promise<RuntimeVariable[]> {

		let a: RuntimeVariable[] = [];

		for (let i = 0; i < 10; i++) {
			a.push(new RuntimeVariable(`global_${i}`, i));
			if (cancellationToken && cancellationToken()) {
				break;
			}
		}
		await timeout(100);

		return a;
	}

	public getLocalVariables(): RuntimeVariable[] {
		console.info('getLocalVariables');
		// return Array.from(this.variables, ([name, value]) => value);
		// return [new RuntimeVariable('local_1', 1), new RuntimeVariable('local_4', 2)];
		return this.assignments[this.caret].localVariables;
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

	/**
	 * Return words of the given address range as "instructions"
	 */
	public disassemble(address: number, instructionCount: number): RuntimeDisassembledInstruction[] {

		const instructions: RuntimeDisassembledInstruction[] = [];

		for (let a = address; a < address + instructionCount; a++) {
			if (a >= 0 && a < this.instructions.length) {
				instructions.push({
					address: a,
					instruction: this.instructions[a].name,
					line: this.instructions[a].line
				});
			} else {
				instructions.push({
					address: a,
					instruction: 'nop'
				});
			}
		}

		return instructions;
	}

	// private methods

	private getLine(line?: number): string {
		return this.sourceLines[line === undefined ? this.currentLine : line].trim();
	}

	private getWords(l: number, line: string): Word[] {
		// break line into words
		const WORD_REGEXP = /[a-z]+/ig;
		const words: Word[] = [];
		let match: RegExpExecArray | null;
		while (match = WORD_REGEXP.exec(line)) {
			words.push({ name: match[0], line: l, index: match.index });
		}
		return words;
	}

	private sendEvent(event: string, ...args: any[]): void {
		setTimeout(() => {
			this.emit(event, ...args);
		}, 0);
	}

}
