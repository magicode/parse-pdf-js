
const async = require("async");
const zlib = require("zlib");
const fs = require("fs");

require('buffertools').extend();


module.exports = {};

const SPACE = 0x20;
const LF = 0x0a;
const CR = 0x0d;

function isNum(char){
    return char >= 0x30 && char <= 0x39;
}
function isNorR(char){
    return char == CR || char == LF;
}


module.exports.parsePdf = parsePdf;
module.exports.findXrefPos = findXrefPos;
module.exports.readLineReverse = readLineReverse;
module.exports.readLine = readLine;
module.exports.parseXref = parseXref;
module.exports.parseObj = parseObj;
module.exports.parseObjInfo = parseObjInfo;
module.exports.parseContent = parseContent;
module.exports.getAttr = getAttr;

function parsePdf( fileBuffer , callback ){
    var xrefPosition = findXrefPos(fileBuffer);
    var xref = parseXref(fileBuffer,xrefPosition);
    
    if(!xref) throw new Error('error xref');
    
    var objs = {};
    
    xref.refs.forEach(function(entry){
        if( entry.type != 'n' ) return;
        var obj = parseObj(fileBuffer, entry.offset);
        objs[obj.id] = obj;
    });
    this.fileBuffer = fileBuffer;
    this.objs = objs;
}


parsePdf.prototype._parseFonts = function( callback ){
    
    var $this = this;
    
    if($this.fonts) return callback();
    
    callback = singleAsync(this, '_single_$_parseFonts',callback);
    
    var fonts = [];
    
    for(var key in this.objs){
        var obj = this.objs[key];
        if(obj.objinfo && obj.objinfo.Type == 'Font'){
            fonts.push(obj);
        }
    }
    
    async.each(fonts, function (obj, next) {
        if(!obj.objinfo.ToUnicode)return next();
        
        var ref = getRef(obj.objinfo.ToUnicode);
        
        var toUnicode = $this.objs[ref];
        if(!toUnicode) return next();  
        
        
        getStream(toUnicode,$this.objs, $this.fileBuffer ,function(err,stream){
            if(err || !stream) return next();
            var str = stream.toString('binary');
            obj.toUnicode = parseToUnicode(str);
            next();
        });

    }, function(){
        $this.fonts = fonts;
        callback();
    });
    
};

function  reverseText(str) {
    var out = "";
    for(var i in str){
        out = str[i] + out;
    }
    return out;
}

parsePdf.prototype._parsePages = function( callback ){
    
    var $this = this;
    
    if($this.pages) return callback();
    
    callback = singleAsync(this, '_single_$_parsePages',callback);
    
    var pages = [];
    
    for(var key in this.objs){
        var obj = this.objs[key];
        if(obj.objinfo && obj.objinfo.Type == 'Page'){
            pages.push(obj);
        }
    }
    
    var objContents = {};
    
    async.each(pages, function (obj, next) {
        
        var font = getAttr('Font', obj, $this.objs);
        if(!font) return next();
        
        if(!obj.objinfo.Contents)return next();
        
        var contentsList = [];
        
        obj.objinfo.Contents.replace(/(\d+\s+\d+)\s+R/g,function(all,ref){
            contentsList.push(ref);
        });
        
        async.each(contentsList, function(ref, next) {
            var contents = $this.objs[ref];
            if(!contents) return next(); 

            getStream(contents,$this.objs, $this.fileBuffer ,function(err,stream){
                if(err || !stream) return next();
                var allText = "";
                var text = "";
                var currentToUnicode = false;
                var currentFont = false;
                var tokens = [];
    
                var str = stream.toString('binary');
                parseContent( str , function(token){
                    tokens.push(token);
                    
                    switch (token.type) {
                        case 'font':
                            var m = /\s*\/(\w+)[^\/]+$/.exec( token.content );
                            if(m && m[1]){
                                var fontCode = m[1];
                                var refFont = getRef(font[fontCode]);
                                var fontObj = $this.objs[refFont];
                                currentFont = fontObj;
                                if(fontObj && fontObj.toUnicode){
                                    currentToUnicode = fontObj.toUnicode;
                                }else{
                                    currentToUnicode = false;
                                }
                            }
                            break;
                        case 'text':
                            text += textToUnicode( token.content, currentToUnicode );
                            break;   
                        case 'end':
                            if(/[א-ת]/.test(text)){
                                text = reverseText(text);
                            }
                            allText += text + "\n";
                            text  = "";
                            break;       
                        default:
                            // code
                    }
                });
                
                obj.tokens = tokens;
                objContents[contents.id] = contents;
                contents._text = allText;
                allText = '';
                //console.log(allText);
                next();
            });
        },function() {
            next();
        });
    }, function(){
        $this.pages = pages;
        $this.contents = objContents;
        callback();
    });
    
};

