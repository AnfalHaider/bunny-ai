// GATE-MARKS: which lines of a failed test run the gate keeps and prints under "what failed" (GATE-NAMES). Pure, so a test can hold it.
// The first part was `(✖|not ok)\b`, which could never match a ✖ line: ✖ is not a word character, so no \b follows it and the failing test's name was never printed.
export const FAIL_MARKS = /^\s*(✖|not ok\b)|^ℹ (tests|suites|pass|fail|cancelled|skipped|todo)\b|AssertionError|\bError \[ERR_|^\s*(TypeError|ReferenceError|RangeError|Error):/;
