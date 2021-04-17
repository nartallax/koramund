# Koramund

This tool will bring some order into your development process.  
It meant to be used along with Typescript, [Imploder](https://github.com/nartallax/imploder "Imploder"), and was written with HTTP apps in mind, but have more uses than just that.  

## Installation

	npm install --save-dev typescript
	npm install --save-dev tslib
	npm install --save-dev @nartallax/koramund

Note that typescript and tslib are peer dependencies. That is, whatever version is installed will be used.  
Imploder is not peer dependency and is included in tool.  
Multiple versions of typescript/tslib/Imploder for different controlled projects are not supported.  

## Configuration

There is [test directory](ts/tests/) that contains configuration examples.  
Also there is [type definitions](ts/src/types.ts) that are thoroughly commented and therefore can be used as documentation.  

### Configuration example

But digging through type definitions all by yourself can be tedious. Let's go through [one of test configs](ts/tests/normal.json):  

	"projects": [{

Here we starting to define projects the tool will control.

		"name": "Summator",
		"imploderProject": "./summator/tsconfig.json",

This project is Imploder project. It is defined by presence of imploderProject parameter, which points to tsconfig.json of the project.  
All relative paths in config are resolved starting in config directory.  
(due to test magic, this path isn't really pointing anywhere, because the config will be moved before testing starts. In test runtime, it will point to [this file](test_projects/summator/tsconfig.json))

		"launchCommand": ["{node}", "{bundle}", "Result: "],
		"launchCompletedCondition": {
			"stdioParsingRegexp": "Started on port ",
			"stderr": true
		},

This project could be launched. Not all Imploder projects could be launched, as some of them could be frontend projects that produce .js to work in browser.  
Placeholders are resolved before launchCommand is executed. {node} points to binary of NodeJS that executes the tool; {bundle} points to .js file produced by Imploder. By the way, all this placeholders can be used in any shell/program launch command in tool config, not only in launchCommand.  
Therefore, actual launch command will look like this: /usr/bin/node /tmp/bundle.js "Result: "  
launchCompletedCondition defines when exactly the project considered fully started. Here we are telling the tool "project is fully started after it outputs this line to stderr".  
Other options for launchCompletedCondition are passing just number (number of milliseconds to wait after launch start), or ProjectEventReference (see example in restartCondition [in this test config](ts/tests/condition_on_other_project_event.json), which is "restart Multiplier project when Summator project launch is completed").  
You can also pass projectName with stdioParsingRegexp to condition on stdout/stderr of other projects.  

		"proxyHttpPort": {
			"jsonFilePath": "summator_config.json",
			"keys": "http.api_endpoint.port"
		},
		"projectHttpPort": {
			"stdioParsingRegexp": "on port (\\d+)",
			"stderr": true
		},

This project will act as HTTP server.  
To allow some triggers to be placed the tool needs to pass HTTP requests through proxy. Recommended way of doing so is by extracting "original" TCP port on which project listens at runtime and pass it to the tool, so the tool could create proxy on that port. The project should bind to arbitrary port and pass port number to the tool, so proxy could redirect requests to that arbitrary port. This way code outside the project could still call it by the same port as before without any changes.  
In options above, we tell the tool "usually the project gets its port from JSON config at this path with this keys" and "the project will output its port to stderr when launched, so you could extract it from there".  
Other options for proxyHttpPort is just number, or shell command that outputs number in stdout (see example [here](ts/tests/portnum_by_shell.json)).  
Other options for projectHttpPort is also number, shell command, and json file path.

		"imploderDevelopmentProfileName": "dev",

This is the name of Imploder profile that will be used when the tool is launched in development mode.  
The tool expects this profile to have watchMode enabled, as development mode is continuous run mode.  
If no profile name is passed, no profile will be used.  

		"restartCondition": [{
			"proxyUrlRegexp": "^/restart_on_delete($|/|\\?)",
			"method": "DELETE"
		}, {
			"proxyUrlRegexp": "^/restart($|/|\\?)"
		}],

Here restart conditions are defined.  
During development of backend apps they need to be restarted frequently. So restartCondition is a way to automate this task.  
Here we say, "restart project when tool proxy for this project receives HTTP DELETE on /restart_on_delete path, or any HTTP request on /restart path".  
Note that it will work the following way - the tool will detect that restart condition is met, then restart the project, then will pass HTTP request to the project. That means restart request is not lost; it is expected to be executed after project restart.  
Other options for restartCondition is ProjectEventReference, or stdio parsing regexp.  

		"imploderBuildProfileName": "prod",
		"postBuildActions": [
			{"shell": "mv js/bundle.js result.js"}
		]

This section defines how project should be built when the tool launched in build or build-all mode.  
imploderBuildProfileName is Imploder profile name that will be used. postBuildActions are shell commands or program launch commands that will be executed after build is completed.  

	}, {
		"name": "Front",
		"imploderProject": "./front/tsconfig.json",
		"imploderDevelopmentProfileName": "dev"

Here we define another project - Front.  
Front is frontend project. It does not need to be controlled at all, so not so much options here. Imploder will be launched at tool start in development mode, it will participate in builds, and that's it.  

	}, {
		"name": "Hashgen",
		"launchCommand": ["{node}", "./hash_generator.js"],
		"workingDirectory": ".",
		"launchCompletedCondition": 1000,

Here we define yet another project - Hashgen.  
Hashgen is external project; that is, we don't control its code, we do not build it, we do not put a proxy over it, and so on. It just needs to be running along with all other projects.  
workingDirectory option is more important here. For Imploder projects, it was deduced from location of tsconfig.json, but here we have no such location.  

		"logging": {
			"showStderr": false
		},

This is the logging options.  
By default the tool will wrap all stdout and stderr of all the projects launched, prepend name and date and put into its own stderr. This option block is the way to control this behavior. See [type definitions](ts/src/types.ts) for complete reference.  

		"shutdownSequence": [
			{"signal": "sigint"},
			{"wait": 500},
			{"signal": "sigint"},
			{"wait": 500},
			{"signal": "sigint"}
		]

This option defines how exactly project should be shut down.  
Here we tell the tool that it needs to send 3 SIGINTs (case insensitive) and wait for 500ms between them. After that the tool will wait indefinitely for process to exit.  
Note that this is "graceful" shutdown sequence. It is used when the process needs to be restarted by trigger, or tool itself is gracefully shut down. When tool is forcefully shut down (but not with, say, kill -9 $TOOL_PID) the projects will be just SIGKILL-ed.  
Note also that default way of graceful shutdown of the tool is to send SIGINT to the tool. It also means that all child processes of the tool will receive the SIGINT without any actions from the tool. To counter that, the tool won't send first signal in sequence if it is equal to signal it is being shut down with, as child processes already received the signal.  

### Other options

You can pass "defaults" for project configuration like this (see [full example](ts/tests/condition_on_other_project_event.json)):  

	"defaultProjectSettings": {
		"logging": {
			"format": "{projectName} | {time} | {message}"
		}
	},

By default external projects are restarted at shutdown. It can be changed with following option:  

		"onShutdown": "nothing"

By default Imploder project launch is deferred until first HTTP request. It can be changed with following option:  

		"initialLaunchOn": "toolStart"

## Launch

	./node_modules/.bin/koramund --config path_to_config.json --mode development

--mode could be development, build and build-all. If build mode is selected, name of project to build is required (passed with --project)

## Not done yet

Windows support. There could be trouble about shell-commands and signal-sending.  
