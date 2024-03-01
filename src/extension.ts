/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/*
 * extension.ts (and activateMockDebug.ts) forms the "plugin" that plugs into VS Code and contains the code that
 * connects VS Code with the debug adapter.
 * 
 * extension.ts contains code for launching the debug adapter in three different ways:
 * - as an external program communicating with VS Code via stdin/stdout,
 * - as a server process communicating with VS Code via sockets or named pipes, or
 * - as inlined code running in the extension itself (default).
 * 
 * Since the code in extension.ts uses node.js APIs it cannot run in the browser.
 */

'use strict';

import * as vscode from 'vscode';
import { MockDebugSession } from './mockDebug';

export function activateMockDebug(context: vscode.ExtensionContext) {

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.mock-debug.runEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'mock',
					name: 'Run File',
					request: 'launch',
					program: targetResource.fsPath
				},
					{ noDebug: true }
				);
			}
		}),
		vscode.commands.registerCommand('extension.mock-debug.debugEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'mock',
					name: 'Debug File',
					request: 'launch',
					program: targetResource.fsPath,
					stopOnEntry: true
				});
			}
		}),
		vscode.commands.registerCommand('extension.mock-debug.toggleFormatting', (variable) => {
			const ds = vscode.debug.activeDebugSession;
			if (ds) {
				ds.customRequest('toggleFormatting');
			}
		})
	);

	context.subscriptions.push(vscode.commands.registerCommand('extension.mock-debug.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the name of a markdown file in the workspace folder",
			value: "readme.md"
		});
	}));

	// register a configuration provider for 'mock' debug type
	const provider = new MockConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mock', provider));

	// register a dynamic configuration provider for 'mock' debug type
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mock', {
		provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined): vscode.ProviderResult<vscode.DebugConfiguration[]> {
			return [
				{
					name: "Mock Launch",
					request: "launch",
					type: "mock",
					program: "${file}"
				}
			];
		}
	}, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

	const factory = new InlineDebugAdapterFactory();

	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('mock', factory));
	// if ('dispose' in factory) {
	context.subscriptions.push(factory);
	// }

	// override VS Code's default implementation of the debug hover
	// here we match only Mock "variables", that are words starting with an '$'
	context.subscriptions.push(vscode.languages.registerEvaluatableExpressionProvider('markdown', {
		provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.EvaluatableExpression> {

			const VARIABLE_REGEXP = /\$[a-z][a-z0-9]*/ig;
			const line = document.lineAt(position.line).text;

			let m: RegExpExecArray | null;
			while (m = VARIABLE_REGEXP.exec(line)) {
				const varRange = new vscode.Range(position.line, m.index, position.line, m.index + m[0].length);

				if (varRange.contains(position)) {
					return new vscode.EvaluatableExpression(varRange);
				}
			}
			return undefined;
		}
	}));

	// override VS Code's default implementation of the "inline values" feature"
	context.subscriptions.push(vscode.languages.registerInlineValuesProvider('markdown', {

		provideInlineValues(document: vscode.TextDocument, viewport: vscode.Range, context: vscode.InlineValueContext): vscode.ProviderResult<vscode.InlineValue[]> {

			const allValues: vscode.InlineValue[] = [];

			for (let l = viewport.start.line; l <= context.stoppedLocation.end.line; l++) {
				const line = document.lineAt(l);
				var regExp = /\$([a-z][a-z0-9]*)/ig;	// variables are words starting with '$'
				do {
					var m = regExp.exec(line.text);
					if (m) {
						const varName = m[1];
						const varRange = new vscode.Range(l, m.index, l, m.index + varName.length);

						// some literal text
						//allValues.push(new vscode.InlineValueText(varRange, `${varName}: ${viewport.start.line}`));

						// value found via variable lookup
						allValues.push(new vscode.InlineValueVariableLookup(varRange, varName, false));

						// value determined via expression evaluation
						//allValues.push(new vscode.InlineValueEvaluatableExpression(varRange, varName));
					}
				} while (m);
			}

			return allValues;
		}
	}));
}

class MockConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'markdown') {
				config.type = 'mock';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new MockDebugSession());
	}

	dispose() {
		// nothing to dispose
	}
}


export function activate(context: vscode.ExtensionContext) {
	activateMockDebug(context);

}

export function deactivate() {
	// nothing to do
}

