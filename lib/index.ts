/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tensor, InferenceSession, env } from 'onnxruntime-web';

export interface SessionResult {
	extensionId: string;
	/**
	 * Confidence between 0 (no confidence) and 1 (maximum confidence)
	 */
	confidence: number;
}
export interface SessionInputs {
	/**
	 * List of extensions that are current installed and enabled.
	 * 
	 * @example ['ms-python.python', 'ms-vscode.csharp']
	 */
	previouslyInstalled?: string[],
	/**
	 * The file types that are currently open in the editor.
	 * Important: Lowercase and includes the '.'
	 * 
	 * @example ['.py', '.js']
	 */
	openedFileTypes?: string[],
	/**
	 * List of extensions that activated in the current session.
	 * 
	 * @example ['ms-python.python', 'ms-vscode.csharp]'
	 */
	activatedExtensions?: string[],
	/**
	 * List of dependencies in the current workspace, based on workspace tags.
	 * 
	 * @see https://github.com/microsoft/vscode/blob/9fb452c4852ef098206ec67a2b236ad5fd0ba828/src/vs/workbench/contrib/tags/electron-sandbox/workspaceTagsService.ts#L303-L563
	 * @example ['workspace.npm.react', 'workspace.npm.playwright']
	 */
	workspaceDependencies?: string[],
	/**
	 * File types in the current workspace.
	 * Important: *Without* the initial '.' (unlike `openedFileTypes`).
	 * 
	 * @see https://github.com/microsoft/vscode/blob/8636541385743e44f861c46e9dfda74de76e8179/src/vs/platform/diagnostics/node/diagnosticsService.ts#L511-L525
	 * @example ['py', 'js']
	 */
	workspaceFileTypes?: string[],
	/**
	 * List of kinds of configuration files in the workspace.
	 * 
	 * @see https://github.com/microsoft/vscode/blob/8636541385743e44f861c46e9dfda74de76e8179/src/vs/platform/diagnostics/node/diagnosticsService.ts#L49-L69
	 * @example ['package.json', 'tsconfig.json']
	 */
	workspaceConfigTypes?: string[]
}

export class SessionOperations {
	private _session: InferenceSession | undefined;
	private _featuresSize: number = 0;
	private _extensionIds: Map<string, number> = new Map();
	private _featureEncodings: Map<string, Map<string, number>> = new Map();
	private _inputTensor?: Int32Array;
	private _outputTensor?: Float32Array;

	private async loadSession() {
		if (this._session) {
			return;
		}
		const fs = await import('fs');
		const path = await import('path');
		const modelPath = path.join(__dirname, '..', 'model');

		env.wasm.numThreads = 1;
		env.wasm.simd = false;
		env.wasm.wasmPaths = {
			'ort-wasm.wasm': path.join(__dirname, '..', 'ort-wasm.wasm')
		};
		this._session = await InferenceSession.create(path.join(modelPath, 'model.onnx'), {
			executionProviders: ['wasm']
		});
		const encodingFile = JSON.parse(await fs.promises.readFile(path.join(modelPath, 'feature_encoding.json'), 'utf8'));
		this._prepareSession(encodingFile);
	}

	private _prepareSession(encodingFile: { [key: string]: { [key: string]: number } }) {
		this._featuresSize = 0;
		for (const [name, encodingList] of Object.entries(encodingFile)) {
			const map = new Map(Object.entries(encodingList));
			this._featuresSize += map.size;
			if (name == 'Extension') {
				this._extensionIds = map;
			} else {
				this._featureEncodings.set(name, map);
			}
		}
		this._inputTensor = new Int32Array(this._extensionIds.size * this._featuresSize);
		this._outputTensor = new Float32Array(this._extensionIds.size);
	}

	/**
	 * 
	 * @param inputs Workspace signals that are used to predict the next extension to be installed.
	 * @param confidencePass Minimum confidence required for each recommended extension.
	 * @param inferenceOptions Override for ORT inference options.
	 * @returns List of extension ids, each with a confidence scores.
	 */
	public async run(inputs: SessionInputs, confidencePass = 0.6, inferenceOptions?: InferenceSession.RunOptions | undefined): Promise<Array<SessionResult>> {
		await this.loadSession();

		const input: Map<string, Set<string>> = new Map();
		if (inputs.previouslyInstalled?.length) {
			input.set('PreviouslyInstalled', new Set(inputs.previouslyInstalled.map(ext => ext.toLowerCase())));
		}
		if (inputs.openedFileTypes?.length) {
			input.set('OpenedFileTypes', new Set(inputs.openedFileTypes.map(ext => ext.toLowerCase().replace(/^(\w)/, '.$1'))));
		}
		if (inputs.activatedExtensions?.length) {
			input.set('ActivatedExts', new Set(inputs.activatedExtensions.map(ext => ext.toLowerCase())));
		}
		if (inputs.workspaceDependencies?.length) {
			input.set('WorkspaceDependencies', new Set(inputs.workspaceDependencies.map(ext => ext.toLowerCase())));
		}
		if (inputs.workspaceFileTypes?.length) {
			input.set('WorkspaceFileTypes', new Set(inputs.workspaceFileTypes.map(ext => ext.toLowerCase().replace(/^\./, ''))));
		}
		if (inputs.workspaceConfigTypes?.length) {
			input.set('WorkspaceConfigTypes', new Set(inputs.workspaceConfigTypes.map(ext => ext.toLowerCase())));
		}

		// First build signal vector based on input, this will be same for all candidate extensions' score calculation.
		const tensor = this._inputTensor!.fill(0);
		for (const [featureName, featureMap] of this._featureEncodings) {
			const featureSet = input.get(featureName);
			if (!featureSet) {
				continue;
			}
			for (const feature of featureSet.values()) {
				const index = featureMap.get(feature);
				if (index != undefined) {
					tensor[index] = 1;
				} else {
					console.warn('Invalid', featureName, feature);
				}
			}
		}

		// Then, repeat signalVector N times, here N is the number of candidate extensions, because the Session will predict a score to each candidate extensions
		const featuresSize = this._featuresSize;
		for (let i = 1; i < featuresSize; i++) {
			tensor.copyWithin(i * featuresSize, 0, featuresSize);
		}
		const extensionSize = this._extensionIds.size;
		// add candidate extensions
		for (let i = 0; i < extensionSize; i++) {
			tensor[i * featuresSize + i] = 1;
		}

		const outputTensor = this._outputTensor!;
		const outputName = this._session!.outputNames[0];
		const result = await this._session!.run({ inputs: new Tensor(tensor, [extensionSize, featuresSize]) }, {
			[outputName]: new Tensor(outputTensor, [outputTensor.length, 1])
		}, {
			logVerbosityLevel: 3,
			...inferenceOptions
		});
		const data = result[outputName].data as Float32Array;

		const scores: Array<SessionResult> = [];
		for (const [extensionId, index] of this._extensionIds) {
			if (data[index] < confidencePass) {
				continue;
			}
			if (input.get('PreviouslyInstalled')?.has(extensionId)) {
				continue;
			}
			scores.push({
				extensionId,
				confidence: data[index]
			});
		}
		
		scores.sort((a, b) => {
			return b.confidence - a.confidence;
		});
		return scores;
	}
}