function textToUnicode(str, toUnicode){
    var text = "";
    if(toUnicode == false){
        str.replace(/\(([^)]+)\)/g,function(all,t){
            text +=t;
        });
        return text;
    }
    
    var len = toUnicode.codespacerange.len || 2;
    
    str.replace(/\<([0-9A-Fa-f]+)\>|\(((?:[^)]|\\.)+)\)/g,function(all,hex,tt){
        
        function addCode(char){
            if(toUnicode.bfchar && toUnicode.bfchar[char]){
                text += String.fromCharCode(toUnicode.bfchar[char]);
            }else if(toUnicode.bfrange && toUnicode.bfrange.length){
                for(var i in toUnicode.bfrange){
                    var range = toUnicode.bfrange[i];
                    if(range.min <= char && range.max >= char){
                        text += String.fromCharCode(char + range.delta);
                        break;
                    }
                }
            }else{
                text += char;
            }
        }
        
        var char;
        while(tt && tt.length){
            char = tt.substr(0,1);
            tt = tt.substr(1);
            char = char.charCodeAt(0);
            addCode(char);
        }

        while(hex && hex.length){
            char = hex.substr(0,len);
            hex = hex.substr(len);
            char = +("0x" + char);
            addCode(char);
        }
    });
    return text;
}

parsePdf.prototype.getTexts = function( callback ){

    var $this = this;

    async.series([
        function (next){ 
            $this._parseFonts(next);
        },
        function (next){ 
            $this._parsePages(next);
        },function(){
            callback();
        }
    ]);

};

function getStream(obj, objs , buffer , callback ){
        var contentsLength = obj.objinfo.Length;
        var refLength = getRef(contentsLength);
        if(refLength) contentsLength = objs[refLength].content;
        contentsLength = +contentsLength;
        
        if(!contentsLength || !obj.streamPosition)
            return callback(new Error("not-have-stream"));
        
        var stream = buffer.slice(obj.streamPosition , obj.streamPosition + contentsLength);
        
        if(obj.objinfo.Filter == 'FlateDecode'){
            stream = zlib.inflate(stream,callback);
        }else{
            callback(null,stream);
        }
}

function getStreamSync(obj, objs , buffer ){
        var contentsLength = obj.objinfo.Length;
        var refLength = getRef(contentsLength);
        if(refLength) contentsLength = objs[refLength].content;
        contentsLength = +contentsLength;
        
        if(!contentsLength || !obj.streamPosition)
            return ;
        
        var stream = buffer.slice(obj.streamPosition , obj.streamPosition + contentsLength);
        
        if(obj.objinfo.Filter == 'FlateDecode'){
            stream = zlib.inflateSync(stream);
        }
        
        if(obj.objinfo.DecodeParms && +obj.objinfo.DecodeParms.Columns){
            stream = predictorParse(stream, +obj.objinfo.DecodeParms.Columns);
        }
        return stream;
}

function predictorParse( stream , columns ){
    var blockSize = columns + 1;
    var newStream = new Buffer(stream.length - (stream.length/blockSize));
    
    var prevBlock = [];
    
    for(var i=0;i<columns;i++) prevBlock[i] = 0;
    
    
    var pos = 0;
    var posDecode = 0;
    
    function getByte(){
        return stream[pos++];
    }
    
    while(pos < stream.length){
        var p = getByte();
        
        switch(p){
            case 2:
                for(i=0;i<columns;i++){
                    var b = getByte();
                    prevBlock[i] = newStream[posDecode++] = (b +  prevBlock[i]) & 0xFF;
                }
                break;
            default:
                return;
        }
    }
    
    return newStream;
}


