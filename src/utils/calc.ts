/**
 * Pure non-programmable ЕГЭ Physics scientific calculator evaluator,
 * arrow geometry helper, and table helper utilities for Whiteboard Pro v9.0.
 */

export type AngleMode = 'DEG' | 'RAD' | 'GRAD';
export type DisplayFormatMode = 'NORM' | 'FIX' | 'SCI';
export interface DisplayFormatConfig {
  mode: DisplayFormatMode;
  digits?: number;
}
export type CalcVarMap = Partial<Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X' | 'Y' | 'M' | 'Ans', number>>;

export function angleToRad(v: number, angleMode: AngleMode = 'DEG'): number {
  if (angleMode === 'DEG') return (v * Math.PI) / 180;
  if (angleMode === 'GRAD') return (v * Math.PI) / 200;
  return v;
}

export function radToAngle(v: number, angleMode: AngleMode = 'DEG'): number {
  if (angleMode === 'DEG') return (v * 180) / Math.PI;
  if (angleMode === 'GRAD') return (v * 200) / Math.PI;
  return v;
}

export function formatComixResult(num: number, fmt?: DisplayFormatConfig): string {
  if (!Number.isFinite(num)) return 'Ошибка';
  if (Object.is(num, -0) || num === 0) {
    if (fmt?.mode === 'FIX') {
      const d = Math.max(0, Math.min(9, fmt.digits ?? 2));
      return (0).toFixed(d);
    }
    if (fmt?.mode === 'SCI') {
      const d = Math.max(0, Math.min(9, fmt.digits ?? 3));
      const frac = d === 0 ? 9 : Math.max(0, d - 1);
      return (0).toExponential(frac);
    }
    return '0';
  }
  if (fmt?.mode === 'FIX') {
    const d = Math.max(0, Math.min(9, fmt.digits ?? 2));
    const abs = Math.abs(num);
    if (abs >= 1e10) return num.toExponential(Math.min(9, Math.max(1, d))).replace(/\.?0+e/, 'e');
    return num.toFixed(d);
  }
  if (fmt?.mode === 'SCI') {
    const d = Math.max(0, Math.min(9, fmt.digits ?? 3));
    const frac = d === 0 ? 9 : Math.max(0, d - 1);
    return num.toExponential(frac).replace('e+', 'e+').replace('e-', 'e-');
  }
  const rounded = Number(num.toPrecision(10));
  if (!Number.isFinite(rounded)) return 'Ошибка';
  if (Math.abs(rounded) >= 1e10 || (Math.abs(rounded) > 0 && Math.abs(rounded) < 1e-5)) {
    return rounded.toExponential(6).replace(/\.?0+e/, 'e');
  }
  return String(rounded);
}

function formatResult(num: number): string {
  return formatComixResult(num);
}

/**
 * Converts a finite decimal value to a Comix CS-85 fraction string using continued fractions.
 * Uses '┘' separator: e.g. 8/9 -> "8┘9", 7/3 -> "2┘1┘3" (mixed) or "7┘3" (improper).
 */
export function decimalToFractionString(val: number, improper = false, maxDen = 9999): string | null {
  if (!Number.isFinite(val)) return null;
  if (Math.abs(val) > 1e7) return null;
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (Math.abs(abs - Math.round(abs)) < 1e-10) {
    return `${sign}${Math.round(abs)}`;
  }

  let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
  let b = abs;
  for (let iter = 0; iter < 32; iter++) {
    const a = Math.floor(b);
    const h = a * h1 + h2;
    const k = a * k1 + k2;
    if (k > maxDen) break;
    h2 = h1; h1 = h;
    k2 = k1; k1 = k;
    if (Math.abs(abs - h1 / k1) < 1e-10) break;
    const rem = b - a;
    if (rem < 1e-12) break;
    b = 1 / rem;
  }

  if (k1 <= 0 || Math.abs(abs - h1 / k1) > 1e-7) return null;
  if (k1 === 1) return `${sign}${h1}`;
  if (improper || h1 < k1) {
    return `${sign}${h1}┘${k1}`;
  }
  const whole = Math.floor(h1 / k1);
  const rem = h1 % k1;
  if (rem === 0) return `${sign}${whole}`;
  return `${sign}${whole}┘${rem}┘${k1}`;
}

export function formatDmsString(val: number): string {
  if (!Number.isFinite(val)) return 'Ошибка';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  let deg = Math.floor(abs + 1e-12);
  const minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat + 1e-10);
  let sec = Math.round((minFloat - min) * 60 * 100) / 100;
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  return `${sign}${deg}°${min}′${sec}″`;
}

export function formatEngNotation(val: number, shiftSteps = 0): string {
  if (!Number.isFinite(val)) return 'Ошибка';
  if (val === 0) return '0e+0';
  const baseExp = Math.floor(Math.log10(Math.abs(val)) / 3) * 3 - shiftSteps * 3;
  const mantissa = Number((val / Math.pow(10, baseExp)).toPrecision(9));
  return `${mantissa}e${baseExp >= 0 ? '+' + baseExp : baseExp}`;
}

export interface SdStatsResult {
  n: number;
  sumX: number;
  sumX2: number;
  mean: number;
  sigmaN: number;
  sigmaN1: number;
}

export function computeSdStats(samples: number[]): SdStatsResult {
  const clean = (samples || []).filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n === 0) {
    return { n: 0, sumX: 0, sumX2: 0, mean: NaN, sigmaN: NaN, sigmaN1: NaN };
  }
  let sumX = 0;
  let sumX2 = 0;
  for (const x of clean) {
    sumX += x;
    sumX2 += x * x;
  }
  const mean = sumX / n;
  const varPop = Math.max(0, sumX2 / n - mean * mean);
  const sigmaN = Math.sqrt(varPop);
  const sigmaN1 = n > 1 ? Math.sqrt(Math.max(0, (sumX2 - (sumX * sumX) / n) / (n - 1))) : NaN;
  return { n, sumX, sumX2, mean, sigmaN, sigmaN1 };
}

function factorial(n: number): number {
  if (!Number.isFinite(n) || n < 0 || n > 170 || Math.floor(n) !== n) {
    throw new Error('Domain error');
  }
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

function comb(n: number, r: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(r) || n < 0 || r < 0 || r > n || Math.floor(n) !== n || Math.floor(r) !== r) {
    throw new Error('Domain error');
  }
  return factorial(n) / (factorial(r) * factorial(n - r));
}

