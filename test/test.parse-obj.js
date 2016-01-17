var parsepdf = require("../parse-pdf");

require('should');

var buff =  new Buffer(
"\r\n\
8 0 obj\r\n\
4728\r\n\
endobj"
);

var ret = parsepdf.parseObj(buff,2);

ret.content.should.eql('4728');
ret.id.should.eql('8 0');
ret.position.should.eql(2);

//console.log(ret);