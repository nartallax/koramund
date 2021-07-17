import {TestToolInstance} from "tests/test_tool_instance";
import {expectError, httpReq, shouldBeEqual, waitLine, waitNoResolutionForLimitedTime, waitPromiseForLimitedTime} from "tests/test_utils";
import {promises as fs} from "fs";
import * as path from "path";

const summatorProxyPort = 6742;
const multiplierProxyPort = 7837;
async function callSummatorAndCheck(tool: TestToolInstance, expected: string): Promise<void>{
	let resp = await httpReq({port: summatorProxyPort, body: JSON.stringify({a: 5, b: 10}), path: "/sum"})
	shouldBeEqual("summator response", expected, resp.body);
	tool.checkProjectRunningState("Summator", "running");
	tool.checkProjectImploderState("Summator", true);
}

export const testList: Record<string, () => Promise<void>> = {
	"normal": async () => {
		await TestToolInstance.startDev("normal", async tool => {

			// external project should be launched right away
			tool.checkProjectRunningState("Hashgen", "running");
			{
				let {body: hashBody} = await httpReq({port: 7835});
				if(!hashBody.match(/^[a-zA-Z\d]{128}$/)){
					throw new Error("Hashgen returned bad hash: " + hashBody);
				}
			}

			// if process dies, it should be restarted
			{
				let restartFinishedPromise = tool.tool.inputProcessor?.onLaunchCompleted.wait();
				tool.getProject("Hashgen").process?.stopImmediatelyAndRough();
				let restartedProject = await waitPromiseForLimitedTime(
					restartFinishedPromise, 
					5000, "Hashgen did not get restarted in time!"
				);
				if(restartedProject !== "Hashgen"){
					throw new Error("Something restarted, but it was not Hashgen project: " + restartedProject);
				}
			}

			// process should be restarted gracefully if asked so
			{
				let hashgen = tool.getProject("Hashgen");
				let restartFinishedPromise = tool.tool.inputProcessor?.onLaunchCompleted.wait();
				let firstSigintPromise = waitLine(hashgen.logger, /Received 1 SIGINTs!/)
				hashgen.restart();
				await waitPromiseForLimitedTime(
					firstSigintPromise, 
					1000, "Hashgen did not received first SIGINT in time!"
				);
				await waitPromiseForLimitedTime(
					waitLine(hashgen.logger, /Received 2 SIGINTs!/), 
					1000, "Hashgen did not received second SIGINT in time!"
				);
				await waitPromiseForLimitedTime(
					waitLine(hashgen.logger, /Received 3 SIGINTs!/), 
					1000, "Hashgen did not received third SIGINT in time!"
				);

				let restartedProject = await waitPromiseForLimitedTime(
					restartFinishedPromise, 
					5000, "Hashgen did not get restarted in time!"
				);
				if(restartedProject !== "Hashgen"){
					throw new Error("Something restarted, but it was not Hashgen project: " + restartedProject);
				}
			}

			// process should not start by itself if stopped
			{
				let hashgen = tool.getProject("Hashgen");
				let restartFinishedPromise = tool.tool.inputProcessor?.onLaunchCompleted.wait();
				let firstSigintPromise = waitLine(hashgen.logger, /Received 1 SIGINTs!/)
				hashgen.process?.stop();
				await waitPromiseForLimitedTime(
					firstSigintPromise, 
					1000, "Hashgen did not received first SIGINT in time!"
				);
				await waitPromiseForLimitedTime(
					waitLine(hashgen.logger, /Received 2 SIGINTs!/), 
					1000, "Hashgen did not received second SIGINT in time!"
				);
				await waitPromiseForLimitedTime(
					waitLine(hashgen.logger, /Received 3 SIGINTs!/), 
					1000, "Hashgen did not received third SIGINT in time!"
				);

				await waitNoResolutionForLimitedTime(
					restartFinishedPromise,
					2000, "Hashgen restarted after stopping, but it should not."
				);

				tool.checkProjectRunningState("Hashgen", "stopped");
				await hashgen.restart();
				tool.checkProjectRunningState("Hashgen", "running");
			}

			// process should should ignore first signal on shutdown if asked to
			{
				let hashgen = tool.getProject("Hashgen");
				let firstSigintPromise = waitLine(hashgen.logger, /Received 1 SIGINTs!/)
				hashgen.process?.stop(false, "SIGINT");
				await waitPromiseForLimitedTime(
					firstSigintPromise, 
					1000, "Hashgen did not received first SIGINT in time!"
				);
				await waitPromiseForLimitedTime(
					waitLine(hashgen.logger, /Received 2 SIGINTs!/), 
					1000, "Hashgen did not received second SIGINT in time!"
				);
				await waitNoResolutionForLimitedTime(
					waitLine(hashgen.logger, /Received 3 SIGINTs!/), 
					1000, "Hashgen did received third SIGINT in time, but should not!"
				);

				// yeah, such calls will lead to hanged "stopping", and it's expected by test
				// as ignoring first signal is done on total tool shutdown
				// when this very signal is passed by OS itself to processes in group
				tool.checkProjectRunningState("Hashgen", "stopping");

				hashgen.process?.stopImmediatelyAndRough();
				await new Promise(ok => setTimeout(ok, 500));
				tool.checkProjectRunningState("Hashgen", "stopped");
				// for sake of the rest of the test, let's assume hashgen is stopped
			}

			// front-like project should be launched right away (imploder)
			tool.checkProjectImploderState("Front", true);

			// project should not be started right away
			tool.checkProjectRunningState("Summator", "stopped");
			tool.checkProjectImploderState("Summator", false);

			await callSummatorAndCheck(tool, "Result: 15!!!"); // project should be launched authomatically
	
			await tool.writeFile("summator/summator_consts.ts", `export const postfix = "???";`);
			await callSummatorAndCheck(tool, "Result: 15!!!"); // project should not restart just by some file change
	
			await httpReq({port: summatorProxyPort, path: "/restart_on_delete?a=b", method: "GET"});
			await callSummatorAndCheck(tool, "Result: 15!!!"); // project should not be restarted yet, wrong HTTP method used
	
			await httpReq({port: summatorProxyPort, path: "/restart_on_delete?a=b", method: "DELETE"});
			await callSummatorAndCheck(tool, "Result: 15???"); // project should restart already, as conditions are met

			// what exactly should happen on syntax error restart fail
			await tool.writeFile("summator/summator_consts.ts", `export const postfix: string = 543;`);
			await expectError("socket hang up", () => httpReq({port: summatorProxyPort, path: "/restart?a=b", method: "DELETE"}));
			tool.checkProjectRunningState("Summator", "stopped");
			tool.checkProjectImploderState("Summator", true);
			await expectError("socket hang up", () => callSummatorAndCheck(tool, "Result: 15???"));

			// project should return back to normal running state once error is fixed
			await tool.writeFile("summator/summator_consts.ts", `export const postfix: string = "...";`);
			tool.checkProjectRunningState("Summator", "stopped");
			tool.checkProjectImploderState("Summator", true);
			await callSummatorAndCheck(tool, "Result: 15...")

			// restarts proxy condition without method condition should work
			await tool.writeFile("summator/summator_consts.ts", `export const postfix: string = "123";`);
			await httpReq({port: summatorProxyPort, path: "/restart"});
			await callSummatorAndCheck(tool, "Result: 15123")

		});
	},

	"json_file_path": async () => {
		await TestToolInstance.startDev("portnum_by_shell", async tool => {
			// project should not be started right away
			// BUT when there are shell commands to acquire something in prepare stage - we have to launch Imploder
			// to extract correct values from its config
			// maybe some time later I refactor to parse just the config...?
			tool.checkProjectRunningState("Summator", "stopped");
			tool.checkProjectImploderState("Summator", true);
			await callSummatorAndCheck(tool, "Result: 15!!!");
		});
	},

	"lot_of_stdout_ignored": async () => {
		// when stdout/stderr is not used at all, no overflow should occur
		await TestToolInstance.startDev("lot_of_stdout_ignored", async tool => {
			tool.checkProjectRunningState("BigOutputter", "running");
			tool.tool.logger.logTool("Querying...");
			await httpReq({port: 7836});
			tool.tool.logger.logTool("Done.");
		});
	},

	"lot_of_stderr_half_ignored": async () => {
		// when stdout/stderr used just for triggers, no overflow should occur
		await TestToolInstance.startDev("lot_of_stderr_half_ignored", async tool => {
			tool.checkProjectRunningState("BigOutputter", "running");
			tool.tool.logger.logTool("Querying...");
			await httpReq({port: 7836});
			tool.tool.logger.logTool("Done.");
		});
	},

	"condition_on_other_project_proxy": async () => {
		await TestToolInstance.startDev("condition_on_other_project_proxy", async tool => {
			tool.checkProjectRunningState("Summator", "stopped");
			tool.checkProjectRunningState("Multiplier", "stopped");

			await callSummatorAndCheck(tool, "Result: 15!!!");
			tool.checkProjectRunningState("Multiplier", "stopped");

			await httpReq({port: summatorProxyPort, path: "/restart", method: "GET"});
			tool.checkProjectRunningState("Summator", "running");
			tool.checkProjectRunningState("Multiplier", "stopped");

			await httpReq({port: summatorProxyPort, path: "/restart_mult", method: "GET"});
			tool.checkProjectRunningState("Summator", "running");
			tool.checkProjectRunningState("Multiplier", "running");

			let {body: multRes} = await httpReq({port: multiplierProxyPort, path: "/mult", method: "POST", body: JSON.stringify({a: 5, b: 11})});
			if(multRes !== "55"){
				throw new Error("Bad multiplication result: " + multRes)
			}
		});
	},

	"condition_on_other_project_event": async () => {
		await TestToolInstance.startDev("condition_on_other_project_event", async tool => {
			tool.checkProjectRunningState("Summator", "stopped");
			tool.checkProjectRunningState("Multiplier", "stopped");

			{
				let launchCompletedPromise = tool.tool.inputProcessor?.onLaunchCompleted.wait();
				await callSummatorAndCheck(tool, "Result: 15!!!");
				await launchCompletedPromise;
				tool.checkProjectRunningState("Summator", "running");
				tool.checkProjectRunningState("Multiplier", "stopped", "starting");
				await tool.tool.inputProcessor?.onLaunchCompleted.wait();
				tool.checkProjectRunningState("Multiplier", "running");
			}

			{
				await httpReq({port: summatorProxyPort, path: "/restart", method: "GET"});
				tool.checkProjectRunningState("Summator", "running");
				tool.checkProjectRunningState("Multiplier", "stopped", "starting");
				await tool.tool.inputProcessor?.onLaunchCompleted.wait();
				tool.checkProjectRunningState("Multiplier", "running");
			}
		});
	},

	"prematural_shutdown_in_sequence": async () => {
		await TestToolInstance.startDev("prematural_shutdown_in_sequence", async tool => {
			tool.checkProjectRunningState("Hashgen", "running");
			let hashgen = tool.getProject("Hashgen");
			let logPromise = waitLine(hashgen.logger, /Received SIGUSR1!/)
			hashgen.restart();
			await waitPromiseForLimitedTime(
				logPromise, 
				1000, "Hashgen did not received SIGUSR1 in time!"
			);
			let nextLogPromise = waitLine(hashgen.logger, /Received SIGUSR1!/)

			tool.checkProjectRunningState("Hashgen", "stopping");
			await waitPromiseForLimitedTime(
				tool.tool.inputProcessor?.onLaunchCompleted.wait(), 
				2000, "Hashgen did not restarted in time!"
			);

			await waitNoResolutionForLimitedTime(
				nextLogPromise,
				5000, "Hashgen did received second SIGUSR1, but should not!"
			);
			
		});
	},

	"double_restart": async () => {
		await TestToolInstance.startDev("double_restart", async tool => {
			tool.checkProjectRunningState("Summator", "running");
			await callSummatorAndCheck(tool, "Result: 15!!!");
			let summator = tool.getProject("Summator")

			{
				let logPromise = waitLine(summator.logger, /Received SIGUSR1!/)
				let resOne = httpReq({port: summatorProxyPort, path: "/restart", method: "GET"});
				await waitPromiseForLimitedTime(
					logPromise, 
					500, "Summator did not received SIGUSR1 in time!"
				);
				let secondLogPromise = waitLine(summator.logger, /Received SIGUSR1!/)
				await new Promise(ok => setTimeout(ok, 300));
				let resTwo = httpReq({port: summatorProxyPort, path: "/restart", method: "GET"});
				tool.checkProjectRunningState("Summator", "stopping");
				await waitPromiseForLimitedTime(
					Promise.all([resOne, resTwo]), 
					2000, "Summator did not responded in time!"
				);
				tool.checkProjectRunningState("Summator", "running");
				await waitNoResolutionForLimitedTime(
					secondLogPromise,
					4000, "Summator did received second SIGUSR1, but should not!"
				);
			}

			{
				let resOne = httpReq({port: summatorProxyPort, path: "/restart_sum", method: "POST", body: JSON.stringify({a: 2, b: 3})});
				await new Promise(ok => setTimeout(ok, 500));
				let resTwo = httpReq({port: summatorProxyPort, path: "/restart_sum", method: "POST", body: JSON.stringify({a: 4, b: 5})});
				tool.checkProjectRunningState("Summator", "stopping");
				let [sumOne, sumTwo] = await waitPromiseForLimitedTime(
					Promise.all([resOne, resTwo]), 
					2000, "Summator did not responded in time!"
				);
				tool.checkProjectRunningState("Summator", "running");
				if(sumOne.body !== "Result: 5!!!" || sumTwo.body !== "Result: 9!!!"){
					throw new Error("Summator returned bad sums: " + sumOne.body + " and " + sumTwo.body);
				}
			}

		});
	},

	"build_all": async () => {
		await TestToolInstance.runBuildAll("normal", async tool => {
			let summator = tool.getProject("Summator");
			let result = await fs.readFile(path.resolve(summator.workingDirectory, "result.js"), "utf8")
			if(result.indexOf(".on('end',function(){") < 0){
				throw new Error("Summator build produced bad bundle.");
			}
		});
	}
}