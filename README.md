# ALEX CLI

A command line interface for running tests and learning experiments with [ALEX](https://github.com/LearnLib/alex) **(v1.4.0)**.

## Requirements

* A running instance of ALEX
* Node.js & NPM

## Installation

### Via NPM

```bash
npm install alex-cli
node node_modules/alex-cli/alex-cli.js -h 
```

### From source

```bash
git clone https://github.com/LearnLib/alex-cli.git
cd alex-cli
npm install
node alex-cli.js -h 
```

## Usage

1. Export the symbols from ALEX ([see here](http://learnlib.github.io/alex/book/1.4.0/contents/user-manual/symbol-modeling/#export--import)).
2. Export the tests from ALEX ([see here](http://learnlib.github.io/alex/book/1.4.0/contents/user-manual/testing.html)).
3. Create a configuration file ([see here](http://learnlib.github.io/alex/book/1.4.0/contents/cli/)).

Execute `node alex-cli.js -h` to see a complete list of parameters and their descriptions.
For examples see the section below.

### Examples

#### Testing

```bash
node alex-cli.js --uri "http://alex.some-server.de" \
                 --target "https://www.google.com" \
                 -a "test" \
                 -u "admin@alex.example:admin" \
                 -s "../google.symbols.json" \
                 -t "../google.tests.json" \
                 -c "../config.testing.json"
```

#### Learning

```bash
node alex-cli.js --uri "http://alex.some-server.de" \
                 --target "https://www.google.com" \
                 -a "learn" \
                 -u "admin@alex.example:admin" \
                 -s "../google.symbols.json" \
                 -c "../config.learning.json"
```
