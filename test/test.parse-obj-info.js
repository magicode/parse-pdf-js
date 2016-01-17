var parsepdf = require("../parse-pdf");

require('should');


var str1 = "<</Type/XObject/Subtype/Image/Width 4928 /Height 3264 /BitsPerComponent 8 /ColorSpace/DeviceRGB/Filter/DCTDecode/Length 4823190>>";
var str2 = "<</Type/Page/Parent 12 0 R/Resources 24 0 R/MediaBox[0 0 612 792]/Group<</S/Transparency/CS/DeviceRGB/I true>>/Contents 2 0 R>>";
var str3 = 
"<</Type/Catalog/Pages 12 0 R\r\n\
/OpenAction[1 0 R /XYZ null null 0]\r\n\
/Lang(en-US)\r\n\
/>>"



var ret = parsepdf.parseObjInfo(str1);

ret.Type.should.eql('XObject');
ret.Subtype.should.eql('Image');
ret.Length.should.eql('4823190');
ret.ColorSpace.should.eql('DeviceRGB');

ret = parsepdf.parseObjInfo(str2);

ret.Type.should.eql('Page');
ret.Group.S.should.eql('Transparency');
ret.Contents.should.eql('2 0 R');

ret = parsepdf.parseObjInfo(str3);

ret.Type.should.eql('Catalog');
ret.Lang.should.eql('(en-US)');

//console.log(ret);