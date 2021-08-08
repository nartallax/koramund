import {test} from "@nartallax/clamsensor";
import {httpReq, testPath, withTestProjectCopy} from "tests/test_utils";

test("imploder no http", assert => withTestProjectCopy(async controller => {

	let prefix = "Result: ";

	let summator = controller.addProject({
		name: "Summator",
		imploderTsconfigPath: testPath("summator/tsconfig.json"),
		imploderProfile: "dev",
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, summator.getImploder().config.outFile, prefix]
		},
		shutdownSequence: [
			{signal: "SIGUSR1"},
			{wait: 3000},
			{signal: "SIGUSR1"}
		]
	});


	let port = -1;
	summator.onStderr(line => {
		let portMatch = line.match(/Started on port (\d+)/);
		if(portMatch){
			port = parseInt(portMatch[1]);
			summator.notifyLaunched();
		}
	});

	assert(summator.process.state).equalsTo("stopped");
	await summator.restart();
	assert(summator.process.state).equalsTo("running");

	let respOne = await httpReq({port, body: JSON.stringify({a: 5, b: 10}), path: "/sum"})
	assert(respOne.body).equalsTo("Result: 15!!!")
	prefix = "Result12345: "
	await summator.restart();
	let respTwo = await httpReq({port, body: JSON.stringify({a: 1, b: 1}), path: "/sum"})
	assert(respTwo.body).equalsTo("Result12345: 2!!!")
}));