/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tensor, InferenceSession } from 'onnxruntime-web';

export interface SessionResult {
	extensionId: string;
	confidence: number;
}
export interface SessionInputs {
	previouslyInstalled?: string[],
	openedFileTypes?: string[],
	activatedExtensions?: string[],
	workspaceDependencies?: string[],
	workspaceFileTypes?: string[],
	workspaceConfigTypes?: string[]
}

export class SessionOperations {
	private _session: InferenceSession | undefined;
	private _featuresSize: number = 0;
	private _extensionIds: Map<string, number> = new Map();
	private _featureEncodings: Map<string, Map<string, number>> = new Map();
	private _tensor: Uint8Array = new Uint8Array();
	private _signalTensor: Uint8Array = new Uint8Array();

	private async loadSession() {
		if (this._session) {
			return;
		}
		const fs = await import('fs');
		const path = await import('path');
		const modelPath = path.join(__dirname, '..', 'model');

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
		this._tensor = new Uint8Array(this._extensionIds.size * this._featuresSize);
		this._signalTensor = new Uint8Array(this._featuresSize);
	}

	public async run(inputs: SessionInputs, confidencePass = 0.6): Promise<Array<SessionResult>> {
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
		const signalTensor = this._signalTensor.fill(0);
		for (const [featureName, featureMap] of this._featureEncodings) {
			const featureSet = input.get(featureName);
			if (!featureSet) {
				continue;
			}
			for (const feature of featureSet.values()) {
				const index = featureMap.get(feature);
				if (index != undefined) {
					signalTensor[index] = 1;
				} else {
					console.warn('Invalid', featureName, feature);
				}
			}
		}

		// Then, repeat signalVector N times, here N is the number of candidate extensions, because the Session will predict a score to each candidate extensions
		const tensor = this._tensor;
		tensor.set(signalTensor);
		const featuresSize = this._featuresSize;
		for (let i = 1; i < featuresSize; i++) {
			tensor.copyWithin(i * featuresSize, 0, featuresSize);
		}
		const extensionSize = this._extensionIds.size;
		// add candidate extensions
		for (let i = 0; i < extensionSize; i++) {
			tensor[i * featuresSize + i] = 1;
		}

		// performance.mark('predict');
		const results = await this._session!.run({ inputs: new Tensor(tensor, [extensionSize, featuresSize]) });
		// performance.measure('predict');
		const data = results.output_1.data as Float32Array;

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