function getAttr(attr,obj,objs){
    var value = obj.objinfo[attr];
    if(!value){
        var resources = obj.objinfo.Resources;
        if('string' == typeof resources){
            resources = objs[getRef(resources)];
            resources = resources && resources.objinfo;
        }
        value = resources && resources[attr];
    }
    
    if(!value) return;
    if('string' == typeof value && getRef(value)){
        value = objs[getRef(value)];
        if(value){
            value = value.objinfo || value.content;
        }
    }
    return value;
}

function parseToUnicode(str){
    
    var strSplit = str.split(/[\s\n\r]+/);
    
    var ss = {};
    var uni = {};
    uni.codespacerange = {};
    uni.bfchar = {};
    uni.bfrange = [];
    
    var regex2 = /\s*<([0-9A-F]+)>\s*<([0-9A-F]+)>/ig;
    var regex3 = /\s*<([0-9A-F]+)>\s*<([0-9A-F]+)>\s*<([0-9A-F]+)>/ig;
    
    var statusMap = {};
    statusMap['begincodespacerange'] = on_begincodespacerange;
    statusMap['beginbfchar'] = on_bfchar;
    statusMap['beginbfrange'] = on_bfrange;
    var status = onFind;
    
    
    strSplit.forEach(function(item,index,list){
        status(item,index,list);
    });
    

    
    function parseHexNum(hex){
        return +("0x" + hex);
    }
    
    function onFind(item,index,list){
        if(statusMap[item]){
            status = statusMap[item];
        }
    }
    
    function on_begincodespacerange(item,index,list){
        if(!ss.stack) ss.stack = '';
        if(item == 'endcodespacerange'){
            var match = regex2.exec(ss.stack);
            if(match){
                var obj = {};
                obj.min = parseHexNum(match[1]);
                obj.max = parseHexNum(match[2]);
                obj.len = match[2].length;
                uni.codespacerange = obj;
            }
            ss.stack = '';
            status = onFind;
        }else{
            ss.stack += item;
        }
    }
    
    function on_bfchar(item,index,list){
        if(!ss.stack) ss.stack = '';
        if(item == 'endbfchar'){
            ss.stack.replace(regex2,function(all,a1,a2){
                var from = parseHexNum(a1);
                var to = parseHexNum(a2);
                uni.bfchar[from] = to;
            });
            ss.stack = '';
            status = onFind;
        }else{
            ss.stack += item;
        }
    }
    
    function on_bfrange(item,index,list){
        if(!ss.stack) ss.stack = '';
        if(item == 'endbfrange'){
            ss.stack.replace(regex3,function(all,min,max,start){
                var obj = {};
                obj.min = parseHexNum(min);
                obj.max = parseHexNum(max);
                obj.start = parseHexNum(start);
                obj.delta = obj.start - obj.min;
                uni.bfrange.push(obj);
            });
            ss.stack = '';
            status = onFind;
        }else{
            ss.stack += item;
        }
    }
    
    return uni;
}

