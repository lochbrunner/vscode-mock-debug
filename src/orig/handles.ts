/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class Handles<T> {
	private startHandle = 1000;


	private _nextHandle: number;
	private _handleMap = new Map<number, T>();

	public constructor(startHandle?: number) {
		this._nextHandle = typeof startHandle === 'number' ? startHandle : this.startHandle;
	}

	public reset(): void {
		this._nextHandle = this.startHandle;
		this._handleMap = new Map<number, T>();
	}

	public create(value: T): number {
		var handle = this._nextHandle++;
		this._handleMap.set(handle, value);
		return handle;
	}

	public get(handle: number, defaultValue?: T): T | undefined {
		return this._handleMap.get(handle) || defaultValue;
	}
}
