export default function(type) {
    function toByteBuffer(type, object) {
        var b = new ArrayBuffer(1);
        type.appendByteBuffer(b, object);
        return b;
    }

    function fromHex(hex) {
        var b = new Uint8Array(hex.match(/[\da-f]{2}/gi).map(function(h) {
            return parseInt(h, 16)
        }));
        return type.fromByteBuffer(b);
    }

    function toHex(object) {
        var b = toByteBuffer(type, object);
        return Array.prototype.map.call(new Uint8Array(b), function(x) {
            return ('00' + x.toString(16)).slice(-2);
        }).join('');
    }

    function fromBuffer(buffer) {
        var b = new Uint8Array(buffer);
        return type.fromByteBuffer(b);
    }

    function toBuffer(object) {
        var b = toByteBuffer(type, object);
        return new Uint8Array(b);
    }

    function fromBinary(string) {
        var b = new Uint8Array(string.split('').map(function(c) {
            return c.charCodeAt(0);
        }));
        return type.fromByteBuffer(b);
    }

    function toBinary(object) {
        var b = toByteBuffer(type, object);
        return String.fromCharCode.apply(null, new Uint8Array(b));
    }

    return {
        fromHex,
        toHex,
        fromBuffer,
        toBuffer,
        fromBinary,
        toBinary
    };
}
