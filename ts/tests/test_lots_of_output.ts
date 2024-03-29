import {test} from "@nartallax/clamsensor"
import {httpReq, sleep, testPath, waitLoggerLine, withTestProjectCopy} from "tests/test_utils"

test("lots of stdout ignored", assert => withTestProjectCopy(async controller => {

	let outputter = controller.addProject({
		name: "Large Outputter",
		getLaunchCommand: () => [controller.nodeEnv.nodeExecutablePath, testPath("large_outputter.js"), "stderr"],
		dropStderr: true
	})

	let port = -1

	outputter.onStdout(line => {
		let m = line.match(/^Started on port (\d+)/)
		if(m){
			outputter.notifyLaunched()
			port = parseInt(m[1])
		}
	})

	await outputter.start()
	outputter.logger.logTool("Querying...")
	let promise = waitLoggerLine(outputter.logger, /THIS IS A LINE/)
	await httpReq({port})
	outputter.logger.logTool("Done querying.")
	await assert(promise).willNotReturnFasterThan(500)

	await sleep(1000)
}))