import {test} from "@nartallax/clamsensor";
import {promises as Fs} from "fs";
import {httpReq, testPath, waitLoggerLine, withTestProjectCopy} from "tests/test_utils";

test("double restart", assert => withTestProjectCopy(async controller => {

	let port = JSON.parse((await Fs.readFile(testPath("summator/summator_config.json"), "utf-8"))).http.api_endpoint.port;

	let summator = controller.addProject({
		name: "Summator",
		imploderTsconfigPath: testPath("summator/tsconfig.json"),
		imploderProfile: "dev",
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, summator.getImploder().config.outFile, "Result: "]
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
			summator.notifyProcessHttpPort(parseInt(portMatch[1]));
			summator.notifyLaunched();
		}
	});

	summator.onHttpRequest(async req => {
		if(req.url.match(/^\/restart($|\/|\\?)/)){
			await summator.restart();
		}
	})

	assert(summator.process.state).equalsTo("stopped");
	await summator.restart();
	assert(summator.process.state).equalsTo("running");

	{
		let logPromiseOne = waitLoggerLine(summator.logger, /Received SIGUSR1!/)
		let resOne = httpReq({port, path: "/restart", method: "GET"});
		await assert(logPromiseOne).fasterThan(250);
		let resTwo = httpReq({port, path: "/restart", method: "GET"});
		await assert(resOne).fasterThan(resTwo);
	}

	{
		let resOne = httpReq({port, path: "/restart_sum", method: "POST", body: JSON.stringify({a: 2, b: 3})});
		await new Promise(ok => setTimeout(ok, 250));
		let resTwo = httpReq({port, path: "/restart_sum", method: "POST", body: JSON.stringify({a: 4, b: 5})});
		assert(summator.process.state).equalsTo("stopping");
		await assert(summator.onStarted.wait()).fasterThan(2500);
		await assert(summator.onStarted.wait()).fasterThan(2500); // two starts expected
		let [sumOne, sumTwo] = await assert(Promise.all([resOne, resTwo])).fasterThan(250);
		assert(summator.process.state).equalsTo("running");
		assert(sumOne.body).equalsTo("Result: 5!!!");
		assert(sumTwo.body).equalsTo("Result: 9!!!");
	}

}));