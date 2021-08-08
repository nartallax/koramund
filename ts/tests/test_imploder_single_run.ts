import {test} from "@nartallax/clamsensor";
import {httpReq, testPath, withTestProjectCopy} from "tests/test_utils";
import {promises as Fs} from "fs";

test("imploder single run", assert => withTestProjectCopy(async controller => {

	let port = JSON.parse((await Fs.readFile(testPath("summator/summator_config.json"), "utf-8"))).http.api_endpoint.port;

	let prefix = "Result A: ";

	let summator = controller.addProject({
		name: "Summator",
		imploderTsconfigPath: testPath("summator/tsconfig.json"),
		imploderProfile: "prod",
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, summator.getImploder().config.outFile, prefix]
		},
		proxyHttpPort: port,
		shutdownSequence: [
			{signal: "SIGUSR1"},
			{wait: 3000},
			{signal: "SIGUSR1"}
		]
	});


	summator.onStderr(line => {
		let portMatch = line.match(/Started on port (\d+)/);
		if(portMatch){
			summator.notifyProjectHttpPort(parseInt(portMatch[1]));
			summator.notifyLaunched();
		}
	});

	assert(summator.process.state).equalsTo("stopped");
	await summator.restart();
	assert(summator.process.state).equalsTo("running");

	let respOne = await httpReq({port, body: JSON.stringify({a: 5, b: 10}), path: "/sum"})
	assert(respOne.body).equalsTo("Result A: 15!!!")
	prefix = "Result B: "
	await summator.restart();
	let respTwo = await httpReq({port, body: JSON.stringify({a: 1, b: 1}), path: "/sum"})
	assert(respTwo.body).equalsTo("Result B: 2!!!")
	prefix = "Result C: "
	await summator.restart();
	let respThree = await httpReq({port, body: JSON.stringify({a: 3, b: 3}), path: "/sum"})
	assert(respThree.body).equalsTo("Result C: 6!!!")
}));