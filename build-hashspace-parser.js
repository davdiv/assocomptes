var fs = require("fs");
var peg = require("pegjs");

var parserPath = "hashspace/hsp/compiler/parser/hspblocks.peg";
var grammar = fs.readFileSync(parserPath + "js", "utf8");
var parser = peg.buildParser(grammar, {
    cache : true,
    trackLineAndColumn : true,
    output : "source"
});
fs.writeFileSync(parserPath + ".js", "module.exports = " + parser + ";\n");
