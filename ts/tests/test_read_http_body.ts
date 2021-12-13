import {test} from "@nartallax/clamsensor";
import {promises as Fs} from "fs";
import {httpReq, testPath, withTestProjectCopy} from "tests/test_utils";

test("http body read", assert => withTestProjectCopy(async controller => {

	let port = JSON.parse((await Fs.readFile(testPath("summator/summator_config.json"), "utf-8"))).http.api_endpoint.port;

	let summator = controller.addProject({
		name: "Summator",
		imploderTsconfigPath: testPath("summator/tsconfig.json"),
		imploderProfile: "dev",
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, summator.imploderConfig.outFile, "Result: "]
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

	summator.onHttpRequest(async req => {
		let body = await req.getBody();
		if(JSON.parse(body.toString("utf-8")).doRestart === true){
			await summator.restart();
		}
	})

	assert(summator.process.state).equalsTo("stopped");
	await summator.restart();
	assert(summator.process.state).equalsTo("running");

	let respOne = await httpReq({port, body: JSON.stringify({a: 5, b: 10}), path: "/sum"})
	assert(respOne.body).equalsTo("Result: 15!!!")
	let startWait = summator.onStarted.wait();
	let respTwoPromise = httpReq({port, body: JSON.stringify({a: 10, b: 20, doRestart: true}), path: "/sum"})
	await assert(startWait).fasterThan(5000);
	let respTwo = await assert(respTwoPromise).fasterThan(500);
	assert(respTwo.body).equalsTo("Result: 30!!!")
}));