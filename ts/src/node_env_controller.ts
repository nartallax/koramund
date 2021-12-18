import {Koramund} from "koramund"
import {Logger} from "logger"
import * as Path from "path"
import {ShellRunner} from "shell_runner"

export class NodeEnvController implements Koramund.NodeEnvironmentController {

	static async create(logger: Logger): Promise<NodeEnvController> {
		let nodePath = process.execPath

		let shell = new ShellRunner(".", logger)
		// this way it can be more robust than just relying on global `npm` executable
		// there can be no global npm, or there can be wrong npm, or whatever
		// this way we will always use the same npm that our version of node uses
		let npmPath = Path.resolve(Path.dirname(nodePath), "./npm")

		let runResult = ""
		await shell.runProcess({
			command: [npmPath, "bin"],
			onStdout: line => runResult += line
		})
		let npmBinPath = runResult
			.split("\n")
			.map(x => x.trim())
			.filter(x => !!x)[0]

		if(!npmBinPath){
			throw new Error("Execution of shell command " + JSON.stringify([npmPath, "bin"]) + " yielded zero stdout lines.")
		}

		return new NodeEnvController(nodePath, npmPath, npmBinPath)
	}

	constructor(readonly nodeExecutablePath: string,
		readonly npmExecutablePath: string,
		readonly npmBinDirectory: string
	) {}

	getPathToNpmPackageExecutable(execName: string): string {
		return Path.resolve(this.npmBinDirectory, execName)
	}

}