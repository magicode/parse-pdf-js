var parsepdf = require("../parse-pdf");

require('should');

var buff =  new Buffer("a\n\n\r\n\r\n1\r2\n3\r\n23235\r");

var offset = buff.length;
var retoffset = 0;

var lines = 
[
"32333233350d",
"330d0a",
"320a",
"310d",
"0d0a",
"0d0a",
"0a",
"610a"
];

while(offset>0){
    retoffset = parsepdf.readLineReverse(buff,offset);
    var line = buff.slice(retoffset,offset).toString('hex');
    //console.log(line);
    line.should.eql(lines.shift());
    offset = retoffset;
}