function __parseToUnicode(str){
/*
/CIDInit/ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo<<
/Registry (Adobe)
/Ordering (UCS)
/Supplement 0
>> def
/CMapName/Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
11 beginbfchar
<01> <0048>
<02> <0065>
<03> <006C>
<04> <006F>
<05> <0020>
<06> <0077>
<07> <0072>
<08> <0064>
<09> <0074>
<0A> <0073>
<0B> <0032>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end

*/
    var ss = {};
    var status = onStartLine;
    var blocks = [];
    
    for(var i=0;i<str.length;i++){
        var char = str[i];
        status(char,i,str);
    }
    
    function onFind(char,i,str){
        if(char == '\n'){
            status = onStartLine;
        }
    }
    
    function onStartLine(char,i,str){
        if(char >= "0" && char <= "9"){
            status = onStartBlock;
            status(char,i,str);
        }else{
            status = onFind;
        }
    }
    function onStartBlock(char,i,str){
        if(!ss.buff) ss.buff = '';
        if(char == '\n'){
            var match = (/^(\d+)\s+begin([^\s]+)/).exec(ss.buff);
            if(match){
                ss.blockSize = +match[1];
                ss.blockRead = 0;
                ss.blockName = match[2];
                ss.blockLines = [];
                status = onBlock;
                //on one line
                if(ss.buff.indexOf('end' + ss.blockName) != -1 && (match = (/^(\d+)\s+begin([^\s]+)(.+)end([^\s]+)/).exec(ss.buff))){
                    blocks.push({ name: ss.blockName, lines:  [ match[3] ] });
                    delete ss.blockSize ;
                    delete ss.blockRead ;
                    delete ss.blockName ;
                    delete ss.blockLines ;
                    delete ss.buff;
                    status = onFind;
                    status(char,i,str);
                }
                delete ss.buff;
            }else{
                delete ss.buff;
                status = onFind;
                status(char,i,str);
            }
            
        }else{
            ss.buff += char;
        }
    }
    
    function onBlock(char,i,str){
        if(!ss.buff) ss.buff = '';

        if(ss.buff && char == '\n'){
            if(!ss.blockLines) ss.blockLines = [];
            var line = ss.buff;
            delete ss.buff;
            var match = /^end(.*)/.exec(line);
            if(match && match[1] == ss.blockName){
                //end;
                blocks.push({ name: ss.blockName, lines:  ss.blockLines });
                delete ss.blockSize ;
                delete ss.blockRead ;
                delete ss.blockName ;
                delete ss.blockLines ;
                status = onFind;
                status(char,i,str);
            }else{
                ss.blockLines.push(line);
            }
        }else{
            ss.buff += char;
        }
    }
    
    function parseHexNum(hex){
        return +("0x" + hex);
    }
    var uni = {};
    uni.codespacerange = {};
    uni.bfchar = {};
    uni.bfrange = [];
    
    var blocksParse = {};
    blocksParse.codespacerange = function(parseLine){
        var obj = {};
        obj.min = parseHexNum(parseLine[1]);
        obj.max = parseHexNum(parseLine[2]);
        obj.len = parseLine[2].length;
        uni.codespacerange = obj;
    };
    blocksParse.bfrange = function(parseLine){
        var obj = {};
        obj.min = parseHexNum(parseLine[1]);
        obj.max = parseHexNum(parseLine[2]);
        obj.start = parseHexNum(parseLine[3]);
        obj.delta = obj.start - obj.min;
        uni.bfrange.push(obj);
    };
    blocksParse.bfchar = function(parseLine){
        var from = parseHexNum(parseLine[1]);
        var to = parseHexNum(parseLine[2]);
        uni.bfchar[from] = to;
    };

    blocks.forEach(function(block){
       
        if(block.lines)
            block.lines.forEach(function(line){
                var parseLine = /^\s*\<([0-9A-Fa-f]{1,4})\>\s*\<([0-9A-Fa-f]{1,4})\>(?:\s*\<([0-9A-Fa-f]{1,4})\>)?/.exec(line);
                if(parseLine && blocksParse[block.name]){
                    blocksParse[block.name]( parseLine );
                }
            });
    });
    
    return uni;
}

