//! ety (`// T:`) annotation extractor — spec Phase 1.
//!
//! Parses JS with Oxc, scans `program.comments` for `// T:` line comments,
//! matches each to its AST node via the two strict placement checks, dedupes,
//! and returns a flat `Vec<EtyAnnotation>` of byte offsets + raw strings.
//! The AST and arena memory never cross the napi boundary.

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ArrowFunctionExpression, Class, ClassBody, Comment, FormalParameter, Function, FunctionBody,
    MethodDefinition, PropertyDefinition, VariableDeclaration,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use oxc_syntax::scope::ScopeFlags;

/// The one struct that crosses the napi boundary. napi-rs camelCases the
/// fields on the JS side (node_start_offset -> nodeStartOffset).
#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Debug, Clone, PartialEq)]
pub struct EtyAnnotation {
    /// Start of the annotated declaration (where the JSDoc gets injected).
    pub node_start_offset: u32,
    /// Start of the `// T:` comment, delimiters included.
    pub ety_start_offset: u32,
    /// End (exclusive) of the `// T:` comment.
    pub ety_end_offset: u32,
    /// "function" | "variable" | "property" | "class" | "import" | "param" | "return"
    pub kind: String,
    /// Declaration name; empty for anonymous functions/classes and imports.
    /// For "param" it is the parameter name.
    pub name: String,
    /// Normalized payload: text after the first `T:`, whitespace-trimmed.
    /// For "param" it is the type only (the `- description` tail is stripped
    /// into `doc`); for "return" it is the text after the leading `=>`.
    pub ety: String,
    /// Per-parameter description: the text after the first top-level ` - ` in a
    /// "param" payload (e.g. "First operand"). Empty for every other kind.
    pub doc: String,
}

#[cfg(feature = "node-api")]
#[napi_derive::napi(js_name = "parse_ety")]
pub fn parse_ety(source: String) -> Vec<EtyAnnotation> {
    parse_source(&source)
}

/// (comment span start, comment span end, normalized payload)
type TComment<'a> = (u32, u32, &'a str);

/// Filter `program.comments` down to `// T:` line comments with normalized
/// payloads. Block comments and non-T comments are ignored. This is a linear
/// scan over structured span data — no regex over source bytes.
fn extract_t_comments<'a>(source: &'a str, comments: &[Comment]) -> Vec<TComment<'a>> {
    comments
        .iter()
        .filter(|c| c.is_line())
        .filter_map(|c| {
            let content = c.content_span();
            let text = &source[content.start as usize..content.end as usize];
            let payload = text.trim().strip_prefix("T:")?.trim();
            Some((c.span.start, c.span.end, payload))
        })
        .collect()
}

/// Inside-Block Check (functions, methods, classes): the comment must sit
/// strictly between the body's opening brace and its first element. Also
/// serves as the spec's check_class_body — both reduce to the same offsets
/// once the AST types are erased. `first_element_start` must be the body's
/// span end for an empty body (the inverted-range guard).
fn check_block<'a, 'b>(
    open_brace: u32,
    first_element_start: u32,
    annotations: &'b [TComment<'a>],
) -> Option<&'b TComment<'a>> {
    annotations.iter().find(|(s, e, _)| *s > open_brace && *e < first_element_start)
}

/// Inline/Trailing Check (variables, properties): the comment must start at
/// or after the node's end, before the next newline. Byte range, not line
/// number, decides.
fn check_inline<'a, 'b>(
    node_end: u32,
    source: &str,
    annotations: &'b [TComment<'a>],
) -> Option<&'b TComment<'a>> {
    let next_newline = source[node_end as usize..]
        .find('\n')
        .map_or(source.len() as u32, |i| node_end + i as u32);

    annotations.iter().find(|(s, _, _)| *s >= node_end && *s < next_newline)
}

/// Per-parameter Check: the comment must start at or after the parameter's end
/// and before `upper` (the next parameter's start, or the function body's open
/// brace for the last parameter). A byte range — not a line — so params sharing
/// a line don't cross-claim each other's trailing comment.
fn check_param<'a, 'b>(
    param_end: u32,
    upper: u32,
    annotations: &'b [TComment<'a>],
) -> Option<&'b TComment<'a>> {
    annotations.iter().find(|(s, _, _)| *s >= param_end && *s < upper)
}

