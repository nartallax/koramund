import {Koramund} from "koramund"
import * as Path from "path"

export class NodeEnvController implements Koramund.NodeEnvironmentController {

	static async create(): Promise<NodeEnvController> {
		let nodePath = process.execPath

		// this way it can be more robust than just relying on global `npm` executable
		// there can be no global npm, or there can be wrong npm, or whatever
		// this way we will always use the same npm that our version of node uses
		let npmPath = Path.resolve(Path.dirname(nodePath), "./npm")
		let npxPath = Path.resolve(Path.dirname(nodePath), "./npx")

		return new NodeEnvController(nodePath, npmPath, npxPath)
	}

	constructor(readonly nodeExecutablePath: string,
		readonly npmExecutablePath: string,
		readonly npxExecutablePath: string,
	) {}

}