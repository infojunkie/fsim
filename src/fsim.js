#!/usr/bin/env node
import fs from 'fs';
import meow from 'meow';
import path from 'path';

const IGNORE_FILE = '.fsimignore';
const CACHE_FILE = '.fsimcache';
const SEPARATOR = '--';
const MIN_RATING = 0.7;

let bigrams = new Map();

// https://stackoverflow.com/a/54577682/209184
function isMochaRunning(context) {
  return ['afterEach','after','beforeEach','before','describe','it'].every(function(functionName) {
    return context[functionName] instanceof Function;
  });
}

if (!isMochaRunning(global)) {
  const OPTIONS = meow(`
    Usage: ${path.basename(process.argv[1])} /path/to/files

    Options:
      -r, --recursive           recurse into subdirectories (default: no recursion)
      -m, --minimum             minimum similarity rating between 0.0 and 1.0 (default: ${MIN_RATING})
      -s, --separator           separator between similar sets (default: ${SEPARATOR})
      -c, --cache               use a per-directory cache of bigrams (default: no cache)
      -h, --help                show usage information
      -v, --version             show version information
    `, {
      flags: {
        recursive: {
          type: 'boolean',
          alias: 'r',
        },
        minimum: {
          type: 'number',
          alias: 'm',
          default: MIN_RATING
        },
        separator: {
          type: 'string',
          alias: 's',
          default: SEPARATOR
        },
        cache: {
          type: 'boolean',
          alias: 'c',
        },
        help: {
          type: 'boolean',
          alias: 'h'
        },
        version: {
          type: 'boolean',
          alias: 'v'
        }
      }
    }
  );

  if (OPTIONS.flags['help'] || !OPTIONS.input.length) {
    OPTIONS.showHelp();
  }

  const results = fsim({
    dir: OPTIONS.input[0],
    minRating: OPTIONS.flags['minimum'],
    separator: OPTIONS.flags['separator'],
    cache: OPTIONS.flags['cache'],
    recursive: OPTIONS.flags['recursive'],
  });
  results.forEach(result => {
    result.forEach(file => { console.log(file); });
    console.log(OPTIONS.flags['separator']);
  });
}

// https://stackoverflow.com/a/56150320/209184
function replacerMap(key, value) {
  if (value instanceof Map) {
    return {
      dataType: 'Map',
      value: [...value],
    };
  } else {
    return value;
  }
}

function reviverMap(key, value) {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'Map') {
      return new Map(value.value);
    }
  }
  return value;
}

export function fsim(options) {
  const fileCache = path.join(options.dir, CACHE_FILE);
  if (options.cache && fs.existsSync(fileCache)) {
    try {
      bigrams = new Map(JSON.parse(fs.readFileSync(fileCache, { encoding: 'utf8', flag: 'r' }), reviverMap));
    }
    catch (e) {
      console.warn(`Failed to read cache file ${fileCache}: ${e.message}`);
    }
  }

  const ignores = readIgnores(path.join(options.dir, IGNORE_FILE), options.separator);
  const results = [];
  const files = getFiles(options.dir, options.recursive, path.normalize(options.dir + path.sep));
  files.forEach(file => {
    files.delete(file.filepath);
    const matches = findSimilar(file, files, options.minRating, ignores);
    if (matches.length) {
      results.push(Array(file.filepath).concat(matches.map(match => match.filepath)));
    }
  });

  if (options.cache) {
    try {
      fs.writeFileSync(fileCache, JSON.stringify(bigrams, replacerMap), { encoding: 'utf8', flag: 'w' });
    }
    catch (e) {
      console.warn(`Failed to write cache file ${fileCache}: ${e.message}`);
    }
  }

  return results;
}

function stripExtension(file) {
  const dot = file.lastIndexOf('.');
  if (dot > -1 && file.length - dot < 10) {
    return file.slice(0, dot);
  }
  return file;
}

function findSimilar(ref, files, minRating, ignores) {
  const ignore = (ignores && ignores.get(ref.filepath)) ?? [];

  // Find similar files to the reference:
  return Array.from(files.values())
  // 1. Filter out ignored files
  .filter(file => !ignore.includes(file.filepath))
  // 2. Calculate distance between reference and candidate
  .map(file => { return { ...file, rating: dice(ref.filename, file.filename) }})
  // 3. filter out results < threshold
  .filter(file => file.rating > minRating)
  // 4. Remove results from active set before recursing.
  .map(file => {
    files.delete(file.filepath);
    return file;
  })
  // 5. Recurse on each result to aggregate similars.
  .reduce((matches, file) => {
    matches.push(file);
    return matches.concat(findSimilar(file, files, minRating, ignores));
  }, []);
}

function readIgnores(ignoreFile, separator) {
  if (!fs.existsSync(ignoreFile)) return new Map();

  try {
    return fs.readFileSync(ignoreFile, { encoding: 'utf8', flag: 'r' }).split(/[\n\r]/).reduce((state, line, index, lines) => {
      const clean = line.trim();
      if (clean === separator) {
        state.current.forEach(k => {
          state.ignores.set(k, state.current);
        });
        state.current = [];
      } else if (clean.length) {
        state.current.push(clean);
      }
      return state;
    }, { ignores: new Map(), current: [] }).ignores;
  }
  catch (e) {
    console.warn(`Failed to read ignore file ${ignoreFile}: ${e.message}`);
    return new Map();
  }
}

function getFiles(dir, recursive, prefix) {
  return fs.readdirSync(dir).reduce((files, file) => {
    const filepath = path.join(dir, file);
    if (fs.statSync(filepath).isDirectory()) {
      if (recursive) {
        return new Map([...files, ...getFiles(filepath, recursive, prefix)]);
      }
    }
    else {
      const relpath = filepath.replace(prefix, '');
      files.set(relpath, {
        filepath: relpath,
        filename: stripExtension(file),
      });
    }
    return files;
  }, new Map());
}

// Implementation of Dice coefficient with memoization of bigrams
// https://en.wikipedia.org/wiki/S%C3%B8rensen%E2%80%93Dice_coefficient
// Adapted from https://github.com/ka-weihe/fast-dice-coefficient
function getBigrams(str) {
  const map = bigrams.get(str) || new Map;
  if (!map.size) {
    let i, j, ref;
    for (i = j = 0, ref = str.length - 2; (0 <= ref ? j <= ref : j >= ref); i = 0 <= ref ? ++j : --j) {
      const bi = str.substr(i, 2);
      const repeats = 1 + (map.get(bi) || 0);
      map.set(bi, repeats);
    }
    bigrams.set(str, map);
  }
  return map;
}

function dice(fst, snd) {
  if (fst.length < 2 || snd.length < 2) {
    return 0;
  }
  const map1 = getBigrams(fst);
  const map2 = getBigrams(snd);
  let match = 0;
  if (map1.length > map2.length) {
    map2.forEach((v, k) => {
      if (map1.has(k)) {
        match += Math.min(v, map1.get(k));
      }
    });
  }
  else {
    map1.forEach((v, k) => {
      if (map2.has(k)) {
        match += Math.min(v, map2.get(k));
      }
    });
  }
  return 2.0 * match / (fst.length + snd.length - 2);
}
