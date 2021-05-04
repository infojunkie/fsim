#!/usr/bin/env node
"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.main = main;

var _fastDiceCoefficient = _interopRequireDefault(require("fast-dice-coefficient"));

var _fs = _interopRequireDefault(require("fs"));

var _meow = _interopRequireDefault(require("meow"));

var _path = _interopRequireDefault(require("path"));

var IGNORE_FILE = '.fsimignore';
var SEPARATOR = '--';
var MIN_RATING = 0.7; // https://stackoverflow.com/a/54577682/209184

function isMochaRunning(context) {
  return ['afterEach', 'after', 'beforeEach', 'before', 'describe', 'it'].every(function (functionName) {
    return context[functionName] instanceof Function;
  });
}

if (!isMochaRunning(global)) {
  var OPTIONS = (0, _meow["default"])("\n    Usage: ".concat(_path["default"].basename(process.argv[1]), " /path/to/files\n\n    Options:\n      -i, --ignore              ignore file (").concat(IGNORE_FILE, ")\n      -r, --rating              minimum similarity rating (").concat(MIN_RATING, ")\n      -s, --separator           separator between similar sets (").concat(SEPARATOR, ")\n      -h, --help                show usage information\n      -v, --version             show version information\n    "), {
    flags: {
      ignore: {
        type: 'string',
        alias: 'i',
        "default": IGNORE_FILE
      },
      rating: {
        type: 'number',
        alias: 'r',
        "default": MIN_RATING
      },
      separator: {
        type: 'string',
        alias: 's',
        "default": SEPARATOR
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
  });

  if (OPTIONS.flags['help'] || !OPTIONS.input.length) {
    OPTIONS.showHelp();
  }

  main({
    dir: OPTIONS.input[0],
    ignoreFile: OPTIONS.flags['ignore'],
    minRating: OPTIONS.flags['rating'],
    separator: OPTIONS.flags['separator']
  });
}

function main(options) {
  var ignores = readIgnores(options.ignoreFile, options.separator);

  var files = _fs["default"].readdirSync(options.dir);

  var file;

  while (file = files.shift()) {
    if (files.length) {
      var matches = findSimilar(file, files, options.minRating, ignores);

      if (matches.length) {
        console.log(file);
        matches.forEach(function (m) {
          console.log(m);
        });
        console.log(options.separator);
      }
    }
  }
}

function findSimilar(file, files, minRating, ignores) {
  var _ref;

  var ignore = (_ref = ignores && ignores.get(file)) !== null && _ref !== void 0 ? _ref : [];
  return files.map(function (f) {
    return {
      file: f,
      rating: (0, _fastDiceCoefficient["default"])(file, f)
    };
  }).filter(function (r) {
    return r.rating > minRating && !ignore.includes(r.file);
  }).sort(function (r1, r2) {
    return r1.rating - r2.rating;
  }).map(function (r) {
    return r.file;
  });
}

function readIgnores(ignoreFile, separator) {
  try {
    return _fs["default"].readFileSync(ignoreFile, {
      encoding: 'utf8',
      flag: 'r'
    }).split(/[\n\r]/).reduce(function (state, line) {
      var clean = line.trim();

      if (clean === separator) {
        state.current.forEach(function (k) {
          state.ignores.set(k, state.current);
        });
        state.current = [];
      } else if (clean.length) {
        state.current.push(clean);
      }

      return state;
    }, {
      ignores: new Map(),
      current: []
    }).ignores;
  } catch (e) {
    return new Map();
  }
}