function parseContent(str , oncontent){
    
    var ss = {};
    
    var ON_ENTER_CHARS = {'\n':true,'\r': true,' ': true};
    
    var status = onStart;
    
    for(var i=0;i<str.length;i++){
        var char = str[i];
        status(char,i,str);
    }
    
    function nextChar(){
        return str[i + 1];
    }
    
    function onFind(char,i,str){
        if( ON_ENTER_CHARS[char] ){
            status = onStart;
        }
    }
    
    function onStart(char,i,str){
        if(char === "B" && str.substr(i,2) == "BT"){
            status = onBegin;
        }else{
            status = onFind;
            status(char,i,str);
        }
    }
    function onBegin(char,i,str){
        if(char === "T"){ //BT
            oncontent({ type: 'begin', content: 'text' });
            status = onText;
        }else{
            status = onFind;
        }
    }
    
    function onTextInBrackets(char,i,str){
        ss.part += char;
        if(char == ']')
            status = onTextCmd;
    }
    
    function onText(char,i,str){
        if(!ss.part) ss.part = '';
        
        if(char == '[' && !ss.part){
            status = onTextInBrackets;
            status(char,i,str);
            return;
        }
        
        if(ON_ENTER_CHARS[char]){
            if(!ss.lastChar) ss.lastChar = char;
            status = onTextCmd;
        }else{
            ss.part += char;
        }
    }
    
    function onTextCmd(char,i,str){
        if( char == 'T'){
            status = onTextPartEnd;
        }else if(char == 'E' && str.substr(i,2) == "ET"){ //ET
            //end text
            oncontent({ type: 'end', content: 'text' });
            status = onFind;
        }else{
            if(ss.lastChar && ss.part){
                ss.part += ss.lastChar;
                delete ss.lastChar;
            }
            status = onText;
            status(char,i,str);
        }
    }
    
    function onTextPartEnd(char,i,str){
        var c = char.toLowerCase();
        var map = { 'f': 'font' , 'j': 'text'};
        
        if(map[c]){
            var part = ss.part.trim();
            oncontent({ type: map[c], content: part });
        }
        
        ss.part = '';
        status = onText;
    }
    
    oncontent({ type: 'end' });
}


function getRef(str){
    var m = /(\d+ \d+) R/.exec(str);
    return m && m[1];
}

function parseObjInfo(str){

    var retObjInfo = {};
    
    var NON_KEY_CHARS = {' ': true, '\t': true, '\n':true ,'\r': true , '[':true , '(': true , "/": true, "<": true };
    var NON_VALUE_CHARS = {'/': true, ' ': true, '\t': true, '\n':true ,'\r': true };
    
    var status = onStart;
    
    var currKey = '';
    var currValue = '';
    var currValueType = '';
    var currValueArrowCount = 0;
    var currValueBracketsCount = 0;
    var currValueBracketsStart = '';
    var currValueBracketsEnd = '';
    for(var i=0;i<str.length;i++){
        var char = str[i];
        status(char,i,str);
    }
    
    function nextChar(){
        return str[i + 1];
    }
    
    function onStart(char,i,str){
        if(char === "/"){
            status = onKey;
        }
    }
    
    function onKey(char,i,str){
        if(NON_KEY_CHARS[char] === true){
            if(currKey === '') return;
            status = onValue;
            status(char,i,str);
            return ;
        }
        currKey += char;
    }
    
    function onValueBrackets(char,i,str){
        if(char === currValueBracketsStart) currValueBracketsCount++;
        if(char === currValueBracketsEnd) currValueBracketsCount--;
        currValue += char;
        if(currValueBracketsCount == 0){
            status = onValue;
        }
    }
    
    function onValue(char,i,str){
        if(currValue === ''){
            if(NON_VALUE_CHARS[char]) return; //on start
            
            if(char === '<'){
                if(nextChar() === '<'){
                    currValueType = 'OBJ_INFO';
                    currValueBracketsStart = '<';
                    currValueBracketsEnd = '>';
                    status = onValueBrackets;
                    return status(char,i,str);
                }
            }else if(char === '['){
                currValueType = 'ARRAY';
                currValueBracketsStart = '[';
                currValueBracketsEnd = ']';
                status = onValueBrackets;
                return status(char,i,str);
            }
        } 

        
        if(currValue !== '' && ( char === '/' || (char === '>' && nextChar() === '>') ) ){
            
            if(currValueType == 'OBJ_INFO'){
                currValue = parseObjInfo(currValue);
            } 
            else currValue = currValue.trim();
            
            retObjInfo[currKey] = currValue;
            
            currKey = '';
            currValue = '';
            currValueType = '';
            currValueArrowCount =0;
            if(char === '/'){
                status = onStart;
                onStart(char,i,str);
            }else{
                status = onEnd;
            }
            return;
        }
        currValue += char;
    }
    
    function onEnd(char,i,str){
        
    }
    
    
    return retObjInfo;
}

