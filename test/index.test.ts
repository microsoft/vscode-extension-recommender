/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
// @ts-ignore
import { SessionOperations, SessionResult } from "../dist/lib";

function expectExtension(results: Array<SessionResult>, extensionIds: string[] | string, expectedRelativeConfidence = 0.6) {
	const resultIds = results.map(r => r.extensionId);
	for (const extensionId of Array.isArray(extensionIds) ? extensionIds : [extensionIds]) {
		const result = results.find(r => r.extensionId === extensionId);
		expect(result, `${extensionId} in [${resultIds.join(', ')}]`).to.not.be.undefined;
		expect(result!.confidence, `Confidence for ${extensionId} greater than ${expectedRelativeConfidence}`).to.be.greaterThan(expectedRelativeConfidence);
	}
}

describe('describe', () => {
	const sessionOperations = new SessionOperations();

	it('test file', async () => {
		expectExtension(await sessionOperations.run({
			openedFileTypes: ['.py']
		}), ['ms-python.python']);
	});

	it('test file normalized', async () => {
		expectExtension(await sessionOperations.run({
			openedFileTypes: ['py']
		}), ['ms-python.python']);
	});

	it('test workspace dependency', async () => {
		expectExtension(await sessionOperations.run({
			workspaceDependencies: ['workspace.sln']
		}), ['ms-dotnettools.csharp']);
	});

	it('test workspace config', async () => {
		// lower confidence because it's not a strong stand-alone signal
		expectExtension(await sessionOperations.run({
			workspaceConfigTypes: ['dockerfile']
		}, 0.5), ['ms-azuretools.vscode-docker'], 0.5);
	});
});
