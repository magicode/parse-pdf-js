var parsepdf = require("../parse-pdf");

require('should');

var buff =  new Buffer("\r\nxref\r\n\
4 2\r\n\
0000000016 00000 f\r\n\
0000001833 00000 n\r\n\
");

var ret = parsepdf.parseXref(buff,2);

ret.should.eql({ refs: 
   [ { position: 16 ,type: 'f' },
     { position: 1833 ,type: 'n' }
     ] });
     
//console.log(ret);