#!/usr/bin/env node

/*
 * Copyright 2018 - 2019 TU Dortmund
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const program = require('commander'),
  request = require('request-promise-native'),
  chalk = require('chalk'),
  fs = require('fs'),
  nPath = require('path'),
  dateformat = require('dateformat');

/**
 * Parse user credentials from a string.
 * The string should be "email:password".
 *
 * @param {string} value The credentials.
 * @return {{email: string, password: string}}
 */
function credentials(value) {
  const parts = value.split(':');
  return {
    email: parts.shift(),
    password: parts.join('')
  };
}

program
  .version('1.8.0')
  .option('--uri [uri]', 'The URI where ALEX is running without trailing \'/\'')
  .option('--targets [targets]', 'The base URL and mirrors of the target application as comma separated list')
  .option('--clean-up', 'If the project is deleted after a test or learning process')
  .option('-a, --action [action]', 'What do you want to do with ALEX? [test|learn]')
  .option('-u, --user [credentials]', 'Credentials with the pattern "email:password"', credentials)
  .option('-s, --symbols [file]', 'Add the json file that contains all necessary symbols')
  .option('-t, --tests [file]', 'Add the json file that contains all tests that should be executed. Omit this if you want to learn.')
  .option('-c, --config [file]', 'Add the json file that contains the configuration for the web driver')
  .option('-f --files [files]', 'A file or directory that contains files to upload to ALEX')
  .option('-o --out [file]', 'A file where test reports and learned models are written to')
  .parse(process.argv);

/**
 * The interval in ms to poll for the test status.
 *
 * @type {number}
 */
const POLL_TIME_TESTING = 3000;

/**
 * The interval in ms to poll for the learner status.
 *
 * @type {number}
 */
const POLL_TIME_LEARNING = 5000;

/**
 * The URI of the server where the backend of ALEX is running.
 *
 * @type {string|null}
 * @private
 */
let _uri = null;

/**
 * The jwt of the user that logs in.
 *
 * @type {string|null}
 * @private
 */
let _jwt = null;

/**
 * The user credentials that are used to log in.
 *
 * @type {{email: string, password: string}|null}
 * @private
 */
let _user = null;

/**
 * The project that is created during the process.
 * At the end, the project will be deleted.
 *
 * @type {{name: string: urls: Object[], id: number}|null}
 * @private
 */
let _project = null;

/**
 * The list of symbols that are required for the tests.
 *
 * @type {Object[]|null}
 * @private
 */
let _symbols = null;

/**
 * The list of symbols groups.
 *
 * @type {Object[]|null}
 * @private
 */
let _symbolGroups = null;

/**
 * The test cases that should be executed.
 *
 * @type {{id:number, name:string, parent:number|null, project:number, symbols:object[]}[]|null}
 * @private
 */
let _tests = null;

/**
 * The configuration for the web driver.
 *
 * @type {object|null}
 * @private
 */
let _config = null;

/**
 * What to do.
 * Either 'learn' or 'test'.
 *
 * @type {string|null}
 * @private
 */
let _action = null;

/**
 * The files to upload.
 *
 * @type {Array}
 * @private
 */
let _files = [];

/**
 * Create the default headers send to ALEX
 *
 * @returns {*}
 * @private
 */
function _getDefaultHttpHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (_jwt != null) {
    headers['Authorization'] = `Bearer ${_jwt}`;
  }
  return headers;
}


/**
 * Login a user.
 *
 * @param {{email:string, password:string}} user
 * @return {*}
 */
function login(user) {
  return request({
    method: 'POST',
    uri: `${_uri}/users/login`,
    headers: _getDefaultHttpHeaders(),
    body: JSON.stringify(user)
  });
}

/**
 * Create a new project with a random name.
 *
 * @return {*}
 */
function createProject() {
  const createProjectName = () => {
    let text = 'alex-cli-';

    text += dateformat(new Date(), 'isoDateTime') + '-';

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 10; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return text;
  };

  const urls = program.targets.split(',').map(u => ({url: u, default: false}));
  urls[0].default = true;

  return request({
    method: 'POST',
    uri: `${_uri}/projects`,
    headers: _getDefaultHttpHeaders(),
    body: JSON.stringify({
      name: createProjectName(),
      urls: urls
    })
  });
}

/**
 * Delete the project that has been created.
 *
 * @return {Promise<*>}
 */
