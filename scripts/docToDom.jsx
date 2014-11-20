var alertedUnsupported = true,
    reservedNames = {   // All IDs in the panel are reserved, we include the empty
        "" : true       // string so that elements with no name will be given one
    },
    alphabetic = new RegExp('[A-Za-z]', 'g'),
    invalid = new RegExp('[^A-Za-z0-9-_]','g'),
    tagList = [
        "id3_data",
        "id3_classNames",
        "id3_reverseTransform"
    ];

function ConsoleProxy () {
    var self = this;
    self.logs = [];
    self.error = null;
    self.output = null;
}
ConsoleProxy.prototype.log = function () {
    var self = this,
        i,
        result = "";
    for (i = 0; i < arguments.length; i += 1) {
        if (i > 0) {
            result += " ";
        }
        result += String(arguments[i]);
    }
    self.logs.push(result);
};
ConsoleProxy.prototype.logError = function (e) {
    var self = this;
    self.error = {
        'message' : String(e.message),
        'line' : String(e.line - 1)
    };
};
ConsoleProxy.prototype.setOutput = function (o) {
    var self = this;
    self.output = o;
};
ConsoleProxy.prototype.jsonPacket = function () {
    var self = this;
    return JSON.stringify({
        'logs' : self.logs,
        'error' : self.error,
        'output' : self.output
    });
};

var console = new ConsoleProxy();

function standardize(activeDoc) {
    var nameLookup = {};
    
    function standardizeItems(items, tagType) {
        var i,
            oldName,
            name,
            newName,
            freeId = 1,
            tag,
            t;
        
        for (i = 0; i < items.length; i += 1) {
            // Make sure item names begin with [A-Za-z] and contain only [A-Za-z0-9\-\_]
            // (jQuery / old DOM restrictions), and are unique (case-insensitive)
            oldName = items[i].name;
            name = oldName.replace(invalid, '_');
            if (name.length === 0) {
                name = items[i].constructor.name;
            } else if (alphabetic.test(name[0]) !== true) {
                name = items[i].constructor.name + '_' + name;
            }
            
            newName = name;
            while (reservedNames.hasOwnProperty(newName) || nameLookup.hasOwnProperty(newName)) {
                newName = name + freeId;
                freeId += 1;
            }
            items[i].name = newName;
            nameLookup[newName] = items[i];
            
            // Create the needed tags if they don't exist
            if (tagType === 'native') {
                for (t = 0; t < tagList.length; t += 1) {
                    try {
                        items[i].tags.getByName(tagList[t]);
                    } catch (e) {
                        tag = items[i].tags.add();
                        tag.name = tagList[t];
                        tag.value = 'null';
                    }
                }
            }
        }
    }
    
    standardizeItems(activeDoc.artboards, 'artboards');
    standardizeItems(activeDoc.layers, 'layers');
    
    standardizeItems(activeDoc.pathItems, 'native');
    standardizeItems(activeDoc.groupItems, 'native');
    
    return nameLookup;
}

function extractColor(e, attr) {
    // TODO: If the activeDocument is in CMYK mode, add
    // device-cmyk(c,m,y,k) to the SVG element's style
    // with an rgb backup. For now, I stupidly convert
    // everything to RGB
    if (e[attr].typename === 'RGBColor') {
        return 'rgb(' + e[attr].red + ',' +
                        e[attr].green + ',' +
                        e[attr].blue + ')';
    } else if (e[attr].typename === 'GrayColor') {
        return 'rgb(' + e[attr].gray + ',' +
                        e[attr].gray + ',' +
                        e[attr].gray + ')';
    } else if (e[attr].typename === 'CMYKColor') {
        return 'rgb(' + Math.floor(0.0255 * (100 - e[attr].cyan) * (100 - e[attr].black)) +
                  ',' + Math.floor(0.0255 * (100 - e[attr].magenta) * (100 - e[attr].black)) +
                  ',' + Math.floor(0.0255 * (100 - e[attr].yellow) * (100 - e[attr].black)) + ')';
        
        // TODO: switch to this once Chrome supports it
        //return 'device-cmyk(' + e[attr].cyan + ',' +
        //                        e[attr].magenta + ',' +
        //                        e[attr].yellow + ',' +
        //                        e[attr].black + ')';
    } else if (e[attr].typename === 'NoColor') {
        return 'none';
    }else {
        if (alertedUnsupported === false) {
            alert('hanpuku does not yet support ' + e[attr].typename);
            alertedUnsupported = true;
        }
        return 'rgb(0,0,0)';
    }
}

