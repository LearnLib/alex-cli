# Examples

Execute the following commands from the root of this repository.

## Testing

```bash
node alex-cli.js \
        --uri "http://localhost:8000" \
        --targets "https://www.google.com,https://www.google.com" \
        -a "test" \
        -u "admin@alex.example:admin" \
        -s "./examples/google/symbols.json" 
        -t "./examples/google/tests.json" 
        -c "./examples/google/config.testing.json" 
        --clean-up
```

## Learning

```bash
node alex-cli.js \
        --uri "http://localhost:8000" \
        --targets "https://www.google.com,https://www.google.com" \
        -a "learn" \
        -u "admin@alex.example:admin" \
        -s "./examples/google/symbols.json" 
        -c "./examples/google/config.learning.json" 
        --clean-up
```