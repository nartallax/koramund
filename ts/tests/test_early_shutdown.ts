import {test} from "@nartallax/clamsensor"
import {testPath, waitLoggerLine, withTestProjectCopy} from "tests/test_utils"

test("early shutdown", assert => withTestProjectCopy(async controller => {
	let hashgen = controller.addProject({
		name: "Hashgen",
		getLaunchCommand: () => [controller.nodeEnv.nodeExecutablePath, testPath("hash_generator.js")],
		shutdownSequence: [
			{signal: "SIGUSR1"},
			{wait: 3000},
			{signal: "SIGUSR1"}
		]
	})

	hashgen.onStderr(line => {
		if(line.match(/Started on port /)){
			hashgen.notifyLaunched()
		}
	})

	await hashgen.start()

	let logPromise = waitLoggerLine(hashgen.logger, /Received SIGUSR1!/)
	hashgen.restart()
	await assert(logPromise).fasterThan(1000)

	let nextLogPromise = waitLoggerLine(hashgen.logger, /Received SIGUSR1!/)
	assert(hashgen.process.state).equalsTo("stopping")
	await assert(hashgen.onStarted.wait()).fasterThan(2000)
	assert(hashgen.process.state).equalsTo("running")

	await assert(nextLogPromise).willNotReturnFasterThan(5000)
}))