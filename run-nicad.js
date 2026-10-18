import calculateDuplication from "./index-nicad.js";

// Full analysis: set codePath only. Incremental analysis: leave codePath empty
// and set the other two.
console.time("Elapsed");

const result = await calculateDuplication({
    codePath: "",
    changedFilesSetPath: "",
    wholeProjectNewVersionPath: "",
    resultsPath: "./results",
});

if (!result.success) {
    console.error(result.error);        // prints message + stack
} else {
    console.log("duplicateLOC:", result.duplicationMetrics.duplicateLOC);
}
// console.log(JSON.stringify(result, null, 2));
console.timeEnd("Elapsed");
