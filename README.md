# Progressive Analysis — Duplication (NiCad)

Code clone detection for Java projects, run through NiCad 7.0 under WSL. This
document covers only how to run the app in its two modes: **full** and
**incremental**.

---

## Requirements

- **Node.js** with the dependencies in `package.json` (`shelljs`, `sax`, `stream-json`, `globby`, `dotenv`). Install them with `npm install`.
- **WSL** with a working [Open-NiCad](https://github.com/CordyJ/Open-NiCad)
  installation at `~/Open-NiCad`, built with `make`. NiCad is invoked in place via
  `./bin/nicad`, so no system-wide install is needed.
- The directory you pass as `resultsPath` (e.g. `./results`) must already exist — the app writes into it but does not create it.

---

## Clear NiCad's cache before every run

NiCad caches its extraction per system name, and that name is just the basename of
the analyzed directory. Since the name repeats across runs, a stale cache means
analyzing the wrong version silently. Clear it first (replace `Java` with the
basename of your `codePath`):

```bash
rm -rf ~/Open-NiCad/nicadclones/Java \
       ~/Open-NiCad/nicadclones/whole \
       ~/Open-NiCad/nicadclones/changed
```

---

## Running

Everything is driven from `run-nicad.js`. Edit the paths in that file — the mode
is chosen by which paths you fill in, there is no flag — then run:

```bash
node run-nicad.js
```

### Full analysis

Analyzes an entire project from scratch and writes the baseline that incremental
runs later build on. Set `codePath` only:

```js
await calculateDuplication({
  codePath: "../Java",
  changedFilesSetPath: "",
  wholeProjectNewVersionPath: "",
  resultsPath: "./results",
});
```

### Incremental analysis

Reanalyzes only what a commit could have affected, reusing the previous result for
everything else. Leave `codePath` empty and set the other two; a previous full
analysis must already exist in `resultsPath`:

```js
await calculateDuplication({
  codePath: "",
  changedFilesSetPath: "../changed-files/Java",
  wholeProjectNewVersionPath: "../whole-project/Java",
  resultsPath: "./results",
});
```

Both paths are **directory roots** that mirror each other, so the same file
appears at the same relative path in every tree:

```
../whole-project/Java/src/main/MyClass.java   the project after the commit
../changed-files/Java/src/main/MyClass.java   only if the commit touched it
```

`changed-files` holds only the files the commit touched; `whole-project` holds the
complete project including those files. The app knows nothing about git — how
these two trees get populated is up to you.

---

## Output

Written to `<resultsPath>/duplication-nicad.json`. The call returns an envelope
that never throws; on failure `success` is `false` and `error` carries the cause.