/// First element of a function body: a directive ('use strict') can precede
/// the first statement. Empty body -> span end (guard).
fn function_body_first_element(body: &FunctionBody) -> u32 {
    body.directives
        .first()
        .map(|d| d.span.start)
        .or_else(|| body.statements.first().map(|s| s.span().start))
        .unwrap_or(body.span.end)
}

fn class_body_first_element(body: &ClassBody) -> u32 {
    body.body.first().map(|e| e.span().start).unwrap_or(body.span.end)
}

struct EtyVisitor<'a> {
    source: &'a str,
    annotations: Vec<TComment<'a>>,
    results: Vec<EtyAnnotation>,
    /// (function start, body start, body end) for every function with a body —
    /// used to bind a `// T: => R` return comment to the innermost enclosing
    /// function (smallest containing body span) in a post-pass.
    fn_bodies: Vec<(u32, u32, u32)>,
}

impl<'a> EtyVisitor<'a> {
    fn push(&mut self, node_start: u32, c: TComment<'a>, kind: &str, name: &str) {
        self.results.push(EtyAnnotation {
            node_start_offset: node_start,
            ety_start_offset: c.0,
            ety_end_offset: c.1,
            kind: kind.to_string(),
            name: name.to_string(),
            ety: c.2.to_string(),
            doc: String::new(),
        });
    }

    /// A per-parameter annotation: `node_start` is the ENCLOSING function's
    /// start (the grouping key + injection point), `name` is the parameter
    /// name, and the payload is split at the first top-level ` - ` into the
    /// type (`ety`) and an optional description (`doc`).
    fn push_param(&mut self, fn_start: u32, c: TComment<'a>, name: &str) {
        let (ty, doc) = c.2.split_once(" - ").map_or((c.2, ""), |(t, d)| (t.trim(), d.trim()));
        self.results.push(EtyAnnotation {
            node_start_offset: fn_start,
            ety_start_offset: c.0,
            ety_end_offset: c.1,
            kind: "param".to_string(),
            name: name.to_string(),
            ety: ty.to_string(),
            doc: doc.to_string(),
        });
    }

    /// Match a trailing `// T:` to each formal parameter. The match window for
    /// parameter `i` is [param.end, next_param.start) — or, for the last
    /// parameter, [param.end, `upper_fallback`) (the body's open brace, or the
    /// parameter list's end for a bodyless function).
    fn collect_params(&mut self, fn_start: u32, params: &[FormalParameter<'a>], upper_fallback: u32) {
        for (i, p) in params.iter().enumerate() {
            let upper = params.get(i + 1).map_or(upper_fallback, |next| next.span.start);
            if let Some(&c) = check_param(p.span.end, upper, &self.annotations) {
                let name = p.pattern.get_identifier_name();
                self.push_param(fn_start, c, name.map_or("", |n| n.as_str()));
            }
        }
    }
}

impl<'a> Visit<'a> for EtyVisitor<'a> {
    // Inside-Block Check only.
    fn visit_function(&mut self, func: &Function<'a>, flags: ScopeFlags) {
        if let Some(body) = &func.body {
            if let Some(&c) =
                check_block(body.span.start, function_body_first_element(body), &self.annotations)
            {
                let name = func.id.as_ref().map_or("", |id| id.name.as_str());
                self.push(func.span.start, c, "function", name);
            }
            self.fn_bodies.push((func.span.start, body.span.start, body.span.end));
        }
        // Per-parameter annotations: the upper bound for the LAST param is the
        // body's open brace (or the param list's end if there is no body).
        let upper_fallback = func.body.as_ref().map_or(func.params.span.end, |b| b.span.start);
        self.collect_params(func.span.start, &func.params.items, upper_fallback);
        walk::walk_function(self, func, flags);
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        // Concise body (x => expr): no valid inside-block position; the
        // trailing Rule-1 check on the enclosing VariableDeclaration applies.
        if !arrow.expression {
            if let Some(&c) = check_block(
                arrow.body.span.start,
                function_body_first_element(&arrow.body),
                &self.annotations,
            ) {
                self.push(arrow.span.start, c, "function", "");
            }
        }
        walk::walk_arrow_function_expression(self, arrow);
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        if let Some(body) = &method.value.body {
            if let Some(&c) =
                check_block(body.span.start, function_body_first_element(body), &self.annotations)
            {
                let name = method.key.static_name();
                self.push(method.span.start, c, "function", name.as_deref().unwrap_or(""));
            }
        }
        // The walk now descends into method.value, where visit_function runs
        // check_block on the SAME body — the dedupe pass keeps this (first) one.
        walk::walk_method_definition(self, method);
    }