function deleteProject() {
  return new Promise((resolve, reject) => {
    request({
      method: 'DELETE',
      uri: `${_uri}/projects/${_project.id}`,
      headers: _getDefaultHttpHeaders()
    }).then(resolve).catch(reject);
  });
}

/**
 * Upload files.
 *
 * @returns {Promise<*>}
 */
function uploadFiles() {
  return new Promise((resolve, reject) => {
    const headers = JSON.parse(JSON.stringify(_getDefaultHttpHeaders()));
    headers['Content-Type'] = 'multipart/form-data';

    const queue = [..._files];

    const next = (file => {
      request({
        headers,
        method: 'POST',
        uri: `${_uri}/projects/${_project.id}/files/upload`,
        formData: {
          file: fs.createReadStream(file)
        }
      }).then(() => {
        if (queue.length === 0) {
          resolve();
        } else {
          next(queue.shift());
        }
      }).catch(reject);
    });

    next(queue.shift());
  });
}

/**
 * Create the symbols from the file.
 *
 * @return {*}
 */
function createSymbols() {
  if (_symbolGroups != null) {
    return request({
      method: 'POST',
      uri: `${_uri}/projects/${_project.id}/groups/batch`,
      headers: _getDefaultHttpHeaders(),
      body: JSON.stringify(_symbolGroups)
    }).then(data => {
      const groups = JSON.parse(data);
      const symbols = [];
      const iterate = (group) => {
        group.symbols.forEach(s => symbols.push(s));
        group.groups.forEach(g => iterate(g));
      };
      groups.forEach(iterate);
      return symbols;
    });
  } else {
    return request({
      method: 'POST',
      uri: `${_uri}/projects/${_project.id}/symbols/batch`,
      headers: _getDefaultHttpHeaders(),
      body: JSON.stringify(_symbols)
    }).then(JSON.parse);
  }
}

/**
 * Create the tests that are specified in the file.
 *
 * @return {*}
 */
function createTests() {

  function prepareTestCase(tc) {
    tc.project = _project.id;

    const mapSymbolIds = (steps) => {
      steps.forEach(step => {
        step.pSymbol.symbol = {id: _symbols.find(s => s.name === step.pSymbol.symbol.name).id};
      });
    };

    mapSymbolIds(tc.preSteps);
    mapSymbolIds(tc.steps);
    mapSymbolIds(tc.postSteps);
  }

  function prepareTests(tests) {
    tests.forEach(test => {
      if (test.type === 'case') {
        prepareTestCase(test);
      } else if (test.type === 'suite') {
        test.project = _project.id;
        prepareTests(test.tests);
      }
    });
  }

  prepareTests(_tests);

  return request({
    method: 'POST',
    uri: `${_uri}/projects/${_project.id}/tests/batch`,
    headers: _getDefaultHttpHeaders(),
    body: JSON.stringify(_tests)
  });
}

/**
 * Execute a single test.
 *
 * @return {*}
 */
function executeTests() {
  return request({
    method: 'POST',
    uri: `${_uri}/projects/${_project.id}/tests/execute`,
    headers: _getDefaultHttpHeaders(),
    body: JSON.stringify(_config)
  });
}

function getTestStatus() {
  return request({
    method: 'GET',
    uri: `${_uri}/projects/${_project.id}/tests/status`,
    headers: _getDefaultHttpHeaders()
  });
}

function getLatestTestResult() {
  return request({
    method: 'GET',
    uri: `${_uri}/projects/${_project.id}/tests/reports/latest`,
    headers: _getDefaultHttpHeaders()
  });
}

/**
 * Get the report as JUnit XML.
 * @param {number} reportId The ID of the test report.
 */
function getJUnitReport(reportId) {
  return request({
    method: 'GET',
    uri: `${_uri}/projects/${_project.id}/tests/reports/${reportId}?format=${encodeURIComponent('junit+xml')}`,
    headers: _getDefaultHttpHeaders()
  });
}

/**
 * Get the result of the learning process.
 * @return {*}
 */
function getLearnerStatus() {
  return request({
    method: 'GET',
    uri: `${_uri}/learner/${_project.id}/status`,
    headers: _getDefaultHttpHeaders()
  });
}

/**
 * Get the latest learner result.
 * Should be called after the learning process is finished.
 * @return {*}
 */
function getLatestLearnerResult() {
  return request({
    method: 'GET',
    uri: `${_uri}/projects/${_project.id}/results/latest`,
    headers: _getDefaultHttpHeaders()
  });
}

