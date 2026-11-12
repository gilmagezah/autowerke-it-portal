// The admin calculator's maths and key logic (public/calc-core.js), run in Node exactly as the
// browser runs it. Run all with `npm test`.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../public/calc-core.js');

// Press a sequence of keys from a blank calculator; returns the final state and history entries
function keys(seq, opts) {
  let state = C.EMPTY; const entries = [];
  for (const k of seq) { const out = C.press(state, k, opts); state = out.state; if (out.entry) entries.push(out.entry); }
  return { state, entries };
}
const typed = (s) => s.split('').map((c) => (c === '=' ? '=' : c));

// 1. Precedence, decimals and floating-point tidy-up
assert.strictEqual(C.evaluate('2+3*4'), 14);
assert.strictEqual(C.evaluate('10-4/2'), 8);
assert.strictEqual(C.evaluate('0.1+0.2'), 0.3);
assert.strictEqual(C.evaluate('1.1*3'), 3.3);
assert.strictEqual(C.evaluate('-5*-2'), 10);
console.log('1. × and ÷ before + and −, decimals, negatives, and 0.1 + 0.2 = 0.3 ✓');

// 2. Desk-calculator percent
assert.strictEqual(C.evaluate('200+10%'), 220);
assert.strictEqual(C.evaluate('200-25%'), 150);
assert.strictEqual(C.evaluate('200*10%'), 20);
assert.strictEqual(C.evaluate('50%'), 0.5);
console.log('2. percent: 200 + 10% = 220, 200 − 25% = 150, 200 × 10% = 20 ✓');

// 3. Anything that isn't calculator input is rejected, never executed
for (const bad of ['alert(1)', '2+', '*3', '1..2', '2**3', 'constructor', '1;2', '(1+2)', '3e5']) {
  assert.throws(() => C.evaluate(bad), `should reject ${bad}`);
}
assert.throws(() => C.evaluate('5/0'), /divide by 0/);
assert.throws(() => C.evaluate('999999999*9999999'), /Too big/);
const src = fs.readFileSync(path.join(__dirname, '../public/calc-core.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../public/calculator.js'), 'utf8');
assert(!/\beval\s*\(|new Function|setTimeout\(\s*['"`]/.test(src), 'no eval-style code');
console.log('3. letters, code, brackets, exponents and half sums are rejected; ÷0 and overflow give a message; no eval anywhere ✓');

// 4. Typing: operators replace each other, one decimal point per number, no leading zeros
let r = keys(['0', '0', '7', '+', '*', '3', '.', '.', '5', '=']);
assert.strictEqual(r.state.expr, '24.5');
assert.strictEqual(r.state.label, '7 × 3.5 =');
r = keys(['.', '5', '+', '1', '=']);
assert.strictEqual(r.state.expr, '1.5');
console.log('4. 007 + × 3..5 = reads as 7 × 3.5 = 24.5; "." starts as 0. ✓');

// 5. After "=": a digit starts over, an operator carries the answer on
r = keys(['6', '*', '7', '=', '+', '8', '=']);
assert.strictEqual(r.state.expr, '50');
assert.strictEqual(r.entries.length, 2);
r = keys(['6', '*', '7', '=', '9']);
assert.strictEqual(r.state.expr, '9');
r = keys(['6', '*', '7', '=', '=']);
assert.strictEqual(r.entries.length, 1, 'pressing = twice does not add a duplicate');
console.log('5. answers carry into the next sum; a new digit starts fresh; = twice adds no duplicate ✓');

// 6. VAT at the server's rate, rounded to cents, and logged with the VAT amount
r = keys(['1', '0', '0', '0', 'vat+'], { vatRate: 15.5 });
assert.strictEqual(r.state.expr, '1155');
assert.strictEqual(r.entries[0].result, 1155);
assert.match(r.entries[0].expr, /1,000 \+ VAT 15\.5% \(155\)/);
r = keys(['1', '1', '5', '5', 'vat-'], { vatRate: 15.5 });
assert.strictEqual(r.state.expr, '1000');
assert.match(r.entries[0].expr, /excl\. VAT 15\.5% \(VAT 155\)/);
r = keys(['9', '9', '.', '9', '9', 'vat+'], { vatRate: 15 });
assert.strictEqual(r.state.expr, '114.99');
r = keys(['2', '0', '0', '+', 'vat+'], { vatRate: 15.5 });
assert.strictEqual(r.state.expr, '231', 'a dangling operator is ignored');
console.log('6. +VAT and EX VAT use the given rate, round to cents, and record the VAT amount ✓');

// 7. ⌫, ±, C, and errors that clear on the next key
r = keys(['1', '2', '3', 'back', 'neg']);
assert.strictEqual(r.state.expr, '-12');
r = keys(['5', '+', '3', 'neg', '=']);
assert.strictEqual(r.state.expr, '2');
r = keys(['8', '/', '0', '=']);
assert.strictEqual(r.state.error, "Can't divide by 0");
r = keys(['8', '/', '0', '=', '4']);
assert.strictEqual(r.state.error, '');
assert.strictEqual(r.state.expr, '4');
assert.deepStrictEqual(keys(['1', '+', '2', 'C']).state, C.EMPTY);
console.log('7. ⌫ deletes, ± flips the current number, ÷0 shows a message that clears on the next key, C resets ✓');

// 8. Display formatting
assert.strictEqual(C.format(1234567.5), '1,234,567.5');
assert.strictEqual(C.formatExpr('1250*3-12.50'), '1,250 × 3 − 12.50');
assert.strictEqual(C.formatExpr('200+10%'), '200 + 10%');
assert.strictEqual(C.recall(0.0000001).expr, '0.0000001', 'never "1e-7", which the keypad could not continue');
console.log('8. thousands separators, × ÷ − symbols, and tiny numbers stay typeable ✓');

// 9. A numbers-only flood can't grow without limit
r = keys(Array(40).fill('9'));
assert.strictEqual(r.state.expr.length, 15);
console.log('9. a number is capped at 15 digits ✓');

// 10. Typed-in sequence helper sanity (keyboard input maps to the same keys)
r = keys(typed('12*12='));
assert.strictEqual(r.state.expr, '144');
console.log('10. a typed sequence 12*12= gives 144 ✓');
