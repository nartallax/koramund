import {testList} from "tests/test_list";

async function runAllTests(){
	let failCount = 0;
	let totalCount = 0;
	for(let testName in testList){
		totalCount++;
		if(!await runTest(testName, testList[testName as keyof typeof testList])){
			failCount++;
		}
	}
	if(failCount === 0){
		console.error(`Testing successful. No tests failed out of ${totalCount}.`);
		process.exit(0);
	} else {
		console.error(`Testing failed: ${failCount} out of ${totalCount} tests failed.`);
		process.exit(1);
	}
}

async function runSingleTest(name: string){
	if(!(name in testList)){
		console.error(`There is no test named ${name}.`);
		process.exit(1);
	}

	if(await runTest(name, testList[name as keyof typeof testList])){
		process.exit(0);
	} else {
		process.exit(1);
	}
}

export async function testMain(){
	if(!!process.argv[2]){
		await runSingleTest(process.argv[2])
	} else {
		await runAllTests();
	}
}

async function runTest(name: string, testFunc: () => void | Promise<void>): Promise<boolean>{
	try {
		console.error(`Running test ${name}`);
		await Promise.resolve(testFunc());
		console.error(`Test ${name} completed.`);
		return true;
	} catch(e){
		console.error(`Test ${name} failed: ${e.message}`);
		return false;
	}
}