function parseObj( buff , pos ){
    var obj = {};
    var idObj = '';
    var char;
    
    function isSpace(char){
        return isNorR(char) || char == SPACE;
    }
    
    obj.position = pos;

    while(pos <= buff.length){
        char = buff[pos];
        if(isNum(char)){
            idObj += String.fromCharCode(char);
        }else if(char == SPACE){
            break;
        }else{
            return;//TODO: error obj;
        }
        pos++;
    }
    
    while( buff[pos] == SPACE ){ 
        idObj += ' ';
        pos++;
    }
    
    while(pos <= buff.length){
        char = buff[pos];
        if(isNum(char)){
            idObj += String.fromCharCode(char);
        }else if(char == SPACE){
            break;
        }else{
            return;//TODO: error obj;
        }
        pos++;
    }
    
    while( buff[pos] == SPACE ) pos++;
    
    var objToken = buff.toString('utf8',pos,pos+3);
    if(objToken != 'obj') 
        return;
    pos+=3;
    
    while( isSpace(buff[pos]) ) pos++;
    

    var schar = String.fromCharCode(buff[pos]);
    
    if(schar == '<'){
        //parse objinfo;
        var objinfo = schar;
        var arrowCount = 1;
        pos++;
        while(pos <= buff.length){
            schar = String.fromCharCode(buff[pos]);
            objinfo+=schar;
            if(schar=='<')arrowCount++;
            if(schar=='>')arrowCount--;
            pos++;
            if(arrowCount == 0){
                break;
            }
        }
        obj.objinforaw = objinfo;
        obj.objinfo = parseObjInfo(objinfo);
        while( isSpace(buff[pos]) ) pos++;
        var  streamToken = buff.toString('utf8',pos,pos+6);
        if('stream' == streamToken){
            obj.stream =  true;
            pos += 6;
            var maxCountNorR = 3;
            while( isSpace(buff[pos]) && maxCountNorR-- ) pos++;
            obj.streamPosition = pos; 
        }
        
    }else{
        //getcontect;
        var indexEndObj = buff.indexOf('endobj',pos);
        if(indexEndObj != -1){
            while(isNorR(buff[indexEndObj-1])) indexEndObj--;
            obj.content = buff.toString('utf8',pos,indexEndObj);
        }
    }

    obj.id = idObj;
    
    return obj;
}