function extractPath (p) {
    var output = {
        itemType : 'path',
        name : p.name,
        fill : extractColor(p, 'fillColor'),
        stroke : extractColor(p, 'strokeColor'),
        strokeWidth : p.strokeWidth,
        opacity : p.opacity / 100,
        closed : p.closed,
        points : [],
        data : JSON.parse(p.tags.getByName('id3_data').value),
        classNames : p.tags.getByName('id3_classNames').value,
        reverseTransform : p.tags.getByName('id3_reverseTransform').value
    },
        pt,
        controlPoint;
    
    try {
        output.zIndex = p.zOrderPosition;
    } catch(e) {
        // TODO: there's a bug in Illustrator that causes an Internal error
        // if you attempt to get the zOrderPosition of an object inside a group
        output.zIndex = 100;
    }
    
    if (p.filled === false) {
        output.fill = 'none';
    }
    if (p.stroked === false) {
        output.stroke = 'none';
    }
    
    for (pt = 0; pt < p.pathPoints.length; pt += 1) {
        output.points.push({
            anchor : p.pathPoints[pt].anchor,
            leftDirection : p.pathPoints[pt].leftDirection,
            rightDirection : p.pathPoints[pt].rightDirection
        });
        for (controlPoint in output.points[pt]) {
            if (output.points[pt].hasOwnProperty(controlPoint)) {
                // Illustrator has inverted Y coordinates
                output.points[pt][controlPoint][1] = -output.points[pt][controlPoint][1];
            }
        }
    }
    
    return output;
}

function extractGroup(g, iType) {
    var output = {
        itemType : iType,
        name : g.name,
        groups : [],
        paths : []
    },
        s,
        p;
    
    try {
        output.zIndex = g.zOrderPosition;
    } catch(e) {
        // TODO: there's a bug in Illustrator that causes an Internal error
        // if you attempt to get the zOrderPosition of an object inside a group
        output.zIndex = 100;
    }
    
    if (iType === 'group') {
        output.data = JSON.parse(g.tags.getByName('id3_data').value);
        output.classNames = g.tags.getByName('id3_classNames').value;
        output.reverseTransform = g.tags.getByName('id3_reverseTransform').value;
    }
    
    for (s = 0; s < g.groupItems.length; s += 1) {
        output.groups.push(extractGroup(g.groupItems[s], 'group'));
    }
    for (p = 0; p < g.pathItems.length; p += 1) {
        output.paths.push(extractPath(g.pathItems[p]));
    }
    return output;
}

function extractDocument() {
    var output = null;

    if (app.documents.length > 0) {
        var activeDoc = app.activeDocument,
            newBoard,
            left, right, top, bottom,
            a, l, s;
        
        /*if (activeDoc.activeLayer.name === 'Isolation Mode') {
            alert('isolation!');
        }*/
        
        standardize(activeDoc);
        
        output = {
            itemType : 'document',
            name : activeDoc.name.split('.')[0],
            artboards : [],
            layers : [],
            selection : []
        };
        
        for (a = 0; a < activeDoc.artboards.length; a += 1) {
            newBoard = {
                name: activeDoc.artboards[a].name,
                rect: activeDoc.artboards[a].artboardRect
            };
            // Illustrator has inverted Y coordinates
            newBoard.rect[1] = -newBoard.rect[1];
            newBoard.rect[3] = -newBoard.rect[3];
            
            // Update the bounds of the whole document
            if (left === undefined || left > newBoard.rect[0]) {
                left = newBoard.rect[0];
            }
            if (top === undefined || top > newBoard.rect[1]) {
                top = newBoard.rect[1];
            }
            if (right === undefined || right < newBoard.rect[2]) {
                right = newBoard.rect[2];
            }
            if (bottom === undefined || bottom < newBoard.rect[3]) {
                bottom = newBoard.rect[3];
            }
            
            output.artboards.push(newBoard);
        }
        output.left = left;
        output.top = top;
        output.right = right;
        output.bottom = bottom;
        for (l = 0; l < activeDoc.layers.length; l += 1) {
            output.layers.push(extractGroup(activeDoc.layers[l], 'layer'));
        }
        for (s = 0; s < activeDoc.selection.length; s += 1) {
            output.selection.push(activeDoc.selection[s].name);
        }
    }
    
    return output;
}

try {
    console.setOutput(extractDocument());
} catch(e) {
    console.logError(e);
}
console.jsonPacket();