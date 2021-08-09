import {test} from "@nartallax/clamsensor";
import {httpReq, testPath, waitLoggerLine, withTestProjectCopy} from "tests/test_utils";
import { promises as Fs } from "fs";
import {isLaunchableProject} from "launchable_project";
import {Koramund} from "koramund";

async function defineProjects(controller: Koramund.ProjectController, profile: "dev" | "prod"){

	let summator = controller.addProject({
		name: "Summator",
		imploderTsconfigPath: testPath("./summator/tsconfig.json"),
		imploderProfile: profile,
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, summator.getImploder().config.outFile, "Result: "]
		},
		proxyHttpPort: JSON.parse((await Fs.readFile(testPath("summator/summator_config.json"), "utf-8"))).http.api_endpoint.port
	});

	summator.onStderr(line => {
		let portMatch = line.match(/Started on port (\d+)/);
		if(portMatch){
			summator.notifyProjectHttpPort(parseInt(portMatch[1]));
			summator.notifyLaunched();
		}
	});

	summator.onHttpRequest(async req => {
		if((req.method === "DELETE" && req.url.match(/^\/restart_on_delete(?:$|\/|\?)/)) || req.url.match(/^\/restart(?:$|\/|\?)/)){
			await summator.restart();
		}
	})

	summator.onBuildFinished(async result => {
		if(result.success){
			await Fs.copyFile(testPath("summator/js/bundle.js"), testPath("summator/result.js"))
		}
	})

	let front = controller.addProject({
		name: "Front",
		imploderTsconfigPath: testPath("./front/tsconfig.json"),
		imploderProfile: profile,
	})

	let hashgen = controller.addProject({
		name: "Hashgen",
		getLaunchCommand: () => [controller.nodePath, testPath("./hash_generator.js")],
		dropStderr: true,
		shutdownSequence: [
			{signal: "SIGINT"},
			{wait: 500},
			{signal: "SIGINT"},
			{wait: 500},
			{signal: "SIGINT"}
		]
	});

	hashgen.onStop(stop => stop.expected || hashgen.start());
	hashgen.onProcessCreated(() => setTimeout(() => hashgen.notifyLaunched(), 1000));

	return {summator, front, hashgen};
}

