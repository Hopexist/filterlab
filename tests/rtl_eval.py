"""Independent reference for the generated SystemVerilog (no HDL simulator on the dev machine).

Parses the small SV subset that dsp/rtl.py emits and executes it cycle by cycle with SystemVerilog's
two's-complement width rules. It deliberately does not import dsp.quant: its results are compared with
simulate_*_fixed in tests/test_rtl.py, so agreement means the *text* computes what the simulator computes.

Subset understood: `logic signed [W-1:0] a, b;` (also as ports), `assign x = expr;` with + - * >>> <<<,
parentheses, signed sized literals N'sdV, and the saturating ternary `(c) ? A : ((d) ? B : C)`; one
always_ff block whose `if (in_valid) begin ... end` contains only `reg <= name;`. All operands are signed, so
evaluating with unbounded integers and truncating to the left-hand width is exact for + - * and <<<; >>> is
only ever applied to a declared wire, whose value is already width-correct.
"""
import re

def _wrap(v, w):
    v &= (1 << w) - 1
    return v - (1 << w) if v >> (w - 1) else v

def _lit(m):
    n, v = int(m.group(1)), int(m.group(2))
    assert v < 1 << (n - 1), f"literal {m.group(0)} does not fit as a positive signed value"
    return str(v)

_TERN = re.compile(r"^\((.+?)\) \? (\S+) : \(\((.+?)\) \? (\S+) : (\S+)\)$")

def _py(expr):
    e = " ".join(expr.split())
    e = re.sub(r"(\d+)'sd(\d+)", _lit, e)
    e = e.replace(">>>", ">>").replace("<<<", "<<")
    m = _TERN.match(e)
    if m:
        c, a, d, b, f = m.groups()
        e = f"(({a}) if ({c}) else (({b}) if ({d}) else ({f})))"
    if re.search(r"[?:'$\[\]{}]", e):
        raise ValueError(f"expression outside the supported subset: {expr!r}")
    return compile(e, "<rtl>", "eval")

class Module:
    def __init__(self, text):
        self.width = {}
        for w, names in re.findall(r"logic\s+signed\s+\[(\d+):0\]\s+([\w\s,]+?);", text):   # declarations
            for n in names.replace(",", " ").split():
                self.width[n] = int(w) + 1
        for w, n in re.findall(r"(?:input|output)\s+logic\s+signed\s+\[(\d+):0\]\s+(\w+)", text):   # ports
            self.width[n] = int(w) + 1
        self.assigns = [(lhs, _py(rhs)) for lhs, rhs in re.findall(r"assign\s+(\w+)\s*=\s*(.*?);", text, re.S)]
        blk = re.search(r"if \(in_valid\) begin(.*?)\n\s*end", text, re.S)
        self.updates = re.findall(r"(\w+)\s*<=\s*(\w+);", blk.group(1))
        self.state = {r: 0 for r, _ in self.updates}
        for n in self.width: self.state.setdefault(n, 0)

    def step(self, x):
        env = dict(self.state); env["in_data"] = _wrap(int(x), self.width["in_data"])
        for lhs, code in self.assigns:
            env[lhs] = _wrap(eval(code, {"__builtins__": {}}, env), self.width[lhs])
        new = {r: env[src] for r, src in self.updates}       # non-blocking: all right-hand sides first
        self.state.update(new)
        return self.state["out_data"]

def run(text, xs):
    """Feed one sample per clock (in_valid = 1 throughout, after reset); return out_data after each edge."""
    m = Module(text)
    return [m.step(x) for x in xs]
