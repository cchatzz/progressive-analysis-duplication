import calculateDuplication from "./index.js";

const result = await calculateDuplication({
    codePath: "../Java",
    resultsPath: "./results",
});

console.log(JSON.stringify(result, null, 2));