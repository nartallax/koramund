import {test} from "@nartallax/clamsensor";
import {promises as Fs} from "fs";
import {httpReq, testPath, withTestProjectCopy} from "tests/test_utils";

test("crossconditions", assert => withTestProjectCopy(async controller => {

	async function callSummatorAndCheck(expected: string): Promise<void>{
		let resp = await httpReq({port: summator.params.proxyHttpPort, body: JSON.stringify({a: 5, b: 10}), path: "/sum"})
		assert(resp.body).equalsTo(expected);
		assert(summator.process.state).equalsTo("running");
		assert(summator.getImploderOrNull()).isTruthy();
	}

	let summator = controller.addProject({
		name: "Summator",
		imploderTsconfigPath: testPath("summator/tsconfig.json"),
		imploderProfile: "dev",
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, summator.getImploder().config.outFile, "Result: "]
		},
		proxyHttpPort: JSON.parse((await Fs.readFile(testPath("summator/summator_config.json"), "utf-8"))).http.api_endpoint.port
	});

	summator.onStderr(line => {
		let portMatch = line.match(/Started on port (\d+)/);
		if(portMatch){
			summator.notifyProcessHttpPort(parseInt(portMatch[1]));
			summator.notifyLaunched();
		}
	});

	summator.onHttpRequest(async req => {
		if(req.url.match(/^\/restart(?:$|\/|\?)/)){
			await summator.restart();
		} else if(req.url.match(/^\/restart_mult(?:$|\/|\?)/)){
			await multiplier.restart();
		}
	})

	let multiplierPort = 7837;
	let multiplier = controller.addProject({
		name: "Multiplier",
		imploderTsconfigPath: testPath("multiplier/tsconfig.json"),
		imploderProfile: "dev",
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, multiplier.getImploder().config.outFile, "Result: "]
		},
		proxyHttpPort: multiplierPort
	});

	multiplier.onStderr(line => {
		let portMatch = line.match(/Started on port (\d+)/);
		if(portMatch){
			multiplier.notifyProcessHttpPort(parseInt(portMatch[1]));
			multiplier.notifyLaunched();
		}
	});

	summator.onStarted(() => multiplier.restart());

	assert(summator.process.state).equalsTo("stopped");
	assert(multiplier.process.state).equalsTo("stopped");

	await summator.start();
	
	assert(summator.process.state).equalsTo("running");
	assert(multiplier.process.state).equalsTo("running");

	await callSummatorAndCheck("Result: 15!!!");

	{
		let multRestartPromise = multiplier.onStarted.wait();
		let sumRestartPromise = summator.onStarted.wait();
		await httpReq({port: summator.params.proxyHttpPort, path: "/restart", method: "GET"});
		await assert(Promise.all([multRestartPromise, sumRestartPromise])).fasterThan(5000);
	}

	{
		let multRestartPromise = multiplier.onStarted.wait();
		let sumRestartPromise = summator.onStarted.wait();
		assert(summator.process.state).equalsTo("running");
		assert(multiplier.process.state).equalsTo("running");
		await httpReq({port: summator.params.proxyHttpPort, path: "/restart_mult", method: "GET"});
		assert(summator.process.state).equalsTo("running");
		await assert(multRestartPromise).fasterThan(5000);
		assert(multiplier.process.state).equalsTo("running");
		await assert(sumRestartPromise).willNotReturnFasterThan(1000);
	}
	

	let {body: multRes} = await httpReq({port: multiplier.params.proxyHttpPort, path: "/mult", method: "POST", body: JSON.stringify({a: 5, b: 11})});
	assert(multRes).equalsTo("55");

}));