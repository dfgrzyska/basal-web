// JSON with Python semantics, so prompts match basal-serve byte for byte.
//
// - parse(): objects become Maps (JS objects put integer-like keys such as "10" before "2", which would reorder
//   the options), and a number written with a fraction or exponent becomes a PyFloat (Python keeps 1.0 apart from 1).
// - dumps(): Python's json.dumps(value, ensure_ascii=False), by default with the separators ", " and ": ".
// - pyStr(): Python's str() of a scalar (str(True) is "True", str(1.0) is "1.0").

export class PyFloat {
  constructor(value) {
    this.value = value;
  }
  valueOf() {
    return this.value;
  }
}

export function parse(text) {
  let i = 0;
  const fail = (msg) => {
    throw new SyntaxError(`${msg} at position ${i}`);
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const [word, v] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    return fail('unexpected token');
  };
  const object = () => {
    const out = new Map();
    i++;
    ws();
    if (text[i] === '}') {
      i++;
      return out;
    }
    for (;;) {
      ws();
      if (text[i] !== '"') fail('expected a string key');
      const k = string();
      ws();
      if (text[i++] !== ':') fail('expected ":"');
      out.set(k, value()); // a repeated key keeps its first position and its last value, as in Python
      ws();
      const c = text[i++];
      if (c === '}') return out;
      if (c !== ',') fail('expected "," or "}"');
    }
  };
  const array = () => {
    const out = [];
    i++;
    ws();
    if (text[i] === ']') {
      i++;
      return out;
    }
    for (;;) {
      out.push(value());
      ws();
      const c = text[i++];
      if (c === ']') return out;
      if (c !== ',') fail('expected "," or "]"');
    }
  };
  const string = () => {
    const start = ++i;
    let out = '';
    let run = start;
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text[i];
      if (c === '"') {
        out += text.slice(run, i++);
        return out;
      }
      if (c === '\\') {
        out += text.slice(run, i);
        const e = text[i + 1];
        const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in simple) {
          out += simple[e];
          i += 2;
        } else if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else fail('bad escape');
        run = i;
      } else if (c < ' ') fail('control character in string');
      else i++;
    }
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail('bad number');
    i += m[0].length;
    if (m[2] || m[3]) return new PyFloat(Number(m[0]));
    const n = Number(m[0]);
    return Number.isSafeInteger(n) ? n : BigInt(m[0]);
  };
  const out = value();
  ws();
  if (i < text.length) fail('trailing characters');
  return out;
}

// A plain JS value (from JSON.parse or code) -> the Map form parse() gives. Key order is then the JS order.
export function fromPlain(x) {
  if (x instanceof Map || x instanceof PyFloat) return x;
  if (Array.isArray(x)) return x.map(fromPlain);
  if (x && typeof x === 'object') return new Map(Object.entries(x).map(([k, v]) => [k, fromPlain(v)]));
  return x;
}

// A Map form -> plain JS objects (for answers shown to the caller).
export function toPlain(x) {
  if (x instanceof PyFloat) return x.value;
  if (x instanceof Map) return Object.fromEntries([...x].map(([k, v]) => [k, toPlain(v)]));
  if (Array.isArray(x)) return x.map(toPlain);
  return x;
}

// Python's repr() of a float: the shortest round-trip digits, fixed notation for exponents -4..15, else d.ddde+XX.
export function floatRepr(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [mant, e] = Math.abs(x).toExponential().split('e');
  const digits = mant.replace('.', '');
  const exp = Number(e);
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const ee = String(Math.abs(exp)).padStart(2, '0');
    return `${sign}${m}e${exp < 0 ? '-' : '+'}${ee}`;
  }
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  const int = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
  const frac = digits.slice(exp + 1);
  return `${sign}${int}.${frac || '0'}`;
}

function dumpString(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

export function dumps(x, item = ', ', key = ': ') {
  const d = (v) => dumps(v, item, key);
  if (x === null || x === undefined) return 'null';
  if (x === true) return 'true';
  if (x === false) return 'false';
  if (x instanceof PyFloat) return floatRepr(x.value);
  if (typeof x === 'bigint') return x.toString();
  if (typeof x === 'number') return Number.isInteger(x) ? String(x) : floatRepr(x);
  if (typeof x === 'string') return dumpString(x);
  if (Array.isArray(x)) return '[' + x.map(d).join(item) + ']';
  if (x instanceof Map) return '{' + [...x].map(([k, v]) => dumpString(String(k)) + key + d(v)).join(item) + '}';
  if (typeof x === 'object') return d(fromPlain(x));
  throw new TypeError(`cannot serialise ${typeof x}`);
}

// Python's str() of a key or label: strings as they are, True / False / None, float repr; containers as JSON.
export function pyStr(x) {
  if (typeof x === 'string') return x;
  if (x === true) return 'True';
  if (x === false) return 'False';
  if (x === null || x === undefined) return 'None';
  if (x instanceof PyFloat) return floatRepr(x.value);
  if (typeof x === 'number') return Number.isInteger(x) ? String(x) : floatRepr(x);
  if (typeof x === 'bigint') return x.toString();
  return dumps(x);
}

// Python truthiness of a parsed JSON value ("" / 0 / [] / {} / null are false).
export function truthy(x) {
  if (x instanceof PyFloat) return x.value !== 0;
  if (x instanceof Map) return x.size > 0;
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === 'bigint') return x !== 0n;
  return Boolean(x);
}
