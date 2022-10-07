/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { SessionOperations, SessionResult } from "../lib";

const expectedRelativeConfidence = 0.8;

function expectExtension(results: Array<SessionResult>, extensionIds: string[] | string) {
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
		const results = await sessionOperations.run({
			workspaceDependencies: ['workspace.npm.@playwright/test']
		});
		console.log(results);

		expectExtension(await sessionOperations.run({
			workspaceDependencies: ['workspace.npm.vue']
		}), ['vue.volar']);
	});
});