/**
 * Write the learned model or test report into a file.
 *
 * @param {string} data The data to write into the file.
 */
function writeOutputFile(data) {
  if (program.out) {
    const file = program.out;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    fs.writeFile(file, data, (err) => {
      if(err) {
        console.error(`Failed to write result in file ${file}.`, err);
      }
      console.log(chalk.white.dim(`Wrote result to file ${file}`));
    });
  }
}

/**
 * Execute all tests.
 *
 * @return {Promise<*>}
 */
function startTesting() {
  _config.tests = _tests.map(test => test.id);
  _config.url = _project.urls[0].id;
  _config.createReport = true;

  function printReport(report) {
    report.testResults.forEach(tr => {
      if (tr.passed) {
        console.log(`${chalk.bgGreen("success")} ${tr.test.name}`);
      } else {
        console.log(`${chalk.bgRed("failed")} ${tr.test.name}`);
      }
    });
  }

  return new Promise((resolve, reject) => {
    executeTests(_tests)
      .then(() => {
        function poll() {
          getTestStatus()
            .then(res1 => {
              const data1 = JSON.parse(res1);
              if (!data1.active) {
                getLatestTestResult()
                  .then(res2 => {
                    const data2 = JSON.parse(res2);
                    printReport(data2);

                    getJUnitReport(data2.id).then(res3 => {
                      writeOutputFile(res3);
                    }).catch(err => {
                      console.error(err);
                    }).finally(() => {
                      if (data2.passed) {
                        resolve(`${data2.numTestsPassed}/${data2.numTests} tests passed.`);
                      } else {
                        reject(`${data2.numTestsFailed}/${data2.numTests} tests failed.`);
                      }
                    });
                  })
                  .catch(reject);
              } else {
                setTimeout(poll, POLL_TIME_TESTING);
              }
            }).catch(reject);
        }

        poll();
      })
      .catch(reject);
  });
}

/**
 * Start learning.
 *
 * @return {Promise<*>}
 */
function startLearning() {

  // symbolId -> parameterName -> parameter
  // needed to set the ids of the parameters by name
  const inputParamMap = {};
  _symbols.forEach(sym => {
    inputParamMap[sym.id] = inputParamMap[sym.id] == null ? {} : inputParamMap[sym.id];
    sym.inputs.forEach(input => {
      inputParamMap[sym.id][input.name] = input;
    });
  });

  const mapSymbolIds = (pSymbol) => {
    pSymbol.symbol = {id: _symbols.find(s => s.name === pSymbol.symbol.name).id};
    pSymbol.parameterValues.forEach(pv => {
      pv.parameter.id = inputParamMap[pSymbol.symbol.id][pv.parameter.name].id;
    })
  };

  _config.symbols.forEach(mapSymbolIds);
  mapSymbolIds(_config.resetSymbol);
  if (_config.postSymbol != null) {
    mapSymbolIds(_config.postSymbol);
  }

  _config.urls = [_project.urls[0].id];

  return new Promise((resolve, reject) => {
    request({
      method: 'POST',
      uri: `${_uri}/learner/${_project.id}/start`,
      headers: _getDefaultHttpHeaders(),
      body: JSON.stringify(_config)
    }).then(() => {
      const poll = () => {
        getLearnerStatus()
          .then(res1 => {
            const data1 = JSON.parse(res1);
            if (!data1.active) {
              getLatestLearnerResult()
                .then(res2 => {
                  const data2 = JSON.parse(res2);
                  if (!data2.error) {
                    console.log('\n', data2.hypothesis, '\n');
                    writeOutputFile(JSON.stringify(data2.hypothesis));
                    resolve('The learning process finished.');
                  } else {
                    reject(data2.errorMessage);
                  }
                })
                .catch(reject);
            } else {
              setTimeout(poll, POLL_TIME_LEARNING);
            }
          })
          .catch(reject);
      };
      poll();
    }).catch(reject);
  });
}