test("normal", assert => withTestProjectCopy(async controller => {

	async function callSummatorAndCheck(expected: string): Promise<void>{
		let resp = await httpReq({port: summator.params.proxyHttpPort, body: JSON.stringify({a: 5, b: 10}), path: "/sum"})
		assert(resp.body).equalsTo(expected);
		assert(summator.process.state).equalsTo("running");
		assert(summator.getImploderOrNull).isTruthy();
	}

	let {summator, hashgen, front} = await defineProjects(controller, "dev");

	assert(hashgen.process.state).equalsTo("stopped");
	await hashgen.start();
	assert(hashgen.process.state).equalsTo("running");
	assert((await httpReq({port: 7835})).body).matches(/^[a-zA-Z\d]{128}$/);

	{ // if process dies, it should restart, as it was not expected
		let startPromise = hashgen.onStarted.wait();
		hashgen.process.process?.kill("SIGTERM");
		await assert(startPromise).fasterThan(5000);
	}
	
	{ // process should be restarted gracefully if asked so
		let startPromise = hashgen.onStarted.wait();
		let firstSigintPromise = waitLoggerLine(hashgen.logger, /Received 1 SIGINTs!/)
		let restartPromise = hashgen.restart();
		await assert(firstSigintPromise).fasterThan(1000);
		await assert(waitLoggerLine(hashgen.logger, /Received 2 SIGINTs!/)).fasterThan(1000);
		await assert(waitLoggerLine(hashgen.logger, /Received 3 SIGINTs!/)).fasterThan(1000);
		await assert(startPromise).fasterThan(5000);
		await assert(restartPromise).fasterThan(1000); // should follow immediately after
	}

	{ // process should not start by itself if stopped
		let startPromise = hashgen.onStarted.wait();
		let firstSigintPromise = waitLoggerLine(hashgen.logger, /Received 1 SIGINTs!/)
		hashgen.stop();
		await assert(firstSigintPromise).fasterThan(1000);
		await assert(waitLoggerLine(hashgen.logger, /Received 2 SIGINTs!/)).fasterThan(1000);
		await assert(waitLoggerLine(hashgen.logger, /Received 3 SIGINTs!/)).fasterThan(1000);
		await assert(startPromise).willNotReturnFasterThan(2000); // should not start
		
		assert(hashgen.process.state).equalsTo("stopped");
		await hashgen.restart();
		assert(hashgen.process.state).equalsTo("running");
	}
	
	{ // process should should ignore first signal on shutdown if asked to
		let firstSigintPromise = waitLoggerLine(hashgen.logger, /Received 1 SIGINTs!/)
		if(!isLaunchableProject(hashgen)){
			throw new Error("WUT");
		}
		hashgen.stop("SIGINT");
		await assert(firstSigintPromise).fasterThan(1000);
		await assert(waitLoggerLine(hashgen.logger, /Received 2 SIGINTs!/)).fasterThan(1000);
		let thirdLinePromise = waitLoggerLine(hashgen.logger, /Received 3 SIGINTs!/);
		await assert(thirdLinePromise).willNotReturnFasterThan(1000);

		// yeah, such calls will lead to hanged "stopping", and it's expected by test
		// as ignoring first signal is done on total tool shutdown
		// when this very signal is passed by OS itself to processes in group
		assert(hashgen.process.state).equalsTo("stopping");

		let stopPromise = hashgen.onStop.wait();
		let startPromise = hashgen.onStarted.wait();
		hashgen.process.process?.kill("SIGINT");
		await assert(thirdLinePromise).fasterThan(1000);
		await assert(stopPromise).fasterThan(500);
		assert(hashgen.process.state).equalsTo("stopped");
		await assert(startPromise).willNotReturnFasterThan(2000);
		await hashgen.start();
	}

	await front.build();
	assert(front.getImploderOrNull()).isTruthy();
	let bundle = await Fs.readFile(front.getImploder().config.outFile, "utf-8");
	assert(bundle).contains("function");

	assert(summator.process.state).equalsTo("stopped");
	assert(summator.getImploderOrNull()).isFalsy();
	await summator.start();
	assert(summator.process.state).equalsTo("running");
	assert(summator.getImploderOrNull()).isTruthy();

	await callSummatorAndCheck("Result: 15!!!");

	await Fs.writeFile(testPath("summator/summator_consts.ts"), `export const postfix = "???";`, "utf-8");
	await callSummatorAndCheck("Result: 15!!!"); // project should not restart just by some file change

	await httpReq({port: summator.params.proxyHttpPort, path: "/restart_on_delete?a=b", method: "GET"});
	await callSummatorAndCheck("Result: 15!!!"); // project should not be restarted yet, wrong HTTP method used

	await httpReq({port: summator.params.proxyHttpPort, path: "/restart_on_delete?a=b", method: "DELETE"});
	await callSummatorAndCheck("Result: 15???"); // project should restart already, as conditions are met

	// what exactly should happen on syntax error restart fail
	await Fs.writeFile(testPath("summator/summator_consts.ts"), `export const postfix: string = 543;`);
	//let res = await httpReq({port: summator.params.proxyHttpPort, path: "/restart?a=b", method: "DELETE"})
	//console.log(res.code);
	//console.log(res.body);
	await assert(httpReq({port: summator.params.proxyHttpPort, path: "/restart?a=b", method: "DELETE"})).throws("socket hang up")
	assert(summator.process.state).equalsTo("stopped");
	assert(summator.getImploderOrNull()).isTruthy();
	await assert(callSummatorAndCheck("Result: 15???")).throws("socket hang up");

	// project should return back to normal running state once error is fixed
	await Fs.writeFile(testPath("summator/summator_consts.ts"), `export const postfix: string = "...";`);
	assert(summator.process.state).equalsTo("stopped");
	assert(summator.getImploderOrNull()).isTruthy();
	await callSummatorAndCheck("Result: 15...");

	// restarts proxy condition without method condition should work
	await Fs.writeFile(testPath("summator/summator_consts.ts"), `export const postfix: string = "123";`);
	await httpReq({port: summator.params.proxyHttpPort, path: "/restart"});
	await callSummatorAndCheck("Result: 15123");

}));

test("build_all", assert => withTestProjectCopy(async controller => {
	await defineProjects(controller, "prod");
	await controller.buildAll();
	let resultJsPath = testPath("summator/result.js");
	let resultJs = await Fs.readFile(resultJsPath, "utf8")
	assert(resultJs).contains(".on('end',function(){");
}))