    // Fires for both `class Box {}` and `const Box = class {}` — Oxc uses one
    // Class node for declarations and expressions.
    fn visit_class(&mut self, class: &Class<'a>) {
        if let Some(&c) = check_block(
            class.body.span.start,
            class_body_first_element(&class.body),
            &self.annotations,
        ) {
            let name = class.id.as_ref().map_or("", |id| id.name.as_str());
            self.push(class.span.start, c, "class", name);
        }
        walk::walk_class(self, class);
    }

    // Inline/Trailing Check only. Statement-level (NOT per-declarator), so a
    // multi-declarator statement fires once with node_start_offset pinned to
    // the let/const keyword, and a comment trailing a non-final line of a
    // multi-line declaration falls inside the span and is silently inert.
    fn visit_variable_declaration(&mut self, decl: &VariableDeclaration<'a>) {
        if let Some(&c) = check_inline(decl.span.end, self.source, &self.annotations) {
            let name = decl.declarations.first().and_then(|d| d.id.get_identifier_name());
            self.push(decl.span.start, c, "variable", name.map_or("", |n| n.as_str()));
        }
        walk::walk_variable_declaration(self, decl);
    }

    fn visit_property_definition(&mut self, prop: &PropertyDefinition<'a>) {
        if let Some(&c) = check_inline(prop.span.end, self.source, &self.annotations) {
            let name = prop.key.static_name();
            self.push(prop.span.start, c, "property", name.as_deref().unwrap_or(""));
        }
        walk::walk_property_definition(self, prop);
    }
}

