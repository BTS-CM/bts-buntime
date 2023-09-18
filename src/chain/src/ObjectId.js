import v from "../../serializer/src/SerializerValidation";

var DB_MAX_INSTANCE_ID = BigInt(Math.pow(2, 48) - 1);

class ObjectId {
    constructor(space, type, instance) {
        this.space = space;
        this.type = type;
        this.instance = instance;
        var instance_string = this.instance.toString();
        var ObjectId = `${this.space}.${this.type}.${instance_string}`;
        if (!v.is_digits(instance_string)) {
            throw new `Invalid object id ${ObjectId}`();
        }
    }

    static fromString(value) {
        if (
            value.space !== undefined &&
            value.type !== undefined &&
            value.instance !== undefined
        ) {
            return value;
        }

        var params = v.require_match(
            /^([0-9]+)\.([0-9]+)\.([0-9]+)$/,
            v.required(value, "ObjectId"),
            "ObjectId"
        );
        return new ObjectId(
            parseInt(params[1]),
            parseInt(params[2]),
            BigInt(params[3])
        );
    }

    static fromLong(long) {
        const space = Number(long >> 56n);
        const type = Number((long >> 48n) & 0x00ffn);
        const instance = long & BigInt(Math.pow(2, 48) - 1);
        return new ObjectId(space, type, instance);
    }

    static fromByteBuffer(b) {
        return ObjectId.fromLong(b.readUint64());
    }

    static toLong() {
        return BigInt(this.space)
            << 56n
            | (BigInt(this.type) << 48n)
            | BigInt(this.instance);
    }

    appendByteBuffer(b) {
        return b.writeUint64(this.toLong());
    }

    toString() {
        return `${this.space}.${this.type}.${this.instance.toString()}`;
    }
}

export default ObjectId;