function perm(n: number, r: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(r) || n < 0 || r < 0 || r > n || Math.floor(n) !== n || Math.floor(r) !== r) {
    throw new Error('Domain error');
  }
  return factorial(n) / factorial(n - r);
}

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: string }
  | { type: 'fn'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

function preprocessComixExpression(raw: string, angleMode: AngleMode): string {
  let s = String(raw || '').trim();
  // Convert Comix DMS notation: 45°30'15" or 45°30′15″ or 45°30°15° -> decimal degrees
  s = s.replace(/(\d+(?:\.\d+)?)°(?:(\d+(?:\.\d+)?)[°'′](?:(\d+(?:\.\d+)?)[°"″]?)?)?/g, (_, d, m, sec) => {
    const deg = Number(d) || 0;
    const min = Number(m) || 0;
    const sc = Number(sec) || 0;
    const degVal = deg + min / 60 + sc / 3600;
    if (angleMode === 'RAD') return `(${(degVal * Math.PI) / 180})`;
    if (angleMode === 'GRAD') return `(${(degVal * 200) / 180})`;
    return `(${degVal})`;
  });

  // Explicit angle unit suffixes from DRG▸ menu: ʳ (radians), ᵍ (gradians)
  s = s.replace(/(\d+(?:\.\d+)?|π)ʳ/g, (_, val) => {
    const radExpr = val === 'π' ? String(Math.PI) : val;
    if (angleMode === 'DEG') return `((${radExpr})*180/${Math.PI})`;
    if (angleMode === 'GRAD') return `((${radExpr})*200/${Math.PI})`;
    return `(${radExpr})`;
  });
  s = s.replace(/(\d+(?:\.\d+)?)ᵍ/g, (_, val) => {
    if (angleMode === 'DEG') return `((${val})*0.9)`;
    if (angleMode === 'RAD') return `((${val})*${Math.PI}/200)`;
    return `(${val})`;
  });

  // Mixed fractions a┘b┘c -> (a + b/c), simple fractions a┘b -> (a/b)
  s = s.replace(/(\d+)┘(\d+)┘(\d+)/g, '($1+$2/$3)');
  s = s.replace(/(\d+)┘(\d+)/g, '($1/$2)');

  return s;
}

function tokenize(raw: string, angleMode: AngleMode, vars: CalcVarMap = {}): Token[] {
  const s = preprocessComixExpression(raw, angleMode)
    .replace(/\s+/g, '')
    .replace(/;/g, ',')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/ˣ√/g, '§')
    .replace(/√\(/g, 'sqrt(')
    .replace(/√/g, 'sqrt')
    .replace(/∛\(/g, 'cbrt(')
    .replace(/∛/g, 'cbrt');

  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Numbers including scientific E notation (e.g., 6.67E-11)
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = '';
      let hasDot = false;
      while (i < s.length && ((s[i] >= '0' && s[i] <= '9') || (s[i] === '.' && !hasDot))) {
        if (s[i] === '.') hasDot = true;
        numStr += s[i++];
      }
      if (i < s.length && s[i] === 'E') {
        let expPart = 'E';
        let j = i + 1;
        if (j < s.length && (s[j] === '+' || s[j] === '-')) {
          expPart += s[j++];
        }
        let expDigits = '';
        while (j < s.length && s[j] >= '0' && s[j] <= '9') {
          expDigits += s[j++];
        }
        if (expDigits.length > 0) {
          numStr += expPart + expDigits;
          i = j;
        }
      }
      const val = Number(numStr);
      if (Number.isNaN(val)) throw new Error('Invalid number');
      tokens.push({ type: 'num', value: val });
      continue;
    }

    if (ch === 'π') {
      tokens.push({ type: 'num', value: Math.PI });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }

    if ('+-*/^%!§'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    // Combinatorics C/P vs ALPHA variable C:
    // If C is preceded by num/rparen and followed by digit/lparen, treat as nCr operator;
    // otherwise allow C to resolve as variable C when present in vars or standalone.
    if (ch === 'C' || ch === 'P') {
      const prev = tokens[tokens.length - 1];
      const nextCh = s[i + 1] || '';
      const isBinaryComb =
        prev &&
        (prev.type === 'num' || prev.type === 'rparen') &&
        ((nextCh >= '0' && nextCh <= '9') || nextCh === '(');
      if (isBinaryComb) {
        tokens.push({ type: 'op', value: ch });
        i++;
        continue;
      }
      if (ch === 'C' && vars.C !== undefined) {
        tokens.push({ type: 'num', value: Number(vars.C) });
        i++;
        continue;
      }
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    // Identifiers: functions, constants, and ALPHA memory variables
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      let id = '';
      while (i < s.length && ((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) {
        id += s[i++];
      }
      const lower = id.toLowerCase();
      if (lower === 'pi') {
        tokens.push({ type: 'num', value: Math.PI });
      } else if (id === 'e') {
        tokens.push({ type: 'num', value: Math.E });
      } else if (lower === 'ans') {
        tokens.push({ type: 'num', value: Number(vars.Ans ?? 0) });
      } else if (/^[ABDEFXYM]$/.test(id)) {
        const key = id as keyof CalcVarMap;
        tokens.push({ type: 'num', value: Number(vars[key] ?? 0) });
      } else if (
        ['sin', 'cos', 'tg', 'tan', 'arcsin', 'asin', 'arccos', 'acos', 'arctg', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'lg', 'log', 'log10', 'ln', 'sqrt', 'cbrt', 'exp', 'abs', 'pol', 'rec', 'ncr', 'npr'].includes(lower)
      ) {
        tokens.push({ type: 'fn', value: lower });
      } else {
        throw new Error(`Unknown identifier: ${id}`);
      }
      continue;
    }

    throw new Error(`Unexpected char: ${ch}`);
  }

  return tokens;
}

export interface PolRecResult {
  primary: number;
  secondary: number;
  xVal: number;
  yVal: number;
}

export function evaluatePolRec(
  expr: string,
  angleMode: AngleMode = 'DEG',
  vars: CalcVarMap = {}
): PolRecResult | null {
  const trimmed = String(expr || '').trim().replace(/;/g, ',');
  const polMatch = trimmed.match(/^Pol\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i);
  if (polMatch) {
    const x = evaluatePhysicsCalcNumeric(polMatch[1], angleMode, vars);
    const y = evaluatePhysicsCalcNumeric(polMatch[2], angleMode, vars);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const r = Math.hypot(x, y);
    const theta = radToAngle(Math.atan2(y, x), angleMode);
    return { primary: r, secondary: theta, xVal: r, yVal: theta };
  }
  const recMatch = trimmed.match(/^Rec\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i);
  if (recMatch) {
    const r = evaluatePhysicsCalcNumeric(recMatch[1], angleMode, vars);
    const th = evaluatePhysicsCalcNumeric(recMatch[2], angleMode, vars);
    if (!Number.isFinite(r) || !Number.isFinite(th)) return null;
    const rad = angleToRad(th, angleMode);
    const x = r * Math.cos(rad);
    const y = r * Math.sin(rad);
    return { primary: x, secondary: y, xVal: x, yVal: y };
  }
  return null;
}

export function evaluatePhysicsCalcNumeric(
  expr: string,
  angleMode: AngleMode = 'DEG',
  vars: CalcVarMap = {}
): number {
  let trimmed = String(expr || '').trim();
  if (!trimmed) return 0;

  const openCount = (trimmed.match(/\(/g) || []).length;
  const closeCount = (trimmed.match(/\)/g) || []).length;
  if (openCount > closeCount) {
    trimmed += ')'.repeat(openCount - closeCount);
  }

  const pr = evaluatePolRec(trimmed, angleMode, vars);
  if (pr) return pr.primary;

  const tokens = tokenize(trimmed, angleMode, vars);
  if (tokens.length === 0) return 0;

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  const needsImplicitMul = (next: Token | undefined): boolean => {
    if (!next) return false;
    return next.type === 'num' || next.type === 'fn' || next.type === 'lparen';
  };

  const toRad = (v: number): number => angleToRad(v, angleMode);
  const fromRad = (v: number): number => radToAngle(v, angleMode);

  function parseExpr(): number {
    let left = parseTerm();
    while (peek()?.type === 'op' && (peek() as { type: 'op'; value: string }).value.match(/^[+-]$/)) {
      const op = (consume() as { type: 'op'; value: string }).value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseUnary();
    while (true) {
      const next = peek();
      if (next?.type === 'op' && (next.value === '*' || next.value === '/')) {
        consume();
        const right = parseUnary();
        if (next.value === '/') {
          if (right === 0) throw new Error('DivByZero');
          left = left / right;
        } else {
          left = left * right;
        }
      } else if (needsImplicitMul(next)) {
        const right = parseUnary();
        left = left * right;
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary(): number {
    const next = peek();
    if (next?.type === 'op' && (next.value === '+' || next.value === '-')) {
      consume();
      const val = parseUnary();
      return next.value === '-' ? -val : val;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePostfix();
    const next = peek();
    if (next?.type === 'op' && (next.value === '^' || next.value === 'C' || next.value === 'P' || next.value === '§')) {
      const op = next.value;
      consume();
      const exp = parseUnary();
      if (op === 'C') return comb(base, exp);
      if (op === 'P') return perm(base, exp);
      if (op === '§') {
        if (base === 0) throw new Error('Domain');
        if (exp < 0 && Math.abs(base % 2) === 1) return -Math.pow(-exp, 1 / base);
        if (exp < 0) throw new Error('Domain');
        return Math.pow(exp, 1 / base);
      }
      return Math.pow(base, exp);
    }
    return base;
  }

  function parsePostfix(): number {
    let val = parsePrimary();
    while (peek()?.type === 'op' && ((peek() as { type: 'op'; value: string }).value === '!' || (peek() as { type: 'op'; value: string }).value === '%')) {
      const op = (consume() as { type: 'op'; value: string }).value;
      if (op === '!') val = factorial(val);
      else if (op === '%') val = val / 100;
    }
    return val;
  }

  function parsePrimary(): number {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end');

    if (tok.type === 'num') {
      consume();
      return tok.value;
    }

    if (tok.type === 'lparen') {
      consume();
      const val = parseExpr();
      if (peek()?.type !== 'rparen') throw new Error('Missing )');
      consume();
      return val;
    }

    if (tok.type === 'fn') {
      consume();
      let arg: number;
      let arg2: number | undefined;
      if (peek()?.type === 'lparen') {
        consume();
        arg = parseExpr();
        if (peek()?.type === 'comma') {
          consume();
          arg2 = parseExpr();
        }
        if (peek()?.type !== 'rparen') throw new Error('Missing )');
        consume();
      } else {
        arg = parseUnary();
      }

      switch (tok.value) {
        case 'sin': {
          if (angleMode === 'DEG' && Math.abs(arg % 180) < 1e-12) return 0;
          if (angleMode === 'GRAD' && Math.abs(arg % 200) < 1e-12) return 0;
          return Math.sin(toRad(arg));
        }
        case 'cos': {
          if (angleMode === 'DEG' && Math.abs((Math.abs(arg) % 180) - 90) < 1e-12) return 0;
          if (angleMode === 'GRAD' && Math.abs((Math.abs(arg) % 200) - 100) < 1e-12) return 0;
          return Math.cos(toRad(arg));
        }
        case 'tg':
        case 'tan': {
          if (angleMode === 'DEG' && Math.abs((Math.abs(arg) % 180) - 90) < 1e-12) {
            throw new Error('Tan90');
          }
          if (angleMode === 'GRAD' && Math.abs((Math.abs(arg) % 200) - 100) < 1e-12) {
            throw new Error('Tan100g');
          }
          return Math.tan(toRad(arg));
        }
        case 'arcsin':
        case 'asin': {
          if (arg < -1 || arg > 1) throw new Error('Domain');
          return fromRad(Math.asin(arg));
        }
        case 'arccos':
        case 'acos': {
          if (arg < -1 || arg > 1) throw new Error('Domain');
          return fromRad(Math.acos(arg));
        }
        case 'arctg':
        case 'atan':
          return fromRad(Math.atan(arg));
        case 'sinh':
          return Math.sinh(arg);
        case 'cosh':
          return Math.cosh(arg);
        case 'tanh':
          return Math.tanh(arg);
        case 'asinh':
          return Math.asinh(arg);
        case 'acosh': {
          if (arg < 1) throw new Error('Domain');
          return Math.acosh(arg);
        }
        case 'atanh': {
          if (arg <= -1 || arg >= 1) throw new Error('Domain');
          return Math.atanh(arg);
        }
        case 'lg':
        case 'log':
        case 'log10': {
          if (arg <= 0) throw new Error('Domain');
          return Math.log10(arg);
        }
        case 'ln': {
          if (arg <= 0) throw new Error('Domain');
          return Math.log(arg);
        }
        case 'sqrt': {
          if (arg < 0) throw new Error('Domain');
          return Math.sqrt(arg);
        }
        case 'cbrt':
          return Math.cbrt(arg);
        case 'exp':
          return Math.exp(arg);
        case 'abs':
          return Math.abs(arg);
        case 'ncr':
          return comb(arg, arg2 ?? 0);
        case 'npr':
          return perm(arg, arg2 ?? 0);
        case 'pol':
          return Math.hypot(arg, arg2 ?? 0);
        case 'rec':
          return arg * Math.cos(toRad(arg2 ?? 0));
        default:
          throw new Error('Unknown fn');
      }
    }

    throw new Error('Unexpected token');
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Trailing tokens');
  return result;
}

export function evaluatePhysicsCalc(
  expr: string,
  angleMode: AngleMode = 'DEG',
  vars: CalcVarMap = {},
  fmt?: DisplayFormatConfig
): string {
  try {
    const val = evaluatePhysicsCalcNumeric(expr, angleMode, vars);
    return fmt ? formatComixResult(val, fmt) : formatResult(val);
  } catch {
    return 'Ошибка';
  }
}

export function calcNormalizedSquareOrCircleBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  constrainEqual = true
): { x: number; y: number; w: number; h: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (constrainEqual) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    const nx2 = x1 + sx * side;
    const ny2 = y1 + sy * side;
    return {
      x: Math.min(x1, nx2),
      y: Math.min(y1, ny2),
      w: side,
      h: side,
    };
  }
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}

export interface ArrowHeadGeometry {
  tip: { x: number; y: number };
  baseLeft: { x: number; y: number };
  baseRight: { x: number; y: number };
  shaftEnd: { x: number; y: number };
}

/**
 * Computes sharp solid filled triangle arrowhead geometry matching reference image_6492bfb2.png.
 */
export function getArrowHeadGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeSize = 4
): ArrowHeadGeometry {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const rawHeadLen = Math.max(17, strokeSize * 4.2);
  const headLen = len > 0 ? Math.min(rawHeadLen, len * 0.65) : rawHeadLen;
  const halfAngle = Math.PI / 6.3; // Sharp filled triangle arrowhead

  const baseLeft = {
    x: x2 - headLen * Math.cos(angle - halfAngle),
    y: y2 - headLen * Math.sin(angle - halfAngle),
  };
  const baseRight = {
    x: x2 - headLen * Math.cos(angle + halfAngle),
    y: y2 - headLen * Math.sin(angle + halfAngle),
  };
  const baseCenterLen = headLen * Math.cos(halfAngle);
  const shaftEnd = {
    x: x2 - baseCenterLen * 0.9 * Math.cos(angle),
    y: y2 - baseCenterLen * 0.9 * Math.sin(angle),
  };

  return {
    tip: { x: x2, y: y2 },
    baseLeft,
    baseRight,
    shaftEnd,
  };
}

export function createDefaultTableData(rows = 3, cols = 3): string[][] {
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(r === 0 ? `Столбец ${c + 1}` : '');
    }
    out.push(row);
  }
  return out;
}

export function resizeTableData(
  data: string[][],
  deltaRows: number,
  deltaCols: number
): string[][] {
  const rows = Math.max(1, Math.min(16, (data.length || 1) + deltaRows));
  const curCols = data[0]?.length || 1;
  const cols = Math.max(1, Math.min(12, curCols + deltaCols));

  const next: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const srcRow = data[r] || [];
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(srcRow[c] !== undefined ? srcRow[c] : r === 0 ? `Столбец ${c + 1}` : '');
    }
    next.push(row);
  }
  return next;
}

export type SearchCategory = 'all' | 'books' | 'text' | 'other';

export interface SearchableWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  latex?: string;
  lawTitle?: string;
  isPdf?: boolean;
  pdfTitle?: string;
  tableData?: string[][];
}

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  category: Exclude<SearchCategory, 'all'>;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function getParticipantInitials(name: string): string {
  const clean = String(name || '').trim();
  if (!clean) return 'УЧ';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function filterBoardSearchItems(
  widgets: SearchableWidget[],
  query = '',
  category: SearchCategory = 'all'
): SearchResultItem[] {
  const q = String(query || '').trim().toLowerCase();
  const items: SearchResultItem[] = [];

  for (const w of widgets || []) {
    let cat: Exclude<SearchCategory, 'all'> = 'other';
    let title = '';
    let subtitle = '';

    if (w.isPdf || w.type === 'pdf') {
      cat = 'books';
      title = w.pdfTitle || 'Документ PDF';
      subtitle = 'Книга';
    } else if (w.type === 'text' || w.type === 'note') {
      cat = 'text';
      title = (w.text || '').replace(/\s+/g, ' ').trim() || (w.type === 'note' ? 'Стикер' : 'Текст');
      subtitle = w.type === 'note' ? 'Стикер' : 'Текст';
    } else if (w.type === 'latex') {
      cat = 'other';
      title = w.lawTitle || w.latex || 'Формула';
      subtitle = 'Формула';
    } else if (w.type === 'table') {
      cat = 'other';
      const firstCell = w.tableData?.[0]?.[0] || '';
      title = firstCell ? `Таблица: ${firstCell}` : 'Таблица';
      subtitle = 'Таблица';
    } else if (w.type === 'calculator') {
      cat = 'other';
      title = 'Калькулятор ЕГЭ';
      subtitle = 'Виджет';
    } else if (w.type === 'timer') {
      cat = 'other';
      title = 'Таймер';
      subtitle = 'Виджет';
    } else if (w.type === 'stopwatch') {
      cat = 'other';
      title = 'Секундомер';
      subtitle = 'Виджет';
    } else if (w.type === 'image') {
      cat = 'other';
      title = w.pdfTitle || 'Изображение';
      subtitle = 'Картинка';
    } else {
      cat = 'other';
      title = w.type || 'Объект';
      subtitle = 'Другое';
    }

    if (category !== 'all' && cat !== category) continue;
    if (q) {
      const hay = `${title} ${subtitle} ${w.latex || ''} ${w.text || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    items.push({
      id: w.id,
      title,
      subtitle,
      category: cat,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
    });
  }

  return items;
}

export function calcFitAllCamera(
  bounds: { x: number; y: number; w: number; h: number } | null,
  viewportW: number,
  viewportH: number,
  padding = 90
): { x: number; y: number; z: number } {
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return { x: 0, y: 0, z: 1 };
  }
  const availW = Math.max(200, viewportW - padding * 2);
  const availH = Math.max(160, viewportH - padding * 2);
  const z = Math.min(2.0, Math.max(0.2, +(Math.min(availW / bounds.w, availH / bounds.h)).toFixed(2)));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return {
    x: Math.round(viewportW / 2 - cx * z),
    y: Math.round(viewportH / 2 - cy * z),
    z,
  };
}

/**
 * ISO/IEC 18004 compliant QR Code matrix generator (Byte mode, ECC Level L, Versions 1..10)
 */
const QR_VERSIONS_L = [
  null,
  { total: 26, ecPerBlock: 7, blocks1: 1, data1: 19, blocks2: 0, data2: 0, align: [] },
  { total: 44, ecPerBlock: 10, blocks1: 1, data1: 34, blocks2: 0, data2: 0, align: [6, 18] },
  { total: 70, ecPerBlock: 15, blocks1: 1, data1: 55, blocks2: 0, data2: 0, align: [6, 22] },
  { total: 100, ecPerBlock: 20, blocks1: 1, data1: 80, blocks2: 0, data2: 0, align: [6, 26] },
  { total: 134, ecPerBlock: 26, blocks1: 1, data1: 108, blocks2: 0, data2: 0, align: [6, 30] },
  { total: 172, ecPerBlock: 18, blocks1: 2, data1: 68, blocks2: 0, data2: 0, align: [6, 34] },
  { total: 196, ecPerBlock: 20, blocks1: 2, data1: 78, blocks2: 0, data2: 0, align: [6, 22, 38] },
  { total: 242, ecPerBlock: 24, blocks1: 2, data1: 97, blocks2: 0, data2: 0, align: [6, 24, 42] },
  { total: 292, ecPerBlock: 30, blocks1: 2, data1: 116, blocks2: 0, data2: 0, align: [6, 26, 46] },
  { total: 346, ecPerBlock: 18, blocks1: 2, data1: 68, blocks2: 2, data2: 69, align: [6, 28, 50] },
];

export function generateQRMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(String(text || '')));
  let ver = 1;
  while (ver <= 10) {
    const spec = QR_VERSIONS_L[ver]!;
    const totalData = spec.blocks1 * spec.data1 + spec.blocks2 * spec.data2;
    const headerBits = ver <= 9 ? 4 + 8 : 4 + 16;
    if (bytes.length * 8 + headerBits <= totalData * 8) break;
    ver++;
  }
  if (ver > 10) ver = 10;
  const spec = QR_VERSIONS_L[ver]!;
  const totalData = spec.blocks1 * spec.data1 + spec.blocks2 * spec.data2;

  // 1. Build bit stream (Byte mode = 0100)
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  const clipped = bytes.slice(0, totalData - (ver <= 9 ? 2 : 3));
  pushBits(clipped.length, ver <= 9 ? 8 : 16);
  for (const b of clipped) pushBits(b, 8);

  const maxBits = totalData * 8;
  const term = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCw: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCw.push(b);
  }
  let padIdx = 0;
  while (dataCw.length < totalData) {
    dataCw.push(padIdx % 2 === 0 ? 0xec : 0x11);
    padIdx++;
  }

  // 2. GF(256) Reed-Solomon error correction
  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
  const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : gfExp[gfLog[a] + gfLog[b]]);

  let gen = [1];
  for (let i = 0; i < spec.ecPerBlock; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], gfExp[i]);
    }
    gen = next;
  }

  const computeEC = (block: number[]) => {
    const msg = [...block, ...new Array(spec.ecPerBlock).fill(0)];
    for (let i = 0; i < block.length; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return msg.slice(block.length);
  };

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < spec.blocks1; b++) {
    const blk = dataCw.slice(offset, offset + spec.data1);
    offset += spec.data1;
    dataBlocks.push(blk);
    ecBlocks.push(computeEC(blk));
  }
  for (let b = 0; b < spec.blocks2; b++) {
    const blk = dataCw.slice(offset, offset + spec.data2);
    offset += spec.data2;
    dataBlocks.push(blk);
    ecBlocks.push(computeEC(blk));
  }

  const finalCw: number[] = [];
  const maxDataLen = Math.max(spec.data1, spec.data2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) finalCw.push(blk[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const blk of ecBlocks) {
      if (i < blk.length) finalCw.push(blk[i]);
    }
  }

  // 3. Matrix setup
  const size = 17 + ver * 4;
  const mat: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (r: number, c: number, val: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mat[r][c] = val;
      isFunc[r][c] = true;
    }
  };

  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const onBorder = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r, c, onBorder || inCore);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  const align = spec.align;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      const cr = align[i];
      const cc = align[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const val = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(cr + dr, cc + dc, val);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i <= 8; i++) {
    if (!isFunc[8][i]) setFunc(8, i, false);
    if (!isFunc[i][8]) setFunc(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunc[8][size - 1 - i]) setFunc(8, size - 1 - i, false);
    if (!isFunc[size - 1 - i][8]) setFunc(size - 1 - i, 8, false);
  }
  setFunc(size - 8, 8, true);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const vBits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // 4. Zig-zag codeword placement
  let bitIdx = 0;
  const totalBits = finalCw.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunc[r][c]) {
          let bit = false;
          if (bitIdx < totalBits) {
            bit = ((finalCw[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) bit = !bit;
          mat[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  // 5. Format info for ECC Level L (01) + Mask 0 (000) -> data = 0b01000 = 8
  const fmtData = (0b01 << 3) | 0;
  let fmtRem = fmtData;
  for (let i = 0; i < 10; i++) fmtRem = (fmtRem << 1) ^ ((fmtRem >> 9) * 0x537);
  const fmtBits = ((fmtData << 10) | fmtRem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) mat[8][i] = ((fmtBits >> i) & 1) === 1;
  mat[8][7] = ((fmtBits >> 6) & 1) === 1;
  mat[8][8] = ((fmtBits >> 7) & 1) === 1;
  mat[7][8] = ((fmtBits >> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) mat[14 - i][8] = ((fmtBits >> i) & 1) === 1;

  for (let i = 0; i < 8; i++) mat[8][size - 1 - i] = ((fmtBits >> i) & 1) === 1;
  for (let i = 8; i < 15; i++) mat[size - 15 + i][8] = ((fmtBits >> i) & 1) === 1;

  return mat;
}

export type LineStyleType = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export function getLineDashPattern(style: LineStyleType = 'solid', size = 4): number[] {
  const w = Math.max(2, Number(size) || 4);
  switch (style) {
    case 'dashed':
      return [+(w * 2.5).toFixed(1), +(w * 1.6).toFixed(1)];
    case 'dotted':
      return [+(w * 1.05).toFixed(1), +(w * 1.45).toFixed(1)];
    case 'dashdot':
      return [
        +(w * 2.8).toFixed(1),
        +(w * 1.3).toFixed(1),
        +(w * 1.0).toFixed(1),
        +(w * 1.3).toFixed(1),
      ];
    case 'solid':
    default:
      return [];
  }
}

export type EraserTargetMode = 'pen_and_highlighter' | 'highlighter_only' | 'pen_only' | 'all';
export type ClearStrokesKind = 'highlighters' | 'student_strokes' | 'teacher_strokes' | 'all_strokes';

export interface ErasableStroke {
  id: number | string;
  type: string;
  isHighlighter?: boolean;
  points?: Array<{ x: number; y: number }>;
  authorRole?: 'teacher' | 'student';
}

export function shouldEraseStroke(stroke: ErasableStroke, target: EraserTargetMode = 'pen_and_highlighter'): boolean {
  if (!stroke) return false;
  const isHl = stroke.type === 'highlighter' || Boolean(stroke.isHighlighter);
  const isFreehandPen = (stroke.type === 'pen' || Boolean(stroke.points)) && !isHl;

  switch (target) {
    case 'highlighter_only':
      return isHl;
    case 'pen_only':
      return isFreehandPen;
    case 'pen_and_highlighter':
      return isHl || isFreehandPen;
    case 'all':
    default:
      return true;
  }
}

export function filterStrokesByClearAction<T extends ErasableStroke>(
  strokes: T[],
  kind: ClearStrokesKind
): T[] {
  if (!Array.isArray(strokes)) return [];
  switch (kind) {
    case 'highlighters':
      return strokes.filter((s) => !(s.type === 'highlighter' || s.isHighlighter));
    case 'student_strokes':
      return strokes.filter((s) => s.authorRole !== 'student');
    case 'teacher_strokes':
      return strokes.filter((s) => s.authorRole === 'student');
    case 'all_strokes':
      return [];
    default:
      return strokes.slice();
  }
}

export interface ManagedPeer {
  id: string;
  name: string;
  role?: 'teacher' | 'student';
  blocked?: boolean;
}

export function togglePeerBlockState(peers: Record<string, ManagedPeer>, peerId: string): {
  blocked: boolean;
  statusLabel: string;
} {
  const peer = peers[peerId];
  if (!peer) {
    return { blocked: false, statusLabel: 'Ученик(активен)' };
  }
  peer.blocked = !peer.blocked;
  return {
    blocked: peer.blocked,
    statusLabel: peer.blocked ? 'Ученик(заблокирован)' : 'Ученик(активен)',
  };
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Rotates a 3D point around the Y axis (yaw) and X axis (pitch).
 */
export function rotate3DPoint(pt: Point3D, yaw: number, pitch: number): Point3D {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  const x1 = pt.x * cy + pt.z * sy;
  const y1 = pt.y;
  const z1 = -pt.x * sy + pt.z * cy;

  const x2 = x1;
  const y2 = y1 * cp - z1 * sp;
  const z2 = y1 * sp + z1 * cp;

  return { x: x2, y: y2, z: z2 };
}

/**
 * Generates the next LearnBoard stereometry construction point label (P, Q, R, T, M, N, K...)
 */
export function getNextConstructionPointLabel(existingLabels: string[]): string {
  const used = new Set((existingLabels || []).map((s) => String(s).trim().toUpperCase()));
  const pool = ['P', 'Q', 'R', 'T', 'M', 'N', 'K', 'E', 'F', 'L', 'H', 'G'];
  for (const ch of pool) {
    if (!used.has(ch)) return ch;
  }
  let idx = 1;
  while (used.has(`P${idx}`)) idx++;
  return `P${idx}`;
}

export function canChange3DBodyType(customPointsCount: number): boolean {
  return (Number(customPointsCount) || 0) === 0;
}

export function unrotate3DPoint(pt: Point3D, yaw: number, pitch: number): Point3D {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  // Inverse of Rx(pitch)
  const x1 = pt.x;
  const y1 = pt.y * cp + pt.z * sp;
  const z1 = -pt.y * sp + pt.z * cp;

  // Inverse of Ry(yaw)
  return {
    x: x1 * cy - z1 * sy,
    y: y1,
    z: x1 * sy + z1 * cy,
  };
}

export function snap3DEdgeRatio(rawT: number, snapEnabled: boolean): { t: number; snapLabel: string | null } {
  const t = Math.max(0.03, Math.min(0.97, rawT));
  if (!snapEnabled) {
    return { t: Number(t.toFixed(3)), snapLabel: null };
  }
  const landmarks: Array<{ val: number; label: string; tol: number }> = [
    { val: 0.5, label: '1/2', tol: 0.085 },
    { val: 1 / 3, label: '1/3', tol: 0.045 },
    { val: 2 / 3, label: '2/3', tol: 0.045 },
    { val: 0.25, label: '1/4', tol: 0.035 },
    { val: 0.75, label: '3/4', tol: 0.035 },
  ];
  for (const lm of landmarks) {
    if (Math.abs(t - lm.val) <= lm.tol) {
      return { t: Number(lm.val.toFixed(4)), snapLabel: lm.label };
    }
  }
  return { t: Number(t.toFixed(3)), snapLabel: null };
}

export interface Body3DSubtypeOption {
  value: string;
  label: string;
}

export interface Body3DDimensionMeta {
  title: string;
  radiusLabel: string;
  showDepth: boolean;
  depthLabel: string;
  showHeight: boolean;
  heightLabel: string;
  showBaseSides: boolean;
  baseSidesLabel: string;
  showBaseAngle: boolean;
  showTiltXY: boolean;
  showTopShift: boolean;
  showTopRatio: boolean;
  showTopRadius: boolean;
  showDiagonals: boolean;
  showFaces: boolean;
  subtypePlacement: 'none' | 'top' | 'cone';
  subtypeLabel: string;
  subtypeKey: '' | 'boxKind' | 'pyramidKind' | 'coneKind';
  subtypeValue: string;
  subtypeOptions: Body3DSubtypeOption[];
}

export interface Body3DMetaConfig {
  boxKind?: string;
  pyramidKind?: string;
  coneKind?: string;
}

export function get3DBodyDimensionMeta(
  bodyType: string,
  cfg: Body3DMetaConfig = {}
): Body3DDimensionMeta {
  const base: Body3DDimensionMeta = {
    title: 'Фигура 3D',
    radiusLabel: 'Радиус основания',
    showDepth: false,
    depthLabel: 'Ширина b',
    showHeight: true,
    heightLabel: 'Высота h',
    showBaseSides: false,
    baseSidesLabel: 'Число сторон основания',
    showBaseAngle: false,
    showTiltXY: false,
    showTopShift: false,
    showTopRatio: false,
    showTopRadius: false,
    showDiagonals: false,
    showFaces: true,
    subtypePlacement: 'none',
    subtypeLabel: '',
    subtypeKey: '',
    subtypeValue: '',
    subtypeOptions: [],
  };

  switch (bodyType) {
    case 'cube':
      return {
        ...base,
        title: 'Куб',
        radiusLabel: 'Длина ребра',
        showHeight: false,
        showDiagonals: true,
      };
    case 'parallelepiped': {
      const boxKind =
        cfg.boxKind === 'right' || cfg.boxKind === 'oblique'
          ? cfg.boxKind
          : 'rectangular';
      const titleMap: Record<string, string> = {
        rectangular: 'Прямоугольный параллелепипед',
        right: 'Прямой параллелепипед',
        oblique: 'Наклонный параллелепипед',
      };
      return {
        ...base,
        title: titleMap[boxKind],
        radiusLabel: 'Длина a',
        showDepth: true,
        depthLabel: 'Ширина b',
        showHeight: true,
        showBaseAngle: boxKind === 'right' || boxKind === 'oblique',
        showTiltXY: boxKind === 'oblique',
        showDiagonals: true,
        subtypePlacement: 'top',
        subtypeLabel: 'Вид',
        subtypeKey: 'boxKind',
        subtypeValue: boxKind,
        subtypeOptions: [
          { value: 'rectangular', label: 'Прямоугольный' },
          { value: 'right', label: 'Прямой' },
          { value: 'oblique', label: 'Наклонный' },
        ],
      };
    }
    case 'prism':
      return {
        ...base,
        title: 'Призма',
        radiusLabel: 'Радиус правильного основания',
        showBaseSides: true,
        showTopShift: true,
        showHeight: true,
      };
    case 'pyramid':
    case 'tetrahedron': {
      const fallbackKind = bodyType === 'tetrahedron' ? 'tetrahedron' : 'regular';
      const pKind =
        cfg.pyramidKind === 'regular' ||
        cfg.pyramidKind === 'truncated' ||
        cfg.pyramidKind === 'tetrahedron'
          ? cfg.pyramidKind
          : fallbackKind;
      const titleMap: Record<string, string> = {
        regular: 'Пирамида',
        truncated: 'Усечённая пирамида',
        tetrahedron: 'Тетраэдр',
      };
      return {
        ...base,
        title: titleMap[pKind],
        radiusLabel: 'Радиус правильного основания',
        showBaseSides: pKind !== 'tetrahedron',
        showTopShift: pKind !== 'tetrahedron',
        showHeight: pKind !== 'tetrahedron',
        showTopRatio: pKind === 'truncated',
        subtypePlacement: 'top',
        subtypeLabel: 'Пирамида',
        subtypeKey: 'pyramidKind',
        subtypeValue: pKind,
        subtypeOptions: [
          { value: 'regular', label: 'Пирамида' },
          { value: 'truncated', label: 'Усечённая пирамида' },
          { value: 'tetrahedron', label: 'Правильный тетраэдр' },
        ],
      };
    }
    case 'cylinder':
      return {
        ...base,
        title: 'Цилиндр',
        radiusLabel: 'Радиус основания',
        showHeight: true,
      };
    case 'cone': {
      const cKind = cfg.coneKind === 'frustum' ? 'frustum' : 'cone';
      return {
        ...base,
        title: cKind === 'frustum' ? 'Усечённый конус' : 'Конус',
        radiusLabel: 'Радиус основания',
        showHeight: true,
        showTopRadius: cKind === 'frustum',
        subtypePlacement: 'cone',
        subtypeLabel: 'Тело',
        subtypeKey: 'coneKind',
        subtypeValue: cKind,
        subtypeOptions: [
          { value: 'cone', label: 'Конус' },
          { value: 'frustum', label: 'Усечённый конус' },
        ],
      };
    }
    case 'sphere':
      return {
        ...base,
        title: 'Сфера',
        radiusLabel: 'Радиус',
        showHeight: false,
        showFaces: false,
      };
    default:
      return base;
  }
}

export function resolve3DFloatingPosition(
  baseAnchor: { left: number; top: number; panelW: number },
  state: {
    settingsOpen: boolean;
    lockedPos: { left: number; top: number } | null;
    customOffset: { dx: number; dy: number } | null;
  },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const maxW = baseAnchor.panelW || 348;
  const maxLeft = Math.max(12, viewport.width - maxW - 12);
  const maxTop = Math.max(58, viewport.height - 120);
  if (state.settingsOpen && state.lockedPos) {
    return {
      left: Math.round(Math.max(12, Math.min(maxLeft, state.lockedPos.left))),
      top: Math.round(Math.max(58, Math.min(maxTop, state.lockedPos.top))),
    };
  }
  const dx = state.customOffset ? state.customOffset.dx : 0;
  const dy = state.customOffset ? state.customOffset.dy : 0;
  return {
    left: Math.round(Math.max(12, Math.min(maxLeft, baseAnchor.left + dx))),
    top: Math.round(Math.max(58, Math.min(maxTop, baseAnchor.top + dy))),
  };
}

export function isContentEditableWidgetTarget(info: {
  isContentEditable: boolean;
  insideWidget: boolean;
  isTableWidget: boolean;
  hasEditingClass: boolean;
}): boolean {
  if (!info.isContentEditable) return false;
  if (!info.insideWidget) return true;
  if (info.isTableWidget) return true;
  return info.hasEditingClass;
}

const SHAPE_2D_TYPES_SET = new Set([
  'line',
  'arrow',
  'axes',
  'rect',
  'square',
  'ellipse',
  'circle',
  'unit_circle',
  'triangle',
  'rhombus',
  'parallelogram',
  'trapezoid',
  'pentagon',
  'hexagon',
  'polygon',
]);

export function is2DShapeStrokeType(type: string): boolean {
  return SHAPE_2D_TYPES_SET.has(String(type || ''));
}

export type LayerReorderAction = 'front' | 'forward' | 'backward' | 'back';

export function reorderStrokesLayer<T extends { id: number | string }>(
  strokes: T[],
  selectedIds: Array<number | string>,
  action: LayerReorderAction
): T[] {
  if (!Array.isArray(strokes) || strokes.length <= 1) return Array.isArray(strokes) ? strokes.slice() : [];
  const sel = new Set(selectedIds);
  if (sel.size === 0) return strokes.slice();

  const arr = strokes.slice();
  if (action === 'front') {
    const rest = arr.filter((item) => !sel.has(item.id));
    const picked = arr.filter((item) => sel.has(item.id));
    return [...rest, ...picked];
  }
  if (action === 'back') {
    const picked = arr.filter((item) => sel.has(item.id));
    const rest = arr.filter((item) => !sel.has(item.id));
    return [...picked, ...rest];
  }
  if (action === 'forward') {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) {
        const tmp = arr[i];
        arr[i] = arr[i + 1];
        arr[i + 1] = tmp;
      }
    }
    return arr;
  }
  if (action === 'backward') {
    for (let i = 1; i < arr.length; i++) {
      if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) {
        const tmp = arr[i];
        arr[i] = arr[i - 1];
        arr[i - 1] = tmp;
      }
    }
    return arr;
  }
  return arr;
}

export function computeFloatingBarPosition(
  shapeScreenBox: { left: number; top: number; width: number; height: number },
  panelSize: { width: number; height: number },
  viewport: { width: number; height: number; topSafe?: number }
): { left: number; top: number } {
  const topSafe = viewport.topSafe ?? 58;
  const cx = shapeScreenBox.left + shapeScreenBox.width / 2;
  const halfW = panelSize.width / 2;
  const minLeft = halfW + 12;
  const maxLeft = Math.max(minLeft, viewport.width - halfW - 12);
  const clampedCenterX = Math.max(minLeft, Math.min(maxLeft, cx));

  let top = shapeScreenBox.top - panelSize.height - 14;
  if (top < topSafe) {
    const below = shapeScreenBox.top + shapeScreenBox.height + 14;
    if (below + panelSize.height <= viewport.height - 86) {
      top = below;
    } else {
      top = topSafe;
    }
  }
  const maxTop = Math.max(topSafe, viewport.height - panelSize.height - 86);
  return {
    left: Math.round(clampedCenterX - halfW),
    top: Math.round(Math.max(topSafe, Math.min(maxTop, top))),
  };
}

export interface PdfStrokePoint {
  x: number;
  y: number;
}

export interface PdfMarkerStroke {
  color: string;
  size: number;
  points: PdfStrokePoint[];
}

export function erasePdfStrokeSegments(
  strokes: PdfMarkerStroke[],
  pt: PdfStrokePoint,
  radius = 14
): { strokes: PdfMarkerStroke[]; changed: boolean } {
  if (!Array.isArray(strokes) || strokes.length === 0) {
    return { strokes: [], changed: false };
  }
  const r = Math.max(2, Number(radius) || 14);
  const next: PdfMarkerStroke[] = [];
  let changed = false;

  for (const s of strokes) {
    const pts = Array.isArray(s?.points) ? s.points : [];
    if (pts.length < 2) {
      changed = true;
      continue;
    }

    let currentChunk: PdfStrokePoint[] = [];
    let strokeTouched = false;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const hit = Math.hypot(p.x - pt.x, p.y - pt.y) <= r;
      if (hit) {
        strokeTouched = true;
        if (currentChunk.length >= 2) {
          next.push({ color: s.color, size: s.size, points: currentChunk });
        }
        currentChunk = [];
      } else {
        currentChunk.push({ x: p.x, y: p.y });
      }
    }

    if (currentChunk.length >= 2) {
      next.push({ color: s.color, size: s.size, points: currentChunk });
    } else if (currentChunk.length === 1) {
      strokeTouched = true;
    }

    if (strokeTouched) changed = true;
  }

  return { strokes: next, changed };
}

export function shouldHideBoardChromeInPdf(isPdfOpen: boolean): boolean {
  return Boolean(isPdfOpen);
}

export interface LinearPoint2D {
  x: number;
  y: number;
}

export interface LinearPointModeState {
  enabled: boolean;
  anchor: LinearPoint2D | null;
  chainStart: LinearPoint2D | null;
  segmentCount: number;
}

export interface LinearPointSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function createLinearPointModeState(enabled = false): LinearPointModeState {
  return {
    enabled: Boolean(enabled),
    anchor: null,
    chainStart: null,
    segmentCount: 0,
  };
}

export function stepLinearPointClick(
  state: LinearPointModeState,
  pt: LinearPoint2D,
  minSegmentDist = 4
): { state: LinearPointModeState; segment: LinearPointSegment | null; closedLoop: boolean } {
  if (!state.enabled) {
    return { state, segment: null, closedLoop: false };
  }

  const nextPt = { x: pt.x, y: pt.y };
  if (!state.anchor) {
    return {
      state: {
        enabled: true,
        anchor: nextPt,
        chainStart: nextPt,
        segmentCount: 0,
      },
      segment: null,
      closedLoop: false,
    };
  }

  const distFromAnchor = Math.hypot(nextPt.x - state.anchor.x, nextPt.y - state.anchor.y);
  if (distFromAnchor < minSegmentDist) {
    return {
      state: {
        enabled: true,
        anchor: null,
        chainStart: null,
        segmentCount: 0,
      },
      segment: null,
      closedLoop: false,
    };
  }

  const segment: LinearPointSegment = {
    x1: state.anchor.x,
    y1: state.anchor.y,
    x2: nextPt.x,
    y2: nextPt.y,
  };

  const closesLoop =
    Boolean(state.chainStart) &&
    state.segmentCount >= 2 &&
    Math.hypot(nextPt.x - state.chainStart!.x, nextPt.y - state.chainStart!.y) < Math.max(minSegmentDist, 6);

  if (closesLoop) {
    return {
      state: {
        enabled: true,
        anchor: null,
        chainStart: null,
        segmentCount: 0,
      },
      segment,
      closedLoop: true,
    };
  }

  return {
    state: {
      enabled: true,
      anchor: nextPt,
      chainStart: state.chainStart || state.anchor,
      segmentCount: state.segmentCount + 1,
    },
    segment,
    closedLoop: false,
  };
}

export function handleLinearPointKey(
  state: LinearPointModeState,
  key: string,
  isEditable = false
): { state: LinearPointModeState; handled: boolean } {
  if (!state.enabled || isEditable) {
    return { state, handled: false };
  }
  if (key === 'Enter') {
    return {
      state: createLinearPointModeState(false),
      handled: true,
    };
  }
  if (key === 'Escape' && state.anchor) {
    return {
      state: createLinearPointModeState(true),
      handled: true,
    };
  }
  return { state, handled: false };
}

export interface PopoverTriggerRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function computeHeaderPopoverPosition(
  trigger: PopoverTriggerRect,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'left' | 'right' = 'right',
  margin = 10,
  gap = 8
): { left: number; top: number } {
  const vw = Math.max(320, viewport.width);
  const vh = Math.max(320, viewport.height);
  const pw = Math.max(120, popover.width);
  const ph = Math.max(80, popover.height);

  let left = align === 'right' ? trigger.right - pw : trigger.left;
  if (left + pw > vw - margin) left = vw - pw - margin;
  if (left < margin) left = margin;

  let top = trigger.bottom + gap;
  if (top + ph > vh - margin) {
    top = Math.max(margin, vh - ph - margin);
  }
  if (top < margin) top = margin;

  return {
    left: Math.round(left),
    top: Math.round(top),
  };
}

export function resolvePageIndexAfterDelete(
  totalPagesBefore: number,
  currentIndex: number,
  deleteIndex: number
): { allowed: boolean; nextIndex: number } {
  if (totalPagesBefore <= 1 || deleteIndex < 0 || deleteIndex >= totalPagesBefore) {
    return { allowed: false, nextIndex: Math.max(0, Math.min(currentIndex, totalPagesBefore - 1)) };
  }
  const remaining = totalPagesBefore - 1;
  if (deleteIndex < currentIndex) {
    return { allowed: true, nextIndex: Math.max(0, currentIndex - 1) };
  }
  if (deleteIndex === currentIndex) {
    return { allowed: true, nextIndex: Math.max(0, Math.min(deleteIndex, remaining - 1)) };
  }
  return { allowed: true, nextIndex: Math.max(0, Math.min(currentIndex, remaining - 1)) };
}

export function getBoardLayerZOrder(isSelectMode: boolean): {
  grid: number;
  widgets: number;
  foreground: number;
} {
  return {
    grid: 1,
    widgets: isSelectMode ? 4 : 2,
    foreground: 3,
  };
}

export function getThemeMetaConfig(isDark: boolean): {
  colorScheme: 'light' | 'dark';
  themeColor: string;
  toggleLabel: string;
} {
  return isDark
    ? {
        colorScheme: 'dark',
        themeColor: '#0f172a',
        toggleLabel: 'Дневная тема',
      }
    : {
        colorScheme: 'light',
        themeColor: '#ffffff',
        toggleLabel: 'Ночная тема',
      };
}
