import calculateDuplication from "./index.js";

const result = await calculateDuplication({
    codePath: "../Theseus---Minotaur",
    resultsPath: "./results",
});

console.log(JSON.stringify(result, null, 2));