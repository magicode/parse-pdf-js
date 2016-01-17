var parsepdf = require("../parse-pdf");

require('should');

var buffendfile =  new Buffer("jfggjhfdkhgdjlghlhgjl\r\nstartxref\r\n12550\r\n%%EOF\r\n");

var xrefpos = parsepdf.findXrefPos(buffendfile);

xrefpos.should.eql(12550);
//console.log(xrefpos);