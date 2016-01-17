var parsepdf = require("../parse-pdf");

require('should');

var buff =  new Buffer("a\n\n\r\n\r\n1\r2\n3\r\n23235\r");

var offset = 0;
var retoffset = buff.length;

var lines = 
[
'610a',
'0a0d',
'0a0d',
'0a',
'310d',
'320a',
'330d0a',
'32333233350d'
];

while(offset < buff.length){
    retoffset = parsepdf.readLine(buff,offset);
    var line = buff.slice(offset,retoffset).toString('hex');
    //console.log(line);
    line.should.eql(lines.shift());
    offset = retoffset;
}
