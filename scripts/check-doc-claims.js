// Mechanical doc-claim checker.
//
// SCOPE OF THE GUARANTEE -- read this before trusting a green result:
//   GATES on   : status/root docs (README, KNOWN-ISSUES, SECURITY, service READMEs...).
//                These assert CURRENT state, so an unresolvable reference is a defect.
//   REPORTS only: design specs (specs/, *-design.md, *-plan-*, FR-inventory). These
//                describe PLANNED work, so forward references to files that do not exist
//                yet are expected and must not fail the build.
//   NEVER gates : function-shaped tokens. That heuristic matches inline code fragments
//                like `address(this)` and `keccak256(...)`, so it is noise.
//
// A pass therefore means "every path and contract name in the status docs resolves",
// NOT "every reference in every document resolves". The spec counts printed below are
// informational; they are expected to be non-zero.
const fs=require("fs"), path=require("path"), {execSync}=require("child_process");
const {includePrefixes,includeFiles}=require("./lib/public-allowlist");
// Works in BOTH contexts. In the private repo the shipping set is
// `git ls-files` filtered by the allowlist. In a promoted snapshot there is no
// .git by design, and every file present IS the shipping set -- so walk instead.
let ship;
try{
  const tracked=execSync("git ls-files",{maxBuffer:1<<28,stdio:["ignore","pipe","ignore"]})
    .toString().split("\n").filter(Boolean);
  ship=new Set(tracked.filter(f=>includeFiles.has(f)||includePrefixes.some(p=>f.startsWith(p))));
}catch{
  ship=new Set();
  (function walk(dir){
    for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      if(["node_modules",".git","artifacts","cache","coverage"].includes(e.name)) continue;
      const full=path.join(dir,e.name);
      const rel=path.relative(".",full);
      e.isDirectory()? walk(full) : ship.add(rel);
    }
  })(".");
}

// Universe of things that exist in the shipped tree
const basenames=new Set(), solNames=new Set(), fnNames=new Set();
for(const f of ship){
  basenames.add(path.basename(f));
  if(f.endsWith(".sol")){
    const b=path.basename(f,".sol"); solNames.add(b);
    try{ for(const m of fs.readFileSync(f,"utf8").matchAll(/function\s+([A-Za-z_]\w*)/g)) fnNames.add(m[1]); }catch{}
  }
  if(/\.(js|ts|cjs|mjs)$/.test(f)){
    try{ for(const m of fs.readFileSync(f,"utf8").matchAll(/function\s+([A-Za-z_]\w*)|(?:const|let)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/g)) fnNames.add(m[1]||m[2]); }catch{}
  }
}
const docs=[...ship].filter(f=>f.endsWith(".md"));
const findings=[];
// A spec that says "Create: foo.js" is a PLAN, not a false claim. Status//root docs assert
// current state and are what a public reader treats as fact.
const isSpec = d => /\/specs\/|FR-inventory|development-plan|-design\.md$|-plan-/.test(d);
for(const d of docs){
  let body; try{ body=fs.readFileSync(d,"utf8"); }catch{ continue; }
  const lines=body.split("\n");
  lines.forEach((line,i)=>{
    for(const m of line.matchAll(/`([^`\n]{2,80})`/g)){
      const tok=m[1].trim();
      // PATHS: contains a slash and a file extension
      if(/^[\w./-]+\/[\w.-]+\.\w{1,5}$/.test(tok)){
        const clean=tok.replace(/^\.\//,"");
        if(!ship.has(clean) && !basenames.has(path.basename(clean)))
          findings.push({sev:isSpec(d)?"PATH-spec":"PATH",doc:d,line:i+1,tok});
        return;
      }
      // SOLIDITY TYPES: CamelCase ending in Facet/Lib/Storage/Base, or I-prefixed interface
      if(/^(?:[A-Z][a-z]\w*(?:Facet|Lib|Storage|Base)|I[A-Z][a-z]\w+)$/.test(tok) && !/^[A-Z0-9_]+$/.test(tok)){
        if(!solNames.has(tok)) findings.push({sev:isSpec(d)?"SOL-spec":"SOL",doc:d,line:i+1,tok});
        return;
      }
      // FUNCTION CALLS: name() or name(args)
      const fm=tok.match(/^([a-z]\w{2,})\s*\(/);
      if(fm && !fnNames.has(fm[1])) findings.push({sev:"FN",doc:d,line:i+1,tok});
    }
  });
}
const by={}; for(const f of findings) (by[f.sev] ||= []).push(f);
console.log(`shipping docs scanned: ${docs.length}`);
for(const k of ["PATH","SOL","FN","PATH-spec","SOL-spec"]){
  const g=by[k]||[];
  console.log(`\n=== ${k} — ${g.length} unresolved ===`);
  const seen=new Set();
  for(const f of g){ const key=f.tok; if(seen.has(key))continue; seen.add(key);
    console.log(`  ${f.doc}:${f.line}  \`${f.tok}\``); }
}

// GATE: unresolved references in status/root docs are failures. Spec documents describe
// planned work, so their forward references are informational only. FN is heuristic (it
// matches inline code fragments) and is reported but never gates.
const hard=(by["PATH"]||[]).concat(by["SOL"]||[]);
if(hard.length){
  console.error(`\n\u274c ${hard.length} unresolved reference(s) in shipping status docs.`);
  console.error("   A public reader cannot open these. Fix the reference or ship the target.");
  process.exit(1);
}
const specCount=(by["PATH-spec"]||[]).length+(by["SOL-spec"]||[]).length;
console.log("\n\u2705 doc-claim check passed \u2014 all paths and contract names in shipping STATUS docs resolve.");
console.log(`   (${specCount} unresolved forward reference(s) inside design specs — informational, not gated.)`);