function parseXref( buff , addpos ){

    
    var refs = [];
    
    var poses = [];
    poses.push(addpos);
    var pos;
    while(pos = poses.shift()){
        var endline = readLine(buff,pos);
        var line = buff.toString('utf8',pos,endline);
        
        if(line.indexOf('xref') != -1 ) {
            
            pos = endline;
            endline = readLine(buff,pos);
            line = buff.toString('utf8',pos,endline);
            
            var match = /^(\d+)\s+(\d+)/.exec(line);
            if(!match) return;
            var count = +match[2];
            
            
            
            while(true){
                pos = endline;
                endline = readLine(buff,pos);
                line = buff.toString('utf8',pos,endline);
                match = /^(\d+)\s+(\d+)\s+(\w+)/.exec(line);
                if(match){
                    refs.push({ offset: +match[1] , type: match[3] });
                }else if(!/^(\d+)\s+(\d+)/.test(line)){
                    break;
                }
            }
            
            while( isNorR(buff[pos]) || buff[pos] == SPACE ) pos++;
            
            //read trailer
            var trailerStr = 'trailer';
            var trailerToken = buff.toString('utf8',pos,pos + trailerStr.length);
            if(trailerToken == trailerStr){
                pos += trailerStr.length;
                while( isNorR(buff[pos]) || buff[pos] == SPACE ) pos++;
                var schar = String.fromCharCode(buff[pos]);
                var arrowCount = 0;
                if(schar == "<"){
                    var trailerContent = '';
                    while(pos <= buff.length){
                        if(schar=='<')arrowCount++;
                        if(schar=='>')arrowCount--;
                        trailerContent +=schar;
                        pos++;
                        if(arrowCount == 0){
                            break;
                        }
                        schar = String.fromCharCode(buff[pos]);
                    }
                    if(trailerContent){
                        trailerContent = parseObjInfo(trailerContent);
                        if(+trailerContent.Prev){
                            poses.push(+trailerContent.Prev);
                        }
                    }
                }
            }
        
        }else if(line.indexOf('obj') != -1 ){
            var xrefObj = parseObj(buff , pos);
            
            console.log(xrefObj);
            
            var xrefStream = getStreamSync(xrefObj,{},buff);
            
            if(xrefStream){
                fs.writeFileSync("xrefStream_"+ xrefObj.id, xrefStream);
            }
            
            var posStream = 0;
            function getByte(){
                return xrefStream[posStream++];
            }
            var W = [];
            xrefObj.objinfo.W.replace(/\d+/g,function(d){ W.push(+d); });
            var typeW = W[0]; 
            var offsetW = W[1]; 
            var genW = W[2]; 
            
            var range = [];
            if(xrefObj.objinfo.Index)
                xrefObj.objinfo.Index.replace(/\d+/g,function(d){ range.push(+d); });
            else  range = [0,+xrefObj.objinfo.Size];
    
            while(range.length > 1){
                var n = range[1];
                
                for(var i=0 ; i < n ; i++){
                    
                    var type = 0;
                    for(var j=0;j<typeW;j++){
                        type = (type<<8) | getByte();
                    }
                    if(typeW===0) type = 1;
                    var offset = 0;
                    for(var j=0;j<offsetW;j++){
                        offset = (offset<<8) | getByte();
                    }
                    for(var j=0;j<genW;j++){
                        getByte();
                    }
                    
                    if(type == 1){
                        refs.push({ offset: offset, type: 'n' });
                    }
                }
                range.splice(0,2);
            }
           

            if(xrefObj.objinfo && +xrefObj.objinfo.Prev){
                poses.push(+xrefObj.objinfo.Prev);
            }
            //console.log(xrefObj);
            //return;
        }else{
            return;
        }
    }
    return { refs: refs };
}

function findXrefPos( buff ){
    var offset = buff.length;
    var linestart = 0;
    
    linestart = readLineReverse(buff,offset);
    var eof = buff.slice(linestart,offset).toString('utf8');
    offset = linestart;
    if(eof.indexOf('%%EOF') == -1)
        throw new Error('no find eof');
        
    linestart = readLineReverse(buff,offset);
    var startxrefnum = buff.slice(linestart,offset).toString('utf8');
    offset = linestart;  
    
    linestart = readLineReverse(buff,offset);
    var startxref = buff.slice(linestart,offset).toString('utf8');
    offset = linestart; 
    
    if(startxref.indexOf('startxref') == -1)
        throw new Error('no find eof');
    
    var num = +startxrefnum;
    
    if(isNaN(num)) 
        throw new Error('pos is error');
        
    
    return num;
    
}



function readLineReverse( buff , offset ){

    var last = false;
    var rncount = 0;
    var noncount = 0;
    for(var i = offset-1; i>=0;i--){
        var char = buff[i];
        if(isNorR(char)){
            if(noncount) return i+1;
            
            if(!last){
                rncount++;
                last = char;
            }
            else if(last == char){
                rncount++;
            }
            else{
                last = false;
            }
            if(rncount>1) return i+1;
        }else{
            noncount++;
            last = false;
        }
    }
    return 0;
}

function readLine( buff , offset ){

    var length = buff.length;
    var last = false;
    for(var i = offset; i<length;i++){
        var char = buff[i];
        if(isNorR(char)){
            if(last){
                if(last == char){
                   return i; 
                }else{
                   return i+1; 
                }
            }else{
                last = char;
            }
        }else{
            if(last) return i; 
        }
    }
    return length;
}



function singleAsync(obj , name , cb){
	
	if(obj && obj[name]){
		obj[name].push(cb);
		return;
	}else{
		obj[name] = [cb];
	}
	
	return function(){
		var list = obj[name];
		delete obj[name];
		var func ;
		while((func = list.shift())){
			func.apply(this,arguments);
		}
	};
}