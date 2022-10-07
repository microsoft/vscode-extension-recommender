#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { ModelOperations } = require('../dist');
const os = require('os');

(function (params) {
	console.warn('Note: this CLI is only for diagnosing the model results in @vscode/vscode-extension-recommender. It should not be depended on in any production system.');
	const args = process.argv.slice(2);
	const content = args.join(os.EOL);

	if (!content) {
		console.error('No content specified. Please pass in the content as the first argument of invocation.');
		return;
	}

	if (content.length <= 20) {
		console.error('Not enough content specified. Please include more content in your invocation.');
		return;
	}

	const modelOperations = new ModelOperations();
	modelOperations.runModel(content).then((result) => console.log(result));
})();