/// Full Phase-1 pipeline: parse, extract `// T:` comments, partition off
/// `import` payloads (standalone comments attached to no AST node), run the
/// visitor, dedupe by comment offset keeping the first match, and return in
/// document order. Oxc is fault-tolerant: a syntax error mid-file still
/// yields annotations for the recoverable prefix.
pub fn parse_source(source: &str) -> Vec<EtyAnnotation> {
    let allocator = Allocator::default();
    // jsx(): ESM + JSX. The LSP serves .js and .jsx with one parser config;
    // {} generics exist precisely so JSX syntax never conflicts.
    let ret = Parser::new(&allocator, source, SourceType::jsx()).parse();

    let t_comments = extract_t_comments(source, &ret.program.comments);

    // `// T: import ...` is hoisted by the transformer and belongs to no node:
    // it becomes its own annotation, node_start_offset = its own comment start
    // (the hoisted virtual line maps back to this line). Imports are excluded
    // from node matching so a trailing import can't bind to a declaration.
    let (imports, rest): (Vec<_>, Vec<_>) =
        t_comments.into_iter().partition(|(_, _, p)| p.starts_with("import "));

    // `// T: => R` is a per-parameter-style RETURN annotation: it starts with
    // `=>` and binds to the enclosing function (not a node the visitor matches),
    // so it is pulled out before node matching, like imports.
    let (returns, candidates): (Vec<_>, Vec<_>) =
        rest.into_iter().partition(|(_, _, p)| p.starts_with("=>"));

    let mut visitor =
        EtyVisitor { source, annotations: candidates, results: Vec::new(), fn_bodies: Vec::new() };
    visitor.visit_program(&ret.program);

    // Bind each return comment to the innermost enclosing function — the
    // function whose body span is smallest among those containing the comment.
    for (s, e, p) in returns {
        if let Some(&(fn_start, _, _)) = visitor
            .fn_bodies
            .iter()
            .filter(|(_, bs, be)| *bs < s && s < *be)
            .min_by_key(|(_, bs, be)| be - bs)
        {
            visitor.results.push(EtyAnnotation {
                node_start_offset: fn_start,
                ety_start_offset: s,
                ety_end_offset: e,
                kind: "return".to_string(),
                name: String::new(),
                ety: p[2..].trim().to_string(), // text after the leading `=>`
                doc: String::new(),
            });
        }
    }

    let mut results: Vec<EtyAnnotation> = imports
        .into_iter()
        .map(|(s, e, p)| EtyAnnotation {
            node_start_offset: s,
            ety_start_offset: s,
            ety_end_offset: e,
            kind: "import".to_string(),
            name: String::new(),
            ety: p.to_string(),
            doc: String::new(),
        })
        .collect();
    results.extend(visitor.results);

    // Dedupe by ety_start_offset, keeping the first match (Gate 1 mandate).
    // The visitor double-fires on class methods: visit_method_definition and
    // then visit_function check the same body; traversal order guarantees the
    // method entry comes first.
    let mut seen = std::collections::HashSet::new();
    results.retain(|a| seen.insert(a.ety_start_offset));

    results.sort_by_key(|a| a.ety_start_offset);
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Comment span helper: start of `//` and end of the comment's last char
    /// (exclusive), computed independently of the implementation.
    fn comment_span(source: &str) -> (u32, u32) {
        let start = source.find("//").unwrap();
        let end = source[start..].find('\n').map_or(source.len(), |i| start + i);
        (start as u32, end as u32)
    }

    // --- check_block (plan: Milestone 1 cargo tests) ---

    #[test]
    fn check_block_matches_between_brace_and_first_statement() {
        let source = "function f() {\n// T: number\n    return 1;\n}\n";
        let open = source.find('{').unwrap() as u32;
        let (cs, ce) = comment_span(source);
        let first_stmt = source.find("return").unwrap() as u32;
        let anns = vec![(cs, ce, "number")];
        assert_eq!(check_block(open, first_stmt, &anns), Some(&(cs, ce, "number")));
    }

    #[test]
    fn check_block_ignores_comment_after_first_statement() {
        let source = "function f() {\n    return 1;\n    // T: number\n}\n";
        let open = source.find('{').unwrap() as u32;
        let (cs, ce) = comment_span(source);
        let first_stmt = source.find("return").unwrap() as u32;
        let anns = vec![(cs, ce, "number")];
        assert_eq!(check_block(open, first_stmt, &anns), None);
    }

    #[test]
    fn check_block_empty_body_guard_returns_none() {
        // Trailing comment on an empty body: first_element_start is the body's
        // span END, so without the guard semantics the range would invert.
        let source = "function f() {} // T: number\n";
        let open = source.find('{').unwrap() as u32;
        let body_end = source.find('}').unwrap() as u32 + 1; // span.end of {}
        let (cs, ce) = comment_span(source);
        let anns = vec![(cs, ce, "number")];
        assert_eq!(check_block(open, body_end, &anns), None);
    }

    // --- check_inline ---

    #[test]
    fn check_inline_matches_trailing_same_line() {
        let source = "let count = 0; // T: number\n";
        let node_end = source.find(';').unwrap() as u32 + 1;
        let (cs, ce) = comment_span(source);
        let anns = vec![(cs, ce, "number")];
        assert_eq!(check_inline(node_end, source, &anns), Some(&(cs, ce, "number")));
    }

    #[test]
    fn check_inline_ignores_next_line_comment() {
        let source = "let count = 0;\n// T: number\n";
        let node_end = source.find(';').unwrap() as u32 + 1;
        let (cs, ce) = comment_span(source);
        let anns = vec![(cs, ce, "number")];
        assert_eq!(check_inline(node_end, source, &anns), None);
    }

    #[test]
    fn check_inline_two_statements_one_line_both_match_dedupe_keeps_first() {
        // Byte-range matching: the comment sits in [node_end, newline) for
        // BOTH statements. Document the consequence: after the program-level
        // dedupe (first match wins), the annotation attaches to `a`. Users
        // should put each annotated declaration on its own line.
        let source = "let a = 1; let b = 2; // T: number\n";
        let a_end = source.find(';').unwrap() as u32 + 1;
        let b_end = source.rfind(';').unwrap() as u32 + 1;
        let (cs, ce) = comment_span(source);
        let anns = vec![(cs, ce, "number")];
        assert!(check_inline(a_end, source, &anns).is_some());
        assert!(check_inline(b_end, source, &anns).is_some());

        let result = parse_source(source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "a");
    }

    // --- class body (same check, class offsets) ---

    #[test]
    fn class_body_annotation_before_first_member_matches() {
        let source = "class Box {\n// T: {T}\n    value;\n}\n";
        let open = source.find('{').unwrap() as u32;
        let (cs, ce) = comment_span(source);
        let first_member = source.find("value").unwrap() as u32;
        let anns = vec![(cs, ce, "{T}")];
        assert_eq!(check_block(open, first_member, &anns), Some(&(cs, ce, "{T}")));
    }

    #[test]
    fn empty_class_body_returns_none() {
        let source = "class Box {} // T: {T}\n";
        let open = source.find('{').unwrap() as u32;
        let body_end = source.find('}').unwrap() as u32 + 1;
        let (cs, ce) = comment_span(source);
        let anns = vec![(cs, ce, "{T}")];
        assert_eq!(check_block(open, body_end, &anns), None);
    }

    // --- payload normalization ---

    #[test]
    fn payload_is_text_after_first_t_colon_trimmed() {
        let source = "let x = 1; //  T:   (string) => User  \n";
        let result = parse_source(source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].ety, "(string) => User");
    }

    #[test]
    fn non_t_line_comments_and_block_comments_are_ignored() {
        let source = "let x = 1; // plain note\nlet y = 2; /* T: number */\n";
        assert!(parse_source(source).is_empty());
    }

    // --- end-to-end parse_source ---

    #[test]
    fn function_declaration_end_to_end() {
        let source = "function createUser(name) {\n// T: (string) => User\n    return { name };\n}\n";
        let (cs, ce) = comment_span(source);
        let result = parse_source(source);
        assert_eq!(
            result,
            vec![EtyAnnotation {
                node_start_offset: 0,
                ety_start_offset: cs,
                ety_end_offset: ce,
                kind: "function".to_string(),
                name: "createUser".to_string(),
                ety: "(string) => User".to_string(),
                doc: String::new(),
            }]
        );
    }

    #[test]
    fn class_method_yields_exactly_one_annotation_despite_double_visit() {
        // Gate 1 mandate: visit_method_definition and visit_function both run
        // check_block on the same body; dedupe must collapse them to one,
        // keeping the method entry (named, method-level node offset).
        let source = "class Box {\n    map(fn) {\n        // T: {U}((T) => U) => Box{U}\n        return fn;\n    }\n}\n";
        let result = parse_source(source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].kind, "function");
        assert_eq!(result[0].name, "map");
        assert_eq!(result[0].node_start_offset, source.find("map").unwrap() as u32);
        assert_eq!(result[0].ety, "{U}((T) => U) => Box{U}");
    }

    #[test]
    fn import_annotation_is_standalone_with_own_offsets() {
        let source = "// T: import { User } from './types'\nlet u = null; // T: User\n";
        let result = parse_source(source);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].kind, "import");
        assert_eq!(result[0].ety, "import { User } from './types'");
        assert_eq!(result[0].node_start_offset, 0);
        assert_eq!(result[0].ety_start_offset, 0);
        assert_eq!(result[1].kind, "variable");
        assert_eq!(result[1].name, "u");
    }

    #[test]
    fn multi_declarator_single_line_fires_once_at_statement_start() {
        let source = "let x = 1, y = 2; // T: number\n";
        let result = parse_source(source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].node_start_offset, 0);
        assert_eq!(result[0].name, "x");
    }

    #[test]
    fn multi_declarator_multi_line_fires_once_at_statement_start() {
        let source = "let x = 1,\n    y = 2; // T: number\n";
        let result = parse_source(source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].node_start_offset, 0);
        assert_eq!(result[0].kind, "variable");
    }

    #[test]
    fn comment_on_non_final_line_of_multi_line_declaration_is_inert() {
        // Falls inside the statement's span: not trailing, silently ignored
        // by design so the rule stays crisp.
        let source = "let x = 1, // T: number\n    y = 2;\n";
        assert!(parse_source(source).is_empty());
    }

    #[test]
    fn recoverable_syntax_error_mid_file_still_yields_annotations_for_valid_prefix() {
        // Oxc 0.135 fault tolerance is NARROW: many syntax errors (unclosed
        // braces/parens, `const x = ;`) are fatal and empty the whole program,
        // dropping every annotation. `let = 5;` is one it recovers from. The
        // empty-program case degrades gracefully downstream: the virtual doc
        // equals the original source and TS reports the syntax error itself.
        let source = "let count = 0; // T: number\nlet = 5;\n";
        let result = parse_source(source);
        assert!(result.iter().any(|a| a.kind == "variable" && a.name == "count"));
    }

    #[test]
    fn fatal_syntax_error_empties_program_and_yields_no_annotations() {
        // Documents the limitation above as a test, so a future Oxc bump that
        // improves recovery shows up as a (welcome) failure here.
        let source = "let count = 0; // T: number\nfunction broken( {\n";
        assert!(parse_source(source).is_empty());
    }

    #[test]
    fn concise_arrow_annotates_via_trailing_statement() {
        let source = "const double = x => x * 2; // T: (number) => number\n";
        let result = parse_source(source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].kind, "variable");
        assert_eq!(result[0].name, "double");
        assert_eq!(result[0].node_start_offset, 0);
    }

    #[test]
    fn function_expression_in_const_matches_inside_block_not_inline() {
        // The comment sits inside the statement's span, so the statement-level
        // inline check must NOT fire; the inside-block check binds it to the
        // function expression. Exactly one annotation.
        let source = "const createUser = function(name) {\n// T: (string) => User\n    return { name };\n};\n";
        let result = parse_source(source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].kind, "function");
        assert_eq!(result[0].node_start_offset, source.find("function").unwrap() as u32);
    }

    // --- per-parameter style (Gap 2): trailing // T: on params + // T: => R ---

    #[test]
    fn per_parameter_annotations_bind_to_params_and_return_binds_to_function() {
        let source = "function add(\n    a,  // T: number - First operand\n    b   // T: number - Second operand\n) {\n    return a + b;  // T: => number\n}\n";
        let result = parse_source(source);
        let fn_start = source.find("function").unwrap() as u32;

        let params: Vec<_> = result.iter().filter(|a| a.kind == "param").collect();
        assert_eq!(params.len(), 2);
        // Source order is preserved (results sort by ety_start_offset).
        assert_eq!((params[0].name.as_str(), params[0].ety.as_str()), ("a", "number"));
        assert_eq!(params[0].doc, "First operand");
        assert_eq!((params[1].name.as_str(), params[1].ety.as_str()), ("b", "number"));
        assert_eq!(params[1].doc, "Second operand");
        // Every param annotation groups under the enclosing function's start.
        assert!(params.iter().all(|p| p.node_start_offset == fn_start));

        let ret: Vec<_> = result.iter().filter(|a| a.kind == "return").collect();
        assert_eq!(ret.len(), 1);
        assert_eq!(ret[0].ety, "number"); // text after the leading `=>`
        assert_eq!(ret[0].node_start_offset, fn_start);
    }

    #[test]
    fn param_without_description_has_empty_doc() {
        let source = "function f(\n    x  // T: string\n) {\n    return x;\n}\n";
        let result = parse_source(source);
        let p = result.iter().find(|a| a.kind == "param").unwrap();
        assert_eq!((p.name.as_str(), p.ety.as_str(), p.doc.as_str()), ("x", "string", ""));
    }

    #[test]
    fn param_with_no_t_comment_is_untouched() {
        let source = "function f(\n    a,  // T: number\n    b\n) {\n    return a;\n}\n";
        let result = parse_source(source);
        let params: Vec<_> = result.iter().filter(|a| a.kind == "param").collect();
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].name, "a");
    }

    #[test]
    fn return_comment_binds_to_innermost_enclosing_function() {
        // The `// T: => string` sits in the INNER function body; it must bind to
        // `inner` (smallest containing body span), not the outer function.
        let source = "function outer() {\n    function inner(\n        x  // T: number\n    ) {\n        return x;  // T: => string\n    }\n    return inner;\n}\n";
        let result = parse_source(source);
        let ret = result.iter().find(|a| a.kind == "return").unwrap();
        assert_eq!(ret.node_start_offset, source.find("function inner").unwrap() as u32);
    }
}