try {
  // validate the action
  if (!program.action) {
    throw 'You haven\'t specified what action to execute. It can either be \'test\' or \'learn\'.';
  } else {
    if (['test', 'learn'].indexOf(program.action.trim()) === -1) {
      throw 'You have specified an invalid action. It can either be \'test\' or \'learn\'.';
    } else {
      _action = program.action;
    }
  }

  // validate ALEX URI
  if (!program.uri) {
    throw 'You haven\'t specified the URI where the server of ALEX is running.';
  } else {
    _uri = program.uri + '/rest';
  }

  // validate target URL
  if (!program.targets) {
    throw 'You haven\'t specified the URL of the target application.';
  }

  // validate user credentials
  if (!program.user) {
    throw 'You haven\'t specified a user.';
  } else {
    const user = program.user;
    if (!user.email || user.email.trim() === '' || !user.password || user.password.trim() === '') {
      throw 'Email or password are not defined or empty.';
    } else {
      _user = program.user;
    }
  }

  // check if the config file exists
  if (!program.config) {
    throw 'You haven\'t specified config file for the web driver.';
  } else {
    const file = program.config;
    if (!fs.existsSync(file)) {
      throw 'The file for the web driver config cannot be found.';
    } else {
      const contents = fs.readFileSync(file);
      _config = JSON.parse(contents);
    }
  }

  // validate symbols
  if (!program.symbols) {
    throw 'You have to specify a file that contains symbols.';
  } else {
    const file = program.symbols;
    if (!fs.existsSync(file)) {
      throw 'The file for the symbols that you specified cannot be found.';
    } else {
      const contents = fs.readFileSync(file);
      const data = JSON.parse(contents);
      if (data.type === 'symbols' && data.symbols != null && data.symbols.length > 0) {
        _symbols = data.symbols;
      } else if (data.type === 'symbolGroups' && data.symbolGroups != null && data.symbolGroups.length > 0) {
        _symbolGroups = data.symbolGroups;
      } else {
        throw 'The file that you specified does not seem to contain any symbols.';
      }
    }
  }

  if (_action === 'test') {
    // validate tests
    if (!program.tests) {
      throw 'You have to specify a file that contains tests.';
    } else {
      const file = program.tests;
      if (!fs.existsSync(file)) {
        throw 'The file for the tests that you specified cannot be found.';
      } else {
        const contents = fs.readFileSync(file);
        const data = JSON.parse(contents);
        if (data.tests == null || data.tests.length === 0) {
          throw 'The file that you specified does not seem to contain any tests.';
        } else {
          _tests = data.tests;
        }
      }
    }
  } else {
    if (program.tests) {
      throw 'You want to learn, but have specified tests.';
    }
  }

  if (program.files) {
    const path = program.files;

    let stat;
    try {
      stat = fs.lstatSync(path);
      if (stat.isFile()) {
        _files = [path];
      } else if (stat.isDirectory()) {
        _files = fs.readdirSync(path).map(f => nPath.join(path, f));
      }
    } catch (e) {
      console.log(chalk.italic.yellow('The file or directory that contains files could not be found'));
    }
  }
} catch (exception) {
  console.log(chalk.red(exception));
  process.exit(1);
}

/**
 * The function that is called if the tests have been executed or the learning process finished.
 * Removes the project that has been created temporarily.
 *
 * @param {string} message The message to print after the cli terminates.
 * @param {Function} fn The callback that processes the message.
 */
function terminate(message, fn) {
  if (program.cleanUp) {
    deleteProject()
        .then(() => {
          console.log(chalk.white.dim(`Project has been deleted.`));
          fn(message);
        })
        .catch(() => fn(message));
  } else {
    fn(message);
  }
}


// execute the tests / learning process
login(_user).then((data) => {
  _jwt = JSON.parse(data).token;
  console.log(chalk.white.dim(`User "${_user.email}" logged in.`));

  function progress() {
    return createSymbols().then((data) => {
      _symbols = data;
      console.log(chalk.white.dim(`Symbols have been imported.`));

      if (_action === 'test') {
        return createTests().then((data) => {
          _tests = JSON.parse(data);
          console.log(chalk.white.dim(`Tests have been imported.`));
          console.log(chalk.white.dim(`Executing tests...`));
          return startTesting();
        });
      } else {
        console.log(chalk.white.dim(`Start learning...`));
        return startLearning();
      }
    });
  }

  return createProject().then((data) => {
    _project = JSON.parse(data);
    console.log(chalk.white.dim(`Project ${_project.name} has been created.`));

    if (_files.length > 0) {
      return uploadFiles().then(() => {
        console.log(chalk.white.dim(`Files have been uploaded.`));
        return progress()
      })
    } else {
      return progress();
    }
  });
}).then((result) => {
  terminate(result, (message) => {
    console.log(chalk.green(message));
    process.exit(0);
  });
}).catch((err) => {
  terminate(err, (message) => {
    console.log(chalk.red(message));
    process.exit(1);
  });
});
