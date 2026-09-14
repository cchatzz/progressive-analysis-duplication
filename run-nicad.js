import calculateDuplication from "./index-nicad.js";

// Full analysis: set codePath only. Incremental analysis: leave codePath empty
// and set the other two.
const result = await calculateDuplication({
    codePath: "",
    changedFilesSetPath: "../changed-files/Java",
    wholeProjectNewVersionPath: "../whole-project/Java",
    resultsPath: "./results",
});

console.log(JSON.stringify(result, null, 2));
